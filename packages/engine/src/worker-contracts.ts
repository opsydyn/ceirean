import {
  CandidateIdentity,
  NonNegativeSafeInteger,
  WorkerCleanup,
  WorkerContainerId,
  WorkerIntent,
  WorkerMutationReply,
  WorkerObservation,
  WorkerOperation,
  WorkerOperationId,
  WorkerReadyReceipt,
  WorkerRefusal,
} from '@leviathan/domain';
import { Schema } from 'effect';

export const WorkerJournalSnapshot = Schema.Struct({
  revision: NonNegativeSafeInteger,
  operation: WorkerOperation,
  createdAtMs: NonNegativeSafeInteger,
  authority: Schema.Struct({
    identity: CandidateIdentity,
    cancelledAtMs: Schema.Option(NonNegativeSafeInteger),
  }),
  intents: Schema.Array(WorkerIntent),
  containerId: Schema.Option(WorkerContainerId),
  readiness: Schema.Option(WorkerReadyReceipt),
  executionAuthorizedAtMs: Schema.Option(NonNegativeSafeInteger),
  cleanup: Schema.Option(WorkerCleanup),
});
export type WorkerJournalSnapshot = typeof WorkerJournalSnapshot.Type;

const common = { operationId: WorkerOperationId, atMs: NonNegativeSafeInteger };
const conditional = { ...common, expectedRevision: NonNegativeSafeInteger };
export const WorkerJournalEdit = Schema.Union([
  Schema.TaggedStruct('Register', {
    ...common,
    operation: WorkerOperation,
    createdAtMs: NonNegativeSafeInteger,
  }),
  Schema.TaggedStruct('Claim', { ...conditional, intent: WorkerIntent }),
  Schema.TaggedStruct('RecordOutcome', { ...conditional, reply: WorkerMutationReply }),
  Schema.TaggedStruct('RecordReadiness', { ...conditional, receipt: WorkerReadyReceipt }),
  Schema.TaggedStruct('AuthorizeExecution', conditional),
  Schema.TaggedStruct('RequestCancellation', {
    ...conditional,
    cleanupWindowMs: NonNegativeSafeInteger,
  }),
  Schema.TaggedStruct('RequestCleanup', {
    ...conditional,
    cleanupWindowMs: NonNegativeSafeInteger,
  }),
  Schema.TaggedStruct('RecordCleanup', { ...conditional, observation: WorkerObservation }),
]);
export type WorkerJournalEdit = typeof WorkerJournalEdit.Type;

export const WorkerJournalResult = Schema.Union([
  Schema.TaggedStruct('Committed', { snapshot: WorkerJournalSnapshot }),
  Schema.TaggedStruct('Conflict', { operationId: WorkerOperationId }),
  Schema.TaggedStruct('Refused', { refusal: WorkerRefusal }),
]);
export type WorkerJournalResult = typeof WorkerJournalResult.Type;

export const WorkerMutationRequest = Schema.Struct({
  operation: WorkerOperation,
  intent: WorkerIntent,
});
export type WorkerMutationRequest = typeof WorkerMutationRequest.Type;

// Some requests direct immutable-ID inspection; None requests unbound discovery.
export const WorkerObservationRequest = Schema.Struct({
  operation: WorkerOperation,
  containerId: Schema.Option(WorkerContainerId),
});
export type WorkerObservationRequest = typeof WorkerObservationRequest.Type;

export const WorkerExecutionRequest = Schema.Struct({
  operation: WorkerOperation,
  readiness: WorkerReadyReceipt,
  authorizedAtMs: NonNegativeSafeInteger,
});
export type WorkerExecutionRequest = typeof WorkerExecutionRequest.Type;

export const WorkerExecutionReply = Schema.Struct({
  operationId: WorkerOperationId,
  identity: CandidateIdentity,
  completedAtMs: NonNegativeSafeInteger,
});
export type WorkerExecutionReply = typeof WorkerExecutionReply.Type;
