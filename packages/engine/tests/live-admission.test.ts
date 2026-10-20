import { expect, test } from 'bun:test';

import { Effect, Fiber, Option, Result } from 'effect';

import { LiveAuthorityError } from '../src/live-admission-errors.ts';
import {
  makeLiveAuthority,
  makeLiveInbox,
  type LiveAuthorityDriver,
} from '../src/live-admission-factories.ts';
import { LiveAuthority, LiveInbox } from '../src/live-admission-ports.ts';
import { makeLiveAdmission } from '../src/live-admission-service.ts';
import { leaseFor, liveFixture, makeMemoryLiveInbox } from './memory-live-inbox.ts';

function harness() {
  const memory = makeMemoryLiveInbox();
  let calls = 0;
  let authority: LiveAuthorityDriver = (query) => Promise.resolve(Result.succeed(leaseFor(query)));
  function check(query: Parameters<LiveAuthorityDriver>[0], signal: AbortSignal) {
    calls += 1;
    return authority(query, signal);
  }
  const acquire = makeLiveAdmission().pipe(
    Effect.provideService(LiveInbox, makeLiveInbox(memory.driver)),
    Effect.provideService(LiveAuthority, makeLiveAuthority(check)),
  );
  return {
    memory,
    acquire,
    calls: () => calls,
    setAuthority: (next: LiveAuthorityDriver) => {
      authority = next;
    },
  };
}

async function replayCase() {
  const h = harness();
  const input = liveFixture().verified;
  function* replay() {
    const service = yield* h.acquire;
    const first = yield* service.admit(input);
    const calls = h.calls();
    h.setAuthority(() =>
      Promise.resolve(
        Result.fail(new LiveAuthorityError({ phase: 'permission', code: 'Unavailable' })),
      ),
    );
    const replay = yield* service.admit(input);
    const other = yield* service.admit({
      ...input,
      receipt: { ...input.receipt, deliveryId: 'other' },
    });
    return { first, replay, other, calls };
  }
  const program = Effect.gen(replay);
  const result = await Effect.runPromise(program);
  expect(result.first).toMatchObject({
    _tag: 'Recorded',
    record: { decision: { _tag: 'AdmittedPreview' } },
  });
  expect(result.replay._tag).toBe('Duplicate');
  expect(result.other._tag).toBe('Duplicate');
  expect(h.calls()).toBe(result.calls);
  expect(h.memory.records()).toHaveLength(1);
  expect(h.memory.receipts()).toHaveLength(2);
}
test('known replay performs zero authority calls; new delivery only adds a receipt', replayCase);

async function freshCase() {
  const h = harness();
  const input = liveFixture().verified;
  const service = await Effect.runPromise(h.acquire);
  const denied = await Effect.runPromise(
    service.admit({ ...input, candidate: { ...input.candidate, operatorId: 99 } }),
  );
  expect(h.calls()).toBe(0);
  expect(denied).toMatchObject({
    _tag: 'Recorded',
    record: { provenance: { _tag: 'LocalPolicy' }, decision: { _tag: 'Rejected' } },
  });
  const eligible = {
    ...input,
    receipt: { ...input.receipt, deliveryId: 'new' },
    candidate: { ...input.candidate, commentId: 56 },
  };
  expect(await Effect.runPromise(service.admit(eligible))).toMatchObject({
    _tag: 'Recorded',
    record: { decision: { _tag: 'AdmittedPreview' } },
  });
  expect(h.calls()).toBe(1);
}
test(
  'unknown eligible comment performs a fresh call; unknown denied operator performs zero calls',
  freshCase,
);

async function operatorCase() {
  const h = harness();
  const fixture = liveFixture();
  const borrowed = leaseFor(fixture);
  h.setAuthority(() => Promise.resolve(Result.succeed(borrowed)));
  const service = await Effect.runPromise(h.acquire);
  const admission = service
    .admit({
      ...fixture.verified,
      candidate: { ...fixture.verified.candidate, operatorId: 67 },
    })
    .pipe(Effect.result);
  const result = await Effect.runPromise(admission);
  expect(result._tag).toBe('Failure');
  expect(h.memory.records()).toHaveLength(0);
}
test('two operators cannot share evidence', operatorCase);

async function failureCase() {
  const h = harness();
  h.setAuthority(() => Promise.reject(new Error('secret native failure')));
  const service = await Effect.runPromise(h.acquire);
  const admission = service.admit(liveFixture().verified).pipe(Effect.result);
  const result = await Effect.runPromise(admission);
  expect(result).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'LiveAuthorityError', code: 'Unavailable' },
  });
  const failure = Option.getOrThrow(Result.getFailure(result));
  expect(failure).toEqual(new LiveAuthorityError({ phase: 'permission', code: 'Unavailable' }));
  expect(h.memory.records()).toHaveLength(0);
  expect(h.memory.receipts()).toHaveLength(0);
}
test('operational failure stores no decision', failureCase);

async function policyCase() {
  const h = harness();
  function commit(draft: Parameters<typeof h.memory.driver.commit>[0]) {
    const previous = h.memory.observation();
    h.memory.setObservation({
      ...previous,
      policy: { ...previous.policy, revision: 'competing' },
    });
    return h.memory.driver.commit(draft);
  }
  const driver = { ...h.memory.driver, commit };
  const service = await Effect.runPromise(
    makeLiveAdmission().pipe(
      Effect.provideService(LiveInbox, makeLiveInbox(driver)),
      Effect.provideService(
        LiveAuthority,
        makeLiveAuthority((query) => Promise.resolve(Result.succeed(leaseFor(query)))),
      ),
    ),
  );
  expect(await Effect.runPromise(service.admit(liveFixture().verified))).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'AuthorityChanged' },
  });
  expect(h.memory.records()).toHaveLength(0);
}
test('competing policy revision refuses commit', policyCase);

async function digestCase() {
  const h = harness();
  const service = await Effect.runPromise(h.acquire);
  const input = liveFixture().verified;
  await Effect.runPromise(service.admit(input));
  const before = h.calls();
  expect(
    await Effect.runPromise(
      service.admit({ ...input, receipt: { ...input.receipt, rawBodyDigest: 'b'.repeat(64) } }),
    ),
  ).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'DeliveryConflict' } });
  expect(h.calls()).toBe(before);
  expect(h.memory.records()).toHaveLength(1);
}
test('same delivery changed digest conflicts before network', digestCase);

async function authorityBoundary() {
  let calls = 0;
  function deniedQuery(query: Parameters<LiveAuthorityDriver>[0]) {
    calls += 1;
    const lease = leaseFor(query);
    return Promise.resolve(
      Result.succeed({ ...lease, evidence: { ...lease.evidence, operatorId: 99 } }),
    );
  }
  const authority = makeLiveAuthority(deniedQuery);
  const fixture = liveFixture();
  const checking = authority.check({
    verified: fixture.verified,
    policy: { ...fixture.policy, allowedOperatorIds: [] },
  });
  expect(calls).toBe(0);
  const result = await Effect.runPromise(checking.pipe(Effect.result));
  expect(result._tag).toBe('Failure');
}
test(
  'authority boundary rejects mismatched evidence even for a locally denied query',
  authorityBoundary,
);

async function inboxBoundary() {
  const memory = makeMemoryLiveInbox();
  let calls = 0;
  function loadPolicy() {
    calls += 1;
    const value = memory.observation();
    return Result.succeed({ ...value, at: { ...value.at, wallMs: -1 } });
  }
  const inbox = makeLiveInbox({ ...memory.driver, loadPolicy });
  const loading = inbox.loadPolicy('fixture-app');
  expect(calls).toBe(0);
  const result = await Effect.runPromise(loading.pipe(Effect.result));
  expect(result).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'LiveInboxError', code: 'InvalidData' },
  });
  expect(calls).toBe(1);
}
test('inbox defers native operations and decodes invalid native output', inboxBoundary);

async function lateSuccess() {
  const h = harness();
  let signal = Option.none<AbortSignal>();
  let finish = (_value: Result.Result<ReturnType<typeof leaseFor>, LiveAuthorityError>) => {};
  function pending(_query: Parameters<LiveAuthorityDriver>[0], received: AbortSignal) {
    signal = Option.some(received);
    return new Promise<Result.Result<ReturnType<typeof leaseFor>, LiveAuthorityError>>(
      function capture(resolve) {
        finish = resolve;
      },
    );
  }
  h.setAuthority(pending);
  function* scenario() {
    const service = yield* h.acquire;
    const fiber = yield* Effect.forkChild(service.admit(liveFixture().verified), {
      startImmediately: true,
    });
    yield* Fiber.interrupt(fiber);
    expect(Option.getOrThrow(signal).aborted).toBe(true);
    const late = leaseFor(liveFixture());
    finish(Result.succeed(late));
    yield* Effect.yieldNow;
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program.pipe(Effect.scoped));
  expect(h.memory.records()).toHaveLength(0);
  expect(h.memory.receipts()).toHaveLength(0);
}
test('interruption aborts native check and late success cannot commit', lateSuccess);

async function commitReplayRace() {
  const memory = makeMemoryLiveInbox();
  let commits = 0;
  function commit(draft: Parameters<typeof memory.driver.commit>[0]) {
    commits += 1;
    memory.driver.commit(draft);
    return memory.driver.commit(draft);
  }
  const driver = { ...memory.driver, commit };
  const acquisition = makeLiveAdmission().pipe(
    Effect.provideService(LiveInbox, makeLiveInbox(driver)),
    Effect.provideService(
      LiveAuthority,
      makeLiveAuthority((query) => Promise.resolve(Result.succeed(leaseFor(query)))),
    ),
  );
  const service = await Effect.runPromise(acquisition);
  const reply = await Effect.runPromise(service.admit(liveFixture().verified));
  expect(reply._tag).toBe('Duplicate');
  expect(commits).toBe(1);
  expect(memory.records()).toHaveLength(1);
  expect(memory.receipts()).toHaveLength(1);
}
test('final commit rechecks replay atomically after a competing commit', commitReplayRace);

async function capacityCase() {
  const h = harness();
  function* fill() {
    const service = yield* h.acquire;
    const input = liveFixture().verified;
    for (let index = 0; index < 256; index += 1) {
      const reply = yield* service.admit({
        ...input,
        candidate: { ...input.candidate, commentId: 1000 + index },
        receipt: { ...input.receipt, deliveryId: `capacity-${index}` },
      });
      expect(reply._tag).toBe('Recorded');
    }
    const original = {
      ...input,
      candidate: { ...input.candidate, commentId: 1000 },
      receipt: { ...input.receipt, deliveryId: 'capacity-0' },
    };
    for (let index = 0; index < 768; index += 1) {
      const duplicate = yield* service.admit({
        ...original,
        receipt: { ...original.receipt, deliveryId: `receipt-${index}` },
      });
      expect(duplicate._tag).toBe('Duplicate');
    }
    const before = h.calls();
    const known = yield* service.admit(original);
    const unknown = yield* service.admit({
      ...original,
      receipt: { ...original.receipt, deliveryId: 'over-capacity' },
    });
    const changed = yield* service.admit({
      ...original,
      receipt: { ...original.receipt, rawBodyDigest: 'b'.repeat(64) },
    });
    expect(known._tag).toBe('Duplicate');
    expect(unknown).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'CapacityExceeded' } });
    expect(changed).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'DeliveryConflict' } });
    expect(h.calls()).toBe(before);
  }
  const program = Effect.gen(fill);
  await Effect.runPromise(program);
  expect(h.memory.records()).toHaveLength(256);
  expect(h.memory.receipts()).toHaveLength(1024);
}
test('known receipts and conflicts remain readable at both capacity ceilings', capacityCase);

async function reloadClockCase() {
  const h = harness();
  function rewind(query: Parameters<LiveAuthorityDriver>[0]) {
    const observation = h.memory.observation();
    h.memory.setObservation({ ...observation, at: { ...observation.at, monotonicMs: 199 } });
    return Promise.resolve(Result.succeed(leaseFor(query)));
  }
  h.setAuthority(rewind);
  const service = await Effect.runPromise(h.acquire);
  const reply = await Effect.runPromise(service.admit(liveFixture().verified));
  expect(reply).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'InvalidClock' } });
  expect(h.memory.records()).toHaveLength(0);
}
test('clock reload cannot roll backward across a live check', reloadClockCase);
