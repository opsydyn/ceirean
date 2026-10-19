import { Array, Match, Option, Result, Schema } from 'effect';

import { CandidateIdentity, NonNegativeSafeInteger } from './identities.ts';
import {
  WorkerContainerId,
  WorkerSubject,
  decodeWorkerObservation,
  decodeWorkerOperation,
} from './worker-operation.ts';
import type {
  WorkerConfiguration,
  WorkerContainer,
  WorkerCustody,
  WorkerObservation,
  WorkerOperation,
  WorkerReadyReceipt,
  WorkerRefusal,
} from './worker-operation.ts';

const sameIdentity = Schema.toEquivalence(CandidateIdentity);
const sameSubject = Schema.toEquivalence(WorkerSubject);

function requireEvidence(
  condition: boolean,
  code: WorkerRefusal['_tag'],
  operation: WorkerOperation,
): Result.Result<void, WorkerRefusal> {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () => Result.fail({ _tag: code, operationId: operation.operationId })),
    Match.exhaustive,
  );
}

function sameConfiguration(expected: WorkerConfiguration, actual: WorkerConfiguration): boolean {
  const capabilitiesMatch = expected.security.droppedCapabilities.every((capability) =>
    actual.security.droppedCapabilities.includes(capability),
  );
  const mountsMatch = expected.mounts.every((mount) =>
    actual.mounts.some((other) =>
      [
        mount.source === other.source,
        mount.target === other.target,
        mount.readOnly === other.readOnly,
      ].every(Boolean),
    ),
  );
  return [
    expected.network === actual.network,
    expected.security.user === actual.security.user,
    expected.security.noNewPrivileges === actual.security.noNewPrivileges,
    expected.security.droppedCapabilities.length === actual.security.droppedCapabilities.length,
    capabilitiesMatch,
    expected.mounts.length === actual.mounts.length,
    mountsMatch,
  ].every(Boolean);
}

function matchesBinding(operation: WorkerOperation, resource: WorkerContainer): boolean {
  return [
    operation.imageDigest === resource.imageDigest,
    operation.sourceDigest === resource.sourceDigest,
    operation.policyDigest === resource.policyDigest,
    operation.configDigest === resource.configDigest,
    sameConfiguration(operation.configuration, resource.configuration),
  ].every(Boolean);
}

// Lexical POSIX custody only: never normalize an escaping path into an owned path.
function isAbsolutePath(path: string): boolean {
  const dotSegments = ['.', '..'];
  const segments = path.split('/').slice(1);
  const safeCharacters = [...path].every(
    (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );
  return [
    path.startsWith('/'),
    !path.includes('\\'),
    safeCharacters,
    !path.includes('//'),
    !path.endsWith('/'),
    segments.every((segment) => !dotSegments.includes(segment)),
  ].every(Boolean);
}

function isDescendant(root: string, path: string): boolean {
  return path.startsWith(`${root}/`);
}

function hasCustody(custody: WorkerCustody): boolean {
  return (
    isAbsolutePath(custody.controllerRoot) &&
    isAbsolutePath(custody.stagingDirectory) &&
    isDescendant(custody.controllerRoot, custody.stagingDirectory) &&
    custody.retainedArtifacts.every(
      (artifact) =>
        isAbsolutePath(artifact) &&
        artifact !== custody.stagingDirectory &&
        !isDescendant(custody.stagingDirectory, artifact) &&
        !isDescendant(artifact, custody.stagingDirectory),
    )
  );
}

export function validateWorkerCustody(
  operation: WorkerOperation,
  observation: WorkerObservation,
): Result.Result<void, WorkerRefusal> {
  function* validateCustody() {
    const decodedOperation = yield* decodeWorkerOperation(operation);
    const decodedObservation = yield* decodeWorkerObservation(observation);
    yield* requireEvidence(hasCustody(decodedOperation.custody), 'NoCustody', decodedOperation);
    yield* requireEvidence(
      decodedObservation.resources.length <= 1,
      'AmbiguousObservation',
      decodedOperation,
    );
    yield* requireEvidence(
      sameSubject(decodedOperation, decodedObservation),
      'IdentityMismatch',
      decodedOperation,
    );
    yield* requireEvidence(
      decodedObservation.resources.every(
        (resource) =>
          resource.operationId === decodedOperation.operationId &&
          sameIdentity(decodedOperation.identity, resource.identity),
      ),
      'IdentityMismatch',
      decodedOperation,
    );
    yield* requireEvidence(
      decodedObservation.resources.every((resource) => matchesBinding(decodedOperation, resource)),
      'ReadinessMismatch',
      decodedOperation,
    );
  }
  return Result.gen(validateCustody);
}

export function validateWorkerReadiness(
  operation: WorkerOperation,
  containerId: WorkerContainerId,
  observation: WorkerObservation,
  createdAtMs: number,
  nowMs: number,
): Result.Result<WorkerReadyReceipt, WorkerRefusal> {
  function* validateReadiness() {
    const decodedOperation = yield* decodeWorkerOperation(operation);
    const decodedObservation = yield* decodeWorkerObservation(observation);
    const validTime = Schema.is(NonNegativeSafeInteger);
    const lifetimeIsValid = [
      validTime(createdAtMs),
      validTime(nowMs),
      createdAtMs <= nowMs,
      createdAtMs < decodedOperation.limits.deadlineMs,
      decodedObservation.atMs <= nowMs,
    ].every(Boolean);
    yield* requireEvidence(lifetimeIsValid, 'InvalidTime', decodedOperation);
    yield* requireEvidence(
      nowMs < decodedOperation.limits.deadlineMs,
      'DeadlineExpired',
      decodedOperation,
    );
    yield* requireEvidence(
      decodedObservation.atMs >= createdAtMs,
      'StaleObservation',
      decodedOperation,
    );
    yield* validateWorkerCustody(decodedOperation, decodedObservation);
    const validContainerId = Schema.is(WorkerContainerId);
    yield* requireEvidence(validContainerId(containerId), 'InvalidInput', decodedOperation);
    const resource = yield* Option.match(Array.head(decodedObservation.resources), {
      onNone: () =>
        Result.fail({ _tag: 'NotFound' as const, operationId: decodedOperation.operationId }),
      onSome: Result.succeed,
    });
    const stagingPresent = Match.value(decodedObservation.staging).pipe(
      Match.when('Present', () => true),
      Match.when('Absent', () => false),
      Match.when('Unknown', () => false),
      Match.exhaustive,
    );
    const isReady = [resource.containerId === containerId, resource.running, stagingPresent].every(
      Boolean,
    );
    yield* requireEvidence(isReady, 'ReadinessMismatch', decodedOperation);
    return {
      operationId: decodedOperation.operationId,
      identity: decodedOperation.identity,
      hostId: decodedOperation.hostId,
      daemonId: decodedOperation.daemonId,
      containerId: resource.containerId,
      imageDigest: decodedOperation.imageDigest,
      sourceDigest: decodedOperation.sourceDigest,
      policyDigest: decodedOperation.policyDigest,
      configDigest: decodedOperation.configDigest,
      configuration: decodedOperation.configuration,
      observedAtMs: decodedObservation.atMs,
    };
  }
  return Result.gen(validateReadiness);
}
