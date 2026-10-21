import {
  CandidateIdentity,
  NonNegativeSafeInteger,
  WorkerIntent,
  WorkerIntentId,
  WorkerIssuerId,
  WorkerOperationId,
  WorkerRefusal,
  decodeWorkerMutationReply,
  decodeWorkerObservation,
  validateWorkerCustody,
  validateWorkerReadiness,
  type WorkerMutationReply,
  type WorkerObservation,
} from '@ceirean/domain';
import { fromEffect } from '@xstate/effect';
import { Array, Clock, Effect, Match, Option, Result, Schema } from 'effect';
import { standardSchemaValidator } from 'xstate/validation';

import {
  WorkerExecutionReply,
  WorkerJournalResult,
  WorkerJournalSnapshot,
  type WorkerJournalEdit,
} from './worker-contracts.ts';
import { WorkerJournalError } from './worker-errors.ts';
import { WorkerJournal, WorkerMechanism } from './worker-ports.ts';

export const LifecycleInput = Schema.Struct({
  operationId: WorkerOperationId,
  issuerId: WorkerIssuerId,
});
type LifecycleInput = typeof LifecycleInput.Type;
export const LifecycleFact = Schema.Struct({
  operationId: WorkerOperationId,
  revision: NonNegativeSafeInteger,
});
export const LifecycleIssue = Schema.Union([
  WorkerRefusal,
  Schema.TaggedStruct('WorkerJournalError', {
    operation: Schema.Literals(['load', 'commit']),
    code: Schema.Literals(['ReadFailed', 'CommitFailed', 'InvalidData', 'RevisionExhausted']),
  }),
  Schema.TaggedStruct('WorkerMechanismError', {
    operation: Schema.Literals(['mutate', 'observe', 'execute']),
    code: Schema.Literals(['Unavailable', 'InvalidReply']),
  }),
  Schema.TaggedStruct('WorkerLifecycleRuntimeError', {
    operationId: WorkerOperationId,
    code: Schema.Literals(['ActorFailed', 'ObservationFailed', 'DrainExpired']),
  }),
]);
const sameIdentity = Schema.toEquivalence(CandidateIdentity);
const sameIntent = Schema.toEquivalence(WorkerIntent);
const sameContainerBinding = Schema.toEquivalence(WorkerJournalSnapshot.fields.containerId);

function requireFact(
  condition: boolean,
  code: WorkerRefusal['_tag'],
  operationId: WorkerOperationId,
) {
  const result: Result.Result<void, WorkerRefusal> = Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () => Result.fail({ _tag: code, operationId })),
    Match.exhaustive,
  );
  return result;
}

function load(operationId: WorkerOperationId) {
  function* readJournal() {
    const journal = yield* WorkerJournal;
    const stored = yield* journal.load(operationId);
    const found = Option.match(stored, {
      onNone: () => Result.fail({ _tag: 'NotFound' as const, operationId }),
      onSome: Result.succeed,
    });
    const snapshot = yield* Effect.fromResult(found);
    const decoded = Schema.decodeUnknownEffect(WorkerJournalSnapshot)(snapshot).pipe(
      Effect.mapError(() => new WorkerJournalError({ operation: 'load', code: 'InvalidData' })),
    );
    return yield* decoded;
  }
  const program = Effect.gen(readJournal);
  return program;
}

function commit(edit: WorkerJournalEdit) {
  function* writeJournal() {
    const journal = yield* WorkerJournal;
    const raw = yield* journal.commit(edit);
    const decoded = Schema.decodeUnknownEffect(WorkerJournalResult)(raw).pipe(
      Effect.mapError(() => new WorkerJournalError({ operation: 'commit', code: 'InvalidData' })),
    );
    const result = yield* decoded;
    const accepted = Match.value(result).pipe(
      Match.tag('Committed', ({ snapshot }) => Result.succeed(snapshot)),
      Match.tag('Conflict', () =>
        Result.fail({ _tag: 'NotCurrent' as const, operationId: edit.operationId }),
      ),
      Match.tag('Refused', ({ refusal }) => Result.fail(refusal)),
      Match.exhaustive,
    );
    return yield* Effect.fromResult(accepted);
  }
  const program = Effect.gen(writeJournal);
  return program;
}

function timeAuthority(snapshot: WorkerJournalSnapshot, cleanup: boolean, atMs: number) {
  function* validateAuthority() {
    const operationId = snapshot.operation.operationId;
    yield* requireFact(
      Number.isSafeInteger(atMs) && atMs >= snapshot.editTimeFloorMs,
      'InvalidTime',
      operationId,
    );
    yield* validateWorkerCustody(snapshot.operation, {
      ...snapshot.operation,
      atMs,
      resources: [],
      staging: 'Unknown',
    });
    return yield* Match.value(cleanup).pipe(
      Match.when(true, () => cleanupAuthority(snapshot, atMs)),
      Match.when(false, () => currentAuthority(snapshot, atMs)),
      Match.exhaustive,
    );
  }
  return Result.gen(validateAuthority);
}
function cleanupAuthority(snapshot: WorkerJournalSnapshot, atMs: number) {
  function* ownedCleanup() {
    const operationId = snapshot.operation.operationId;
    const bounds = yield* Option.match(snapshot.cleanup, {
      onNone: () => Result.fail({ _tag: 'NoCustody' as const, operationId }),
      onSome: Result.succeed,
    });
    yield* requireFact(
      atMs >= bounds.requestedAtMs && atMs < bounds.deadlineMs,
      'DeadlineExpired',
      operationId,
    );
    return atMs;
  }
  return Result.gen(ownedCleanup);
}
function currentAuthority(snapshot: WorkerJournalSnapshot, atMs: number) {
  function* current() {
    const operationId = snapshot.operation.operationId;
    yield* requireFact(
      sameIdentity(snapshot.authority.identity, snapshot.operation.identity),
      'NotCurrent',
      operationId,
    );
    yield* requireFact(Option.isNone(snapshot.authority.cancelledAtMs), 'Cancelled', operationId);
    yield* requireFact(Option.isNone(snapshot.cleanup), 'AlreadyClaimed', operationId);
    yield* requireFact(atMs < snapshot.operation.limits.deadlineMs, 'DeadlineExpired', operationId);
    return atMs;
  }
  return Result.gen(current);
}

function clockAuthority(snapshot: WorkerJournalSnapshot, cleanup: boolean) {
  function* checkClock() {
    const atMs = yield* Clock.currentTimeMillis;
    return yield* Effect.fromResult(timeAuthority(snapshot, cleanup, atMs));
  }
  const program = Effect.gen(checkClock);
  return program;
}

export function isUnresolved(intent: WorkerIntent) {
  return Match.value(intent.outcome).pipe(
    Match.tag('Claimed', 'Unknown', () => true),
    Match.orElse(() => false),
  );
}

export function actionCompleted(snapshot: WorkerJournalSnapshot, kind: WorkerIntent['kind']) {
  return snapshot.intents.some(
    (intent) =>
      intent.kind === kind &&
      Match.value(intent.outcome).pipe(
        Match.tag('Completed', () => true),
        Match.orElse(() => false),
      ),
  );
}

function cleanupAction(kind: WorkerIntent['kind']) {
  return Match.value(kind).pipe(
    Match.whenOr('Stop', 'Remove', () => true),
    Match.orElse(() => false),
  );
}

const ClaimInput = Schema.Struct({
  ...LifecycleInput.fields,
  revision: NonNegativeSafeInteger,
  kind: WorkerIntent.fields.kind,
});
type ClaimInput = typeof ClaimInput.Type;
const MutationInput = Schema.Struct({
  ...LifecycleInput.fields,
  revision: NonNegativeSafeInteger,
  intent: WorkerIntent,
});
type MutationInput = typeof MutationInput.Type;
const SnapshotInput = Schema.Struct({ ...LifecycleInput.fields, revision: NonNegativeSafeInteger });
type SnapshotInput = typeof SnapshotInput.Type;

function claim(input: ClaimInput) {
  function* claimIntent() {
    const snapshot = yield* load(input.operationId);
    yield* Effect.fromResult(
      requireFact(snapshot.revision === input.revision, 'NotCurrent', input.operationId),
    );
    const atMs = yield* clockAuthority(snapshot, cleanupAction(input.kind));
    const owned = Match.value(input.kind).pipe(
      Match.when('Create', () => Result.succeed(snapshot.operation.custody.containerSlot)),
      Match.orElse(() =>
        Option.match(snapshot.containerId, {
          onNone: () => Result.fail({ _tag: 'NoCustody' as const, operationId: input.operationId }),
          onSome: Result.succeed,
        }),
      ),
    );
    const resource = yield* Effect.fromResult(owned);
    const intent = WorkerIntent.make({
      intentId: WorkerIntentId.make(`${input.operationId}:${input.kind}:${resource}`),
      operationId: input.operationId,
      issuerId: input.issuerId,
      kind: input.kind,
      resource,
      claimedAtMs: atMs,
      outcome: { _tag: 'Claimed' },
    });
    return yield* commit({
      _tag: 'Claim',
      operationId: input.operationId,
      expectedRevision: snapshot.revision,
      atMs,
      intent,
    });
  }
  const program = Effect.gen(claimIntent);
  return program;
}

function mutate(input: MutationInput) {
  function* issueMutation() {
    const snapshot = yield* load(input.operationId);
    const stored = Array.findFirst(snapshot.intents, (intent) => sameIntent(intent, input.intent));
    const claimed = Match.value(input.intent.outcome).pipe(
      Match.tag('Claimed', () => true),
      Match.orElse(() => false),
    );
    yield* Effect.fromResult(
      requireFact(
        snapshot.revision === input.revision &&
          Option.isSome(stored) &&
          input.intent.issuerId === input.issuerId &&
          claimed,
        'NotCurrent',
        input.operationId,
      ),
    );
    const dispatchedAtMs = yield* clockAuthority(snapshot, cleanupAction(input.intent.kind));
    const owned = Match.value(input.intent.kind).pipe(
      Match.when('Create', () => true),
      Match.orElse(() => Option.contains(snapshot.containerId, input.intent.resource)),
    );
    yield* Effect.fromResult(requireFact(owned, 'NoCustody', input.operationId));
    const mechanism = yield* WorkerMechanism;
    const deadline = Option.match(snapshot.cleanup, {
      onNone: () => snapshot.operation.limits.deadlineMs,
      onSome: (cleanup) => cleanup.deadlineMs,
    });
    const mutation = mechanism.mutate({ operation: snapshot.operation, intent: input.intent }).pipe(
      Effect.timeout(deadline - dispatchedAtMs),
      Effect.catchTag('TimeoutError', () =>
        Effect.fail({ _tag: 'DeadlineExpired' as const, operationId: input.operationId }),
      ),
    );
    const response = yield* Effect.result(mutation);
    const atMs = yield* Clock.currentTimeMillis;
    const parsed = Result.match(response, {
      onSuccess: decodeWorkerMutationReply,
      onFailure: () =>
        Result.succeed<WorkerMutationReply>({
          ...snapshot.operation,
          intentId: input.intent.intentId,
          issuerId: input.issuerId,
          atMs,
          outcome: {
            _tag: 'Unknown',
            reason: { _tag: 'UnresolvedIntent', operationId: input.operationId },
          },
        }),
    });
    const reply = yield* Effect.fromResult(parsed);
    yield* Effect.fromResult(
      requireFact(
        reply.intentId === input.intent.intentId && reply.issuerId === input.issuerId,
        'IdentityMismatch',
        input.operationId,
      ),
    );
    const current = yield* load(input.operationId);
    const next = yield* commit({
      _tag: 'RecordOutcome',
      operationId: input.operationId,
      expectedRevision: current.revision,
      atMs,
      reply,
    });
    return yield* response.pipe(
      Result.map(() => next),
      Effect.fromResult,
    );
  }
  const program = Effect.gen(issueMutation);
  return program;
}

function observe(snapshot: WorkerJournalSnapshot, bounded: boolean) {
  function* inspectResource() {
    const mechanism = yield* WorkerMechanism;
    const task = mechanism.observe({
      operation: snapshot.operation,
      containerId: snapshot.containerId,
    });
    const now = yield* Clock.currentTimeMillis;
    const deadline = Option.match(snapshot.cleanup, {
      onNone: () => snapshot.operation.limits.deadlineMs,
      onSome: (cleanup) => cleanup.deadlineMs,
    });
    const end = Match.value(bounded).pipe(
      Match.when(true, () => snapshot.operation.limits.deadlineMs),
      Match.orElse(() => deadline),
    );
    const readback = task.pipe(
      Effect.timeout(Math.max(0, end - now)),
      Effect.catchTag('TimeoutError', () =>
        Effect.fail({
          _tag: 'DeadlineExpired' as const,
          operationId: snapshot.operation.operationId,
        }),
      ),
    );
    const raw = yield* readback;
    const observation = yield* Effect.fromResult(decodeWorkerObservation(raw));
    const atMs = yield* Clock.currentTimeMillis;
    yield* Effect.fromResult(validateWorkerCustody(snapshot.operation, observation));
    yield* Effect.fromResult(
      requireFact(
        observation.atMs >= snapshot.outcomeEvidenceFloorMs && observation.atMs <= atMs,
        'StaleObservation',
        snapshot.operation.operationId,
      ),
    );
    const bound = observation.resources.every(
      (resource) =>
        Option.isNone(snapshot.containerId) ||
        Option.contains(snapshot.containerId, resource.containerId),
    );
    yield* Effect.fromResult(requireFact(bound, 'NoCustody', snapshot.operation.operationId));
    return observation;
  }
  const program = Effect.gen(inspectResource);
  return program;
}

function recordReady(snapshot: WorkerJournalSnapshot, observation: WorkerObservation, now: number) {
  function* persistReady() {
    const containerId = yield* Effect.fromOption(snapshot.containerId);
    const receipt = yield* Effect.fromResult(
      validateWorkerReadiness(
        snapshot.operation,
        containerId,
        observation,
        snapshot.createdAtMs,
        now,
      ),
    );
    const next = yield* commit({
      _tag: 'RecordReadiness',
      operationId: snapshot.operation.operationId,
      expectedRevision: snapshot.revision,
      atMs: now,
      receipt,
    });
    return { _tag: 'Ready' as const, snapshot: next };
  }
  const program = Effect.gen(persistReady);
  return program;
}

function checkReadiness(input: LifecycleInput) {
  function* inspectReadiness() {
    const snapshot = yield* load(input.operationId);
    yield* clockAuthority(snapshot, false);
    const observation = yield* observe(snapshot, true);
    const now = yield* clockAuthority(snapshot, false);
    const resource = Array.head(observation.resources);
    const staging = Match.value(observation.staging).pipe(
      Match.when('Present', () => true),
      Match.orElse(() => false),
    );
    const pending = Option.isSome(resource) && !resource.value.running && staging;
    const readiness = Match.value(pending).pipe(
      Match.when(true, () => Effect.succeed({ _tag: 'Pending' as const, snapshot })),
      Match.when(false, () => recordReady(snapshot, observation, now)),
      Match.exhaustive,
    );
    return yield* readiness;
  }
  const program = Effect.gen(inspectReadiness);
  return program;
}

function waitReadiness(input: LifecycleInput) {
  function* waitWithinDeadline() {
    const snapshot = yield* load(input.operationId);
    const now = yield* clockAuthority(snapshot, false);
    yield* Effect.sleep(Math.min(10, snapshot.operation.limits.deadlineMs - now));
  }
  const program = Effect.gen(waitWithinDeadline);
  return program;
}

function authorize(input: SnapshotInput) {
  function* authorizeExecution() {
    const snapshot = yield* load(input.operationId);
    const atMs = yield* clockAuthority(snapshot, false);
    return yield* commit({
      _tag: 'AuthorizeExecution',
      operationId: input.operationId,
      expectedRevision: input.revision,
      atMs,
    });
  }
  const program = Effect.gen(authorizeExecution);
  return program;
}

function execute(input: SnapshotInput) {
  function* executeAuthorized() {
    const snapshot = yield* load(input.operationId);
    yield* Effect.fromResult(
      requireFact(snapshot.revision === input.revision, 'NotCurrent', input.operationId),
    );
    const atMs = yield* clockAuthority(snapshot, false);
    const authorizedAtMs = yield* Effect.fromOption(snapshot.executionAuthorizedAtMs);
    const readiness = yield* Effect.fromOption(snapshot.readiness);
    const mechanism = yield* WorkerMechanism;
    const execution = mechanism
      .execute({ operation: snapshot.operation, readiness, authorizedAtMs })
      .pipe(
        Effect.timeout(snapshot.operation.limits.deadlineMs - atMs),
        Effect.catchTag('TimeoutError', () =>
          Effect.fail({ _tag: 'DeadlineExpired' as const, operationId: input.operationId }),
        ),
      );
    const raw = yield* execution;
    const decoded = Schema.decodeUnknownEffect(WorkerExecutionReply)(raw).pipe(
      Effect.mapError(() => ({ _tag: 'InvalidInput' as const, operationId: input.operationId })),
    );
    const reply = yield* decoded;
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.fromResult(
      requireFact(
        reply.operationId === input.operationId &&
          sameIdentity(reply.identity, snapshot.operation.identity),
        'IdentityMismatch',
        input.operationId,
      ),
    );
    const validTime = validExecutionTime(
      reply.completedAtMs,
      authorizedAtMs,
      now,
      snapshot.operation.limits.deadlineMs,
    );
    yield* Effect.fromResult(requireFact(validTime, 'InvalidTime', input.operationId));
    const current = yield* load(input.operationId);
    // Offline tracer policy only, matching the canonical journal cleanup fixture.
    return yield* commit({
      _tag: 'RequestCleanup',
      operationId: input.operationId,
      expectedRevision: current.revision,
      atMs: now,
      cleanupWindowMs: 100,
    });
  }
  const program = Effect.gen(executeAuthorized);
  return program;
}

function validExecutionTime(
  completedAtMs: number,
  authorizedAtMs: number,
  now: number,
  deadline: number,
) {
  return [completedAtMs >= authorizedAtMs, completedAtMs <= now, completedAtMs < deadline].every(
    Boolean,
  );
}

function resolvedBy(
  intent: WorkerIntent,
  snapshot: WorkerJournalSnapshot,
  observation: WorkerObservation,
) {
  const resource = Array.head(observation.resources);
  const present = Option.isSome(resource);
  return Match.value(intent.kind).pipe(
    Match.when('Create', () => present),
    Match.when('Start', () => present && resource.value.running),
    Match.when('Stop', () => present && !resource.value.running),
    Match.when('Remove', () => !present && Option.isSome(snapshot.containerId)),
    Match.exhaustive,
  );
}

function reconcileOutcome(
  snapshot: WorkerJournalSnapshot,
  intent: WorkerIntent,
  observation: WorkerObservation,
) {
  function* persistEvidence() {
    const atMs = yield* Clock.currentTimeMillis;
    const reply: WorkerMutationReply = {
      ...snapshot.operation,
      intentId: intent.intentId,
      issuerId: intent.issuerId,
      atMs,
      outcome: { _tag: 'Completed', observation },
    };
    return yield* commit({
      _tag: 'RecordOutcome',
      operationId: snapshot.operation.operationId,
      expectedRevision: snapshot.revision,
      atMs,
      reply,
    });
  }
  const program = Effect.gen(persistEvidence);
  return program;
}

function reconcile(input: LifecycleInput) {
  function* reconcileReadback() {
    const original = yield* load(input.operationId);
    const observation = yield* observe(original, false);
    const resolvable = original.intents.filter(
      (intent) => isUnresolved(intent) && resolvedBy(intent, original, observation),
    );
    for (const intent of resolvable) {
      const current = yield* load(input.operationId);
      yield* reconcileOutcome(current, intent, observation);
    }
    // Cancellation can be persisted without its notification; always re-read it.
    const snapshot = yield* load(input.operationId);
    const absenceStillBound =
      observation.resources.length > 0 ||
      sameContainerBinding(original.containerId, snapshot.containerId);
    yield* Effect.fromResult(requireFact(absenceStillBound, 'NotCurrent', input.operationId));
    const atMs = yield* Clock.currentTimeMillis;
    const cleanup = Option.match(snapshot.cleanup, {
      onNone: () => Effect.succeed({ snapshot, observation }),
      onSome: () => recordCleanup(snapshot, observation, atMs),
    });
    return yield* cleanup;
  }
  const program = Effect.gen(reconcileReadback);
  return program;
}

function recordCleanup(
  snapshot: WorkerJournalSnapshot,
  observation: WorkerObservation,
  atMs: number,
) {
  const editing = commit({
    _tag: 'RecordCleanup',
    operationId: snapshot.operation.operationId,
    expectedRevision: snapshot.revision,
    atMs,
    observation,
  });
  return editing.pipe(Effect.map((next) => ({ snapshot: next, observation })));
}

const validator = standardSchemaValidator();
const inputSchema = Schema.toType(LifecycleInput);
const claimSchema = Schema.toType(ClaimInput);
const mutationSchema = Schema.toType(MutationInput);
const snapshotSchema = Schema.toType(SnapshotInput);
export const loadWorker = fromEffect({
  validator,
  schemas: { input: inputSchema },
  effect: ({ input }) => load(input.operationId).pipe(Effect.result),
});
export const claimWorker = fromEffect({
  validator,
  schemas: { input: claimSchema },
  effect: ({ input }) => claim(input).pipe(Effect.result),
});
export const mutateWorker = fromEffect({
  validator,
  schemas: { input: mutationSchema },
  effect: ({ input }) => mutate(input).pipe(Effect.result),
});
export const checkWorkerReadiness = fromEffect({
  validator,
  schemas: { input: inputSchema },
  effect: ({ input }) => checkReadiness(input).pipe(Effect.result),
});
export const waitWorkerReadiness = fromEffect({
  validator,
  schemas: { input: inputSchema },
  effect: ({ input }) => waitReadiness(input).pipe(Effect.result),
});
export const authorizeWorkerExecution = fromEffect({
  validator,
  schemas: { input: snapshotSchema },
  effect: ({ input }) => authorize(input).pipe(Effect.result),
});
export const executeWorker = fromEffect({
  validator,
  schemas: { input: snapshotSchema },
  effect: ({ input }) => execute(input).pipe(Effect.result),
});
export const reconcileWorker = fromEffect({
  validator,
  schemas: { input: inputSchema },
  effect: ({ input }) => reconcile(input).pipe(Effect.result),
});
