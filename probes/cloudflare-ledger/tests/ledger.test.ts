import { expect } from 'bun:test';

import {
  decideMigrationLedger,
  migrationLedgerBounds,
  migrationLedgerCodecs,
  type MigrationLedgerState,
} from '@ceirean/engine/journal-policy';
import { Effect, Option, Result, Schema } from 'effect';

import { commands, encodeCommand, encodeReply, encodeState } from './fixtures.ts';
import { commit, decodeJson, local, request } from './harness.ts';

function* registersRun() {
  expect(decodeJson(yield* commit('registration', commands().register))).toMatchObject({
    _tag: 'Registered',
  });
  expect(decodeJson(yield* request('read', 'registration'))).toMatchObject({
    sequence: 1,
    runs: [{ revision: 0 }],
  });
}
local.test('actual workerd RPC registers a run and retains its sequence', Effect.gen(registersRun));

function* policyParity() {
  const c = commands();
  let expected: MigrationLedgerState = { sequence: 0, runs: [], workers: [] };
  for (const command of [c.register, c.register, c.worker, c.cancel, c.cancel]) {
    const decision = Result.getOrThrow(decideMigrationLedger(expected, command));
    expect(yield* commit('policy', command)).toBe(encodeReply(decision.reply));
    expected = decision.next;
    expect(yield* request('read', 'policy')).toBe(encodeState(expected));
  }
  expect(decodeJson(yield* request('audit', 'policy'))).toHaveLength(3);
  const decoded = Schema.decodeUnknownSync(migrationLedgerCodecs.state)(
    yield* request('read', 'policy'),
  );
  expect(decoded.runs[0]?.revision).toBe(1);
  expect(Option.isSome(decoded.workers[0]?.authority.cancelledAtMs ?? Option.none())).toBe(true);
}
local.test(
  'run/worker transitions, duplicates and stale revisions match policy atomically',
  Effect.gen(policyParity),
);

function* concurrentCas() {
  const c = commands();
  yield* commit('cas', c.register);
  const replies = yield* Effect.all([commit('cas', c.cancel), commit('cas', c.cancel)], {
    concurrency: 2,
  });
  const parsed = replies.map((reply) => decodeJson(reply));
  expect(parsed).toContainEqual(
    expect.objectContaining({
      _tag: 'RunResult',
      result: expect.objectContaining({ _tag: 'Committed' }),
    }),
  );
  expect(parsed).toContainEqual(
    expect.objectContaining({
      _tag: 'RunResult',
      result: expect.objectContaining({ _tag: 'Conflict' }),
    }),
  );
  expect(decodeJson(yield* request('audit', 'cas'))).toHaveLength(2);
}
local.test('concurrent CAS has one winner and one audit event', Effect.gen(concurrentCas));

function* rollback() {
  const c = commands();
  yield* commit('rollback', c.register);
  yield* commit('rollback', c.worker);
  const before = yield* request('read', 'rollback');
  const audit = yield* request('audit', 'rollback');
  const body = encodeCommand(c.cancel);
  expect(decodeJson(yield* request('fault', 'rollback', body))).toMatchObject({
    _tag: 'ProbeFailure',
  });
  expect(yield* request('read', 'rollback')).toBe(before);
  expect(yield* request('audit', 'rollback')).toBe(audit);
  expect(decodeJson(yield* commit('rollback', c.cancel))).toMatchObject({
    _tag: 'RunResult',
    result: { _tag: 'Committed' },
  });
}
local.test(
  'failure between snapshot and audit rolls back run and worker state',
  Effect.gen(rollback),
);

function* invalidInputs() {
  const name = crypto.randomUUID();
  yield* commit(name, commands().register);
  const before = yield* request('read', name);
  const audit = yield* request('audit', name);
  const valid = encodeCommand(commands().register);
  const excess = valid.replace('{', '{"extra":1,');
  for (const body of ['{', excess, 'x'.repeat(migrationLedgerBounds.maxRecordBytes + 1)]) {
    expect(decodeJson(yield* request('commit', name, body))).toMatchObject({
      _tag: 'ProbeFailure',
    });
    expect(yield* request('read', name)).toBe(before);
    expect(yield* request('audit', name)).toBe(audit);
  }
}
local.test(
  'malformed, excess-field and oversized input cannot mutate storage',
  Effect.gen(invalidInputs),
);

function* corruptStorage() {
  yield* commit('corrupt', commands().register);
  yield* request('corrupt', 'corrupt', '');
  expect(decodeJson(yield* request('read', 'corrupt'))).toMatchObject({ _tag: 'ProbeFailure' });
  expect(decodeJson(yield* commit('corrupt', commands().register))).toMatchObject({
    _tag: 'ProbeFailure',
  });
  expect(decodeJson(yield* request('audit', 'corrupt'))).toHaveLength(1);
}
local.test(
  'invalid stored data fails closed without resetting the ledger',
  Effect.gen(corruptStorage),
);
