import type { WorkerOperationId } from '@ceirean/domain';
import { Data } from 'effect';

export class WorkerJournalError extends Data.TaggedError('WorkerJournalError')<{
  readonly operation: 'load' | 'commit';
  readonly code:
    | 'ReadFailed'
    | 'CommitFailed'
    | 'InvalidData'
    | 'RevisionExhausted'
    | 'Busy'
    | 'CapacityExceeded'
    | 'Closed';
}> {}

export class WorkerMechanismError extends Data.TaggedError('WorkerMechanismError')<{
  readonly operation: 'mutate' | 'observe' | 'execute';
  readonly code: 'Unavailable' | 'InvalidReply';
}> {}

export class WorkerLifecycleRuntimeError extends Data.TaggedError('WorkerLifecycleRuntimeError')<{
  readonly operationId: WorkerOperationId;
  readonly code: 'ActorFailed' | 'ObservationFailed' | 'DrainExpired';
}> {}
