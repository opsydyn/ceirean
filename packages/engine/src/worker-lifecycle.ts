import { WorkerIntent, type WorkerCleanup } from '@ceirean/domain';
import { setupEffect } from '@xstate/effect';
import { Array, Match, Option, Result, Schema } from 'effect';
import type { OutputFrom } from 'xstate';
import { standardSchemaValidator } from 'xstate/validation';

import { WorkerJournalSnapshot } from './worker-contracts.ts';
import { WorkerLifecycleRuntimeError } from './worker-errors.ts';
import {
  LifecycleFact,
  LifecycleInput,
  LifecycleIssue,
  actionCompleted,
  authorizeWorkerExecution,
  checkWorkerReadiness,
  claimWorker,
  executeWorker,
  isUnresolved,
  loadWorker,
  mutateWorker,
  reconcileWorker,
  waitWorkerReadiness,
} from './worker-lifecycle-tasks.ts';

const LifecycleContext = Schema.Struct({
  ...LifecycleInput.fields,
  snapshot: Schema.NullOr(WorkerJournalSnapshot),
  pending: WorkerIntent.fields.kind,
  requestedRevision: Schema.NullOr(Schema.Number),
  issue: Schema.NullOr(LifecycleIssue),
  taskError: Schema.NullOr(LifecycleIssue),
});
type LifecycleContext = typeof LifecycleContext.Type;
type Completion<Output> = {
  readonly context: LifecycleContext;
  readonly event: { readonly output: Output };
};
type Notification = {
  readonly context: LifecycleContext;
  readonly event: typeof LifecycleFact.Type;
};

function failure(context: LifecycleContext, error: unknown): LifecycleContext {
  const runtimeError = new WorkerLifecycleRuntimeError({
    operationId: context.operationId,
    code: 'ActorFailed',
  });
  const decoded = Schema.decodeUnknownResult(LifecycleIssue)(error);
  const issue = Result.getOrElse(decoded, () => runtimeError);
  const operational = Match.value(issue).pipe(
    Match.tag(
      'WorkerJournalError',
      'WorkerMechanismError',
      'WorkerLifecycleRuntimeError',
      (error) => Option.some(error),
    ),
    Match.orElse(() => Option.none()),
  );
  const taskError = Option.getOrElse(operational, () => context.taskError);
  return { ...context, issue, taskError };
}
function blocked(context: LifecycleContext, error: unknown) {
  return { target: 'blocked' as const, context: failure(context, error) };
}
function needsReconciliation(context: LifecycleContext, error: unknown) {
  return { target: 'reconciling' as const, context: failure(context, error) };
}
function taskFailed({
  context,
  event,
}: {
  readonly context: LifecycleContext;
  readonly event: { readonly error: unknown };
}) {
  return blocked(context, event.error);
}
function revision(context: LifecycleContext) {
  return context.snapshot?.revision ?? 0;
}
function mutationInput({ context }: { readonly context: LifecycleContext }) {
  const intent = Option.fromNullishOr(context.snapshot).pipe(
    Option.flatMap((snapshot) =>
      Array.findFirst(snapshot.intents, (entry) => entry.kind === context.pending),
    ),
  );
  return {
    operationId: context.operationId,
    issuerId: context.issuerId,
    revision: revision(context),
    intent: Option.getOrThrow(intent),
  };
}
function notified({ context, event }: Notification) {
  return Match.value(event.operationId === context.operationId).pipe(
    Match.when(true, () => ({ target: '.reconciling' as const })),
    Match.orElse(() => ({})),
  );
}
function executionRequested({ context, event }: Notification) {
  return Match.value(event.operationId === context.operationId).pipe(
    Match.when(true, () => ({
      target: 'authorizingExecution' as const,
      context: { ...context, requestedRevision: event.revision },
    })),
    Match.orElse(() => ({})),
  );
}
function loaded({ context, event }: Completion<OutputFrom<typeof loadWorker>>) {
  return Result.match(event.output, {
    onFailure: (error) => blocked(context, error),
    onSuccess: (snapshot) => loadedSnapshot(context, snapshot),
  });
}
function loadedSnapshot(context: LifecycleContext, snapshot: WorkerJournalSnapshot) {
  const fresh =
    snapshot.intents.length === 0 &&
    Option.isNone(snapshot.cleanup) &&
    Option.isNone(snapshot.executionAuthorizedAtMs);
  const target = Match.value(fresh).pipe(
    Match.when(true, () => 'recordingIntent' as const),
    Match.orElse(() => 'reconciling' as const),
  );
  return { target, context: { ...context, snapshot } };
}
function claimed({ context, event }: Completion<OutputFrom<typeof claimWorker>>) {
  return Result.match(event.output, {
    onFailure: (error) => blocked(context, error),
    onSuccess: function (snapshot) {
      const targets = {
        Create: 'creating',
        Start: 'starting',
        Stop: 'stopping',
        Remove: 'removing',
      } as const;
      return { target: targets[context.pending], context: { ...context, snapshot } };
    },
  });
}
function created({ context, event }: Completion<OutputFrom<typeof mutateWorker>>) {
  return Result.match(event.output, {
    onFailure: (error) => needsReconciliation(context, error),
    onSuccess: (snapshot) => createdSnapshot(context, snapshot),
  });
}
function createdSnapshot(context: LifecycleContext, snapshot: WorkerJournalSnapshot) {
  const advance = actionCompleted(snapshot, 'Create') && Option.isNone(snapshot.cleanup);
  const target = Match.value(advance).pipe(
    Match.when(true, () => 'recordingIntent' as const),
    Match.orElse(() => 'reconciling' as const),
  );
  return { target, context: { ...context, snapshot, pending: 'Start' as const } };
}
function started({ context, event }: Completion<OutputFrom<typeof mutateWorker>>) {
  return Result.match(event.output, {
    onFailure: (error) => needsReconciliation(context, error),
    onSuccess: (snapshot) => startedSnapshot(context, snapshot),
  });
}
function startedSnapshot(context: LifecycleContext, snapshot: WorkerJournalSnapshot) {
  const advance = actionCompleted(snapshot, 'Start') && Option.isNone(snapshot.cleanup);
  const target = Match.value(advance).pipe(
    Match.when(true, () => 'checkingReadiness' as const),
    Match.orElse(() => 'reconciling' as const),
  );
  return { target, context: { ...context, snapshot } };
}
function checked({ context, event }: Completion<OutputFrom<typeof checkWorkerReadiness>>) {
  return Result.match(event.output, {
    onFailure: (error) => blocked(context, error),
    onSuccess: (result) => checkedSnapshot(context, result),
  });
}
function checkedSnapshot(
  context: LifecycleContext,
  result: Result.Result.Success<OutputFrom<typeof checkWorkerReadiness>>,
) {
  const target = Match.value(result).pipe(
    Match.tag('Ready', () => 'ready' as const),
    Match.tag('Pending', () => 'waitingReadiness' as const),
    Match.exhaustive,
  );
  return { target, context: { ...context, snapshot: result.snapshot } };
}
function waited({ context, event }: Completion<OutputFrom<typeof waitWorkerReadiness>>) {
  return Result.match(event.output, {
    onFailure: (error) => blocked(context, error),
    onSuccess: () => ({ target: 'checkingReadiness' as const }),
  });
}
function authorized({ context, event }: Completion<OutputFrom<typeof authorizeWorkerExecution>>) {
  return Result.match(event.output, {
    onFailure: (error) => needsReconciliation(context, error),
    onSuccess: (snapshot) => ({ target: 'executing' as const, context: { ...context, snapshot } }),
  });
}
function executed({ context, event }: Completion<OutputFrom<typeof executeWorker>>) {
  return Result.match(event.output, {
    onFailure: (error) => blocked(context, error),
    onSuccess: (snapshot) => ({
      target: 'reconciling' as const,
      context: { ...context, snapshot },
    }),
  });
}
function cleanupMutated({ context, event }: Completion<OutputFrom<typeof mutateWorker>>) {
  return Result.match(event.output, {
    onFailure: (error) => needsReconciliation(context, error),
    onSuccess: (snapshot) => ({
      target: 'reconciling' as const,
      context: { ...context, snapshot },
    }),
  });
}
function failedReason(intent: WorkerIntent) {
  return Match.value(intent.outcome).pipe(
    Match.tag('Failed', ({ reason }) => Option.some(reason)),
    Match.orElse(() => Option.none()),
  );
}
function reconciled({ context, event }: Completion<OutputFrom<typeof reconcileWorker>>) {
  return Result.match(event.output, {
    onFailure: (error) => blocked(context, error),
    onSuccess: (result) => reconciledSnapshot(context, result),
  });
}
function runningCleanupKind(owned: { readonly running: boolean }) {
  return Match.value(owned.running).pipe(
    Match.when(true, () => 'Stop' as const),
    Match.orElse(() => 'Remove' as const),
  );
}
function storedCleanupIssue(cleanup: WorkerCleanup) {
  return Match.value(cleanup).pipe(
    Match.tag('CleanupUnknown', ({ reason }) => reason),
    Match.orElse(() => ({ _tag: 'ReadinessMismatch' as const })),
  );
}
function reconciledSnapshot(
  context: LifecycleContext,
  { snapshot, observation }: Result.Result.Success<OutputFrom<typeof reconcileWorker>>,
) {
  const confirmed = Option.exists(snapshot.cleanup, (cleanup) =>
    Match.value(cleanup).pipe(
      Match.tag('CleanupConfirmed', () => true),
      Match.orElse(() => false),
    ),
  );
  const reason = Array.findFirst(snapshot.intents.map(failedReason), Option.isSome).pipe(
    Option.flatten,
  );
  const next = Option.match(reason, {
    onNone: () => ({ ...context, snapshot }),
    onSome: (error) => failure({ ...context, snapshot }, error),
  });
  const resource = Array.head(observation.resources);
  const pending = Option.match(resource, {
    onNone: () => 'Remove' as const,
    onSome: runningCleanupKind,
  });
  const cleanupIssue = Option.match(snapshot.cleanup, {
    onNone: () => ({ _tag: 'ReadinessMismatch' as const, operationId: context.operationId }),
    onSome: storedCleanupIssue,
  });
  const hasStart = snapshot.intents.some((intent) =>
    Match.value(intent.kind).pipe(
      Match.when('Start', () => true),
      Match.orElse(() => false),
    ),
  );
  const decisions = {
    confirmed,
    unresolved: snapshot.intents.some(isUnresolved),
    failed: Option.isSome(reason),
    cleanup: Option.isSome(snapshot.cleanup),
    canClean:
      Option.isSome(resource) && !snapshot.intents.some((intent) => intent.kind === pending),
    hasContainer: Option.isSome(snapshot.containerId),
    resourcePresent: Option.isSome(resource),
    authorized: Option.isSome(snapshot.executionAuthorizedAtMs),
    started: actionCompleted(snapshot, 'Start'),
    canStart: actionCompleted(snapshot, 'Create') && !hasStart,
  };
  return Match.value(decisions).pipe(
    Match.when({ confirmed: true }, () => ({ target: 'released' as const, context: next })),
    Match.when({ unresolved: true }, () =>
      blocked(next, { _tag: 'UnresolvedIntent', operationId: context.operationId }),
    ),
    Match.when({ cleanup: true, canClean: true }, () => ({
      target: 'recordingIntent' as const,
      context: { ...next, pending },
    })),
    Match.when({ failed: true }, () => blocked(next, Option.getOrThrow(reason))),
    Match.when({ cleanup: true }, () => blocked(next, cleanupIssue)),
    Match.when({ hasContainer: true, resourcePresent: false }, () =>
      blocked(next, { _tag: 'NotFound', operationId: context.operationId }),
    ),
    Match.when({ authorized: true }, () =>
      blocked(next, { _tag: 'AlreadyClaimed', operationId: context.operationId }),
    ),
    Match.when({ started: true }, () => ({ target: 'checkingReadiness' as const, context: next })),
    Match.when({ canStart: true }, () => ({
      target: 'recordingIntent' as const,
      context: { ...next, pending: 'Start' as const },
    })),
    Match.orElse(() => blocked(next, { _tag: 'NotCurrent', operationId: context.operationId })),
  );
}

// These named callbacks are transitions of this single statechart, not a persisted phase reducer.
export const workerLifecycleMachine = setupEffect({
  validator: standardSchemaValidator(),
  schemas: {
    input: Schema.toType(LifecycleInput),
    context: Schema.toType(LifecycleContext),
    events: {
      RecordedCancellation: Schema.toType(LifecycleFact),
      RequestedReconciliation: Schema.toType(LifecycleFact),
      RequestedExecution: Schema.toType(LifecycleFact),
      RequestedCleanup: Schema.toType(LifecycleFact),
    },
  },
  actors: {
    loadWorker,
    claimWorker,
    mutateWorker,
    checkWorkerReadiness,
    waitWorkerReadiness,
    authorizeWorkerExecution,
    executeWorker,
    reconcileWorker,
  },
}).createMachine({
  context: ({ input }) => ({
    ...input,
    snapshot: null,
    pending: 'Create',
    requestedRevision: null,
    issue: null,
    taskError: null,
  }),
  initial: 'loading',
  on: {
    RecordedCancellation: notified,
    RequestedCleanup: notified,
    RequestedReconciliation: notified,
  },
  states: {
    loading: {
      invoke: {
        src: 'loadWorker',
        input: ({ context }) => context,
        onDone: loaded,
        onError: taskFailed,
      },
    },
    recordingIntent: {
      invoke: {
        src: 'claimWorker',
        input: ({ context }) => ({
          ...context,
          revision: revision(context),
          kind: context.pending,
        }),
        onDone: claimed,
        onError: taskFailed,
      },
    },
    creating: {
      invoke: { src: 'mutateWorker', input: mutationInput, onDone: created, onError: taskFailed },
    },
    starting: {
      invoke: { src: 'mutateWorker', input: mutationInput, onDone: started, onError: taskFailed },
    },
    checkingReadiness: {
      invoke: {
        src: 'checkWorkerReadiness',
        input: ({ context }) => context,
        onDone: checked,
        onError: taskFailed,
      },
    },
    waitingReadiness: {
      invoke: {
        src: 'waitWorkerReadiness',
        input: ({ context }) => context,
        onDone: waited,
        onError: taskFailed,
      },
    },
    ready: { on: { RequestedExecution: executionRequested } },
    authorizingExecution: {
      invoke: {
        src: 'authorizeWorkerExecution',
        input: ({ context }) => ({
          ...context,
          revision: context.requestedRevision ?? revision(context),
        }),
        onDone: authorized,
        onError: taskFailed,
      },
    },
    executing: {
      invoke: {
        src: 'executeWorker',
        input: ({ context }) => ({ ...context, revision: revision(context) }),
        onDone: executed,
        onError: taskFailed,
      },
    },
    stopping: {
      invoke: {
        src: 'mutateWorker',
        input: mutationInput,
        onDone: cleanupMutated,
        onError: taskFailed,
      },
    },
    removing: {
      invoke: {
        src: 'mutateWorker',
        input: mutationInput,
        onDone: cleanupMutated,
        onError: taskFailed,
      },
    },
    reconciling: {
      invoke: {
        src: 'reconcileWorker',
        input: ({ context }) => context,
        onDone: reconciled,
        onError: taskFailed,
      },
    },
    blocked: {},
    released: { type: 'final' },
  },
});
