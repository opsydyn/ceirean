import { expect, test } from 'bun:test';

import {
  LiveAdmissionRecord,
  type AuthorityQuery,
  type LiveAdmissionReply,
  type VerifiedCommand,
} from '@leviathan/domain';
import { Arbitrary, Effect, Fiber, Match, Option, Result, Schema } from 'effect';

import { validateCheckResult } from '../../domain/tests/properties.ts';
import { LiveAuthorityError } from '../src/live-admission-errors.ts';
import {
  makeLiveAuthority,
  makeLiveInbox,
  type LiveAuthorityDriver,
} from '../src/live-admission-factories.ts';
import { LiveAuthority, LiveInbox } from '../src/live-admission-ports.ts';
import { makeLiveAdmission } from '../src/live-admission-service.ts';
import { leaseFor, liveFixture, makeMemoryLiveInbox } from './memory-live-inbox.ts';

const actionSchema = Schema.Struct({
  id: Schema.Literals([0, 1, 2, 3, 4]),
  kind: Schema.Literals([
    'Replay',
    'Rename',
    'Digest',
    'Actor',
    'Issue',
    'Policy',
    'Fail',
    'Interrupt',
  ]),
});
const action = Arbitrary.schema(actionSchema);
const actions = Arbitrary.array(action, { minLength: 1, maxLength: 25 });
type Actions = typeof actions extends Arbitrary.Arbitrary<infer A> ? A : never;
function acquire(memory: ReturnType<typeof makeMemoryLiveInbox>, driver: LiveAuthorityDriver) {
  const program = makeLiveAdmission().pipe(
    Effect.provideService(LiveInbox, makeLiveInbox(memory.driver)),
    Effect.provideService(LiveAuthority, makeLiveAuthority(driver)),
  );
  return program;
}
function preview(reply: LiveAdmissionReply) {
  return Match.value(reply).pipe(
    Match.when({ _tag: 'Recorded', record: { decision: { _tag: 'AdmittedPreview' } } }, () => true),
    Match.orElse(() => false),
  );
}
const sameRecords = Schema.toEquivalence(Schema.Array(LiveAdmissionRecord));
function inputFor(id: number, delivery: string): VerifiedCommand {
  const input = liveFixture().verified;
  return {
    ...input,
    candidate: { ...input.candidate, commentId: 100 + id },
    receipt: { ...input.receipt, deliveryId: delivery },
  };
}
function success(query: AuthorityQuery) {
  return Promise.resolve(Result.succeed(leaseFor(query)));
}

function permutationLaw(sequence: Actions) {
  function* trace() {
    const memory = makeMemoryLiveInbox();
    let calls = 0;
    function check(query: AuthorityQuery) {
      calls += 1;
      return success(query);
    }
    const service = yield* acquire(memory, check);
    const unique = [...new Set(sequence.map((action) => action.id))];
    let safe = true;
    for (const id of unique) {
      const first = yield* service.admit(inputFor(id, `first-${id}`));
      safe = safe && preview(first);
    }
    const originals = memory.records();
    const before = calls;
    for (const [index, action] of [...sequence].reverse().entries()) {
      const duplicate = yield* service.admit(inputFor(action.id, `permuted-${index}`));
      const duplicated = Match.value(duplicate).pipe(
        Match.tag('Duplicate', () => true),
        Match.orElse(() => false),
      );
      safe = safe && duplicated;
    }
    return [
      safe,
      calls === before,
      before === unique.length,
      sameRecords(originals, memory.records()),
      memory.receipts().length === unique.length + sequence.length,
    ].every(Boolean);
  }
  const program = Effect.gen(trace);
  return program;
}

function conflictLaw(sequence: Actions) {
  function* trace() {
    const memory = makeMemoryLiveInbox();
    let calls = 0;
    function check(query: AuthorityQuery) {
      calls += 1;
      return success(query);
    }
    const service = yield* acquire(memory, check);
    const input = inputFor(0, 'original');
    const control = yield* service.admit(input);
    const originals = memory.records();
    let safe = preview(control);
    for (const [index, action] of sequence.entries()) {
      const changed = Match.value(action.kind).pipe(
        Match.when('Digest', () => ({
          ...input,
          receipt: { ...input.receipt, rawBodyDigest: 'b'.repeat(64) },
        })),
        Match.when('Actor', () => ({
          ...input,
          candidate: { ...input.candidate, operatorId: 67 },
          receipt: { ...input.receipt, deliveryId: `actor-${index}` },
        })),
        Match.when('Issue', () => ({
          ...input,
          candidate: { ...input.candidate, issueId: 999 },
          receipt: { ...input.receipt, deliveryId: `issue-${index}` },
        })),
        Match.orElse(() => ({
          ...input,
          candidate: { ...input.candidate, ownerLogin: 'rename', repositoryName: 'rename' },
          receipt: { ...input.receipt, deliveryId: `rename-${index}` },
        })),
      );
      const reply = yield* service.admit(changed);
      const expected = Match.value(action.kind).pipe(
        Match.when('Digest', () => 'DeliveryConflict'),
        Match.when('Actor', () => 'CommandConflict'),
        Match.when('Issue', () => 'CommandConflict'),
        Match.orElse(() => 'Duplicate'),
      );
      const duplicateExpected = Match.value(expected).pipe(
        Match.when('Duplicate', () => true),
        Match.orElse(() => false),
      );
      const correct = Match.value(reply).pipe(
        Match.tag('Duplicate', () => duplicateExpected),
        Match.tag('Unrecorded', ({ decision }) => decision.reason === expected),
        Match.orElse(() => false),
      );
      safe = safe && correct && sameRecords(originals, memory.records()) && calls === 1;
    }
    return safe;
  }
  const program = Effect.gen(trace);
  return program;
}

function isolationLaw(sequence: Actions) {
  function* trace() {
    const memory = makeMemoryLiveInbox();
    let calls = 0;
    let mutation = -1;
    function check(query: AuthorityQuery) {
      calls += 1;
      const current = leaseFor(query);
      function race() {
        const observation = memory.observation();
        memory.setObservation({
          ...observation,
          policy: { ...observation.policy, revision: `raced-${mutation}` },
        });
        return current;
      }
      const lease = Match.value(mutation).pipe(
        Match.when(-1, () => current),
        Match.when(
          (value) => value % 3 === 0,
          () => ({ ...current, evidence: { ...current.evidence, operatorId: 66 } }),
        ),
        Match.when(
          (value) => value % 3 === 1,
          () => ({ ...current, evidence: { ...current.evidence, localPolicyRevision: 'stale' } }),
        ),
        Match.orElse(race),
      );
      return Promise.resolve(Result.succeed(lease));
    }
    const service = yield* acquire(memory, check);
    const control = yield* service.admit(inputFor(0, 'control'));
    const original = memory.records();
    let safe = preview(control);
    for (const [index, action] of sequence.entries()) {
      mutation = index + action.id;
      const baseline = memory.observation();
      memory.setObservation({
        ...baseline,
        policy: { ...baseline.policy, revision: `revision-${index}-${action.id}` },
      });
      const input = inputFor(index + 1, `isolated-${index}`);
      const other = { ...input, candidate: { ...input.candidate, operatorId: 67 } };
      const result = yield* service.admit(other).pipe(Effect.result);
      function revisionRefused(reply: LiveAdmissionReply) {
        return Match.value(reply).pipe(
          Match.when({ _tag: 'Unrecorded', decision: { reason: 'AuthorityChanged' } }, () => true),
          Match.orElse(() => false),
        );
      }
      const refused = Result.match(result, { onFailure: () => true, onSuccess: revisionRefused });
      safe = safe && refused && sameRecords(original, memory.records());
    }
    return safe && calls === sequence.length + 1;
  }
  const program = Effect.gen(trace);
  return program;
}

function failedLaw(sequence: Actions) {
  function* trace() {
    const memory = makeMemoryLiveInbox();
    const controlService = yield* acquire(memory, success);
    const control = yield* controlService.admit(inputFor(0, 'control'));
    const originals = memory.records();
    let safe = preview(control);
    for (const [index, action] of sequence.entries()) {
      let signal = Option.none<AbortSignal>();
      let finish = (_value: Result.Result<ReturnType<typeof leaseFor>, LiveAuthorityError>) => {};
      function pending(_query: AuthorityQuery, received: AbortSignal) {
        signal = Option.some(received);
        return new Promise<Result.Result<ReturnType<typeof leaseFor>, LiveAuthorityError>>(
          function capture(resolve) {
            finish = resolve;
          },
        );
      }
      function fail() {
        return Promise.resolve(
          Result.fail(new LiveAuthorityError({ phase: 'permission', code: 'Unavailable' })),
        );
      }
      const explicitInterrupt = Match.value(action.kind).pipe(
        Match.when('Interrupt', () => true),
        Match.orElse(() => false),
      );
      const interrupted = explicitInterrupt || action.id % 2 === 0;
      const driver = Match.value(interrupted).pipe(
        Match.when(true, () => pending),
        Match.orElse(() => fail),
      );
      const service = yield* acquire(memory, driver);
      const input = inputFor(index + 1, `failed-${index}`);
      function* interrupt() {
        const fiber = yield* Effect.forkChild(service.admit(input), { startImmediately: true });
        yield* Fiber.interrupt(fiber);
        const late = leaseFor({ verified: input, policy: memory.observation().policy });
        finish(Result.succeed(late));
        yield* Effect.yieldNow;
        return Option.exists(signal, (received) => received.aborted);
      }
      const failed = service.admit(input).pipe(Effect.result, Effect.map(Result.isFailure));
      const interruption = Effect.gen(interrupt);
      const checked = Match.value(interrupted).pipe(
        Match.when(true, () => interruption),
        Match.orElse(() => failed),
      );
      const refused = yield* checked;
      safe =
        safe &&
        refused &&
        sameRecords(originals, memory.records()) &&
        memory.receipts().length === 1;
    }
    return safe;
  }
  const program = Effect.gen(trace);
  return program.pipe(Effect.scoped);
}

const laws = {
  'delivery permutation deduplication': permutationLaw,
  'command and receipt conflict history': conflictLaw,
  'operator and policy isolation': isolationLaw,
  'failed and interrupted checks cannot admit': failedLaw,
};
for (const [name, law] of Object.entries(laws)) {
  for (const seed of [0, 1, 163]) {
    async function runLaw() {
      const checking = Arbitrary.checkEffect(actions, law, {
        seed,
        runs: 1000,
        size: 50,
        maxShrinks: 1000,
        maxDiscards: 10000,
      });
      function verify(result: Arbitrary.CheckResult<unknown, unknown>) {
        const validation = validateCheckResult(`live engine ${name}`, seed, result, 1000);
        const program = Effect.fromResult(validation);
        return program;
      }
      const verified = checking.pipe(Effect.tap(verify));
      const result = await Effect.runPromise(verified);
      expect(result).toMatchObject({ _tag: 'Passed', runs: 1000 });
    }
    test(`live engine law: ${name}; seed ${seed}`, runLaw);
  }
}
