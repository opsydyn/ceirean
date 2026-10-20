import { expect, test } from 'bun:test';

import {
  AdmissionRecord,
  Digest,
  type AuthorityObservation,
  type AdmissionReply,
  type AdmissionDraft,
} from '@leviathan/domain';
import { Arbitrary, Effect, Match, Schema } from 'effect';

import { validateCheckResult } from '../../domain/tests/properties.ts';
import {
  acquireCommandAdmission,
  authorityFixture,
  verifiedCommandFixture,
} from './command-fixtures.ts';
import { makeMemoryCommandInbox } from './memory-command-inbox.ts';

const action = Schema.Struct({
  comment: Schema.Literals([55, 56, 57, 58]),
  delivery: Schema.Literals([0, 1, 2, 3, 4]),
  kind: Schema.Literals([
    'Replay',
    'Rename',
    'Conflict',
    'Digest',
    'Replace',
    'Revoke',
    'Expire',
    'Rewind',
  ]),
});
type Action = typeof action.Type;
const sequences = Arbitrary.array(Arbitrary.schema(action), { minLength: 1, maxLength: 20 });
const sameRecord = Schema.toEquivalence(AdmissionRecord);
const sameRecords = Schema.toEquivalence(Schema.Array(AdmissionRecord));

function isPreview(reply: AdmissionReply) {
  function admitted(recorded: Extract<AdmissionReply, { readonly _tag: 'Recorded' }>) {
    return Match.value(recorded.record.decision).pipe(
      Match.tag('AdmittedPreview', () => true),
      Match.orElse(() => false),
    );
  }
  return Match.value(reply).pipe(
    Match.tag('Recorded', admitted),
    Match.orElse(() => false),
  );
}
function inputFor(step: Action) {
  const input = verifiedCommandFixture();
  const candidate = { ...input.candidate, commentId: step.comment };
  const changed = Match.value(step.kind).pipe(
    Match.when('Rename', () => ({
      ...candidate,
      ownerLogin: 'renamed',
      repositoryName: 'renamed',
    })),
    Match.when('Conflict', () => ({ ...candidate, operatorId: 99 })),
    Match.orElse(() => candidate),
  );
  const digest = Match.value(step.kind).pipe(
    Match.when('Digest', () => Digest.make('b'.repeat(64))),
    Match.orElse(() => input.receipt.rawBodyDigest),
  );
  return {
    ...input,
    candidate: changed,
    receipt: { ...input.receipt, deliveryId: `generated-${step.delivery}`, rawBodyDigest: digest },
  };
}

function replayTrace(actions: readonly Action[]) {
  const memory = makeMemoryCommandInbox();
  function* scenario() {
    const service = yield* acquireCommandAdmission(memory.driver);
    const control = yield* service.admit(verifiedCommandFixture());
    const originals = new Map<string, AdmissionRecord>();
    let unique = isPreview(control);
    let immutable = unique;
    const freshCounts = new Map<string, number>();
    function countFresh(reply: AdmissionReply) {
      function count({ record }: Extract<AdmissionReply, { readonly _tag: 'Recorded' }>) {
        const total = (freshCounts.get(record.commandKey) ?? 0) + 1;
        freshCounts.set(record.commandKey, total);
        return total === 1;
      }
      const counted = Match.value(reply).pipe(
        Match.tag('Recorded', count),
        Match.orElse(() => true),
      );
      unique = unique && counted;
    }
    countFresh(control);
    function observe(record: AdmissionRecord) {
      const prior = originals.get(record.commandKey);
      const previous = Match.value(prior).pipe(
        Match.when(undefined, () => record),
        Match.orElse((value) => value),
      );
      immutable = immutable && sameRecord(previous, record);
      originals.set(record.commandKey, previous);
    }
    memory.records().forEach(observe);
    for (const step of actions) {
      const reply = yield* service.admit(inputFor(step));
      countFresh(reply);
      const records = memory.records();
      unique =
        unique && new Set(records.map((record) => record.commandKey)).size === records.length;
      records.forEach(observe);
    }
    return { unique, immutable };
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  return scoped;
}

function uniqueLaw(actions: readonly Action[]) {
  return replayTrace(actions).pipe(Effect.map(({ unique }) => unique));
}
function immutableLaw(actions: readonly Action[]) {
  return replayTrace(actions).pipe(Effect.map(({ immutable }) => immutable));
}

function staleLaw(actions: readonly Action[]) {
  const memory = makeMemoryCommandInbox();
  let pending: AuthorityObservation = authorityFixture();
  function racedCommit(draft: AdmissionDraft) {
    memory.setAuthority(pending);
    return memory.driver.commit(draft);
  }
  function* scenario() {
    const service = yield* acquireCommandAdmission({ ...memory.driver, commit: racedCommit });
    const control = yield* service.admit(verifiedCommandFixture());
    let safe = isPreview(control);
    const baseline = authorityFixture();
    let index = 0;
    for (const step of actions) {
      index += 1;
      memory.setAuthority(baseline);
      const changed = Match.value(step.kind).pipe(
        Match.when('Expire', () => ({ ...baseline, atMs: 2000 })),
        Match.when('Rewind', () => ({ ...baseline, atMs: 999 })),
        Match.when('Replace', () => ({
          ...baseline,
          state: { ...baseline.state, revision: `replacement-${index}` },
        })),
        Match.when('Revoke', () => ({
          ...baseline,
          state: { ...baseline.state, access: 'Revoked' as const },
        })),
        Match.orElse(() => ({
          ...baseline,
          state: { _tag: 'Unavailable' as const, revision: `changed-${index}` },
        })),
      );
      pending = changed;
      const original = verifiedCommandFixture();
      const input = {
        ...original,
        candidate: { ...original.candidate, commentId: 100 + index },
        receipt: { ...original.receipt, deliveryId: `race-${index}` },
      };
      const reply = yield* service.admit(input);
      const unrecorded = Match.value(reply).pipe(
        Match.tag('Unrecorded', () => true),
        Match.orElse(() => false),
      );
      safe = safe && unrecorded && memory.records().length === 1;
    }
    return safe;
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  return scoped;
}

function constructiveLaw(actions: readonly Action[]) {
  const memory = makeMemoryCommandInbox();
  const baseline = authorityFixture();
  const disabled = {
    ...baseline,
    state: {
      ...baseline.state,
      _tag: 'Available' as const,
      profile: { _tag: 'Disabled' as const },
    },
  };
  function* scenario() {
    const service = yield* acquireCommandAdmission(memory.driver);
    memory.setAuthority(disabled);
    const input = verifiedCommandFixture();
    const rejected = yield* service.admit(input);
    memory.setAuthority(baseline);
    const next = {
      ...input,
      candidate: { ...input.candidate, commentId: 56 },
      receipt: { ...input.receipt, deliveryId: 'resolved-new-comment' },
    };
    const admitted = yield* service.admit(next);
    const originals = memory.records();
    const first = originals[0];
    const firstRejected = Match.value(first?.decision).pipe(
      Match.when({ _tag: 'Rejected' }, () => true),
      Match.orElse(() => false),
    );
    const recordedRejection = Match.value(rejected).pipe(
      Match.tag('Recorded', () => firstRejected),
      Match.orElse(() => false),
    );
    let safe = isPreview(admitted) && recordedRejection;
    for (const step of actions) {
      const chosen = Match.value(step.comment).pipe(
        Match.when(55, () => input),
        Match.orElse(() => next),
      );
      const replay = {
        ...chosen,
        receipt: { ...chosen.receipt, deliveryId: `constructive-${step.delivery}` },
      };
      const reply = yield* service.admit(replay);
      const historical = Match.value(reply).pipe(
        Match.tag('Duplicate', () => true),
        Match.when({ _tag: 'Unrecorded', decision: { reason: 'DeliveryConflict' } }, () => true),
        Match.orElse(() => false),
      );
      safe = safe && historical && sameRecords(originals, memory.records());
    }
    return safe;
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  return scoped;
}

const laws = {
  'at most one admission per command key': uniqueLaw,
  'original decisions immutable': immutableLaw,
  'authority and time races never activate stale drafts': staleLaw,
  'resolved blocker admits only a new comment': constructiveLaw,
};
for (const [name, law] of Object.entries(laws)) {
  for (const seed of [0, 1, 163]) {
    async function checkSeed() {
      const checking = Arbitrary.checkEffect(sequences, law, {
        seed,
        runs: 1000,
        size: 50,
        maxShrinks: 1000,
        maxDiscards: 10000,
      });
      function verify(result: Arbitrary.CheckResult<unknown, unknown>) {
        const validation = validateCheckResult(name, seed, result, 1000);
        const program = Effect.fromResult(validation);
        return program;
      }
      const verified = checking.pipe(Effect.tap(verify));
      const result = await Effect.runPromise(verified);
      expect(result).toMatchObject({ _tag: 'Passed', runs: 1000 });
    }
    test(`command sequence ${name}; seed ${seed}`, checkSeed);
  }
}
