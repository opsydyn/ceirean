import type { Database } from 'bun:sqlite';

import {
  MigrationLedgerEvent,
  MigrationLedgerState,
  decideMigrationLedger,
  migrationLedgerBounds,
  migrationLedgerDecoding,
  recoverMigrationLedger,
} from '@ceirean/engine/journal-policy';
import { Option, Result, Schema } from 'effect';

import type { MigrationLedgerConfig } from './config.ts';
import { requireStorage } from './errors.ts';
import { ledgerTables, validateSchema } from './schema.ts';

export function unwrap<A, E>(result: Result.Result<A, E>) {
  return Result.getOrThrowWith(result, (error) => error);
}

export function measureLedger(db: Database) {
  // Measure UTF-8 bytes in SQLite before copying or decoding any payload.
  const totals = db
    .query<{ runs: number; workers: number; commits: number }, []>(
      'SELECT (SELECT count(*) FROM runs) AS runs,(SELECT count(*) FROM workers) AS workers,(SELECT count(*) FROM commits) AS commits',
    )
    .get();
  requireStorage(totals !== null, 'InvalidData');
  const boundedCounts = [
    totals !== null,
    (totals?.runs ?? Infinity) <= migrationLedgerBounds.maxRuns,
    (totals?.workers ?? Infinity) <= migrationLedgerBounds.maxWorkers,
    (totals?.commits ?? Infinity) <= migrationLedgerBounds.maxEvents,
  ].every(Boolean);
  requireStorage(boundedCounts, 'CapacityExceeded');
  const sizes = db
    .query<{ total: number; largest: number; records: number; events: number }, []>(
      `SELECT coalesce(sum(bytes),0) AS total,coalesce(max(bytes),0) AS largest,
      coalesce(sum(CASE WHEN kind=0 THEN bytes ELSE 0 END),0) AS records,
      coalesce(sum(CASE WHEN kind=1 THEN bytes ELSE 0 END),0) AS events
      FROM (SELECT length(CAST(payload AS BLOB)) AS bytes,0 AS kind FROM runs
      UNION ALL SELECT length(CAST(payload AS BLOB)),0 FROM workers
      UNION ALL SELECT length(CAST(payload AS BLOB)),1 FROM commits)`,
    )
    .get();
  requireStorage(sizes !== null, 'InvalidData');
  const boundedBytes = [
    sizes !== null,
    (sizes?.total ?? Infinity) <= migrationLedgerBounds.maxPayloadBytes,
    (sizes?.largest ?? Infinity) <= migrationLedgerBounds.maxRecordBytes,
  ].every(Boolean);
  requireStorage(boundedBytes, 'CapacityExceeded');
  return { records: sizes?.records ?? 0, events: sizes?.events ?? 0 };
}

const sameEvent = Schema.toEquivalence(MigrationLedgerEvent);
const sameState = Schema.toEquivalence(MigrationLedgerState);
function ordered(state: MigrationLedgerState) {
  return {
    ...state,
    runs: [...state.runs].sort((a, b) => a.state.runId.localeCompare(b.state.runId)),
    workers: [...state.workers].sort((a, b) =>
      a.operation.operationId.localeCompare(b.operation.operationId),
    ),
  };
}

// Caller holds one read/write transaction. Audit replay makes decisions only:
// it never recovers actors, runs mechanisms, or emits external effects.
export function readLedgerState(db: Database) {
  measureLedger(db);
  const metadata = db.query<{ sequence: number }, []>('SELECT sequence FROM metadata').all();
  requireStorage(metadata.length === 1, 'InvalidData');
  const sequence = metadata[0]?.sequence ?? -1;
  function decodeRun(row: { run_id: string; revision: number; payload: string }) {
    const run = unwrap(migrationLedgerDecoding.run(row.payload));
    requireStorage(run.state.runId === row.run_id && run.revision === row.revision, 'InvalidData');
    return run;
  }
  const runs = db
    .query<{ run_id: string; revision: number; payload: string }, []>(
      'SELECT run_id,revision,payload FROM runs ORDER BY rowid',
    )
    .all()
    .map(decodeRun);
  function decodeWorker(row: {
    operation_id: string;
    run_id: string;
    revision: number;
    payload: string;
  }) {
    const worker = unwrap(migrationLedgerDecoding.worker(row.payload));
    const bound = [
      worker.operation.operationId === row.operation_id,
      worker.operation.identity.runId === row.run_id,
      worker.revision === row.revision,
    ].every(Boolean);
    requireStorage(bound, 'InvalidData');
    return worker;
  }
  const workers = db
    .query<{ operation_id: string; run_id: string; revision: number; payload: string }, []>(
      'SELECT operation_id,run_id,revision,payload FROM workers ORDER BY rowid',
    )
    .all()
    .map(decodeWorker);
  let replay: MigrationLedgerState = { sequence: 0, runs: [], workers: [] };
  const events = db
    .query<{ sequence: number; payload: string }, []>(
      'SELECT sequence,payload FROM commits ORDER BY sequence',
    )
    .all();
  requireStorage(events.length === sequence, 'InvalidData');
  for (const row of events) {
    const event = unwrap(migrationLedgerDecoding.event(row.payload));
    requireStorage(
      row.sequence === replay.sequence + 1 && event.sequence === row.sequence,
      'InvalidData',
    );
    const decided = unwrap(decideMigrationLedger(replay, event.command));
    requireStorage(
      Option.exists(decided.event, (expected) => sameEvent(expected, event)),
      'InvalidData',
    );
    replay = decided.next;
  }
  const state = { sequence, runs, workers };
  const exact = sameState(ordered(state), ordered(replay));
  requireStorage(exact, 'InvalidData');
  unwrap(recoverMigrationLedger(state));
  return state;
}

export function validateLedger(db: Database, config: MigrationLedgerConfig, identity: string) {
  validateSchema(db, ledgerTables, 'wal');
  const rows = db
    .query<{ ledger_id: string; identity: string }, []>('SELECT ledger_id,identity FROM metadata')
    .all();
  const bound = [
    rows.length === 1,
    rows[0]?.ledger_id === config.ledgerId,
    rows[0]?.identity === identity,
  ].every(Boolean);
  requireStorage(bound, 'InvalidData');
  const state = readLedgerState(db);
  return {
    ledgerId: config.ledgerId,
    schemaVersion: 1 as const,
    sequence: state.sequence,
    runCount: state.runs.length,
    workerCount: state.workers.length,
  };
}
