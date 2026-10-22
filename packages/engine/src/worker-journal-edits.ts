import {
  WorkerSubject,
  WorkerIntentOutcome,
  decodeWorkerMutationReply,
  validateWorkerCustody,
  validateWorkerReadiness,
  type WorkerCleanup,
  type WorkerIntent,
  type WorkerMutationReply,
  type WorkerObservation,
  type WorkerReadyReceipt,
  type WorkerRefusal,
} from '@ceirean/domain';
import { Array, Match, Option, Result, Schema } from 'effect';

import type { WorkerJournalEdit, WorkerJournalSnapshot } from './worker-contracts.ts';
import {
  requireRecord,
  observationTime,
  evidenceTime,
  custodyObservation,
  currentAuthority,
  unresolved,
  canMaterialize,
  cleanupAuthority,
  executionClaimAuthority,
  earliest,
  sameIdentity,
} from './worker-journal-record.ts';

export type ConditionalEdit = Exclude<WorkerJournalEdit, { readonly _tag: 'Register' }>;
const sameSubject = Schema.toEquivalence(WorkerSubject);
const sameOutcome = Schema.toEquivalence(WorkerIntentOutcome);
function claim(
  snapshot: WorkerJournalSnapshot,
  edit: Extract<ConditionalEdit, { readonly _tag: 'Claim' }>,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  function* validate() {
    const intent = edit.intent;
    const isClaimed = Match.value(intent.outcome).pipe(
      Match.tag('Claimed', () => true),
      Match.orElse(() => false),
    );
    yield* requireRecord(
      intent.operationId === edit.operationId && isClaimed && intent.claimedAtMs === edit.atMs,
      snapshot,
      'InvalidInput',
    );
    function sameAction(previous: WorkerIntent) {
      const sameLogicalAction =
        previous.kind === intent.kind && previous.resource === intent.resource;
      return previous.intentId === intent.intentId || sameLogicalAction;
    }
    const alreadyClaimed = snapshot.intents.some(sameAction);
    yield* requireRecord(!alreadyClaimed, snapshot, 'AlreadyClaimed');
    yield* validateWorkerCustody(snapshot.operation, custodyObservation(snapshot, edit.atMs));
    yield* requireRecord(!snapshot.intents.some(unresolved), snapshot, 'UnresolvedIntent');
    yield* Match.value(intent.kind).pipe(
      Match.whenOr('Create', 'Start', () => executionClaimAuthority(snapshot, edit.atMs)),
      Match.whenOr('Stop', 'Remove', () => cleanupAuthority(snapshot, edit.atMs)),
      Match.exhaustive,
    );
    const owned = Match.value(intent.kind).pipe(
      Match.when(
        'Create',
        () =>
          intent.resource === snapshot.operation.custody.containerSlot &&
          Option.isNone(snapshot.containerId),
      ),
      Match.orElse(() => Option.contains(snapshot.containerId, intent.resource)),
    );
    yield* requireRecord(owned, snapshot, 'NoCustody');
    return { ...snapshot, readiness: Option.none(), intents: [...snapshot.intents, intent] };
  }
  return Result.gen(validate);
}

function presentEvidence(
  snapshot: WorkerJournalSnapshot,
  intent: WorkerIntent,
  observation: WorkerObservation,
) {
  function* validate() {
    const resource = yield* Option.match(Array.head(observation.resources), {
      onNone: () =>
        Result.fail({
          _tag: 'UnresolvedIntent' as const,
          operationId: snapshot.operation.operationId,
        }),
      onSome: Result.succeed,
    });
    const ownedSlot =
      intent.resource === snapshot.operation.custody.containerSlot &&
      (Option.isNone(snapshot.containerId) ||
        Option.contains(snapshot.containerId, resource.containerId));
    const owned = Match.value(intent.kind).pipe(
      Match.when('Create', () => ownedSlot),
      Match.orElse(
        () =>
          resource.containerId === intent.resource &&
          Option.contains(snapshot.containerId, resource.containerId),
      ),
    );
    const validRunning = Match.value(intent.kind).pipe(
      Match.when('Create', () => true),
      Match.when('Start', () => resource.running),
      Match.when('Stop', () => !resource.running),
      Match.when('Remove', () => false),
      Match.exhaustive,
    );
    yield* requireRecord(owned, snapshot, 'NoCustody');
    yield* requireRecord(validRunning, snapshot, 'ReadinessMismatch');
    return Option.some(resource.containerId);
  }
  return Result.gen(validate);
}

function absentEvidence(
  snapshot: WorkerJournalSnapshot,
  intent: WorkerIntent,
  observation: WorkerObservation,
) {
  function* validate() {
    yield* requireRecord(
      Option.contains(snapshot.containerId, intent.resource),
      snapshot,
      'NoCustody',
    );
    yield* requireRecord(observation.resources.length === 0, snapshot, 'ReadinessMismatch');
    return snapshot.containerId;
  }
  return Result.gen(validate);
}

function completedEvidence(
  snapshot: WorkerJournalSnapshot,
  intent: WorkerIntent,
  reply: WorkerMutationReply,
  observation: WorkerObservation,
) {
  function* validate() {
    yield* validateWorkerCustody(snapshot.operation, observation);
    const floor = Math.max(intent.claimedAtMs, observationTime(snapshot));
    yield* requireRecord(
      observation.atMs >= floor && observation.atMs <= reply.atMs,
      snapshot,
      'StaleObservation',
    );
    return yield* Match.value(intent.kind).pipe(
      Match.when('Remove', () => absentEvidence(snapshot, intent, observation)),
      Match.orElse(() => presentEvidence(snapshot, intent, observation)),
    );
  }
  return Result.gen(validate);
}

function resolveOutcome(
  snapshot: WorkerJournalSnapshot,
  intent: WorkerIntent,
  reply: WorkerMutationReply,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  function* validate() {
    const knownFailure = Match.value(reply.outcome).pipe(
      Match.tag('Failed', () => true),
      Match.orElse(() => false),
    );
    const uncertain = Match.value(intent.outcome).pipe(
      Match.tag('Unknown', () => true),
      Match.orElse(() => false),
    );
    yield* requireRecord(!(uncertain && knownFailure), snapshot, 'UnresolvedIntent');
    const containerId = yield* Match.value(reply.outcome).pipe(
      Match.tag('Completed', ({ observation }) =>
        completedEvidence(snapshot, intent, reply, observation),
      ),
      Match.tag('Failed', 'Unknown', () => Result.succeed(snapshot.containerId)),
      Match.exhaustive,
    );
    const intents = snapshot.intents.map((entry) =>
      Match.value(entry.intentId === intent.intentId).pipe(
        Match.when(true, () => ({ ...entry, outcome: reply.outcome })),
        Match.when(false, () => entry),
        Match.exhaustive,
      ),
    );
    return { ...snapshot, containerId, intents };
  }
  return Result.gen(validate);
}

function terminalOutcome(
  snapshot: WorkerJournalSnapshot,
  intent: WorkerIntent,
  reply: WorkerMutationReply,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  return requireRecord(sameOutcome(intent.outcome, reply.outcome), snapshot, 'AlreadyClaimed').pipe(
    Result.map(() => snapshot),
  );
}

function recordOutcome(
  snapshot: WorkerJournalSnapshot,
  edit: Extract<ConditionalEdit, { readonly _tag: 'RecordOutcome' }>,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  function* validate() {
    const reply = yield* decodeWorkerMutationReply(edit.reply);
    yield* requireRecord(sameSubject(snapshot.operation, reply), snapshot, 'IdentityMismatch');
    const intent = yield* Option.match(
      Array.findFirst(snapshot.intents, (entry) => entry.intentId === reply.intentId),
      {
        onNone: () =>
          Result.fail({ _tag: 'UnresolvedIntent' as const, operationId: edit.operationId }),
        onSome: Result.succeed,
      },
    );
    yield* requireRecord(intent.issuerId === reply.issuerId, snapshot, 'NotCurrent');
    yield* requireRecord(
      reply.atMs >= intent.claimedAtMs && reply.atMs <= edit.atMs,
      snapshot,
      'InvalidTime',
    );
    yield* requireRecord(
      reply.atMs >= snapshot.outcomeEvidenceFloorMs,
      snapshot,
      'StaleObservation',
    );
    const next = yield* Match.value(intent.outcome).pipe(
      Match.tag('Completed', 'Failed', () => terminalOutcome(snapshot, intent, reply)),
      Match.tag('Claimed', 'Unknown', () => resolveOutcome(snapshot, intent, reply)),
      Match.exhaustive,
    );
    return { ...next, outcomeEvidenceFloorMs: Math.max(next.outcomeEvidenceFloorMs, reply.atMs) };
  }
  return Result.gen(validate);
}

function receiptObservation(receipt: WorkerReadyReceipt): WorkerObservation {
  return {
    ...receipt,
    atMs: receipt.observedAtMs,
    resources: [{ ...receipt, running: true }],
    staging: 'Present',
  };
}

function checkReady(snapshot: WorkerJournalSnapshot, receipt: WorkerReadyReceipt, atMs: number) {
  function* validate() {
    yield* currentAuthority(snapshot, atMs);
    const claimedTimes = snapshot.intents.map((intent) => intent.claimedAtMs);
    const floor = Math.max(observationTime(snapshot), ...claimedTimes);
    yield* requireRecord(receipt.observedAtMs >= floor, snapshot, 'StaleObservation');
    yield* requireRecord(
      Option.isNone(snapshot.cleanup) && !snapshot.intents.some(unresolved),
      snapshot,
      'UnresolvedIntent',
    );
    const containerId = yield* Option.match(snapshot.containerId, {
      onNone: () =>
        Result.fail({ _tag: 'NoCustody' as const, operationId: snapshot.operation.operationId }),
      onSome: Result.succeed,
    });
    return yield* validateWorkerReadiness(
      snapshot.operation,
      containerId,
      receiptObservation(receipt),
      snapshot.createdAtMs,
      atMs,
    );
  }
  return Result.gen(validate);
}

function recordReadiness(
  snapshot: WorkerJournalSnapshot,
  edit: Extract<ConditionalEdit, { readonly _tag: 'RecordReadiness' }>,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  function* validate() {
    const receipt = yield* checkReady(snapshot, edit.receipt, edit.atMs);
    return {
      ...snapshot,
      readiness: Option.some(receipt),
      outcomeEvidenceFloorMs: Math.max(snapshot.outcomeEvidenceFloorMs, receipt.observedAtMs),
    };
  }
  return Result.gen(validate);
}

function authorize(
  snapshot: WorkerJournalSnapshot,
  atMs: number,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  function* validate() {
    yield* requireRecord(
      Option.isNone(snapshot.executionAuthorizedAtMs),
      snapshot,
      'AlreadyClaimed',
    );
    const receipt = yield* Option.match(snapshot.readiness, {
      onNone: () =>
        Result.fail({
          _tag: 'ReadinessMismatch' as const,
          operationId: snapshot.operation.operationId,
        }),
      onSome: Result.succeed,
    });
    yield* checkReady(snapshot, receipt, atMs);
    return { ...snapshot, executionAuthorizedAtMs: Option.some(atMs) };
  }
  return Result.gen(validate);
}

function requestCleanup(
  snapshot: WorkerJournalSnapshot,
  edit: Extract<ConditionalEdit, { readonly _tag: 'RequestCancellation' | 'RequestCleanup' }>,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  function* validate() {
    const allowed = Match.value(edit).pipe(
      Match.tag('RequestCancellation', () =>
        sameIdentity(snapshot.authority.identity, snapshot.operation.identity),
      ),
      Match.tag('RequestCleanup', () => true),
      Match.exhaustive,
    );
    yield* requireRecord(allowed, snapshot, 'NotCurrent');
    const deadlineMs = edit.atMs + edit.cleanupWindowMs;
    yield* requireRecord(Number.isSafeInteger(deadlineMs), snapshot, 'InvalidTime');
    const cleanup = Option.match(snapshot.cleanup, {
      onNone: (): WorkerCleanup => ({
        _tag: 'CleanupPending',
        requestedAtMs: edit.atMs,
        deadlineMs,
      }),
      onSome: (previous): WorkerCleanup => ({
        ...previous,
        requestedAtMs: Math.min(previous.requestedAtMs, edit.atMs),
        deadlineMs: Math.min(previous.deadlineMs, deadlineMs),
      }),
    });
    const authority = Match.value(edit).pipe(
      Match.tag('RequestCancellation', () => ({
        ...snapshot.authority,
        cancelledAtMs: earliest(snapshot.authority.cancelledAtMs, edit.atMs),
      })),
      Match.tag('RequestCleanup', () => snapshot.authority),
      Match.exhaustive,
    );
    return { ...snapshot, authority, cleanup: Option.some(cleanup) };
  }
  return Result.gen(validate);
}

function recordCleanup(
  snapshot: WorkerJournalSnapshot,
  edit: Extract<ConditionalEdit, { readonly _tag: 'RecordCleanup' }>,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  function* validate() {
    const cleanup = yield* Option.match(snapshot.cleanup, {
      onNone: () =>
        Result.fail({ _tag: 'NoCustody' as const, operationId: snapshot.operation.operationId }),
      onSome: Result.succeed,
    });
    const observation = edit.observation;
    yield* validateWorkerCustody(snapshot.operation, observation);
    yield* requireRecord(
      observation.atMs >= Math.max(observationTime(snapshot), cleanup.requestedAtMs) &&
        observation.atMs <= edit.atMs,
      snapshot,
      'StaleObservation',
    );
    yield* requireRecord(
      observation.resources.every((resource) =>
        Option.contains(snapshot.containerId, resource.containerId),
      ),
      snapshot,
      'NoCustody',
    );
    const unresolvedCreation = snapshot.intents.some(
      (intent) => canMaterialize(intent) && unresolved(intent),
    );
    const stagingAbsent = Match.value(observation.staging).pipe(
      Match.when('Absent', () => true),
      Match.orElse(() => false),
    );
    const absent = observation.resources.length === 0 && stagingAbsent && !unresolvedCreation;
    const confirmed = Match.value(cleanup).pipe(
      Match.tag('CleanupConfirmed', () => true),
      Match.orElse(() => false),
    );
    yield* requireRecord(!confirmed || absent, snapshot, 'AlreadyClaimed');
    const times = { requestedAtMs: cleanup.requestedAtMs, deadlineMs: cleanup.deadlineMs };
    const reason = Match.value({
      unresolvedCreation,
      expired: observation.atMs >= cleanup.deadlineMs,
    }).pipe(
      Match.when({ unresolvedCreation: true }, () => 'UnresolvedIntent' as const),
      Match.when({ expired: true }, () => 'DeadlineExpired' as const),
      Match.orElse(() => 'ReadinessMismatch' as const),
    );
    const next: WorkerCleanup = Match.value(absent && observation.atMs < cleanup.deadlineMs).pipe(
      Match.when(true, (): WorkerCleanup => ({
        _tag: 'CleanupConfirmed',
        ...times,
        observedAtMs: observation.atMs,
      })),
      Match.when(false, (): WorkerCleanup => ({
        _tag: 'CleanupUnknown',
        ...times,
        reason: { _tag: reason, operationId: edit.operationId },
      })),
      Match.exhaustive,
    );
    return {
      ...snapshot,
      cleanup: Option.some(next),
      outcomeEvidenceFloorMs: Math.max(snapshot.outcomeEvidenceFloorMs, observation.atMs),
    };
  }
  return Result.gen(validate);
}

export function applyEdit(
  snapshot: WorkerJournalSnapshot,
  edit: ConditionalEdit,
  sharedEditFloorMs: number,
): Result.Result<WorkerJournalSnapshot, WorkerRefusal> {
  function* validate() {
    yield* requireRecord(edit.atMs >= snapshot.createdAtMs, snapshot, 'InvalidTime');
    yield* requireRecord(
      edit.atMs >= Math.max(evidenceTime(snapshot), sharedEditFloorMs),
      snapshot,
      'StaleObservation',
    );
    return yield* Match.value(edit).pipe(
      Match.tag('Claim', (request) => claim(snapshot, request)),
      Match.tag('RecordOutcome', (request) => recordOutcome(snapshot, request)),
      Match.tag('RecordReadiness', (request) => recordReadiness(snapshot, request)),
      Match.tag('AuthorizeExecution', (request) => authorize(snapshot, request.atMs)),
      Match.tag('RequestCancellation', (request) => requestCleanup(snapshot, request)),
      Match.tag('RequestCleanup', (request) => requestCleanup(snapshot, request)),
      Match.tag('RecordCleanup', (request) => recordCleanup(snapshot, request)),
      Match.exhaustive,
    );
  }
  return Result.gen(validate);
}
