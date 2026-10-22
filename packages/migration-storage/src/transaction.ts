import type { Database } from 'bun:sqlite';

import {
  decideMigrationLedger,
  migrationLedgerBounds,
  migrationLedgerEncoding,
  migrationPayloadBytes,
  type MigrationLedgerEvent,
} from '@ceirean/engine/journal-policy';
import { Match, Option, Result, Schema } from 'effect';

import { measureLedger, readLedgerState, unwrap } from './codec.ts';
import type { MigrationLedgerTestFault } from './config.ts';
import { MigrationStorageError, requireStorage, sanitized } from './errors.ts';

const resourceCode = Schema.Struct({
  code: Schema.Literals([
    'InvalidData',
    'RevisionExhausted',
    'CapacityExceeded',
    'Closed',
    'SQLITE_BUSY',
    'SQLITE_LOCKED',
  ]),
});
function failure(error: unknown, operation: 'read' | 'commit' | 'close') {
  const decoded = Schema.decodeUnknownResult(resourceCode)(error);
  const fallback = Match.value(operation).pipe(
    Match.when('commit', () => 'CommitFailed' as const),
    Match.orElse(() => 'InvalidData' as const),
  );
  function known({ code }: typeof resourceCode.Type) {
    const mapped = Match.value(code).pipe(
      Match.whenOr('SQLITE_BUSY', 'SQLITE_LOCKED', () => 'Busy' as const),
      Match.orElse((value) => value),
    );
    return new MigrationStorageError({ operation, code: mapped });
  }
  return Result.match(decoded, {
    onFailure: () => sanitized(error, operation, fallback),
    onSuccess: known,
  });
}

export function makeTransactions(db: Database, fault: MigrationLedgerTestFault | undefined) {
  let closed = false;
  function attempt<A>(operation: 'read' | 'commit' | 'close', action: () => A) {
    return Result.try({
      try: () => {
        requireStorage(!closed, 'Closed');
        return action();
      },
      catch: (error) => failure(error, operation),
    });
  }
  function read() {
    return attempt('read', () => db.transaction(() => readLedgerState(db)).deferred());
  }
  function ensureOpen() {
    return attempt('read', () => undefined);
  }
  function commit(command: unknown) {
    function write() {
      const current = readLedgerState(db);
      const decision = unwrap(decideMigrationLedger(current, command));
      function persist(event: MigrationLedgerEvent) {
        const runs = decision.next.runs.map((run) => ({
          run,
          payload: unwrap(migrationLedgerEncoding.run(run)),
        }));
        const workers = decision.next.workers.map((worker) => ({
          worker,
          payload: unwrap(migrationLedgerEncoding.worker(worker)),
        }));
        const encodedEvent = unwrap(migrationLedgerEncoding.event(event));
        const encodedCommand = unwrap(migrationLedgerEncoding.command(event.command));
        const stored = measureLedger(db);
        const changedRuns = runs.filter(({ run }) =>
          event.runRevisions.some((revision) => revision.runId === run.state.runId),
        );
        const changedWorkers = workers.filter(({ worker }) =>
          event.workerRevisions.some(
            (revision) => revision.operationId === worker.operation.operationId,
          ),
        );
        // Unchanged rows retain their original encoding, including JSON whitespace.
        let proposed = stored.records;
        for (const { run, payload } of changedRuns) {
          const previous = db
            .query<{ bytes: number }, [string]>(
              'SELECT length(CAST(payload AS BLOB)) AS bytes FROM runs WHERE run_id=?',
            )
            .get(run.state.runId);
          proposed += migrationPayloadBytes(payload) - (previous?.bytes ?? 0);
        }
        for (const { worker, payload } of changedWorkers) {
          const previous = db
            .query<{ bytes: number }, [string]>(
              'SELECT length(CAST(payload AS BLOB)) AS bytes FROM workers WHERE operation_id=?',
            )
            .get(worker.operation.operationId);
          proposed += migrationPayloadBytes(payload) - (previous?.bytes ?? 0);
        }
        requireStorage(
          Math.max(stored.records, proposed) +
            stored.events +
            migrationPayloadBytes(encodedEvent) +
            migrationPayloadBytes(encodedCommand) <=
            migrationLedgerBounds.maxPayloadBytes,
          'CapacityExceeded',
        );
        for (const { run, payload } of changedRuns) {
          db.query(
            'INSERT INTO runs(run_id,revision,payload) VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',
          ).run(run.state.runId, run.revision, payload);
          fault?.('AfterRunWrite');
        }
        for (const { worker, payload } of changedWorkers) {
          db.query(
            'INSERT INTO workers(operation_id,run_id,revision,payload) VALUES(?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',
          ).run(
            worker.operation.operationId,
            worker.operation.identity.runId,
            worker.revision,
            payload,
          );
          fault?.('AfterWorkerWrite');
        }
        db.query('INSERT INTO commits(sequence,payload) VALUES(?,?)').run(
          event.sequence,
          encodedEvent,
        );
        db.query('UPDATE metadata SET sequence=? WHERE id=1').run(decision.next.sequence);
        fault?.('AfterEventWrite');
        fault?.('BeforeCommit');
        return { reply: decision.reply, committed: true };
      }
      return Option.match(decision.event, {
        onNone: () => ({ reply: decision.reply, committed: false }),
        onSome: persist,
      });
    }
    function execute() {
      const outcome = db.transaction(write).immediate();
      function acknowledged() {
        fault?.('AfterCommit');
        return outcome.reply;
      }
      return Match.value(outcome.committed).pipe(
        Match.when(true, acknowledged),
        Match.orElse(() => outcome.reply),
      );
    }
    return attempt('commit', execute);
  }
  function close() {
    return attempt('close', () => {
      closed = true;
      fault?.('Close');
    });
  }
  return { read, commit, close, ensureOpen };
}
