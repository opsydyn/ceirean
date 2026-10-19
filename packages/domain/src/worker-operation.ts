import { Match, Result, Schema } from 'effect';

import { CandidateIdentity, Digest, NonNegativeSafeInteger } from './identities.ts';
import { RunLimits } from './upgrade-run.ts';

const Identifier = Schema.String.check(Schema.isPattern(/\S/));
export const WorkerOperationId = Identifier.pipe(Schema.brand('WorkerOperationId'));
export type WorkerOperationId = typeof WorkerOperationId.Type;
export const WorkerIntentId = Identifier.pipe(Schema.brand('WorkerIntentId'));
export type WorkerIntentId = typeof WorkerIntentId.Type;
export const WorkerIssuerId = Identifier.pipe(Schema.brand('WorkerIssuerId'));
export type WorkerIssuerId = typeof WorkerIssuerId.Type;
export const WorkerHostId = Identifier.pipe(Schema.brand('WorkerHostId'));
export type WorkerHostId = typeof WorkerHostId.Type;
export const WorkerDaemonId = Identifier.pipe(Schema.brand('WorkerDaemonId'));
export type WorkerDaemonId = typeof WorkerDaemonId.Type;
export const WorkerContainerId = Identifier.pipe(Schema.brand('WorkerContainerId'));
export type WorkerContainerId = typeof WorkerContainerId.Type;

const refusalFields = { operationId: Schema.optionalKey(WorkerOperationId) };
export const WorkerRefusal = Schema.Union([
  Schema.TaggedStruct('InvalidInput', refusalFields),
  Schema.TaggedStruct('NotFound', refusalFields),
  Schema.TaggedStruct('IdentityMismatch', refusalFields),
  Schema.TaggedStruct('ConflictingOperation', refusalFields),
  Schema.TaggedStruct('StaleObservation', refusalFields),
  Schema.TaggedStruct('InvalidTime', refusalFields),
  Schema.TaggedStruct('DeadlineExpired', refusalFields),
  Schema.TaggedStruct('NotCurrent', refusalFields),
  Schema.TaggedStruct('Cancelled', refusalFields),
  Schema.TaggedStruct('NoCustody', refusalFields),
  Schema.TaggedStruct('ReadinessMismatch', refusalFields),
  Schema.TaggedStruct('AmbiguousObservation', refusalFields),
  Schema.TaggedStruct('UnresolvedIntent', refusalFields),
  Schema.TaggedStruct('AlreadyClaimed', refusalFields),
  Schema.TaggedStruct('ShuttingDown', refusalFields),
]);
export type WorkerRefusal = typeof WorkerRefusal.Type;

const WorkerMount = Schema.Struct({
  source: Schema.String,
  target: Schema.String,
  readOnly: Schema.Boolean,
});
export const WorkerConfiguration = Schema.Struct({
  mounts: Schema.Array(WorkerMount).check(
    Schema.makeFilter((mounts: readonly (typeof WorkerMount.Type)[]) =>
      mounts.every(
        (mount, index) =>
          !mounts.slice(0, index).some((previous) => previous.target === mount.target),
      ),
    ),
  ),
  network: Schema.String,
  security: Schema.Struct({
    user: Schema.String,
    droppedCapabilities: Schema.Array(Schema.String).check(Schema.isUnique()),
    noNewPrivileges: Schema.Boolean,
  }),
});
export type WorkerConfiguration = typeof WorkerConfiguration.Type;

export const WorkerCustody = Schema.Struct({
  controllerRoot: Schema.String,
  stagingDirectory: Schema.String,
  containerSlot: Identifier,
  retainedArtifacts: Schema.Array(Schema.String),
});
export type WorkerCustody = typeof WorkerCustody.Type;

export const WorkerSubject = Schema.Struct({
  operationId: WorkerOperationId,
  identity: CandidateIdentity,
  hostId: WorkerHostId,
  daemonId: WorkerDaemonId,
});
export type WorkerSubject = typeof WorkerSubject.Type;
const pinnedFields = {
  imageDigest: Digest,
  sourceDigest: Digest,
  policyDigest: Digest,
  configDigest: Digest,
  configuration: WorkerConfiguration,
};
export const WorkerOperation = Schema.Struct({
  ...WorkerSubject.fields,
  purpose: Schema.Literals(['Baseline', 'Candidate', 'Verification']),
  ...pinnedFields,
  custody: WorkerCustody,
  limits: RunLimits,
});
export type WorkerOperation = typeof WorkerOperation.Type;

export const WorkerContainer = Schema.Struct({
  containerId: WorkerContainerId,
  operationId: WorkerOperationId,
  identity: CandidateIdentity,
  ...pinnedFields,
  running: Schema.Boolean,
});
export type WorkerContainer = typeof WorkerContainer.Type;
export const WorkerObservation = Schema.Struct({
  ...WorkerSubject.fields,
  atMs: NonNegativeSafeInteger,
  resources: Schema.Array(WorkerContainer),
  staging: Schema.Literals(['Present', 'Absent', 'Unknown']),
});
export type WorkerObservation = typeof WorkerObservation.Type;
export const WorkerReadyReceipt = Schema.Struct({
  ...WorkerSubject.fields,
  containerId: WorkerContainerId,
  ...pinnedFields,
  observedAtMs: NonNegativeSafeInteger,
});
export type WorkerReadyReceipt = typeof WorkerReadyReceipt.Type;

export const WorkerMutationOutcome = Schema.Union([
  Schema.TaggedStruct('Completed', { observation: WorkerObservation }),
  Schema.TaggedStruct('Failed', { reason: WorkerRefusal }),
  Schema.TaggedStruct('Unknown', { reason: WorkerRefusal }),
]);
export type WorkerMutationOutcome = typeof WorkerMutationOutcome.Type;
export const WorkerIntentOutcome = Schema.Union([
  Schema.TaggedStruct('Claimed', {}),
  WorkerMutationOutcome,
]);
export type WorkerIntentOutcome = typeof WorkerIntentOutcome.Type;
export const WorkerIntent = Schema.Struct({
  intentId: WorkerIntentId,
  operationId: WorkerOperationId,
  issuerId: WorkerIssuerId,
  kind: Schema.Literals(['Create', 'Start', 'Stop', 'Remove']),
  resource: Identifier,
  claimedAtMs: NonNegativeSafeInteger,
  outcome: WorkerIntentOutcome,
});
export type WorkerIntent = typeof WorkerIntent.Type;

const cleanupTimes = { requestedAtMs: NonNegativeSafeInteger, deadlineMs: NonNegativeSafeInteger };
export const WorkerCleanup = Schema.Union([
  Schema.TaggedStruct('CleanupPending', cleanupTimes),
  Schema.TaggedStruct('CleanupUnknown', { ...cleanupTimes, reason: WorkerRefusal }),
  Schema.TaggedStruct('CleanupConfirmed', {
    ...cleanupTimes,
    observedAtMs: NonNegativeSafeInteger,
  }),
]);
export type WorkerCleanup = typeof WorkerCleanup.Type;
export const WorkerMutationReply = Schema.Struct({
  ...WorkerSubject.fields,
  intentId: WorkerIntentId,
  issuerId: WorkerIssuerId,
  atMs: NonNegativeSafeInteger,
  outcome: WorkerMutationOutcome,
});
export type WorkerMutationReply = typeof WorkerMutationReply.Type;

export function decodeWorkerOperation(
  input: unknown,
): Result.Result<WorkerOperation, WorkerRefusal> {
  const result = Schema.decodeUnknownResult(WorkerOperation)(input);
  return Result.mapError(result, () => ({ _tag: 'InvalidInput' as const }));
}

export function decodeWorkerObservation(
  input: unknown,
): Result.Result<WorkerObservation, WorkerRefusal> {
  const result = Schema.decodeUnknownResult(WorkerObservation)(input);
  return Result.mapError(result, () => ({ _tag: 'InvalidInput' as const }));
}

export function decodeWorkerMutationReply(
  input: unknown,
): Result.Result<WorkerMutationReply, WorkerRefusal> {
  function* decodeReply() {
    const result = Schema.decodeUnknownResult(WorkerMutationReply)(input);
    const reply = yield* Result.mapError(result, () => ({ _tag: 'InvalidInput' as const }));
    yield* Match.value(reply.outcome).pipe(
      Match.tag('Completed', ({ observation }) => checkCompletion(reply, observation)),
      Match.tag('Failed', () => Result.succeed(undefined)),
      Match.tag('Unknown', () => Result.succeed(undefined)),
      Match.exhaustive,
    );
    return reply;
  }
  return Result.gen(decodeReply);
}

const sameSubject = Schema.toEquivalence(WorkerSubject);
const sameIdentity = Schema.toEquivalence(CandidateIdentity);

function checkCompletion(
  reply: WorkerMutationReply,
  observation: WorkerObservation,
): Result.Result<void, WorkerRefusal> {
  function requireCompletion(
    condition: boolean,
    code: WorkerRefusal['_tag'],
  ): Result.Result<void, WorkerRefusal> {
    return Match.value(condition).pipe(
      Match.when(true, () => Result.succeed(undefined)),
      Match.when(false, () => Result.fail({ _tag: code, operationId: reply.operationId })),
      Match.exhaustive,
    );
  }
  function* validateCompletion() {
    yield* requireCompletion(observation.resources.length <= 1, 'AmbiguousObservation');
    // Empty Remove readback is representable; the journal authorizes against the stored intent.
    yield* requireCompletion(sameSubject(reply, observation), 'IdentityMismatch');
    yield* requireCompletion(
      observation.resources.every(
        (resource) =>
          resource.operationId === reply.operationId &&
          sameIdentity(reply.identity, resource.identity),
      ),
      'IdentityMismatch',
    );
    yield* requireCompletion(observation.atMs <= reply.atMs, 'InvalidTime');
  }
  return Result.gen(validateCompletion);
}
