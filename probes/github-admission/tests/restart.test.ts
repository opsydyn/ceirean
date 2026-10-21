import { expect, test } from 'bun:test';

import { AuthorityState, DecisionId } from '@ceirean/domain';
import { Effect, Match, Result, Schema } from 'effect';

import { authorityFixture } from '../src/fixture.ts';
import { RestartResult, RestartPhase } from '../src/report.ts';
import { makeSqliteInbox } from '../src/sqlite-inbox.ts';
import {
  boundedOutput,
  committedIdentity,
  corrupt,
  counts,
  joined,
  phaseText,
  storedRecord,
  watchdog,
  withProcesses,
  type Owned,
} from './restart-process.test.ts';

const decodePhase = Schema.decodeUnknownSync(Schema.fromJsonString(RestartPhase));
const decodeResult = Schema.decodeUnknownSync(Schema.fromJsonString(RestartResult));
async function phase(owned: Owned) {
  return decodePhase(await phaseText(owned));
}
async function read(owned: Owned) {
  const output = boundedOutput(owned.child.stdout);
  void output.catch(() => undefined);
  expect(await joined(owned)).toBe(0);
  return decodeResult((await watchdog(output)).trim());
}
type Own = (mode: string) => Owned;
async function committed(file: string, own: Own) {
  const writer = own('committed');
  expect((await phase(writer)).phase).toBe('AfterCommit');
  expect(counts(file)).toEqual([1, 1]);
  const identity = committedIdentity(file);
  const committedDecisionId = Schema.decodeUnknownSync(DecisionId)(identity);
  writer.child.kill('SIGKILL');
  await joined(writer);
  expect(writer.child.signalCode).toBe('SIGKILL');
  const recovered = await read(own('read'));
  expect(recovered.disposition).toBe('Duplicate');
  expect(recovered.decisionId).toBe(committedDecisionId);
  expect(counts(file)).toEqual([1, 2]);
  expect(await read(own('read'))).toEqual(recovered);
  expect(counts(file)).toEqual([1, 2]);
}
test('committed lost response survives process kill', () => withProcesses(committed));
async function uncommitted(file: string, own: Own) {
  const writer = own('uncommitted');
  expect((await phase(writer)).phase).toBe('AfterDecision');
  expect(counts(file)).toEqual([0, 0]);
  writer.child.kill('SIGKILL');
  await joined(writer);
  expect(writer.child.signalCode).toBe('SIGKILL');
  expect(counts(file)).toEqual([0, 0]);
  expect(await read(own('read'))).toEqual({ disposition: 'Recorded', decisionId: '1' });
  expect(counts(file)).toEqual([1, 1]);
  expect(await read(own('read'))).toEqual({ disposition: 'Duplicate', decisionId: '1' });
  expect(counts(file)).toEqual([1, 1]);
}
test('uncommitted kill leaves no partial admission', () => withProcesses(uncommitted));
function invalidDatabase(kind: string) {
  async function scenario(file: string, own: Own) {
    const prepared = Match.value(kind).pipe(
      Match.when('corrupt', () => corrupt(file)),
      Match.orElse(() => undefined),
    );
    void prepared;
    const reader = own('read');
    const output = boundedOutput(reader.child.stdout);
    expect(await joined(reader)).not.toBe(0);
    expect(await watchdog(output)).toBe('');
  }
  return withProcesses(scenario);
}
test.each(['missing', 'corrupt'])(
  'reader refuses %s database without creating recovered success',
  invalidDatabase,
);
function seedRevoked(file: string) {
  const state = Schema.decodeUnknownSync(AuthorityState)({
    ...authorityFixture().state,
    access: 'Revoked',
  });
  function* initialize() {
    const native = yield* makeSqliteInbox({
      file,
      create: true,
      ingressScopeId: 'fixture-app',
      initialAuthority: state,
      limits: { decisions: 256, receipts: 1024, authorityRevisions: 256 },
      nowMs: () => 1000,
    });
    const loaded = Result.getOrThrow(native.driver.loadAuthority('fixture-app'));
    expect(loaded.state).toEqual(state);
  }
  const program = Effect.gen(initialize);
  Effect.runSync(program.pipe(Effect.scoped));
}
async function revoked(file: string, own: Own) {
  seedRevoked(file);
  const reader = own('read');
  const output = boundedOutput(reader.child.stdout);
  expect(await joined(reader)).not.toBe(0);
  expect(await watchdog(output)).toBe('');
  expect(storedRecord(file)).toContain('AccessRevoked');
  expect(counts(file)).toEqual([1, 1]);
}
test('reader retains revoked authority rather than seeding granted fixture', () =>
  withProcesses(revoked));
