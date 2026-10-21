import { expect, test } from 'bun:test';

import { Digest, type AdmissionDraft, type AdmissionReply } from '@ceirean/domain';
import { Data, Effect, Match, Option, Result } from 'effect';

import { makeCommandInbox } from '../src/index.ts';
import {
  acquireCommandAdmission,
  authorityFixture,
  draftFixture,
  verifiedCommandFixture,
} from './command-fixtures.ts';
import { makeMemoryCommandInbox } from './memory-command-inbox.ts';

function committed(memory: ReturnType<typeof makeMemoryCommandInbox>, draft = draftFixture()) {
  return Result.getOrThrow(memory.driver.commit(draft));
}
function recordOf(reply: AdmissionReply) {
  const selected = Match.value(reply).pipe(
    Match.tag('Recorded', 'Duplicate', ({ record }) => Option.some(record)),
    Match.orElse(() => Option.none()),
  );
  return Option.getOrThrow(selected);
}

function digestConflict() {
  const memory = makeMemoryCommandInbox();
  const first = committed(memory);
  const original = draftFixture();
  const changed = {
    ...original,
    verified: {
      ...original.verified,
      receipt: { ...original.verified.receipt, rawBodyDigest: Digest.make('b'.repeat(64)) },
    },
  };
  expect(committed(memory, changed)).toEqual({
    _tag: 'Unrecorded',
    decision: { _tag: 'Rejected', reason: 'DeliveryConflict' },
  });
  expect(memory.records()).toEqual([recordOf(first)]);
}
test('same transport key with different digest preserves first record', digestConflict);

for (const fact of ['operatorId', 'issueId', 'issueNumber', 'ownerId'] as const) {
  function factConflict() {
    const memory = makeMemoryCommandInbox();
    const first = committed(memory);
    const original = verifiedCommandFixture();
    const candidate = { ...original.candidate, [fact]: original.candidate[fact] + 1 };
    const sameDelivery = draftFixture({ ...original, candidate });
    expect(committed(memory, sameDelivery)).toMatchObject({
      _tag: 'Unrecorded',
      decision: { reason: 'DeliveryConflict' },
    });
    const changed = {
      ...original,
      candidate,
      receipt: { ...original.receipt, deliveryId: 'new-delivery' },
    };
    const newDelivery = draftFixture(changed);
    expect(committed(memory, newDelivery)).toMatchObject({
      _tag: 'Unrecorded',
      decision: { reason: 'CommandConflict' },
    });
    expect(memory.records()).toEqual([recordOf(first)]);
  }
  test(`changed immutable ${fact} conflicts under old and new delivery IDs`, factConflict);
}

async function historicalDuplicate() {
  const memory = makeMemoryCommandInbox();
  const service = await Effect.runPromise(acquireCommandAdmission(memory.driver));
  const original = verifiedCommandFixture();
  const first = await Effect.runPromise(service.admit(original));
  const observation = authorityFixture();
  memory.setAuthority({ atMs: 5000, state: { _tag: 'Unavailable', revision: 'revoked' } });
  const renamed = {
    ...original,
    candidate: {
      ...original.candidate,
      ownerLogin: 'renamed-owner',
      repositoryName: 'renamed-repo',
    },
    receipt: { ...original.receipt, deliveryId: 'redelivered' },
  };
  const second = await Effect.runPromise(service.admit(renamed));
  expect(second).toEqual({ _tag: 'Duplicate', record: recordOf(first) });
  memory.setAuthority(observation);
  expect(memory.records()).toHaveLength(1);
}
test(
  'rename and new delivery reference historical preview after revocation and expiry',
  historicalDuplicate,
);

async function rejectedStaysRejected() {
  const memory = makeMemoryCommandInbox();
  const observation = authorityFixture();
  const state = { ...observation.state, _tag: 'Available' as const };
  memory.setAuthority({ ...observation, state: { ...state, profile: { _tag: 'Disabled' } } });
  const service = await Effect.runPromise(acquireCommandAdmission(memory.driver));
  const input = verifiedCommandFixture();
  const first = await Effect.runPromise(service.admit(input));
  expect(first).toMatchObject({
    _tag: 'Recorded',
    record: { decision: { _tag: 'Rejected', reason: 'ProfileUnavailable' } },
  });
  memory.setAuthority({ ...observation, state: { ...state, revision: 'authority-2' } });
  expect(await Effect.runPromise(service.admit(input))).toEqual({
    _tag: 'Duplicate',
    record: recordOf(first),
  });
  const next = {
    ...input,
    candidate: { ...input.candidate, commentId: 56 },
    receipt: { ...input.receipt, deliveryId: 'next-comment' },
  };
  expect(await Effect.runPromise(service.admit(next))).toMatchObject({
    _tag: 'Recorded',
    record: { decision: { _tag: 'AdmittedPreview' } },
  });
}
test(
  'rejected command remains rejected after profile changes; a new comment succeeds',
  rejectedStaysRejected,
);

function commitBeforeEvaluation() {
  const memory = makeMemoryCommandInbox();
  const observation = authorityFixture();
  memory.setAuthority({ ...observation, atMs: 999 });
  expect(committed(memory)).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'InvalidClock' },
  });
  expect(memory.records()).toHaveLength(0);
  expect(memory.receipts()).toHaveLength(0);
}
test(
  'commit clock earlier than evaluation refuses first fresh preview without a floor',
  commitBeforeEvaluation,
);

function evaluationWindow() {
  const memory = makeMemoryCommandInbox();
  expect(committed(memory, { ...draftFixture(), evaluatedAtMs: 0 })).toMatchObject({
    _tag: 'Unrecorded',
  });
  expect(memory.records()).toHaveLength(0);
}
test('draft evaluation must itself be inside the authority observation window', evaluationWindow);

function immutableReceipt() {
  const memory = makeMemoryCommandInbox();
  committed(memory);
  const before = memory.receipts();
  const draft = draftFixture();
  const renamed = {
    ...draft,
    verified: {
      ...draft.verified,
      candidate: { ...draft.verified.candidate, ownerLogin: 'renamed' },
    },
  };
  expect(committed(memory, renamed)).toMatchObject({ _tag: 'Duplicate' });
  expect(memory.receipts()).toEqual(before);
}
test('known transport receipt is never overwritten by a display-name rename', immutableReceipt);

function clockFloor() {
  const memory = makeMemoryCommandInbox();
  const first = committed(memory);
  const observation = authorityFixture();
  memory.setAuthority({ ...observation, atMs: 999 });
  const input = verifiedCommandFixture();
  const next = {
    ...input,
    candidate: { ...input.candidate, commentId: 56 },
    receipt: { ...input.receipt, deliveryId: 'next' },
  };
  const draft = draftFixture(next, { ...observation, atMs: 999 });
  expect(committed(memory, draft)).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'InvalidClock' },
  });
  expect(committed(memory)).toEqual({ _tag: 'Duplicate', record: recordOf(first) });
}
test('committed clock floor cannot regress but historical duplicates still resolve', clockFloor);

function decisionCapacity() {
  const memory = makeMemoryCommandInbox();
  const input = verifiedCommandFixture();
  for (let index = 0; index < 256; index += 1) {
    const next = {
      ...input,
      candidate: { ...input.candidate, commentId: 55 + index },
      receipt: { ...input.receipt, deliveryId: `delivery-${index}` },
    };
    const draft = draftFixture(next);
    expect(committed(memory, draft)).toMatchObject({ _tag: 'Recorded' });
  }
  const before = memory.records();
  const next = {
    ...input,
    candidate: { ...input.candidate, commentId: 999 },
    receipt: { ...input.receipt, deliveryId: 'overflow' },
  };
  const overflow = draftFixture(next);
  const duplicate = draftFixture({
    ...input,
    receipt: { ...input.receipt, deliveryId: 'delivery-0' },
  });
  expect(committed(memory, overflow)).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'CapacityExceeded' },
  });
  expect(committed(memory, duplicate)).toMatchObject({ _tag: 'Duplicate' });
  expect(memory.records()).toEqual(before);
}
test('decision capacity never evicts; identical receipt works at capacity', decisionCapacity);

function transportCapacity() {
  const memory = makeMemoryCommandInbox();
  const input = verifiedCommandFixture();
  for (let index = 0; index < 1024; index += 1) {
    const next = { ...input, receipt: { ...input.receipt, deliveryId: `receipt-${index}` } };
    committed(memory, draftFixture(next));
  }
  expect(memory.receipts()).toHaveLength(1024);
  expect(committed(memory)).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'CapacityExceeded' },
  });
  const next = {
    ...input,
    candidate: { ...input.candidate, commentId: 56 },
    receipt: { ...input.receipt, deliveryId: 'overflow-new' },
  };
  const overflow = draftFixture(next);
  const duplicate = draftFixture({
    ...input,
    receipt: { ...input.receipt, deliveryId: 'receipt-0' },
  });
  expect(committed(memory, overflow)).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'CapacityExceeded' },
  });
  expect(committed(memory, duplicate)).toMatchObject({ _tag: 'Duplicate' });
  expect(memory.records()).toHaveLength(1);
}
test('transport capacity is atomic for new decisions and duplicate receipts', transportCapacity);

async function inputAndReplyValidation() {
  const memory = makeMemoryCommandInbox();
  const service = await Effect.runPromise(acquireCommandAdmission(memory.driver));
  const input = verifiedCommandFixture();
  for (const invalid of [
    null,
    {},
    { ...input, receipt: { ...input.receipt, eventName: 'issues' } },
    { ...input, receipt: { ...input.receipt, ingressScopeId: 'other' } },
  ]) {
    expect(await Effect.runPromise(service.admit(invalid))).toMatchObject({
      _tag: 'Unrecorded',
      decision: { reason: 'MalformedInput' },
    });
  }
  expect(memory.calls()).toEqual({ load: 0, commit: 0 });
  const inbox = makeCommandInbox({
    ...memory.driver,
    commit: () => Result.succeed({ _tag: 'Recorded' } as never),
  });
  expect(await Effect.runPromise(inbox.commit(draftFixture()).pipe(Effect.result))).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'CommandInboxError', code: 'InvalidData' },
  });
}
test(
  'invalid input and event header binding never call driver; malformed reply fails',
  inputAndReplyValidation,
);

async function replyMismatch() {
  const memory = makeMemoryCommandInbox();
  const record = recordOf(committed(memory));
  const variants = [
    { ...record, candidate: { ...record.candidate, operatorId: 99 } },
    { ...record, commandKey: '[11,22,99]' },
    { ...record, committedAtMs: 999 },
    { ...record, authorityRevision: 'wrong' },
    { ...record, evaluatedAtMs: 999 },
  ];
  for (const variant of variants) {
    for (const tag of ['Recorded', 'Duplicate'] as const) {
      const inbox = makeCommandInbox({
        ...memory.driver,
        commit: () => Result.succeed({ _tag: tag, record: variant }),
      });
      const result = await Effect.runPromise(inbox.commit(draftFixture()).pipe(Effect.result));
      const expected = Match.value(tag).pipe(
        Match.when('Duplicate', () => variant.evaluatedAtMs === 999),
        Match.orElse(() => false),
      );
      expect(Result.isSuccess(result)).toBe(expected);
    }
  }
}
test('mismatched fresh and historical record replies fail operationally', replyMismatch);

async function driverThrows() {
  const memory = makeMemoryCommandInbox();
  class SyntheticStoreFault extends Data.TaggedError('SyntheticStoreFault')<{
    readonly secret: string;
  }> {}
  function explode(): never {
    throw new SyntheticStoreFault({ secret: 'secret backing store details' });
  }
  for (const operation of ['loadAuthority', 'commit'] as const) {
    const driver = { ...memory.driver, [operation]: explode };
    const service = await Effect.runPromise(acquireCommandAdmission(driver));
    const result = await Effect.runPromise(
      service.admit(verifiedCommandFixture()).pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
    const error = Option.getOrThrow(Result.getFailure(result));
    expect(error.message).not.toContain('secret');
    expect('secret' in error).toBe(false);
    expect(memory.records()).toHaveLength(0);
  }
}
test('driver throws are sanitized observed failures, never recorded decisions', driverThrows);

async function detachedHistory() {
  const memory = makeMemoryCommandInbox();
  const input = structuredClone(verifiedCommandFixture());
  function mutateDriverDraft(draft: AdmissionDraft) {
    const result = memory.driver.commit(draft);
    Object.assign(draft.verified.candidate, { operatorId: 999 });
    return result;
  }
  const service = await Effect.runPromise(
    acquireCommandAdmission({ ...memory.driver, commit: mutateDriverDraft }),
  );
  const result = await Effect.runPromise(service.admit(input));
  const original = memory.records();
  Object.assign(input.candidate, { operatorId: 888 });
  Object.assign(recordOf(result).candidate, { operatorId: 777 });
  Object.assign(memory.records()[0]?.candidate ?? {}, { operatorId: 666 });
  expect(memory.records()).toEqual(original);
  expect(recordOf(result).candidate.operatorId).toBe(777);
  expect(original[0]?.candidate.operatorId).toBe(66);
}
test(
  'driver, caller, and returned snapshot mutation cannot rewrite retained history',
  detachedHistory,
);
