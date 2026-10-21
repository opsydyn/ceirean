import {
  CandidateIdentity,
  WorkerSubject,
  WorkerIntentOutcome,
  WorkerOperation,
  decodeWorkerMutationReply,
  validateWorkerCustody,
  validateWorkerReadiness,
  type WorkerCleanup,
  type WorkerIntent,
  type WorkerMutationReply,
  type WorkerObservation,
  type WorkerOperationId,
  type WorkerReadyReceipt,
  type WorkerRefusal,
} from '@ceirean/domain';
import { Array, Effect, HashMap, Match, Option, Ref, Result, Schema } from 'effect';

import {
  WorkerJournalEdit,
  WorkerJournalSnapshot,
  type WorkerJournalResult,
} from '../src/worker-contracts.ts';
import { WorkerJournalError } from '../src/worker-errors.ts';
import { WorkerJournal } from '../src/worker-ports.ts';

type Store = HashMap.HashMap<WorkerOperationId, WorkerJournalSnapshot>;
type ConditionalEdit = Exclude<WorkerJournalEdit, { readonly _tag: 'Register' }>;
const sameIdentity = Schema.toEquivalence(CandidateIdentity);
const sameSubject = Schema.toEquivalence(WorkerSubject);
const sameOperation = Schema.toEquivalence(WorkerOperation);
const sameOutcome = Schema.toEquivalence(WorkerIntentOutcome);
const sameAuthority = Schema.toEquivalence(WorkerJournalSnapshot.fields.authority);

// Options carry prototype identity. Clone only plain payloads and rebuild each wrapper.
function detach(snapshot: WorkerJournalSnapshot): WorkerJournalSnapshot {
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

function requireRecord(
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

function observationTime(snapshot: WorkerJournalSnapshot): number {
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

function evidenceTime(snapshot: WorkerJournalSnapshot): number {
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

function custodyObservation(snapshot: WorkerJournalSnapshot, atMs: number): WorkerObservation {
  return { ...snapshot.operation, atMs, resources: [], staging: 'Unknown' };
}

function currentAuthority(snapshot: WorkerJournalSnapshot, atMs: number) {
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

function unresolved(intent: WorkerIntent) {
  return Match.value(intent.outcome).pipe(
    Match.tag('Claimed', 'Unknown', () => true),
    Match.tag('Completed', 'Failed', () => false),
    Match.exhaustive,
  );
}

function canMaterialize(intent: WorkerIntent) {
  return Match.value(intent.kind).pipe(
    Match.whenOr('Create', 'Start', () => true),
    Match.whenOr('Stop', 'Remove', () => false),
    Match.exhaustive,
  );
}

function cleanupAuthority(snapshot: WorkerJournalSnapshot, atMs: number) {
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

function executionClaimAuthority(snapshot: WorkerJournalSnapshot, atMs: number) {
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

function earliest(existing: Option.Option<number>, atMs: number) {
  const previous = Option.getOrElse(existing, () => atMs);
  const first = Math.min(previous, atMs);
  return Option.some(first);
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

function applyEdit(
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

function runSnapshots(current: Store, operation: WorkerOperation) {
  return Array.fromIterable(HashMap.values(current)).filter(
    (snapshot) => snapshot.operation.identity.runId === operation.identity.runId,
  );
}

function register(
  current: Store,
  edit: Extract<WorkerJournalEdit, { readonly _tag: 'Register' }>,
): Result.Result<WorkerJournalResult, WorkerJournalError> {
  const peers = runSnapshots(current, edit.operation);
  const sameRun = Array.head(peers);
  const authority = Option.match(sameRun, {
    onNone: () => ({ identity: edit.operation.identity, cancelledAtMs: Option.none<number>() }),
    onSome: (value) => value.authority,
  });
  const snapshot: WorkerJournalSnapshot = {
    revision: 0,
    operation: edit.operation,
    createdAtMs: edit.createdAtMs,
    editTimeFloorMs: Math.max(
      edit.createdAtMs,
      edit.atMs,
      ...peers.map((peer) => peer.editTimeFloorMs),
    ),
    outcomeEvidenceFloorMs: Math.max(
      edit.createdAtMs,
      ...peers.map((peer) => peer.outcomeEvidenceFloorMs),
    ),
    authority,
    intents: [],
    containerId: Option.none(),
    readiness: Option.none(),
    executionAuthorizedAtMs: Option.none(),
    cleanup: Option.none(),
  };
  function* validate() {
    yield* requireRecord(
      edit.operationId === edit.operation.operationId,
      snapshot,
      'IdentityMismatch',
    );
    yield* requireRecord(
      edit.createdAtMs <= edit.atMs && edit.createdAtMs < edit.operation.limits.deadlineMs,
      snapshot,
      'InvalidTime',
    );
    yield* validateWorkerCustody(edit.operation, custodyObservation(snapshot, edit.atMs));
    const runFloorMs = Math.max(edit.createdAtMs, ...peers.map(evidenceTime));
    yield* requireRecord(edit.atMs >= runFloorMs, snapshot, 'StaleObservation');
    return snapshot;
  }
  const validation = Result.gen(validate);
  const inserted = Result.match(validation, {
    onFailure: (refusal): WorkerJournalResult => ({ _tag: 'Refused', refusal }),
    onSuccess: (value): WorkerJournalResult => ({ _tag: 'Committed', snapshot: value }),
  });
  function existingResult(existing: WorkerJournalSnapshot) {
    const sameInput =
      sameOperation(existing.operation, edit.operation) &&
      existing.createdAtMs === edit.createdAtMs;
    return Match.value(sameInput).pipe(
      Match.when(true, (): WorkerJournalResult => ({
        _tag: 'Conflict',
        operationId: edit.operationId,
      })),
      Match.when(false, (): WorkerJournalResult => ({
        _tag: 'Refused',
        refusal: { _tag: 'ConflictingOperation', operationId: edit.operationId },
      })),
      Match.exhaustive,
    );
  }
  const result = Option.match(HashMap.get(current, edit.operationId), {
    onNone: () => inserted,
    onSome: existingResult,
  });
  return Result.succeed(result);
}

function updateExisting(
  current: Store,
  snapshot: WorkerJournalSnapshot,
  edit: ConditionalEdit,
): Result.Result<WorkerJournalResult, WorkerJournalError> {
  const sharedEditFloorMs = Match.value(edit).pipe(
    Match.tag('RequestCancellation', () =>
      Math.max(
        snapshot.createdAtMs,
        ...runSnapshots(current, snapshot.operation).map(evidenceTime),
      ),
    ),
    Match.orElse(() => 0),
  );
  function changed() {
    return applyEdit(snapshot, edit, sharedEditFloorMs).pipe(
      Result.match({
        onFailure: (refusal): WorkerJournalResult => ({ _tag: 'Refused', refusal }),
        onSuccess: (next): WorkerJournalResult => ({
          _tag: 'Committed',
          snapshot: {
            ...next,
            revision: snapshot.revision + 1,
            editTimeFloorMs: Math.max(next.editTimeFloorMs, edit.atMs),
          },
        }),
      }),
      Result.succeed,
    );
  }
  const result = Match.value(snapshot.revision).pipe(
    Match.when(
      (revision) => revision !== edit.expectedRevision,
      (): Result.Result<WorkerJournalResult, WorkerJournalError> =>
        Result.succeed({ _tag: 'Conflict', operationId: edit.operationId }),
    ),
    Match.when(Number.MAX_SAFE_INTEGER, () =>
      Result.fail(new WorkerJournalError({ operation: 'commit', code: 'RevisionExhausted' })),
    ),
    Match.orElse(changed),
  );
  return result;
}

function conditionalCommit(current: Store, edit: ConditionalEdit) {
  return Option.match(HashMap.get(current, edit.operationId), {
    onNone: (): Result.Result<WorkerJournalResult, WorkerJournalError> =>
      Result.succeed({ _tag: 'Conflict', operationId: edit.operationId }),
    onSome: (snapshot) => updateExisting(current, snapshot, edit),
  });
}

function evaluate(
  current: Store,
  input: WorkerJournalEdit,
): Result.Result<WorkerJournalResult, WorkerJournalError> {
  function* validate() {
    const edit = yield* Schema.decodeUnknownResult(WorkerJournalEdit)(input).pipe(
      Result.mapError(() => new WorkerJournalError({ operation: 'commit', code: 'InvalidData' })),
    );
    return yield* Match.value(edit).pipe(
      Match.tag('Register', (request) => register(current, request)),
      Match.orElse((request) => conditionalCommit(current, request)),
    );
  }
  return Result.gen(validate);
}

function spreadAuthority(
  current: Store,
  snapshot: WorkerJournalSnapshot,
  atMs: Option.Option<number>,
): Result.Result<Store, WorkerJournalError> {
  const peers = Array.fromIterable(HashMap.values(current)).filter(
    (peer) =>
      peer.operation.identity.runId === snapshot.operation.identity.runId &&
      peer.operation.operationId !== snapshot.operation.operationId,
  );
  const room = peers.every((peer) => peer.revision < Number.MAX_SAFE_INTEGER);
  function replacePeers() {
    const updated = peers.reduce(
      (store, peer) =>
        HashMap.set(
          store,
          peer.operation.operationId,
          detach({
            ...peer,
            revision: peer.revision + 1,
            authority: snapshot.authority,
            editTimeFloorMs: Math.max(
              peer.editTimeFloorMs,
              Option.getOrElse(atMs, () => peer.editTimeFloorMs),
            ),
          }),
        ),
      current,
    );
    return Result.succeed(HashMap.set(updated, snapshot.operation.operationId, snapshot));
  }
  return Match.value(room).pipe(
    Match.when(true, replacePeers),
    Match.when(false, () =>
      Result.fail(new WorkerJournalError({ operation: 'commit', code: 'RevisionExhausted' })),
    ),
    Match.exhaustive,
  );
}

// One synchronous Ref.modify owns decode, CAS, run authority/custody checks and append.
function transition(
  current: Store,
  edit: WorkerJournalEdit,
): readonly [Result.Result<WorkerJournalResult, WorkerJournalError>, Store] {
  function committed({
    snapshot: value,
  }: Extract<WorkerJournalResult, { readonly _tag: 'Committed' }>): readonly [
    Result.Result<WorkerJournalResult, WorkerJournalError>,
    Store,
  ] {
    const snapshot = detach(value);
    const returned = detach(snapshot);
    const updated = Match.value(edit).pipe(
      Match.tag('RequestCancellation', ({ atMs }) =>
        spreadAuthority(current, snapshot, Option.some(atMs)),
      ),
      Match.orElse(() =>
        Result.succeed(HashMap.set(current, snapshot.operation.operationId, snapshot)),
      ),
    );
    return Result.match(updated, {
      onFailure: (error) => [Result.fail(error), current],
      onSuccess: (store) => [Result.succeed({ _tag: 'Committed', snapshot: returned }), store],
    });
  }
  function unchanged(
    result: WorkerJournalResult,
  ): readonly [Result.Result<WorkerJournalResult, WorkerJournalError>, Store] {
    return [Result.succeed(result), current];
  }
  function successful(result: WorkerJournalResult) {
    return Match.value(result).pipe(Match.tag('Committed', committed), Match.orElse(unchanged));
  }
  return evaluate(current, edit).pipe(
    Result.match({
      onFailure: (error) => [Result.fail(error), current],
      onSuccess: successful,
    }),
  );
}

function changedAuthority(
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

function authorityTransition(
  current: Store,
  operationId: WorkerOperationId,
  identity: CandidateIdentity,
  cancelledAtMs: Option.Option<number>,
): readonly [Result.Result<Option.Option<WorkerJournalSnapshot>, WorkerJournalError>, Store] {
  function replace(
    snapshot: WorkerJournalSnapshot,
  ): readonly [Result.Result<Option.Option<WorkerJournalSnapshot>, WorkerJournalError>, Store] {
    function committed(
      next: WorkerJournalSnapshot,
    ): readonly [Result.Result<Option.Option<WorkerJournalSnapshot>, WorkerJournalError>, Store] {
      const detached = detach(next);
      const returned = Option.some(detach(detached));
      return spreadAuthority(current, detached, cancelledAtMs).pipe(
        Result.match({
          onFailure: (error) => [Result.fail(error), current],
          onSuccess: (store) => [Result.succeed(returned), store],
        }),
      );
    }
    return changedAuthority(snapshot, identity, cancelledAtMs).pipe(
      Result.match({ onFailure: (error) => [Result.fail(error), current], onSuccess: committed }),
    );
  }
  return Option.match(HashMap.get(current, operationId), {
    onNone: () => [Result.succeed(Option.none()), current],
    onSome: replace,
  });
}

function validateSeeds(snapshots: readonly WorkerJournalSnapshot[]) {
  const unique = snapshots.every(
    (snapshot, index) =>
      !snapshots
        .slice(0, index)
        .some((previous) => previous.operation.operationId === snapshot.operation.operationId),
  );
  const coherent = snapshots.every((snapshot) =>
    snapshots.every(
      (other) =>
        other.operation.identity.runId !== snapshot.operation.identity.runId ||
        sameAuthority(snapshot.authority, other.authority),
    ),
  );
  return Match.value(unique && coherent).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () =>
      Result.fail(new WorkerJournalError({ operation: 'load', code: 'InvalidData' })),
    ),
    Match.exhaustive,
  );
}

export function makeMemoryWorkerJournal(initial: readonly WorkerJournalSnapshot[]) {
  function* acquire() {
    const snapshots = yield* Effect.forEach(initial, (snapshot) =>
      Schema.decodeUnknownResult(WorkerJournalSnapshot)(snapshot).pipe(
        Result.mapError(() => new WorkerJournalError({ operation: 'load', code: 'InvalidData' })),
        Effect.fromResult,
        Effect.map(detach),
      ),
    );
    yield* Effect.fromResult(validateSeeds(snapshots));
    const entries = snapshots.map(
      (snapshot) => [snapshot.operation.operationId, snapshot] as const,
    );
    const store = yield* Ref.make(HashMap.fromIterable(entries));
    const load = (operationId: WorkerOperationId) =>
      Ref.get(store).pipe(
        Effect.map((current) => Option.map(HashMap.get(current, operationId), detach)),
      );
    const service = WorkerJournal.of({
      load,
      commit: (edit) =>
        Ref.modify(store, (current) => transition(current, edit)).pipe(
          Effect.flatMap(Effect.fromResult),
        ),
    });
    const replaceAuthority = (
      operationId: WorkerOperationId,
      identity: CandidateIdentity,
      cancelledAtMs: Option.Option<number>,
    ) =>
      Ref.modify(store, (current) =>
        authorityTransition(current, operationId, identity, cancelledAtMs),
      ).pipe(Effect.flatMap(Effect.fromResult));
    return { service, inspect: load, replaceAuthority };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
