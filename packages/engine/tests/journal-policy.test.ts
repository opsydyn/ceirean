import { expect, test } from 'bun:test';

import { WorkerOperationId } from '@ceirean/domain';
import {
  evaluateRunChange,
  evaluateWorkerJournalEdit,
  replaceWorkerAuthority,
} from '@ceirean/engine/journal-policy';
import { Match, Option, Result, Schema } from 'effect';

import type { CommitResult } from '../src/contracts.ts';
import { WorkerJournalSnapshot, type WorkerJournalResult } from '../src/worker-contracts.ts';
import { WorkerJournalError } from '../src/worker-errors.ts';
import { makeCancelledChange, makeQualifiedChange, makeSnapshot } from './fixtures.ts';
import { cleanupEdit, makeWorkerCase, makeWorkerSnapshot } from './worker-fixtures.ts';

function committed(result: WorkerJournalResult) {
  return Match.value(result).pipe(
    Match.tag('Committed', ({ snapshot }) => snapshot),
    Match.orElse(() => {
      throw new TypeError('Expected committed worker');
    }),
  );
}

function committedRun(result: CommitResult) {
  return Match.value(result).pipe(
    Match.tag('Committed', ({ snapshot }) => snapshot),
    Match.orElse(() => {
      throw new TypeError('Expected committed run');
    }),
  );
}

function peers() {
  const seed = makeWorkerSnapshot();
  const sibling = {
    ...makeWorkerSnapshot(),
    operation: { ...seed.operation, operationId: WorkerOperationId.make('worker-2') },
  };
  return [seed, sibling] as const;
}

function runCas() {
  const seed = makeSnapshot();
  const winningDecision = evaluateRunChange(Option.some(seed), makeCancelledChange());
  const snapshot = committedRun(Result.getOrThrow(winningDecision));
  expect(snapshot.revision).toBe(8);
  const loser = evaluateRunChange(Option.some(snapshot), makeQualifiedChange());
  expect(Result.getOrThrow(loser)).toEqual({
    _tag: 'Conflict',
    runId: seed.state.runId,
    expectedRevision: 7,
  });
  expect(snapshot.history.map((fact) => fact._tag)).toEqual(['RunCancelled']);
  expect(seed.history).toEqual([]);
}
test('run CAS loser appends no fact', runCas);

function workerCancellation() {
  const current = peers();
  const decision = Result.getOrThrow(
    evaluateWorkerJournalEdit(current, {
      ...cleanupEdit(current[0], 960),
      _tag: 'RequestCancellation',
    }),
  );
  expect(committed(decision.result).revision).toBe(8);
  expect(decision.next.map((snapshot) => snapshot.revision)).toEqual([8, 8]);
  expect(decision.next.map((snapshot) => snapshot.authority.cancelledAtMs)).toEqual([
    Option.some(960),
    Option.some(960),
  ]);
  expect(decision.next.map((snapshot) => snapshot.editTimeFloorMs)).toEqual([960, 960]);
  expect(Option.getOrThrow(committed(decision.result).cleanup)).toEqual({
    _tag: 'CleanupPending',
    requestedAtMs: 960,
    deadlineMs: 1060,
  });
  expect(current.map((snapshot) => snapshot.revision)).toEqual([7, 7]);
  const stale = Result.getOrThrow(
    evaluateWorkerJournalEdit(decision.next, {
      ...cleanupEdit(current[0], 961),
      _tag: 'RequestCancellation',
    }),
  );
  expect(stale.result).toEqual({ _tag: 'Conflict', operationId: current[0].operation.operationId });
  expect(stale.next).toEqual(decision.next);
}
test('worker cancellation updates all peer revisions atomically', workerCancellation);

function peerExhaustion() {
  const [seed, sibling] = peers();
  const current = [seed, { ...sibling, revision: Number.MAX_SAFE_INTEGER }];
  const [beforeSeed, beforeSibling] = peers();
  const before = [beforeSeed, { ...beforeSibling, revision: Number.MAX_SAFE_INTEGER }];
  const error = Result.fail(
    new WorkerJournalError({ operation: 'commit', code: 'RevisionExhausted' }),
  );
  const cancelling = evaluateWorkerJournalEdit(current, {
    ...cleanupEdit(seed, 960),
    _tag: 'RequestCancellation',
  });
  expect(cancelling).toEqual(error);
  const replacing = replaceWorkerAuthority(
    current,
    seed.operation.operationId,
    { ...seed.operation.identity, generation: 4 },
    Option.none(),
  );
  expect(replacing).toEqual(error);
  expect(current).toEqual(before);
}
test('peer revision exhaustion leaves all records unchanged', peerExhaustion);

function optionPayloads() {
  const seed = makeWorkerSnapshot();
  const c = makeWorkerCase();
  const receipt = {
    ...c.resource,
    hostId: c.operation.hostId,
    daemonId: c.operation.daemonId,
    observedAtMs: 950,
  };
  const populated = {
    ...seed,
    containerId: Option.some(c.containerId),
    readiness: Option.some(receipt),
    executionAuthorizedAtMs: Option.some(951),
    authority: { ...seed.authority, cancelledAtMs: Option.some(952) },
    cleanup: Option.some({ _tag: 'CleanupPending' as const, requestedAtMs: 952, deadlineMs: 1052 }),
  };
  const replaced = replaceWorkerAuthority(
    [populated],
    seed.operation.operationId,
    seed.operation.identity,
    Option.none(),
  );
  const next = Result.getOrThrow(replaced);
  const copy = Option.getOrThrow(Option.fromUndefinedOr(next[0]));
  const validCopy = Schema.is(WorkerJournalSnapshot)(copy);
  expect(validCopy).toBe(true);
  expect(copy.revision).toBe(8);
  expect(copy.containerId).toEqual(Option.some(c.containerId));
  expect(copy.authority.cancelledAtMs).toEqual(Option.some(952));
  expect(copy.executionAuthorizedAtMs).toEqual(Option.some(951));
  expect(Option.getOrThrow(copy.readiness).observedAtMs).toBe(950);
  expect(Option.getOrThrow(copy.cleanup).deadlineMs).toBe(1052);
  Reflect.set(Option.getOrThrow(copy.readiness), 'observedAtMs', 9999);
  Reflect.set(Option.getOrThrow(copy.cleanup), 'deadlineMs', 9999);
  expect(Option.getOrThrow(populated.readiness).observedAtMs).toBe(950);
  expect(Option.getOrThrow(populated.cleanup).deadlineMs).toBe(1052);
  const missing = replaceWorkerAuthority(
    [seed],
    WorkerOperationId.make('missing'),
    seed.operation.identity,
    Option.none(),
  );
  const empty = Result.getOrThrow(missing);
  expect(empty).toEqual([seed]);
  expect(empty[0]).not.toBe(seed);
  const validEmpty = Schema.is(WorkerJournalSnapshot)(empty[0]);
  expect(validEmpty).toBe(true);
}
test('Option payloads survive detachment', optionPayloads);

function detachedResults() {
  const current = peers();
  const evaluated = evaluateWorkerJournalEdit(current, cleanupEdit(current[0], 960));
  const decision = Result.getOrThrow(evaluated);
  const returned = committed(decision.result);
  Reflect.set(returned.operation.limits, 'spentMicros', 9999);
  Reflect.set(Option.getOrThrow(returned.cleanup), 'deadlineMs', 9999);
  expect(current[0].operation.limits.spentMicros).toBe(17);
  expect(decision.next[0]?.operation.limits.spentMicros).toBe(17);
  const retained = Option.getOrThrow(Option.fromUndefinedOr(decision.next[0]));
  const cleanup = Option.getOrThrow(retained.cleanup);
  expect(cleanup.deadlineMs).toBe(1060);
  Reflect.set(decision.next[1]?.operation.identity ?? {}, 'generation', 9999);
  expect(current[1].operation.identity.generation).toBe(3);
  const seed = makeSnapshot();
  const runDecision = evaluateRunChange(Option.some(seed), makeQualifiedChange());
  const snapshot = committedRun(Result.getOrThrow(runDecision));
  Reflect.set(snapshot.contract, 'contractId', 'mutated');
  expect(seed.contract.contractId).not.toBe('mutated');
}
test('returned data cannot mutate the input store', detachedResults);
