import type { RunId, WorkerOperationId } from '@ceirean/domain';
import {
  RunRepositoryError,
  WorkerJournalError,
  makeRunRepository,
  makeWorkerJournal,
  type RunRepositoryDriver,
  type WorkerJournalDriver,
} from '@ceirean/engine';
import type { RunChange, WorkerJournalEdit } from '@ceirean/engine';
import { Match, Option, Result } from 'effect';

import type { MigrationStorageError } from './errors.ts';
import type { makeTransactions } from './transaction.ts';

function adapterCode(error: MigrationStorageError, fallback: 'ReadFailed' | 'CommitFailed') {
  return Match.value(error.code).pipe(
    Match.whenOr(
      'InvalidData',
      'RevisionExhausted',
      'CapacityExceeded',
      'Closed',
      'Busy',
      (code) => code,
    ),
    Match.orElse(() => fallback),
  );
}
export function makeDrivers(transactions: ReturnType<typeof makeTransactions>) {
  function loadRun(runId: RunId) {
    return transactions.read().pipe(
      Result.map((state) =>
        Option.fromUndefinedOr(state.runs.find((snapshot) => snapshot.state.runId === runId)),
      ),
      Result.mapError(
        (error) =>
          new RunRepositoryError({
            operation: 'load',
            runId,
            code: adapterCode(error, 'ReadFailed'),
          }),
      ),
    );
  }
  function commitRun(change: RunChange) {
    function result(reply: import('@ceirean/engine/journal-policy').MigrationLedgerReply) {
      return Match.value(reply).pipe(
        Match.tag('RunResult', ({ result }) => Result.succeed(result)),
        Match.orElse(() =>
          Result.fail(
            new RunRepositoryError({
              operation: 'commit',
              runId: change.runId,
              code: 'InvalidData',
            }),
          ),
        ),
      );
    }
    return transactions.commit({ _tag: 'ChangeRun', change }).pipe(
      Result.mapError(
        (error) =>
          new RunRepositoryError({
            operation: 'commit',
            runId: change.runId,
            code: adapterCode(error, 'CommitFailed'),
          }),
      ),
      Result.flatMap(result),
    );
  }
  function loadWorker(operationId: WorkerOperationId) {
    return transactions.read().pipe(
      Result.map((state) =>
        Option.fromUndefinedOr(
          state.workers.find((snapshot) => snapshot.operation.operationId === operationId),
        ),
      ),
      Result.mapError(
        (error) =>
          new WorkerJournalError({ operation: 'load', code: adapterCode(error, 'ReadFailed') }),
      ),
    );
  }
  function commitWorker(edit: WorkerJournalEdit) {
    function result(reply: import('@ceirean/engine/journal-policy').MigrationLedgerReply) {
      return Match.value(reply).pipe(
        Match.tag('WorkerResult', ({ result }) => Result.succeed(result)),
        Match.orElse(() =>
          Result.fail(new WorkerJournalError({ operation: 'commit', code: 'InvalidData' })),
        ),
      );
    }
    return transactions.commit({ _tag: 'EditWorker', edit }).pipe(
      Result.mapError(
        (error) =>
          new WorkerJournalError({ operation: 'commit', code: adapterCode(error, 'CommitFailed') }),
      ),
      Result.flatMap(result),
    );
  }
  const run: RunRepositoryDriver = { load: loadRun, commit: commitRun };
  const worker: WorkerJournalDriver = { load: loadWorker, commit: commitWorker };
  return { runRepository: makeRunRepository(run), workerJournal: makeWorkerJournal(worker) };
}
