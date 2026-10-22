import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { afterEach, mock, spyOn } from 'bun:test';

import { AttemptId, WorkerOperationId } from '@ceirean/domain';
import {
  MigrationLedgerState,
  decideMigrationLedger,
  migrationLedgerBounds,
  migrationLedgerDecoding,
  migrationLedgerEncoding,
  migrationPayloadBytes,
  recoverMigrationLedger,
} from '@ceirean/engine/journal-policy';
import { Cause, Data, Effect, Exit, Match, Option, Result, Schema } from 'effect';

import { LifecycleIssue } from '../../engine/src/worker-lifecycle-tasks.ts';
import { makeCancelledChange, makeSnapshot } from '../../engine/tests/fixtures.ts';
import {
  makeWorkerCase,
  cleanupEdit,
  claimEdit,
  makeWorkerIntent,
} from '../../engine/tests/worker-fixtures.ts';
import * as Ledger from '../src/index.ts';
import { ownedConfig, platform } from './fixtures.ts';

const seed = makeSnapshot();
const registration = { state: seed.state, contract: seed.contract };
const operation = makeWorkerCase().operation;
const operations = [operation, { ...operation, operationId: WorkerOperationId.make('peer') }];
const cancellation = { ...makeCancelledChange(), expectedRevision: 0 };
const encodeUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
type NativeLedger = Effect.Success<ReturnType<typeof Ledger.openMigrationLedger>>;
class InjectedFailure extends Data.TaggedError('InjectedFailure')<{ readonly secret: string }> {}
afterEach(() => mock.restore());

function seedLedger(ledger: NativeLedger) {
  function* register() {
    expect(yield* ledger.registerRun(registration)).toMatchObject({ _tag: 'Registered' });
    expect(Option.isSome(yield* ledger.runRepository.load(seed.state.runId))).toBe(true);
    for (const value of operations) {
      const edit = {
        _tag: 'Register' as const,
        operationId: value.operationId,
        operation: value,
        atMs: 900,
        createdAtMs: 900,
      };
      expect(yield* ledger.workerJournal.commit(edit)).toMatchObject({ _tag: 'Committed' });
    }
  }
  const program = Effect.gen(register);
  return program;
}
function scenario(body: (ledger: NativeLedger, file: string) => ReturnType<typeof seedLedger>) {
  function* run() {
    const fixture = yield* ownedConfig();
    yield* Ledger.initializeMigrationLedger(fixture.config);
    const ledger = yield* Ledger.openMigrationLedger(fixture.config);
    yield* body(ledger, fixture.file);
  }
  const program = Effect.gen(run);
  return program;
}
async function runNative(program: ReturnType<typeof scenario>) {
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}

function ports(ledger: NativeLedger) {
  function* verify() {
    yield* seedLedger(ledger);
    expect(yield* ledger.registerRun(registration)).toEqual({
      _tag: 'RegistrationRefused',
      reason: 'RunAlreadyPresent',
    });
    expect(
      yield* ledger.workerJournal.commit({
        _tag: 'Register',
        operationId: operation.operationId,
        operation,
        atMs: 900,
        createdAtMs: 900,
      }),
    ).toMatchObject({ _tag: 'Conflict' });
    expect(
      yield* ledger.runRepository.commit({ ...cancellation, expectedRevision: 1 }),
    ).toMatchObject({ _tag: 'Conflict' });
    expect((yield* ledger.readRecovery()).sequence).toBe(3);
    expect(yield* ledger.runRepository.commit(cancellation)).toMatchObject({ _tag: 'Committed' });
    const recovery = yield* ledger.readRecovery();
    expect(recovery.sequence).toBe(4);
    expect(recovery.runs[0]).toMatchObject({
      revision: 1,
      state: { _tag: 'Cancelled' },
      history: [expect.anything()],
    });
    expect(recovery.workers.map(({ snapshot }) => snapshot.revision)).toEqual([1, 1]);
    expect(recovery.workers.map(({ snapshot }) => snapshot.authority.cancelledAtMs)).toEqual([
      Option.some(999),
      Option.some(999),
    ]);
  }
  const program = Effect.gen(verify);
  return program;
}
test('public ports persist exact revisions, duplicate/CAS results and cancellation peers', () =>
  runNative(scenario(ports)));

for (const mutationKind of ['RunCancellation', 'WorkerCancellation', 'Replacement'] as const) {
  for (const point of [
    'AfterRunWrite',
    'AfterWorkerWrite',
    'AfterEventWrite',
    'BeforeCommit',
    'AfterCommit',
  ] as const) {
    async function atomicFailure() {
      function* run() {
        const fixture = yield* ownedConfig();
        yield* Ledger.initializeMigrationLedger(fixture.config);
        let armed = false;
        let calls = 0;
        function inject(observed: Ledger.MigrationLedgerTestFaultPoint) {
          expect(typeof observed).toBe('string');
          return Match.value(armed && observed === point).pipe(
            Match.when(true, () => {
              calls += 1;
              throw new InjectedFailure({ secret: 'private injection' });
            }),
            Match.orElse(() => undefined),
          );
        }
        const expectedSequence = Match.value(point).pipe(
          Match.when('AfterCommit', () => 4),
          Match.orElse(() => 3),
        );
        function* fail() {
          const ledger = yield* Ledger.openMigrationLedger({
            ...fixture.config,
            testFault: inject,
          });
          yield* seedLedger(ledger);
          const before = yield* ledger.readRecovery();
          armed = true;
          const worker = before.workers[0]!.snapshot;
          const replacement = {
            ...seed.state,
            generation: seed.state.generation + 1,
            attemptId: AttemptId.make('replacement'),
          };
          const runCancellation = ledger.runRepository.commit(cancellation).pipe(Effect.result);
          const workerCancellation = ledger.workerJournal
            .commit({ ...cleanupEdit(worker, 960), _tag: 'RequestCancellation' })
            .pipe(Effect.result);
          const replacing = ledger.runRepository
            .commit({ runId: seed.state.runId, expectedRevision: 0, state: replacement, facts: [] })
            .pipe(Effect.result);
          const mutation = Match.value(mutationKind).pipe(
            Match.when('RunCancellation', () => runCancellation),
            Match.when('WorkerCancellation', () => workerCancellation),
            Match.when('Replacement', () => replacing),
            Match.exhaustive,
          );
          const failed = yield* mutation;
          expect(failed._tag).toBe('Failure');
          expect(encodeUnknown(failed)).not.toContain('private injection');
          armed = false;
          expect(calls).toBe(1);
          const after = yield* ledger.readRecovery();
          expect(after.sequence).toBe(expectedSequence);
          const expectedTag = Match.value(mutationKind).pipe(
            Match.when('Replacement', () => 'Frozen' as const),
            Match.orElse(() => 'Cancelled' as const),
          );
          function committed() {
            expect(after.runs[0]?.state._tag).toBe(expectedTag);
            expect(after.workers.map(({ snapshot }) => snapshot.revision)).toEqual([1, 1]);
          }
          return Match.value(point).pipe(
            Match.when('AfterCommit', committed),
            Match.orElse(() => expect(after).toEqual(before)),
          );
        }
        const failing = Effect.gen(fail);
        yield* Effect.scoped(failing);
        function* readback() {
          const reopened = yield* Ledger.openMigrationLedger(fixture.config);
          expect((yield* reopened.readRecovery()).sequence).toBe(expectedSequence);
        }
        const reading = Effect.gen(readback);
        yield* Effect.scoped(reading);
      }
      const program = Effect.gen(run);
      await runNative(program);
    }
    test(
      `${mutationKind}/${point}: rollback is atomic; committed response loss is read back`,
      atomicFailure,
    );
  }
}

function replacement(ledger: NativeLedger) {
  function* verify() {
    yield* seedLedger(ledger);
    const next = {
      ...seed.state,
      generation: seed.state.generation + 1,
      attemptId: AttemptId.make('new'),
    };
    yield* ledger.runRepository.commit({
      runId: seed.state.runId,
      expectedRevision: 0,
      state: next,
      facts: [],
    });
    const old = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
    expect(old.revision).toBe(1);
    expect(old.operation).toEqual(operation);
    expect(old.authority.identity.generation).toBe(next.generation);
    expect(
      yield* ledger.workerJournal.commit({ ...cleanupEdit(old, 960), _tag: 'RequestCancellation' }),
    ).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'NotCurrent' } });
    yield* ledger.workerJournal.commit(cleanupEdit(old, 960));
    const recovery = yield* ledger.readRecovery();
    expect(recovery.runs[0]?.state).toEqual(next);
    expect(Option.isSome(recovery.workers[0]!.snapshot.cleanup)).toBe(true);
  }
  const program = Effect.gen(verify);
  return program;
}
test('generation replacement preserves peer and old-worker authority', () =>
  runNative(scenario(replacement)));

function currentCancellation(ledger: NativeLedger) {
  function* verify() {
    yield* seedLedger(ledger);
    const worker = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
    yield* ledger.workerJournal.commit({
      ...cleanupEdit(worker, 960),
      _tag: 'RequestCancellation',
    });
    const next = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
    yield* ledger.workerJournal.commit({ ...cleanupEdit(next, 970), _tag: 'RequestCancellation' });
    const recovered = yield* ledger.readRecovery();
    expect(recovered.runs[0]?.revision).toBe(1);
    expect(recovered.workers[1]?.snapshot.authority.cancelledAtMs).toEqual(Option.some(960));
    expect(recovered.workers[0]?.snapshot.cleanup).toEqual(next.cleanup);
  }
  const program = Effect.gen(verify);
  return program;
}
test('current worker cancellation atomically cancels peers and retains earliest cleanup', () =>
  runNative(scenario(currentCancellation)));

function exhaustion() {
  const state = makeWorkerCase();
  const start = Result.getOrThrow(
    decideMigrationLedger(
      { runs: [], workers: [], sequence: 0 },
      { _tag: 'RegisterRun', ...registration },
    ),
  ).next;
  const registered = Result.getOrThrow(
    decideMigrationLedger(start, {
      _tag: 'EditWorker',
      edit: {
        _tag: 'Register',
        operationId: state.operation.operationId,
        operation: state.operation,
        atMs: 900,
        createdAtMs: 900,
      },
    }),
  ).next;
  const exhausted = {
    ...registered,
    workers: registered.workers.map((worker) => ({ ...worker, revision: Number.MAX_SAFE_INTEGER })),
  };
  const result = decideMigrationLedger(exhausted, { _tag: 'ChangeRun', change: cancellation });
  const expected = Option.some(expect.objectContaining({ code: 'RevisionExhausted' }));
  expect(Result.getFailure(result)).toEqual(expected);
  expect(exhausted.runs[0]?.revision).toBe(0);
}
test('pure peer revision exhaustion remains all-or-nothing', exhaustion);

async function closure() {
  function* run() {
    const fixture = yield* ownedConfig();
    yield* Ledger.initializeMigrationLedger(fixture.config);
    function* write() {
      const service = yield* Ledger.openMigrationLedger(fixture.config);
      yield* seedLedger(service);
      const worker = Option.getOrThrow(yield* service.workerJournal.load(operation.operationId));
      yield* service.workerJournal.commit(cleanupEdit(worker, 960));
      return service;
    }
    const writing = Effect.gen(write);
    const ledger = yield* Effect.scoped(writing);
    const late = [
      ledger.readRecovery().pipe(Effect.result),
      ledger.registerRun(registration).pipe(Effect.result),
      ledger.registerRun(null).pipe(Effect.result),
      ledger.runRepository.load(seed.state.runId).pipe(Effect.result),
      ledger.runRepository.commit(cancellation).pipe(Effect.result),
      ledger.workerJournal.load(operation.operationId).pipe(Effect.result),
      ledger.workerJournal
        .commit({
          _tag: 'Register',
          operationId: operation.operationId,
          operation,
          atMs: 900,
          createdAtMs: 900,
        })
        .pipe(Effect.result),
    ];
    for (const effect of late) {
      const result = yield* effect;
      expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'Closed' } });
    }
    function* readback() {
      const service = yield* Ledger.openMigrationLedger(fixture.config);
      const recovered = yield* service.readRecovery();
      expect(Option.isSome(recovered.workers[0]!.snapshot.cleanup)).toBe(true);
      expect(Option.isNone(recovered.workers[1]!.snapshot.cleanup)).toBe(true);
      const detached = Schema.decodeUnknownSync(MigrationLedgerState)({
        runs: recovered.runs,
        workers: recovered.workers.map((value) => value.snapshot),
        sequence: recovered.sequence,
      });
      Object.assign(detached.runs[0]!.state, { deadlineMs: 1 });
      expect((yield* service.readRecovery()).runs[0]?.state.deadlineMs).toBe(seed.state.deadlineMs);
    }
    const reading = Effect.gen(readback);
    yield* Effect.scoped(reading);
    expect(yield* Ledger.readMigrationLedgerStatus(fixture.config)).toMatchObject({
      sequence: 4,
      runCount: 1,
      workerCount: 2,
    });
  }
  const program = Effect.gen(run);
  await runNative(program);
}
test('recovery/load data are detached canonical Options and late calls fail Closed', closure);

function corruptAudit(ledger: NativeLedger, file: string) {
  function* verify() {
    yield* seedLedger(ledger);
    const db = new Database(file, { create: false, strict: true });
    db.query(
      "UPDATE commits SET payload=json_set(payload,'$.workerRevisions[0].after',99) WHERE sequence=2",
    ).run();
    db.close(true);
    const result = yield* Effect.result(ledger.readRecovery());
    const expected = Option.some(expect.objectContaining({ code: 'InvalidData' }));
    expect(Result.getFailure(result)).toEqual(expected);
  }
  const program = Effect.gen(verify);
  return program;
}
test('tampered audit bytes fail closed without repair', () => runNative(scenario(corruptAudit)));

function busy(ledger: NativeLedger, file: string) {
  function* verify() {
    yield* seedLedger(ledger);
    const before = yield* ledger.readRecovery();
    const db = new Database(file, { create: false, strict: true });
    db.run('BEGIN IMMEDIATE');
    const run = yield* Effect.result(ledger.runRepository.commit(cancellation));
    const worker = before.workers[0]!.snapshot;
    const edit = yield* Effect.result(ledger.workerJournal.commit(cleanupEdit(worker, 960)));
    expect(run).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'RunRepositoryError', code: 'Busy' },
    });
    expect(edit).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'WorkerJournalError', code: 'Busy' },
    });
    db.run('ROLLBACK');
    db.close(true);
    expect(yield* ledger.readRecovery()).toEqual(before);
  }
  const program = Effect.gen(verify);
  return program;
}
test('real SQLite Busy returns finite port failures and does not retry', () =>
  runNative(scenario(busy)));

function richHistory(ledger: NativeLedger) {
  function* build() {
    yield* seedLedger(ledger);
    const c = makeWorkerCase();
    for (const kind of ['Create', 'Start'] as const) {
      const intent = makeWorkerIntent(kind);
      const worker = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
      expect(yield* ledger.workerJournal.commit(claimEdit(worker, intent))).toMatchObject({
        _tag: 'Committed',
      });
      const observation = { ...c.observation, atMs: 950 };
      const reply = {
        ...c.reply,
        intentId: intent.intentId,
        atMs: 950,
        outcome: { _tag: 'Completed' as const, observation },
      };
      expect(
        yield* ledger.workerJournal.commit({
          _tag: 'RecordOutcome',
          operationId: operation.operationId,
          expectedRevision: worker.revision + 1,
          atMs: 950,
          reply,
        }),
      ).toMatchObject({ _tag: 'Committed' });
    }
    const receipt = {
      ...c.resource,
      hostId: operation.hostId,
      daemonId: operation.daemonId,
      observedAtMs: 950,
    };
    const { running: _running, ...ready } = receipt;
    expect(
      yield* ledger.workerJournal.commit({
        _tag: 'RecordReadiness',
        operationId: operation.operationId,
        expectedRevision: 4,
        atMs: 951,
        receipt: ready,
      }),
    ).toMatchObject({ _tag: 'Committed' });
    expect(
      yield* ledger.workerJournal.commit({
        _tag: 'AuthorizeExecution',
        operationId: operation.operationId,
        expectedRevision: 5,
        atMs: 960,
      }),
    ).toMatchObject({ _tag: 'Committed' });
    expect(
      yield* ledger.workerJournal.commit({
        _tag: 'RecordReadiness',
        operationId: operation.operationId,
        expectedRevision: 6,
        atMs: 971,
        receipt: { ...ready, observedAtMs: 970 },
      }),
    ).toMatchObject({ _tag: 'Committed' });
    const authorized = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
    yield* ledger.workerJournal.commit(cleanupEdit(authorized, 972));
    const cleaning = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
    expect(
      yield* ledger.workerJournal.commit(
        claimEdit(cleaning, { ...makeWorkerIntent('Stop'), claimedAtMs: 973 }),
      ),
    ).toMatchObject({ _tag: 'Committed' });
    const stopped = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
    yield* ledger.workerJournal.commit({ ...cleanupEdit(stopped, 974), cleanupWindowMs: 0 });
    const recovered = yield* ledger.readRecovery();
    expect(recovered.sequence).toBe(13);
    const state = {
      runs: recovered.runs,
      workers: recovered.workers.map((value) => value.snapshot),
      sequence: recovered.sequence,
    };
    const snapshotOnly = recoverMigrationLedger(state);
    expect(Result.isSuccess(snapshotOnly)).toBe(true);
    expect(recovered.runs[0]?.contract).toEqual(seed.contract);
    expect(recovered.workers.map((value) => value.snapshot.operation)).toEqual(operations);
    expect(recovered.workers[0]?.snapshot.readiness).toEqual(Option.none());
    expect(recovered.workers[0]?.snapshot.executionAuthorizedAtMs).toEqual(Option.some(960));
  }
  const program = Effect.gen(build);
  return program;
}

for (const corruption of [
  'OriginalReadiness',
  'OriginalCleanupWindow',
  'Snapshot',
  'AuditRevision',
  'SequenceGap',
  'ExcessField',
  'RowBinding',
] as const) {
  async function historicalProof() {
    function* run() {
      const fixture = yield* ownedConfig();
      yield* Ledger.initializeMigrationLedger(fixture.config);
      function* populate() {
        const ledger = yield* Ledger.openMigrationLedger(fixture.config);
        yield* richHistory(ledger);
      }
      const populating = Effect.gen(populate);
      yield* Effect.scoped(populating);
      const control = yield* Ledger.readMigrationLedgerStatus(fixture.config);
      expect(control.sequence).toBe(13);
      const db = new Database(fixture.file, { create: false, strict: true });
      const sql = Match.value(corruption).pipe(
        Match.when(
          'OriginalReadiness',
          () =>
            "UPDATE commits SET payload=json_set(payload,'$.command.edit.receipt.imageDigest',?) WHERE sequence=8",
        ),
        Match.when(
          'OriginalCleanupWindow',
          () =>
            "UPDATE commits SET payload=json_set(payload,'$.command.edit.cleanupWindowMs',0) WHERE sequence=11",
        ),
        Match.when(
          'Snapshot',
          () => "UPDATE runs SET payload=json_set(payload,'$.state.spentMicros',18)",
        ),
        Match.when(
          'AuditRevision',
          () =>
            "UPDATE commits SET payload=json_set(payload,'$.workerRevisions[0].after',99) WHERE sequence=2",
        ),
        Match.when('SequenceGap', () => 'DELETE FROM commits WHERE sequence=2'),
        Match.when(
          'ExcessField',
          () =>
            "UPDATE workers SET payload=json_set(payload,'$.unexpected',true) WHERE operation_id='worker-1'",
        ),
        Match.when(
          'RowBinding',
          () => "UPDATE workers SET revision=revision+1 WHERE operation_id='worker-1'",
        ),
        Match.exhaustive,
      );
      const params = Match.value(corruption).pipe(
        Match.when('OriginalReadiness', () => [operation.sourceDigest]),
        Match.orElse(() => []),
      );
      db.query(sql).run(...params);
      db.close(true);
      const names = (yield* fixture.fs.readDirectory(fixture.root)).sort();
      const isShm = Schema.is(Schema.Literal('migration.sqlite-shm'));
      const stable = names.filter((name) => !isShm(name));
      const before = yield* Effect.forEach(stable, (name) =>
        fixture.fs.readFile(`${fixture.root}/${name}`),
      );
      const status = yield* Effect.result(Ledger.readMigrationLedgerStatus(fixture.config));
      const opening = Ledger.openMigrationLedger(fixture.config).pipe(Effect.scoped, Effect.result);
      expect(status).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidData' } });
      expect(yield* opening).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidData' } });
      expect((yield* fixture.fs.readDirectory(fixture.root)).sort()).toEqual(names);
      expect(
        yield* Effect.forEach(stable, (name) => fixture.fs.readFile(`${fixture.root}/${name}`)),
      ).toEqual(before);
    }
    const program = Effect.gen(run);
    await runNative(program);
  }
  test(`replay rejects ${corruption} from populated history without repair`, historicalProof);
}

function padHistory(file: string, fullAudit: boolean, headroom = 1) {
  const db = new Database(file, { create: false, strict: true });
  const recordBytes = db
    .query<{ bytes: number }, []>(
      'SELECT sum(bytes) AS bytes FROM (SELECT length(CAST(payload AS BLOB)) AS bytes FROM runs UNION ALL SELECT length(CAST(payload AS BLOB)) FROM workers)',
    )
    .get()!.bytes;
  const paddingBudget = Match.value(fullAudit).pipe(
    Match.when(true, () => migrationLedgerBounds.maxPayloadBytes),
    Match.when(false, () => migrationLedgerBounds.maxPayloadBytes - recordBytes - headroom),
    Match.exhaustive,
  );
  let remaining = paddingBudget;
  const events = db
    .query<{ sequence: number; payload: string }, []>(
      'SELECT sequence,payload FROM commits ORDER BY sequence',
    )
    .all();
  function pad() {
    for (const row of events) {
      const bytes = Math.min(remaining, migrationLedgerBounds.maxRecordBytes);
      expect(bytes).toBeGreaterThanOrEqual(row.payload.length);
      db.query('UPDATE commits SET payload=? WHERE sequence=?').run(
        row.payload.padEnd(bytes, ' '),
        row.sequence,
      );
      remaining -= bytes;
    }
  }
  db.transaction(pad).immediate();
  db.close(true);
  expect(remaining).toBe(0);
}
function fillHistory(ledger: NativeLedger) {
  function* build() {
    yield* seedLedger(ledger);
    for (let index = 3; index < 64; index += 1) {
      const worker = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
      expect(yield* ledger.workerJournal.commit(cleanupEdit(worker, 960))).toMatchObject({
        _tag: 'Committed',
      });
    }
  }
  const program = Effect.gen(build);
  return program;
}
function retainedWriteBudget(ledger: NativeLedger, file: string) {
  function* verify() {
    yield* fillHistory(ledger);
    padHistory(file, false);
    const before = yield* ledger.readRecovery();
    const worker = before.workers[0]!.snapshot;
    const result = yield* Effect.result(ledger.workerJournal.commit(cleanupEdit(worker, 960)));
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'CapacityExceeded' } });
    expect(yield* ledger.readRecovery()).toEqual(before);
  }
  const program = Effect.gen(verify);
  return program;
}
test('write byte cap includes every retained commit payload, not only current snapshots', () =>
  runNative(scenario(retainedWriteBudget)));

function paddedRecordBudget(ledger: NativeLedger, file: string) {
  function* verify() {
    yield* fillHistory(ledger);
    const before = yield* ledger.readRecovery();
    const state = {
      runs: before.runs,
      workers: before.workers.map((value) => value.snapshot),
      sequence: before.sequence,
    };
    const edit = cleanupEdit(state.workers[1]!, 960);
    const command = { _tag: 'EditWorker' as const, edit };
    const decision = Result.getOrThrow(decideMigrationLedger(state, command));
    const event = Option.getOrThrow(decision.event);
    const encodedCommand = Result.getOrThrow(migrationLedgerEncoding.command(command));
    const encodedEvent = Result.getOrThrow(migrationLedgerEncoding.event(event));
    const headroom =
      migrationPayloadBytes(encodedCommand) + migrationPayloadBytes(encodedEvent) + 1;
    const db = new Database(file, { create: false, strict: true });
    const row = db.query<{ payload: string }, []>('SELECT payload FROM runs').get()!;
    db.query('UPDATE runs SET payload=?').run(row.payload.padEnd(8192, ' '));
    db.close(true);
    padHistory(file, false, headroom);
    expect(yield* ledger.readRecovery()).toEqual(before);
    const result = yield* Effect.result(ledger.workerJournal.commit(edit));
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'CapacityExceeded' } });
    expect(yield* ledger.readRecovery()).toEqual(before);
  }
  const program = Effect.gen(verify);
  return program;
}
test('proposed byte budget preserves raw unchanged records while changed workers grow', () =>
  runNative(scenario(paddedRecordBudget)));

for (const bound of ['Aggregate', 'Record'] as const) {
  function beforeDecode(ledger: NativeLedger, file: string) {
    function* verify() {
      yield* fillHistory(ledger);
      function enlargeRecord() {
        const db = new Database(file, { create: false, strict: true });
        const row = db.query<{ payload: string }, []>('SELECT payload FROM runs').get()!;
        db.query('UPDATE runs SET payload=?').run(
          row.payload.padEnd(migrationLedgerBounds.maxRecordBytes + 1, ' '),
        );
        db.close(true);
      }
      const enlarge = Match.value(bound).pipe(
        Match.when('Aggregate', () => () => padHistory(file, true)),
        Match.when('Record', () => enlargeRecord),
        Match.exhaustive,
      );
      enlarge();
      const decodeRun = spyOn(migrationLedgerDecoding, 'run');
      const decodeEvent = spyOn(migrationLedgerDecoding, 'event');
      const result = yield* Effect.result(ledger.readRecovery());
      expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'CapacityExceeded' } });
      expect(decodeRun).not.toHaveBeenCalled();
      expect(decodeEvent).not.toHaveBeenCalled();
    }
    const program = Effect.gen(verify);
    return program;
  }
  test(`${bound} payload bound refuses before any record/event decode`, () =>
    runNative(scenario(beforeDecode)));
}

async function closeFault() {
  function* run() {
    const fixture = yield* ownedConfig();
    yield* Ledger.initializeMigrationLedger(fixture.config);
    function inject(point: Ledger.MigrationLedgerTestFaultPoint) {
      return Match.value(point).pipe(
        Match.when('Close', () => {
          throw new InjectedFailure({ secret: 'private close' });
        }),
        Match.orElse(() => undefined),
      );
    }
    const opening = Ledger.openMigrationLedger({ ...fixture.config, testFault: inject });
    const result = yield* Effect.scoped(opening).pipe(Effect.exit);
    expect(Exit.isFailure(result)).toBe(true);
    const defects = Match.value(result).pipe(
      Match.tag('Failure', ({ cause }) =>
        cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect),
      ),
      Match.orElse(() => []),
    );
    expect(defects).toEqual([
      expect.objectContaining({ _tag: 'MigrationStorageError', code: 'CloseFailed' }),
    ]);
    expect(encodeUnknown(defects)).not.toContain('private close');
    const reacquiring = Ledger.openMigrationLedger(fixture.config);
    yield* Effect.scoped(reacquiring);
  }
  const program = Effect.gen(run);
  await runNative(program);
}
test(
  'Close fault is redacted, marks services closed and still releases actual ownership',
  closeFault,
);

async function productionFault() {
  function* run() {
    const fixture = yield* ownedConfig();
    let called = false;
    const config = {
      ...fixture.config,
      testFault: () => {
        called = true;
      },
      pathPolicy: {
        _tag: 'Production' as const,
        stateRoot: '/synthetic/migration-ledger',
        ownerUid: fixture.config.pathPolicy.ownerUid,
        homeDirectory: '/synthetic-home',
        repositoryRoots: [],
        buildRoots: [],
        temporaryRoots: [],
        syncedRoots: [],
        filesystem: 'OperatorDeclaredLocalNonSynced' as const,
      },
    };
    const opening = Ledger.openMigrationLedger(config).pipe(Effect.scoped, Effect.result);
    expect(yield* opening).toMatchObject({
      _tag: 'Failure',
      failure: { operation: 'open', code: 'InvalidConfig' },
    });
    expect(called).toBe(false);
    expect(yield* fixture.fs.readDirectory(fixture.root)).toEqual([]);
  }
  const program = Effect.gen(run);
  await runNative(program);
}
test(
  'Production rejects any test fault before selecting or touching a storage path',
  productionFault,
);

function resourceIssueCodes() {
  for (const code of ['Busy', 'CapacityExceeded', 'Closed'] as const) {
    const issue = { _tag: 'WorkerJournalError', operation: 'commit', code };
    const result = Schema.decodeUnknownResult(LifecycleIssue)(issue);
    expect(Result.isSuccess(result)).toBe(true);
  }
}
test(
  'existing lifecycle issue codec preserves the new finite journal resource codes',
  resourceIssueCodes,
);

async function populatedStatus() {
  function* run() {
    const fixture = yield* ownedConfig();
    yield* Ledger.initializeMigrationLedger(fixture.config);
    const ledger = yield* Ledger.openMigrationLedger(fixture.config);
    expect(yield* ledger.readRecovery()).toEqual({ sequence: 0, runs: [], workers: [] });
    yield* richHistory(ledger);
    const names = (yield* fixture.fs.readDirectory(fixture.root)).sort();
    const isShm = Schema.is(Schema.Literal('migration.sqlite-shm'));
    const stable = names.filter((name) => !isShm(name));
    const bytes = yield* Effect.forEach(stable, (name) =>
      fixture.fs.readFile(`${fixture.root}/${name}`),
    );
    const beforeShm = yield* fixture.fs.stat(`${fixture.file}-shm`);
    const before = yield* ledger.readRecovery();
    expect(yield* Ledger.readMigrationLedgerStatus(fixture.config)).toMatchObject({
      sequence: 13,
      runCount: 1,
      workerCount: 2,
    });
    expect(yield* ledger.readRecovery()).toEqual(before);
    expect((yield* fixture.fs.readDirectory(fixture.root)).sort()).toEqual(names);
    expect(
      yield* Effect.forEach(stable, (name) => fixture.fs.readFile(`${fixture.root}/${name}`)),
    ).toEqual(bytes);
    const afterShm = yield* fixture.fs.stat(`${fixture.file}-shm`);
    expect([afterShm.dev, afterShm.ino, afterShm.size, afterShm.mode, afterShm.uid]).toEqual([
      beforeShm.dev,
      beforeShm.ino,
      beforeShm.size,
      beforeShm.mode,
      beforeShm.uid,
    ]);
  }
  const program = Effect.gen(run);
  await runNative(program);
}
test(
  'populated read-only status under live owner preserves inventory, rows and all non-SHM bytes',
  populatedStatus,
);
