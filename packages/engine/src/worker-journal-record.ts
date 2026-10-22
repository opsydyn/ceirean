import {
  CandidateIdentity,
  type WorkerCleanup,
  type WorkerIntent,
  type WorkerObservation,
  type WorkerRefusal,
} from '@ceirean/domain';
import { Match, Option, Result, Schema } from 'effect';

import { WorkerJournalSnapshot } from './worker-contracts.ts';
import { WorkerJournalError } from './worker-errors.ts';

export const sameIdentity = Schema.toEquivalence(CandidateIdentity);
// Options carry prototype identity. Clone only plain payloads and rebuild each wrapper.
export function detach(snapshot: WorkerJournalSnapshot): WorkerJournalSnapshot {
  const cancelledAtMs = Option.map(snapshot.authority.cancelledAtMs, (value) => value);
  const containerId = Option.map(snapshot.containerId, (value) => value);
  const readiness = Option.map(snapshot.readiness, (value) => structuredClone(value));
  const executionAuthorizedAtMs = Option.map(snapshot.executionAuthorizedAtMs, (value) => value);
  const cleanup = Option.map(snapshot.cleanup, (value) => structuredClone(value));
  return {
    revision: snapshot.revision,
    operation: structuredClone(snapshot.operation),
    createdAtMs: snapshot.createdAtMs,
    editTimeFloorMs: snapshot.editTimeFloorMs,
    outcomeEvidenceFloorMs: snapshot.outcomeEvidenceFloorMs,
    authority: {
      identity: structuredClone(snapshot.authority.identity),
      cancelledAtMs,
    },
    intents: structuredClone(snapshot.intents),
    containerId,
    readiness,
    executionAuthorizedAtMs,
    cleanup,
  };
}

export function requireRecord(
  condition: boolean,
  snapshot: WorkerJournalSnapshot,
  code: WorkerRefusal['_tag'],
): Result.Result<void, WorkerRefusal> {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () =>
      Result.fail({ _tag: code, operationId: snapshot.operation.operationId }),
    ),
    Match.exhaustive,
  );
}

export function observationTime(snapshot: WorkerJournalSnapshot): number {
  const completedTimes = snapshot.intents.flatMap((intent) =>
    Match.value(intent.outcome).pipe(
      Match.tag('Completed', ({ observation }) => [observation.atMs]),
      Match.orElse(() => []),
    ),
  );
  function cleanupEvidence(cleanup: WorkerCleanup) {
    return Match.value(cleanup).pipe(
      Match.tag('CleanupConfirmed', (confirmed) => [confirmed.observedAtMs]),
      Match.orElse(() => []),
    );
  }
  const cleanupTimes = Option.match(snapshot.cleanup, {
    onNone: () => [],
    onSome: cleanupEvidence,
  });
  const readyTime = snapshot.readiness.pipe(
    Option.map((receipt) => receipt.observedAtMs),
    Option.getOrElse(() => 0),
  );
  return Math.max(
    snapshot.createdAtMs,
    snapshot.outcomeEvidenceFloorMs,
    ...completedTimes,
    ...cleanupTimes,
    readyTime,
  );
}

export function evidenceTime(snapshot: WorkerJournalSnapshot): number {
  const authorizedTime = Option.getOrElse(snapshot.executionAuthorizedAtMs, () => 0);
  const cancellationTime = Option.getOrElse(snapshot.authority.cancelledAtMs, () => 0);
  const claimedTimes = snapshot.intents.map((intent) => intent.claimedAtMs);
  const cleanupTime = snapshot.cleanup.pipe(
    Option.map((cleanup) => cleanup.requestedAtMs),
    Option.getOrElse(() => 0),
  );
  return Math.max(
    observationTime(snapshot),
    snapshot.editTimeFloorMs,
    authorizedTime,
    cancellationTime,
    cleanupTime,
    ...claimedTimes,
  );
}

export function custodyObservation(
  snapshot: WorkerJournalSnapshot,
  atMs: number,
): WorkerObservation {
  return { ...snapshot.operation, atMs, resources: [], staging: 'Unknown' };
}

export function currentAuthority(snapshot: WorkerJournalSnapshot, atMs: number) {
  function* validate() {
    yield* requireRecord(
      sameIdentity(snapshot.authority.identity, snapshot.operation.identity),
      snapshot,
      'NotCurrent',
    );
    yield* requireRecord(Option.isNone(snapshot.authority.cancelledAtMs), snapshot, 'Cancelled');
    yield* requireRecord(atMs < snapshot.operation.limits.deadlineMs, snapshot, 'DeadlineExpired');
  }
  return Result.gen(validate);
}

export function unresolved(intent: WorkerIntent) {
  return Match.value(intent.outcome).pipe(
    Match.tag('Claimed', 'Unknown', () => true),
    Match.tag('Completed', 'Failed', () => false),
    Match.exhaustive,
  );
}

export function canMaterialize(intent: WorkerIntent) {
  return Match.value(intent.kind).pipe(
    Match.whenOr('Create', 'Start', () => true),
    Match.whenOr('Stop', 'Remove', () => false),
    Match.exhaustive,
  );
}

export function cleanupAuthority(snapshot: WorkerJournalSnapshot, atMs: number) {
  function* validate() {
    const cleanup = yield* Option.match(snapshot.cleanup, {
      onNone: () =>
        Result.fail({ _tag: 'NoCustody' as const, operationId: snapshot.operation.operationId }),
      onSome: Result.succeed,
    });
    const open = Match.value(cleanup).pipe(
      Match.tag('CleanupConfirmed', () => false),
      Match.orElse(() => true),
    );
    yield* requireRecord(open, snapshot, 'AlreadyClaimed');
    yield* requireRecord(
      atMs >= cleanup.requestedAtMs && atMs < cleanup.deadlineMs,
      snapshot,
      'DeadlineExpired',
    );
  }
  return Result.gen(validate);
}

export function executionClaimAuthority(snapshot: WorkerJournalSnapshot, atMs: number) {
  function* validate() {
    yield* currentAuthority(snapshot, atMs);
    yield* requireRecord(
      Option.isNone(snapshot.cleanup) && Option.isNone(snapshot.executionAuthorizedAtMs),
      snapshot,
      'AlreadyClaimed',
    );
  }
  return Result.gen(validate);
}

export function earliest(existing: Option.Option<number>, atMs: number) {
  const previous = Option.getOrElse(existing, () => atMs);
  const first = Math.min(previous, atMs);
  return Option.some(first);
}

export function changedAuthority(
  snapshot: WorkerJournalSnapshot,
  identity: CandidateIdentity,
  cancelledAtMs: Option.Option<number>,
): Result.Result<WorkerJournalSnapshot, WorkerJournalError> {
  const existingCancellation = Option.match(cancelledAtMs, {
    onNone: () => snapshot.authority.cancelledAtMs,
    onSome: (atMs) => earliest(snapshot.authority.cancelledAtMs, atMs),
  });
  const cancelled = Match.value(sameIdentity(snapshot.authority.identity, identity)).pipe(
    Match.when(true, () => existingCancellation),
    Match.when(false, () => cancelledAtMs),
    Match.exhaustive,
  );
  const next = {
    ...snapshot,
    revision: snapshot.revision + 1,
    editTimeFloorMs: Math.max(
      snapshot.editTimeFloorMs,
      Option.getOrElse(cancelledAtMs, () => snapshot.editTimeFloorMs),
    ),
    authority: { identity, cancelledAtMs: cancelled },
  };
  const valid =
    Schema.is(WorkerJournalSnapshot)(next) &&
    identity.runId === snapshot.operation.identity.runId &&
    !Option.exists(cancelledAtMs, (atMs) => atMs < snapshot.createdAtMs);
  const validation = Match.value(valid).pipe(
    Match.when(true, () => Result.succeed(next)),
    Match.when(false, () =>
      Result.fail(new WorkerJournalError({ operation: 'commit', code: 'InvalidData' })),
    ),
    Match.exhaustive,
  );
  return Match.value(snapshot.revision).pipe(
    Match.when(Number.MAX_SAFE_INTEGER, () =>
      Result.fail(new WorkerJournalError({ operation: 'commit', code: 'RevisionExhausted' })),
    ),
    Match.orElse(() => validation),
  );
}
