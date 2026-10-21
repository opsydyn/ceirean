import type { WorkerOperationId } from '@ceirean/domain';
import { Effect, Option, Result } from 'effect';

import type {
  WorkerExecutionRequest,
  WorkerJournalEdit,
  WorkerJournalResult,
  WorkerJournalSnapshot,
  WorkerMutationRequest,
  WorkerObservationRequest,
} from './worker-contracts.ts';
import { WorkerJournalError, WorkerMechanismError } from './worker-errors.ts';

export interface WorkerJournalDriver {
  readonly load: (
    operationId: WorkerOperationId,
  ) => Result.Result<Option.Option<WorkerJournalSnapshot>, WorkerJournalError>;
  readonly commit: (
    edit: WorkerJournalEdit,
  ) => Result.Result<WorkerJournalResult, WorkerJournalError>;
}

export interface WorkerMechanismDriver {
  readonly mutate: (
    request: WorkerMutationRequest,
    signal: AbortSignal,
  ) => Promise<Result.Result<unknown, WorkerMechanismError>>;
  readonly observe: (
    request: WorkerObservationRequest,
    signal: AbortSignal,
  ) => Promise<Result.Result<unknown, WorkerMechanismError>>;
  readonly execute: (
    request: WorkerExecutionRequest,
    signal: AbortSignal,
  ) => Promise<Result.Result<unknown, WorkerMechanismError>>;
}

export function makeWorkerJournal(driver: WorkerJournalDriver) {
  return {
    load: (operationId: WorkerOperationId) =>
      Effect.try({
        try: () => driver.load(operationId),
        catch: () => new WorkerJournalError({ operation: 'load', code: 'ReadFailed' }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.withSpan('WorkerJournal.load')),
    commit: (edit: WorkerJournalEdit) =>
      Effect.try({
        try: () => driver.commit(edit),
        catch: () => new WorkerJournalError({ operation: 'commit', code: 'CommitFailed' }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.withSpan('WorkerJournal.commit')),
  };
}

export function makeWorkerMechanism(driver: WorkerMechanismDriver) {
  return {
    mutate: (request: WorkerMutationRequest) =>
      Effect.tryPromise({
        try: (signal) => driver.mutate(request, signal),
        catch: () => new WorkerMechanismError({ operation: 'mutate', code: 'Unavailable' }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.withSpan('WorkerMechanism.mutate')),
    observe: (request: WorkerObservationRequest) =>
      Effect.tryPromise({
        try: (signal) => driver.observe(request, signal),
        catch: () => new WorkerMechanismError({ operation: 'observe', code: 'Unavailable' }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.withSpan('WorkerMechanism.observe')),
    execute: (request: WorkerExecutionRequest) =>
      Effect.tryPromise({
        try: (signal) => driver.execute(request, signal),
        catch: () => new WorkerMechanismError({ operation: 'execute', code: 'Unavailable' }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.withSpan('WorkerMechanism.execute')),
  };
}
