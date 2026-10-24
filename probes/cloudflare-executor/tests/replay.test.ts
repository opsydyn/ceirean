import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Schema } from 'effect';

import { decideReplay, type ReplayState } from '../src/replay.ts';

const receipt = {
  sessionId: 'session-1',
  operationId: 'operation-1',
  worksheetSha256: 'a'.repeat(64),
};
function recordOnce() {
  const first = decideReplay({ _tag: 'Empty' }, receipt);
  expect(first).toMatchObject({ disposition: 'Recorded', activation: 'Blocked' });
  expect(decideReplay(first.state, receipt)).toMatchObject({
    disposition: 'Replay',
    state: first.state,
  });
  expect(decideReplay(first.state, { ...receipt, worksheetSha256: 'b'.repeat(64) })).toMatchObject({
    disposition: 'Conflict',
    state: first.state,
  });
  expect(decideReplay(first.state, { ...receipt, operationId: 'operation-2' })).toMatchObject({
    disposition: 'Busy',
    state: first.state,
  });
  expect(decideReplay(first.state, { ...receipt, sessionId: 'other' })).toMatchObject({
    disposition: 'WrongSession',
    state: first.state,
  });
}
test(
  'record once; exact duplicate references the record and changed contents cannot replace it',
  recordOnce,
);

const Choices = Schema.Array(Schema.Boolean).check(Schema.isMaxLength(30));
const isRecorded = Schema.is(Schema.Struct({ disposition: Schema.Literal('Recorded') }));
function sequenceLaw(choices: ReadonlyArray<boolean>) {
  let state: ReplayState = { _tag: 'Empty' };
  let records = 0;
  for (const choice of choices) {
    const next = { ...receipt, operationId: String(choice) };
    const result = decideReplay(state, next);
    records += Number(isRecorded(result));
    state = result.state;
  }
  return [records <= 1, choices.length === 0 || records === 1].every(Boolean);
}

function ownershipLaw(seed: number) {
  function* verify() {
    const inputs = Arbitrary.schema(Choices);
    const result = yield* Arbitrary.checkEffect(
      inputs,
      (choices) => Effect.succeed(sequenceLaw(choices)),
      { seed, runs: 100, maxShrinks: 100 },
    );
    expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
    expect(result).toMatchObject({ runs: 100 });
  }
  async function run() {
    const workflow = Effect.gen(verify);
    await Effect.runPromise(workflow);
  }
  return run;
}
for (const seed of [0, 1, 163])
  test(`one receipt per session law; seed ${seed}`, ownershipLaw(seed));
