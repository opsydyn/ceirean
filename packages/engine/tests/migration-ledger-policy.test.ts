import { expect, test } from 'bun:test';

import { AttemptId, RunId, WorkerOperationId } from '@ceirean/domain';
import {
  MigrationLedgerState,
  MigrationLedgerCommand,
  MigrationLedgerEvent,
  MigrationRecovery,
  migrationLedgerBounds,
  migrationLedgerCodecs,
  migrationLedgerEncoding,
  migrationLedgerDecoding,
  migrationPayloadBytes,
  recoverMigrationLedger,
  decideMigrationLedger,
} from '@ceirean/engine/migration-ledger';
import { Match, Option, Result, Schema } from 'effect';

import { makeSnapshot, makeCancelledChange, makeQualifiedChange } from './fixtures.ts';
import {
  cleanupEdit,
  claimEdit,
  makeWorkerSnapshot,
  makeWorkerIntent,
  makeWorkerCase,
  makeStartedWorkerSnapshot,
} from './worker-fixtures.ts';

export function ledgerFixture() {
  const run = makeSnapshot();
  const first = makeWorkerSnapshot();
  const second = {
    ...makeWorkerSnapshot(),
    operation: { ...first.operation, operationId: WorkerOperationId.make('worker-2') },
  };
  return { sequence: 3, runs: [run], workers: [first, second] };
}

export function replacementCommand(current: MigrationLedgerState = ledgerFixture()) {
  const run = Option.getOrThrow(Option.fromUndefinedOr(current.runs[0]));
  return {
    _tag: 'ChangeRun' as const,
    change: {
      runId: run.state.runId,
      expectedRevision: run.revision,
      state: {
        ...run.state,
        _tag: 'Frozen' as const,
        generation: run.state.generation + 1,
        attemptId: AttemptId.make(`replacement-${run.state.generation}`),
      },
      facts: [],
    },
  };
}

export function decide(current: MigrationLedgerState, command: unknown) {
  return Result.getOrThrow(decideMigrationLedger(current, command));
}

function registerRun() {
  const seed = makeSnapshot();
  const command = { _tag: 'RegisterRun', state: seed.state, contract: seed.contract };
  const result = decide({ sequence: 0, runs: [], workers: [] }, command);
  expect(result.reply).toEqual({
    _tag: 'Registered',
    snapshot: { ...seed, revision: 0, history: [] },
  });
  expect(result.next.sequence).toBe(1);
  expect(Option.getOrThrow(result.event).runRevisions).toEqual([
    { runId: seed.state.runId, before: Option.none(), after: 0 },
  ]);
  const duplicate = decide(result.next, command);
  expect(duplicate.reply).toEqual({ _tag: 'RegistrationRefused', reason: 'RunAlreadyPresent' });
  expect(duplicate.next).toEqual(result.next);
  expect(Option.isNone(duplicate.event)).toBe(true);
  const active = decide(result.next, {
    ...command,
    state: { ...seed.state, runId: RunId.make('run-2') },
  });
  expect(active.reply).toEqual({ _tag: 'RegistrationRefused', reason: 'RunActive' });
  const invalid = decideMigrationLedger(
    { sequence: 0, runs: [], workers: [] },
    {
      ...command,
      state: makeCancelledChange().state,
    },
  );
  expect(Result.isFailure(invalid)).toBe(true);
}
test('Frozen registration starts at revision zero and refuses duplicate/active runs', registerRun);

function cancellation() {
  const current = ledgerFixture();
  for (const command of [
    { _tag: 'ChangeRun', change: makeCancelledChange() },
    {
      _tag: 'EditWorker',
      edit: { ...cleanupEdit(current.workers[0], 960), _tag: 'RequestCancellation' },
    },
  ]) {
    const result = decide(current, command);
    const run = result.next.runs[0];
    expect(run?.state._tag).toBe('Cancelled');
    expect(run?.revision).toBe(8);
    expect(run?.history).toHaveLength(1);
    expect(result.next.workers.map((worker) => worker.revision)).toEqual([8, 8]);
    const expectedTime = Match.value(command).pipe(
      Match.when({ _tag: 'ChangeRun' }, () => 999),
      Match.orElse(() => 960),
    );
    expect(result.next.workers.map((worker) => worker.authority.cancelledAtMs)).toEqual([
      Option.some(expectedTime),
      Option.some(expectedTime),
    ]);
    expect(result.next.sequence).toBe(4);
    const event = Option.getOrThrow(result.event);
    expect(event.sequence).toBe(4);
    expect(event.runRevisions).toEqual([
      { runId: current.runs[0].state.runId, before: Option.some(7), after: 8 },
    ]);
    expect(event.workerRevisions.map((pair) => [pair.before, pair.after])).toEqual([
      [Option.some(7), 8],
      [Option.some(7), 8],
    ]);
    expect(current.runs[0].revision).toBe(7);
  }
}
test(
  'run and worker cancellation each update run, siblings and exactly one audit atomically',
  cancellation,
);

function replacementIsolation() {
  const current = ledgerFixture();
  const replaced = decide(current, replacementCommand(current));
  expect(replaced.next.workers.map((worker) => worker.authority.identity.generation)).toEqual([
    4, 4,
  ]);
  const old = replaced.next.workers[0];
  const cancelled = decide(replaced.next, {
    _tag: 'EditWorker',
    edit: { ...cleanupEdit(old, 960), _tag: 'RequestCancellation' },
  });
  expect(cancelled.reply).toMatchObject({
    _tag: 'WorkerResult',
    result: { _tag: 'Refused', refusal: { _tag: 'NotCurrent' } },
  });
  expect(cancelled.next).toEqual(replaced.next);
  expect(Option.isNone(cancelled.event)).toBe(true);
  const cleanup = decide(replaced.next, { _tag: 'EditWorker', edit: cleanupEdit(old, 960) });
  expect(cleanup.reply).toMatchObject({ _tag: 'WorkerResult', result: { _tag: 'Committed' } });
  expect(cleanup.next.runs).toEqual(replaced.next.runs);
  expect(Option.isNone(cleanup.next.workers[1].cleanup)).toBe(true);
}
test(
  'old-generation cancellation cannot revoke replacement; explicit cleanup remains available',
  replacementIsolation,
);

function noAppend() {
  const current = ledgerFixture();
  const result = decide(current, {
    _tag: 'ChangeRun',
    change: { ...makeCancelledChange(), expectedRevision: 6 },
  });
  expect(result.reply).toMatchObject({ _tag: 'RunResult', result: { _tag: 'Conflict' } });
  expect(result.next).toEqual(current);
  expect(Option.isNone(result.event)).toBe(true);
  const refused = decide(current, {
    _tag: 'EditWorker',
    edit: {
      ...claimEdit(current.workers[0]),
      intent: { ...makeWorkerIntent(), resource: 'foreign' },
    },
  });
  expect(refused.reply).toMatchObject({ _tag: 'WorkerResult', result: { _tag: 'Refused' } });
  expect(refused.next).toEqual(current);
  expect(Option.isNone(refused.event)).toBe(true);
  const exhausted = {
    ...current,
    workers: [current.workers[0], { ...current.workers[1], revision: Number.MAX_SAFE_INTEGER }],
  };
  const exhaustedDecision = decideMigrationLedger(exhausted, {
    _tag: 'ChangeRun',
    change: makeCancelledChange(),
  });
  const exhaustion = Option.some(expect.objectContaining({ code: 'RevisionExhausted' }));
  expect(Result.getFailure(exhaustedDecision)).toEqual(exhaustion);
  expect(exhausted.workers[0].revision).toBe(7);
}
test('CAS loser, semantic refusal and peer exhaustion append nothing', noAppend);

function qualifiedCleanup() {
  const qualified = decide(ledgerFixture(), { _tag: 'ChangeRun', change: makeQualifiedChange() });
  const worker = qualified.next.workers[0];
  for (const edit of [
    claimEdit(worker),
    { ...cleanupEdit(worker, 999), _tag: 'RequestCancellation' },
    {
      _tag: 'AuthorizeExecution',
      operationId: worker.operation.operationId,
      expectedRevision: worker.revision,
      atMs: 999,
    },
  ]) {
    const result = decide(qualified.next, { _tag: 'EditWorker', edit });
    expect(result.reply).toMatchObject({
      _tag: 'WorkerResult',
      result: { _tag: 'Refused', refusal: { _tag: 'NotCurrent' } },
    });
    expect(Option.isNone(result.event)).toBe(true);
  }
  const cleanup = decide(qualified.next, { _tag: 'EditWorker', edit: cleanupEdit(worker, 999) });
  expect(cleanup.reply).toMatchObject({ _tag: 'WorkerResult', result: { _tag: 'Committed' } });
  expect(cleanup.next.runs).toEqual(qualified.next.runs);
}
test(
  'Qualified runs allow cleanup, not cancellation or new worker execution authority',
  qualifiedCleanup,
);

function invalidChanges() {
  const current = ledgerFixture();
  const replacement = replacementCommand(current);
  const qualified = makeQualifiedChange();
  const cancelled = decide(current, { _tag: 'ChangeRun', change: makeCancelledChange() });
  const changes = [
    { ...replacement.change, state: { ...replacement.change.state, deadlineMs: 1001 } },
    { ...replacement.change, state: { ...replacement.change.state, spentMicros: 16 } },
    { ...replacement.change, state: { ...replacement.change.state, repairs: 0 } },
    {
      ...replacement.change,
      state: { ...replacement.change.state, attemptId: current.runs[0].state.attemptId },
    },
    { ...replacement.change, state: { ...replacement.change.state, generation: 3 } },
    { ...replacement.change, facts: qualified.facts },
    { ...qualified, facts: [] },
    { ...qualified, state: { ...qualified.state, spentMicros: 18 } },
    { ...qualified, state: { ...qualified.state, qualifiedAtMs: 1000 } },
  ];
  for (const change of changes) {
    const result = decideMigrationLedger(current, { _tag: 'ChangeRun', change });
    expect(Result.isFailure(result)).toBe(true);
  }
  const reopened = decideMigrationLedger(cancelled.next, {
    ...replacement,
    change: { ...replacement.change, expectedRevision: 8 },
  });
  expect(Result.isFailure(reopened)).toBe(true);
}
test(
  'rejects fabricated facts, renewed deadlines, decreasing budgets and reopened terminal runs',
  invalidChanges,
);

function workerRegistration() {
  const current = ledgerFixture();
  const worker = current.workers[0];
  const edit = {
    _tag: 'Register',
    operationId: worker.operation.operationId,
    operation: worker.operation,
    createdAtMs: 900,
    atMs: 950,
  };
  const duplicate = decide(current, { _tag: 'EditWorker', edit });
  expect(duplicate.reply).toMatchObject({ result: { _tag: 'Conflict' } });
  const replaced = decide(current, replacementCommand(current));
  expect(decide(replaced.next, { _tag: 'EditWorker', edit }).reply).toMatchObject({
    result: { _tag: 'Conflict' },
  });
  const unknown = {
    ...edit,
    operationId: WorkerOperationId.make('new'),
    operation: { ...edit.operation, operationId: WorkerOperationId.make('new') },
  };
  expect(decide(replaced.next, { _tag: 'EditWorker', edit: unknown }).reply).toMatchObject({
    result: { _tag: 'Refused', refusal: { _tag: 'NotCurrent' } },
  });
  expect(
    decide({ ...current, runs: [], workers: [] }, { _tag: 'EditWorker', edit }).reply,
  ).toMatchObject({ result: { _tag: 'Refused', refusal: { _tag: 'NotFound' } } });
  const missing = decideMigrationLedger({ ...current, runs: [] }, { _tag: 'EditWorker', edit });
  expect(Result.isFailure(missing)).toBe(true);
}
test(
  'worker registration preserves exact duplicates but refuses stale and missing parents',
  workerRegistration,
);

function cleanupSlot() {
  const current = ledgerFixture();
  const cancelled = decide(current, { _tag: 'ChangeRun', change: makeCancelledChange() });
  const seed = makeSnapshot();
  const command = {
    _tag: 'RegisterRun',
    state: { ...seed.state, runId: RunId.make('run-2') },
    contract: seed.contract,
  };
  expect(decide(cancelled.next, command).reply).toEqual({
    _tag: 'RegistrationRefused',
    reason: 'CleanupUnresolved',
  });
  const cleaned = {
    ...cancelled.next,
    workers: cancelled.next.workers.map((worker) => ({
      ...worker,
      cleanup: Option.some({
        _tag: 'CleanupConfirmed' as const,
        requestedAtMs: 999,
        deadlineMs: 1100,
        observedAtMs: 1000,
      }),
      editTimeFloorMs: 1000,
      outcomeEvidenceFloorMs: 1000,
    })),
  };
  expect(decide(cleaned, command).reply._tag).toBe('Registered');
  const unresolved = {
    ...cleaned,
    workers: [{ ...cleaned.workers[0], intents: [makeWorkerIntent()] }, cleaned.workers[1]],
  };
  const corrupt = decideMigrationLedger(unresolved, command);
  expect(Result.isFailure(corrupt)).toBe(true);
}
test(
  'terminal run retains the active slot until every cleanup is confirmed without unresolved creation',
  cleanupSlot,
);

function strictBoundaries() {
  const current = ledgerFixture();
  const command = replacementCommand(current);
  for (const input of [
    { ...command, extra: true },
    { ...command, change: { ...command.change, extra: true } },
    { ...command, change: { ...command.change, state: { ...command.change.state, extra: true } } },
  ]) {
    const result = decideMigrationLedger(current, input);
    expect(Result.isFailure(result)).toBe(true);
  }
  for (const state of [
    { ...current, extra: true },
    { ...current, runs: [{ ...current.runs[0], extra: true }] },
    {
      ...current,
      workers: [
        {
          ...current.workers[0],
          authority: {
            ...current.workers[0].authority,
            identity: { ...current.workers[0].authority.identity, generation: 99 },
          },
        },
      ],
    },
    { ...current, workers: [current.workers[0], current.workers[0]] },
    { ...current, runs: [current.runs[0], current.runs[0]] },
  ]) {
    const result = decideMigrationLedger(state, command);
    expect(Result.isFailure(result)).toBe(true);
  }
}
test(
  'all untrusted state and nested command boundaries reject excess and corrupt authority',
  strictBoundaries,
);

function repeatedCancellation() {
  const current = ledgerFixture();
  const first = decide(current, {
    _tag: 'EditWorker',
    edit: { ...cleanupEdit(current.workers[0], 960), _tag: 'RequestCancellation' },
  });
  const second = decide(first.next, {
    _tag: 'EditWorker',
    edit: { ...cleanupEdit(first.next.workers[0], 970), _tag: 'RequestCancellation' },
  });
  expect(second.next.runs).toEqual(first.next.runs);
  expect(second.next.workers[1].revision).toBe(8);
  expect(second.next.workers[0].authority.cancelledAtMs).toEqual(Option.some(960));
  expect(Option.getOrThrow(second.next.workers[0].cleanup).deadlineMs).toBe(1060);
  expect(Option.getOrThrow(second.event).runRevisions).toEqual([]);
}
test(
  'repeated cancellation preserves first time, one run fact and unchanged peer revisions',
  repeatedCancellation,
);

function boundsAndCodecs() {
  const current = ledgerFixture();
  const command = replacementCommand(current);
  const full = { ...current, sequence: migrationLedgerBounds.maxEvents };
  const fullDecision = decideMigrationLedger(full, command);
  const capacity = Option.some(expect.objectContaining({ code: 'CapacityExceeded' }));
  expect(Result.getFailure(fullDecision)).toEqual(capacity);
  const huge = {
    ...command,
    change: {
      ...command.change,
      state: { ...command.change.state, attemptId: 'x'.repeat(1048577) },
    },
  };
  const hugeDecision = decideMigrationLedger(current, huge);
  expect(Result.getFailure(hugeDecision)).toEqual(capacity);
  const outcome = decide(current, {
    _tag: 'EditWorker',
    edit: { ...cleanupEdit(current.workers[0], 960), _tag: 'RequestCancellation' },
  });
  const encoding = Schema.encodeUnknownResult(migrationLedgerCodecs.state)(outcome.next);
  const encoded = Result.getOrThrow(encoding);
  const decoding = Schema.decodeUnknownResult(migrationLedgerCodecs.state)(encoded);
  const decoded = Result.getOrThrow(decoding);
  expect(decoded).toEqual(outcome.next);
  const validState = Schema.is(MigrationLedgerState)(decoded);
  expect(validState).toBe(true);
  expect(Option.isSome(decoded.workers[0].cleanup)).toBe(true);
  expect(Option.isNone(decoded.workers[1].cleanup)).toBe(true);
  const validCommand = Schema.is(MigrationLedgerCommand)(command);
  const validEvent = Schema.is(MigrationLedgerEvent)(Option.getOrThrow(outcome.event));
  expect(validCommand).toBe(true);
  expect(validEvent).toBe(true);
  const recovered = recoverMigrationLedger(outcome.next);
  const recovery = Result.getOrThrow(recovered);
  const validRecovery = Schema.is(MigrationRecovery)(recovery);
  expect(validRecovery).toBe(true);
  expect(recovery.workers[0].unresolvedIntentIds).toEqual([]);
  Reflect.set(recovery.runs[0].state, 'generation', 123);
  expect(outcome.next.runs[0].state.generation).toBe(3);
  const event = Option.getOrThrow(outcome.event);
  Reflect.set(event.command, '_tag', 'corrupt');
  expect(outcome.next.sequence).toBe(4);
}
test(
  'bounds refuse without eviction and canonical codecs/recovery preserve detached Options',
  boundsAndCodecs,
);

function issuedOutcomes() {
  const current = ledgerFixture();
  const issued = decide(current, { _tag: 'EditWorker', edit: claimEdit(current.workers[0]) });
  const c = makeWorkerCase();
  const intent = makeWorkerIntent();
  const edit = {
    _tag: 'RecordOutcome',
    operationId: c.operation.operationId,
    expectedRevision: 9,
    atMs: 1001,
    reply: {
      ...c.reply,
      intentId: intent.intentId,
      atMs: 1001,
      outcome: { _tag: 'Completed', observation: { ...c.observation, atMs: 1001 } },
    },
  };
  for (const command of [
    { _tag: 'ChangeRun', change: makeCancelledChange() },
    replacementCommand(issued.next),
  ]) {
    const transitioned = decide(issued.next, command);
    const outcome = decide(transitioned.next, { _tag: 'EditWorker', edit });
    expect(outcome.reply).toMatchObject({ _tag: 'WorkerResult', result: { _tag: 'Committed' } });
    expect(outcome.next.workers[0].containerId).toEqual(Option.some(c.containerId));
    expect(outcome.next.workers[0].intents[0]?.outcome._tag).toBe('Completed');
    expect(outcome.next.runs).toEqual(transitioned.next.runs);
  }
}
test(
  'issued outcomes remain recordable after cancellation, expiry and replacement',
  issuedOutcomes,
);

function corruptEvidence() {
  const current = ledgerFixture();
  const started = makeStartedWorkerSnapshot();
  const c = makeWorkerCase();
  const ready = {
    operationId: c.operation.operationId,
    identity: c.operation.identity,
    hostId: c.operation.hostId,
    daemonId: c.operation.daemonId,
    containerId: c.containerId,
    imageDigest: c.operation.imageDigest,
    sourceDigest: c.operation.sourceDigest,
    policyDigest: c.operation.policyDigest,
    configDigest: c.operation.configDigest,
    configuration: c.operation.configuration,
    observedAtMs: 950,
  };
  const valid = { ...current, workers: [{ ...started, readiness: Option.some(ready) }] };
  const control = decide(valid, { _tag: 'EditWorker', edit: cleanupEdit(valid.workers[0], 960) });
  expect(control.reply).toMatchObject({ result: { _tag: 'Committed' } });
  const forged = {
    ...valid,
    workers: [
      {
        ...valid.workers[0],
        readiness: Option.some({ ...ready, imageDigest: c.operation.sourceDigest }),
      },
    ],
  };
  const result = decideMigrationLedger(forged, replacementCommand(current));
  expect(Result.isFailure(result)).toBe(true);
  const corruptIntent = {
    ...current,
    workers: [
      {
        ...started,
        intents: started.intents.map((intent) => ({ ...intent, resource: 'foreign' })),
      },
    ],
  };
  const corrupt = decideMigrationLedger(corruptIntent, replacementCommand(current));
  expect(Result.isFailure(corrupt)).toBe(true);
}
test(
  'persisted readiness and completed-intent bindings are validated before deciding',
  corruptEvidence,
);

function strictWire() {
  const current = ledgerFixture();
  const run = Result.getOrThrow(migrationLedgerEncoding.run(current.runs[0]));
  const worker = Result.getOrThrow(migrationLedgerEncoding.worker(current.workers[0]));
  const replacement = replacementCommand(current);
  const encodedCommand = migrationLedgerEncoding.command(replacement);
  const command = Result.getOrThrow(encodedCommand);
  function rejects(decode: (value: string) => Result.Result<unknown, unknown>, encoded: string) {
    const result = decode(encoded);
    return Result.isFailure(result);
  }
  for (const [decode, encoded] of [
    [migrationLedgerDecoding.run, run],
    [migrationLedgerDecoding.worker, worker],
    [migrationLedgerDecoding.command, command],
  ] as const) {
    const bad = encoded.replace('{', '{"extra":true,');
    expect(rejects(decode, bad)).toBe(true);
  }
  expect(migrationPayloadBytes('\u00e9')).toBe(2);
  const oversized = {
    ...current.workers[0],
    operation: {
      ...current.workers[0].operation,
      configuration: {
        ...current.workers[0].operation.configuration,
        network: '\u00e9'.repeat(600000),
      },
    },
  };
  const encoded = migrationLedgerEncoding.worker(oversized);
  const capacity = Option.some(expect.objectContaining({ code: 'CapacityExceeded' }));
  expect(Result.getFailure(encoded)).toEqual(capacity);
}
test('storage-facing codecs reject excess wire fields and enforce UTF-8 record bytes', strictWire);

function retainedRuns(count: number) {
  const seed = decide(ledgerFixture(), { _tag: 'ChangeRun', change: makeCancelledChange() }).next
    .runs[0];
  function retained(_value: unknown, index: number) {
    const runId = RunId.make(`retained-${index}`);
    return {
      ...seed,
      state: { ...seed.state, runId },
      history: seed.history.map((fact) => ({ ...fact, runId })),
    };
  }
  return Array.from({ length: count }, retained);
}

function countBounds() {
  const seed = makeSnapshot();
  const command = { _tag: 'RegisterRun', state: seed.state, contract: seed.contract };
  const runs = retainedRuns(31);
  const boundary = decide({ sequence: 31, runs, workers: [] }, command);
  expect(boundary.reply._tag).toBe('Registered');
  expect(boundary.next.runs).toHaveLength(32);
  const full = { sequence: 32, runs: retainedRuns(32), workers: [] };
  const refused = decideMigrationLedger(full, command);
  const capacity = Option.some(expect.objectContaining({ code: 'CapacityExceeded' }));
  expect(Result.getFailure(refused)).toEqual(capacity);
  const current = ledgerFixture();
  const worker = current.workers[0];
  const workers = Array.from({ length: 64 }, (_, index) => ({
    ...worker,
    operation: { ...worker.operation, operationId: WorkerOperationId.make(`peer-${index}`) },
  }));
  const register = {
    _tag: 'EditWorker',
    edit: {
      _tag: 'Register',
      operationId: worker.operation.operationId,
      operation: worker.operation,
      createdAtMs: 900,
      atMs: 950,
    },
  };
  const atLimit = { ...current, workers };
  const cleanup = decide(atLimit, { _tag: 'EditWorker', edit: cleanupEdit(workers[0], 950) });
  expect(cleanup.reply).toMatchObject({ result: { _tag: 'Committed' } });
  const beyond = decideMigrationLedger(atLimit, register);
  expect(Result.getFailure(beyond)).toEqual(capacity);
  const terminalRuns = retainedRuns(4);
  const allWorkers = terminalRuns.flatMap((run, index) =>
    workers.map((peer, peerIndex) => ({
      ...peer,
      operation: {
        ...peer.operation,
        operationId: WorkerOperationId.make(`run-${index}-peer-${peerIndex}`),
        identity: { ...peer.operation.identity, runId: run.state.runId },
      },
      authority: {
        identity: { ...peer.authority.identity, runId: run.state.runId },
        cancelledAtMs: Option.some(999),
      },
      editTimeFloorMs: 999,
    })),
  );
  const totalLimit = { sequence: 260, runs: terminalRuns, workers: allWorkers };
  const totalControl = decide(totalLimit, {
    _tag: 'EditWorker',
    edit: cleanupEdit(allWorkers[0], 1000),
  });
  expect(totalControl.reply).toMatchObject({ result: { _tag: 'Committed' } });
  const tooMany = {
    ...totalLimit,
    workers: [
      ...allWorkers,
      {
        ...allWorkers[0],
        operation: { ...allWorkers[0].operation, operationId: WorkerOperationId.make('extra') },
      },
    ],
  };
  const totalRefused = decideMigrationLedger(tooMany, command);
  expect(Result.getFailure(totalRefused)).toEqual(capacity);
}
test(
  'retained run, per-run worker and global worker capacities stop writes without eviction',
  countBounds,
);

function aggregateBounds() {
  const runs = retainedRuns(2);
  const seed = ledgerFixture().workers[0];
  function largeWorker(_value: unknown, index: number) {
    const run = Option.getOrThrow(Option.fromUndefinedOr(runs[Math.floor(index / 64)]));
    const identity = { ...seed.operation.identity, runId: run.state.runId };
    return {
      ...seed,
      operation: {
        ...seed.operation,
        operationId: WorkerOperationId.make(`large-${index}`),
        identity,
        configuration: { ...seed.operation.configuration, network: 'x'.repeat(1040000) },
      },
      authority: { identity, cancelledAtMs: Option.some(999) },
      editTimeFloorMs: 999,
    };
  }
  const workers = Array.from({ length: 65 }, largeWorker);
  const current = { sequence: 67, runs, workers };
  const command = { _tag: 'EditWorker', edit: cleanupEdit(workers[0], 1000) };
  const encoded = migrationLedgerEncoding.worker(workers[0]);
  expect(Result.isSuccess(encoded)).toBe(true);
  const result = decideMigrationLedger(current, command);
  const capacity = Option.some(expect.objectContaining({ code: 'CapacityExceeded' }));
  expect(Result.getFailure(result)).toEqual(capacity);
  const emptyWorkers = workers.map((worker) => ({
    ...worker,
    operation: {
      ...worker.operation,
      configuration: { ...worker.operation.configuration, network: '' },
    },
  }));
  function recordBytes(worker: (typeof workers)[number]) {
    const encoded = migrationLedgerEncoding.worker(worker);
    return migrationPayloadBytes(Result.getOrThrow(encoded));
  }
  function runBytes(run: (typeof runs)[number]) {
    const encoded = migrationLedgerEncoding.run(run);
    return migrationPayloadBytes(Result.getOrThrow(encoded));
  }
  const overhead =
    emptyWorkers.reduce((sum, worker) => sum + recordBytes(worker), 0) +
    runs.reduce((sum, run) => sum + runBytes(run), 0);
  const filler = migrationLedgerBounds.maxPayloadBytes - overhead - 64;
  const each = Math.floor(filler / emptyWorkers.length);
  const remainder = filler % emptyWorkers.length;
  function fillRecord(worker: (typeof workers)[number], index: number) {
    const extra = Match.value(index).pipe(
      Match.when(0, () => remainder),
      Match.orElse(() => 0),
    );
    return {
      ...worker,
      operation: {
        ...worker.operation,
        configuration: { ...worker.operation.configuration, network: 'x'.repeat(each + extra) },
      },
    };
  }
  const near = { ...current, workers: emptyWorkers.map(fillRecord) };
  const total =
    near.workers.reduce((sum, worker) => sum + recordBytes(worker), 0) +
    runs.reduce((sum, run) => sum + runBytes(run), 0);
  expect(total).toBe(migrationLedgerBounds.maxPayloadBytes - 64);
  const proposed = decideMigrationLedger(near, command);
  expect(Result.getFailure(proposed)).toEqual(capacity);
}
test(
  'aggregate encoded application records are bounded independently of each record',
  aggregateBounds,
);

function moreAtomicControls() {
  const current = ledgerFixture();
  const exhausted = {
    ...current,
    workers: [current.workers[0], { ...current.workers[1], revision: Number.MAX_SAFE_INTEGER }],
  };
  const failed = decideMigrationLedger(exhausted, {
    _tag: 'EditWorker',
    edit: { ...cleanupEdit(current.workers[0], 960), _tag: 'RequestCancellation' },
  });
  const exhaustion = Option.some(
    expect.objectContaining({ _tag: 'WorkerJournalError', code: 'RevisionExhausted' }),
  );
  expect(Result.getFailure(failed)).toEqual(exhaustion);
  expect(current.runs[0].history).toEqual([]);
  expect(current.workers.map((worker) => worker.revision)).toEqual([7, 7]);
  const qualified = decide(current, { _tag: 'ChangeRun', change: makeQualifiedChange() });
  const worker = current.workers[0];
  const terminalRegistration = decide(qualified.next, {
    _tag: 'EditWorker',
    edit: {
      _tag: 'Register',
      operationId: WorkerOperationId.make('terminal-new'),
      operation: { ...worker.operation, operationId: WorkerOperationId.make('terminal-new') },
      createdAtMs: 900,
      atMs: 999,
    },
  });
  expect(terminalRegistration.reply).toMatchObject({
    result: { _tag: 'Refused', refusal: { _tag: 'NotCurrent' } },
  });
  expect(Option.isNone(terminalRegistration.event)).toBe(true);
  const finalEvent = { ...current, sequence: 4095 };
  const committed = decide(finalEvent, replacementCommand(finalEvent));
  expect(committed.next.sequence).toBe(4096);
  const conflict = decide(committed.next, replacementCommand(finalEvent));
  expect(conflict.reply).toMatchObject({ result: { _tag: 'Conflict' } });
  expect(Option.isNone(conflict.event)).toBe(true);
}
test(
  'worker peer exhaustion is atomic; terminal registration and full-ledger CAS preserve refusal distinctions',
  moreAtomicControls,
);
