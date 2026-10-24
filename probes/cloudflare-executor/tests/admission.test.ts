import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Result, Schema } from 'effect';

import { makeAdmissionGate } from '../src/admission.ts';
import { request, sessionConfig } from './contracts-fixtures.ts';

const acceptedTag = Schema.Struct({ _tag: Schema.Literal('Accepted') });
const refusedTag = Schema.Struct({ _tag: Schema.Literal('Refused') });
const isAccepted = Schema.is(acceptedTag);
const isRefused = Schema.is(refusedTag);

function* verifyReplayAndConflicts() {
  const gate = yield* makeAdmissionGate(sessionConfig());
  const first = yield* gate.admit(request(), 0);
  expect(first).toMatchObject({ _tag: 'Accepted', activation: 'Blocked', deadlineMs: 1000 });
  expect(yield* gate.admit(request(), 1)).toEqual({
    _tag: 'Replay',
    operationId: 'operation-1',
    activation: 'Blocked',
  });
  expect(yield* gate.admit({ ...request(), durationMs: 999 }, 2)).toEqual({
    _tag: 'Refused',
    reason: 'OperationConflict',
  });
  expect(yield* gate.admit(request('operation-2'), 3)).toEqual({ _tag: 'Refused', reason: 'Busy' });
}
async function replayAndConflicts() {
  const program = Effect.gen(verifyReplayAndConflicts);
  await Effect.runPromise(program);
}
test(
  'duplicates replay the existing reservation and conflicting requests cannot allocate',
  replayAndConflicts,
);

function* verifyRace() {
  const gate = yield* makeAdmissionGate(sessionConfig());
  const decisions = yield* Effect.forEach(
    [1, 2, 3, 4],
    (id) => gate.admit(request(`operation-${id}`), 1),
    { concurrency: 'unbounded' },
  );
  expect(decisions.filter(isAccepted)).toHaveLength(1);
  expect(decisions.filter(isRefused)).toHaveLength(3);
}
async function race() {
  const program = Effect.gen(verifyRace);
  await Effect.runPromise(program);
}
test('concurrent admissions reserve one process-local slot atomically', race);

function* verifyTimeBoundaries() {
  for (const [nowMs, durationMs, expected] of [
    [2699000, 1000, 'Accepted'],
    [2699001, 1000, 'Refused'],
    [2700000, 1, 'Refused'],
    [3600000, 1, 'Refused'],
    [-1, 1, 'Refused'],
  ] as const) {
    const gate = yield* makeAdmissionGate(sessionConfig());
    const decision = yield* gate.admit({ ...request(), durationMs }, nowMs);
    expect(decision._tag).toBe(expected);
  }
  const gate = yield* makeAdmissionGate(sessionConfig());
  expect(yield* gate.admit({ ...request(), sessionId: 'wrong' }, 0)).toEqual({
    _tag: 'Refused',
    reason: 'WrongSession',
  });
}
async function timeBoundaries() {
  const program = Effect.gen(verifyTimeBoundaries);
  await Effect.runPromise(program);
}
test(
  'exact deadline fits but one millisecond over and invalid sessions are refused',
  timeBoundaries,
);

function* verifyClockRollback() {
  const gate = yield* makeAdmissionGate(sessionConfig());
  expect(yield* gate.admit(request(), 3600000)).toMatchObject({ _tag: 'Refused' });
  expect(yield* gate.admit(request(), 0)).toEqual({ _tag: 'Refused', reason: 'InvalidClock' });
}
async function clockRollback() {
  const program = Effect.gen(verifyClockRollback);
  await Effect.runPromise(program);
}
test('an expired session cannot reopen by moving the supplied clock backwards', clockRollback);

function* verifyExpiredReplay() {
  const gate = yield* makeAdmissionGate(sessionConfig());
  yield* gate.admit(request(), 0);
  expect(yield* gate.admit(request(), 3600000)).toEqual({
    _tag: 'Replay',
    operationId: 'operation-1',
    activation: 'Blocked',
  });
}
async function expiredReplay() {
  const program = Effect.gen(verifyExpiredReplay);
  await Effect.runPromise(program);
}
test(
  'an exact retry after expiry returns only the existing reservation not new admission',
  expiredReplay,
);

function* verifyConfigAndRequestSnapshots() {
  const config = sessionConfig();
  const gate = yield* makeAdmissionGate(config);
  config.endsAtMs = 0;
  const input = request();
  expect(yield* gate.admit(input, 0)).toMatchObject({ _tag: 'Accepted' });
  input.budget.artifactBytes = 1;
  expect(yield* gate.admit(input, 1)).toMatchObject({
    _tag: 'Refused',
    reason: 'OperationConflict',
  });
  expect(yield* gate.admit(request(), 2)).toMatchObject({ _tag: 'Replay' });
  for (const bad of [
    { ...sessionConfig(), endsAtMs: 3600001 },
    { ...sessionConfig(), executionDeadlineMs: 2700001 },
    { ...sessionConfig(), endsAtMs: 3599999 },
  ]) {
    const building = makeAdmissionGate(bad);
    const result = yield* building.pipe(Effect.result);
    expect(result._tag).toBe('Failure');
  }
}
async function snapshots() {
  const program = Effect.gen(verifyConfigAndRequestSnapshots);
  await Effect.runPromise(program);
}
test(
  'admission snapshots trusted inputs and rejects oversized or cleanup-short sessions',
  snapshots,
);

function admissionLaw(seed: number) {
  function* verifyLaw() {
    const time = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3600000 }));
    const times = Arbitrary.schema(time);
    function law(nowMs: number) {
      function* generatedCase() {
        const gate = yield* makeAdmissionGate(sessionConfig());
        const decision = yield* gate.admit(request(), nowMs);
        const accepted = isAccepted(decision);
        return accepted === nowMs <= 2699000;
      }
      const workflow = Effect.gen(generatedCase);
      const outcome = workflow.pipe(Effect.result);
      const checking = outcome.pipe(Effect.map(Result.getOrElse(() => false)));
      return checking;
    }
    const result = yield* Arbitrary.checkEffect(times, law, { seed, runs: 100, maxShrinks: 100 });
    expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
    expect(result).toMatchObject({ runs: 100 });
  }
  async function verifySeed() {
    const program = Effect.gen(verifyLaw);
    await Effect.runPromise(program);
  }
  return verifySeed;
}
for (const seed of [0, 1, 163]) test(`admission deadline law; seed ${seed}`, admissionLaw(seed));
