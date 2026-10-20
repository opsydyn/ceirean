import {
  CandidateIdentity,
  WorkerOperation,
  WorkerOperationId,
  WorkerRefusal,
  type WorkerIssuerId,
} from '@leviathan/domain';
import { createEffectActor, join, send, snapshots, type EffectActor } from '@xstate/effect';
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  HashMap,
  Layer,
  Match,
  Option,
  Queue,
  Ref,
  Result,
  Schema,
  Stream,
  Struct,
} from 'effect';

import {
  WorkerJournalResult,
  WorkerJournalSnapshot,
  type WorkerJournalEdit,
} from './worker-contracts.ts';
import {
  WorkerJournalError,
  WorkerLifecycleRuntimeError,
  WorkerMechanismError,
} from './worker-errors.ts';
import { workerLifecycleMachine } from './worker-lifecycle.ts';
import { WorkerJournal } from './worker-ports.ts';

const Refused = Schema.TaggedStruct('Refused', { refusal: WorkerRefusal });
const Acquisition = Schema.Union([
  Schema.TaggedStruct('Accepted', { operationId: WorkerOperationId }),
  Refused,
]);
const Observation = Schema.Union([
  Schema.TaggedStruct('Observed', { snapshot: WorkerJournalSnapshot }),
  Refused,
]);
type Acquisition = typeof Acquisition.Type;
type Observation = typeof Observation.Type;
type Drained = { readonly _tag: 'Drained' };
type Method = 'requestExecution' | 'cancel' | 'reconcile' | 'requestCleanup' | 'read';
type Reply<A> = Deferred.Deferred<
  A,
  WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError
>;
type Request =
  | { readonly _tag: 'Acquire'; readonly input: unknown; readonly reply: Reply<Acquisition> }
  | {
      readonly _tag: 'Operation';
      readonly method: Method;
      readonly operationId: WorkerOperationId;
      readonly reply: Reply<Observation>;
    }
  | { readonly _tag: 'Shutdown'; readonly reply: Reply<Drained> };
type Owned = {
  readonly operation: WorkerOperation;
  readonly ready: Deferred.Deferred<
    EffectActor<typeof workerLifecycleMachine> | null,
    WorkerRefusal | WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError
  >;
  readonly stop: Deferred.Deferred<void>;
  readonly closed: Deferred.Deferred<void>;
  readonly failed: Reply<never>;
  readonly failure: Ref.Ref<
    Option.Option<WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError>
  >;
};
type Drain = { readonly deadlineMs: number; readonly result: Reply<Drained> };
type Registry = {
  readonly entries: HashMap.HashMap<WorkerOperationId, Owned>;
  readonly drain: Option.Option<Drain>;
};
const sameOperation = Schema.toEquivalence(WorkerOperation);
const sameIdentity = Schema.toEquivalence(CandidateIdentity);
const active = (actor: EffectActor<typeof workerLifecycleMachine>) =>
  Match.value(actor.getSnapshot().status).pipe(
    Match.when('active', () => true),
    Match.orElse(() => false),
  );

function refused(refusal: WorkerRefusal): typeof Refused.Type {
  return { _tag: 'Refused', refusal };
}
function refusalValue(refusal: WorkerRefusal) {
  const result = Effect.succeed(refused(refusal));
  return result;
}
function runtimeFailure(
  operationId: WorkerOperationId,
  code: WorkerLifecycleRuntimeError['code'] = 'ActorFailed',
) {
  return new WorkerLifecycleRuntimeError({ operationId, code });
}
function requireFact(condition: boolean, refusal: WorkerRefusal) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.orElse(() => Result.fail(refusal)),
  );
}
function makeOwned(operation: WorkerOperation) {
  function* allocateOwner() {
    const ready = yield* Deferred.make<
      EffectActor<typeof workerLifecycleMachine> | null,
      WorkerRefusal | WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError
    >();
    const stop = yield* Deferred.make<void>();
    const closed = yield* Deferred.make<void>();
    const failed = yield* Deferred.make<
      never,
      WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError
    >();
    const failure = yield* Ref.make<
      Option.Option<WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError>
    >(Option.none());
    return { operation, ready, stop, closed, failed, failure };
  }
  const acquisition = Effect.gen(allocateOwner);
  return acquisition;
}
function reserve(state: Registry, candidate: Owned) {
  const operationId = candidate.operation.operationId;
  function existing(entry: Owned) {
    return requireFact(sameOperation(entry.operation, candidate.operation), {
      _tag: 'ConflictingOperation',
      operationId,
    }).pipe(Result.map(() => ({ entry, fresh: false })));
  }
  function open() {
    const previous = HashMap.get(state.entries, operationId);
    const selected = Option.match(previous, {
      onNone: () => Result.succeed({ entry: candidate, fresh: true }),
      onSome: existing,
    });
    const entries = HashMap.set(
      state.entries,
      operationId,
      Option.getOrElse(previous, () => candidate),
    );
    return [selected, Struct.evolve(state, { entries: () => entries })] as const;
  }
  return Option.match(state.drain, {
    onNone: open,
    onSome: () => [Result.fail({ _tag: 'ShuttingDown' as const, operationId }), state] as const,
  });
}
function retain(
  entry: Owned,
  error: WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError,
) {
  function* recordFailure() {
    yield* Ref.update(entry.failure, (prior) => Option.orElse(prior, () => Option.some(error)));
    yield* Deferred.fail(entry.failed, error);
  }
  const program = Effect.gen(recordFailure);
  return program;
}
function inspectFailure(entry: Owned) {
  function* failIfRetained() {
    const failure = yield* Ref.get(entry.failure);
    yield* Option.match(failure, { onNone: () => Effect.void, onSome: Effect.fail });
  }
  const program = Effect.gen(failIfRetained);
  return program;
}
function retainSnapshot(
  entry: Owned,
  state: ReturnType<EffectActor<typeof workerLifecycleMachine>['getSnapshot']>,
) {
  const failure = Match.value(state.context.taskError).pipe(
    Match.when({ _tag: 'WorkerJournalError' }, (error) =>
      Option.some(new WorkerJournalError(error)),
    ),
    Match.when({ _tag: 'WorkerMechanismError' }, (error) =>
      Option.some(new WorkerMechanismError(error)),
    ),
    Match.when({ _tag: 'WorkerLifecycleRuntimeError' }, (error) =>
      Option.some(new WorkerLifecycleRuntimeError(error)),
    ),
    Match.orElse(() => Option.none()),
  );
  return Option.match(failure, {
    onNone: () => Effect.void,
    onSome: (error) => retain(entry, error),
  });
}
function supervise(entry: Owned, actor: EffectActor<typeof workerLifecycleMachine>) {
  function* watchActor() {
    const watching = snapshots(actor).pipe(
      Stream.runForEach((state) => retainSnapshot(entry, state)),
    );
    yield* Effect.forkScoped(watching);
    yield* join(actor).pipe(
      Effect.catchCause(() => retain(entry, runtimeFailure(entry.operation.operationId))),
    );
    yield* retainSnapshot(entry, actor.getSnapshot());
  }
  const program = Effect.gen(watchActor);
  return program;
}

export function makeWorkerLifecycle(issuerId: WorkerIssuerId) {
  function* acquireService() {
    const journal = yield* WorkerJournal;
    const scope = yield* Effect.scope;
    const requests = yield* Queue.bounded<Request>(64);
    const registry = yield* Ref.make<Registry>({ entries: HashMap.empty(), drain: Option.none() });

    function find(operationId: WorkerOperationId) {
      function* readValidated() {
        const raw = yield* journal.load(operationId);
        function decode(value: WorkerJournalSnapshot) {
          return Schema.decodeUnknownEffect(WorkerJournalSnapshot)(value).pipe(
            Effect.map(Option.some),
            Effect.mapError(
              () => new WorkerJournalError({ operation: 'load', code: 'InvalidData' }),
            ),
          );
        }
        return yield* Option.match(raw, {
          onNone: () => Effect.succeed(Option.none<WorkerJournalSnapshot>()),
          onSome: decode,
        });
      }
      const program = Effect.gen(readValidated);
      return program;
    }
    function load(operationId: WorkerOperationId) {
      function* requireStored() {
        const snapshot = yield* find(operationId);
        const found = Option.match(snapshot, {
          onNone: () => Result.fail({ _tag: 'NotFound' as const, operationId }),
          onSome: Result.succeed,
        });
        return yield* Effect.fromResult(found);
      }
      const program = Effect.gen(requireStored);
      return program;
    }
    function commit(edit: WorkerJournalEdit) {
      function* commitValidated() {
        const raw = yield* journal.commit(edit);
        const decoding = Schema.decodeUnknownEffect(WorkerJournalResult)(raw).pipe(
          Effect.mapError(
            () => new WorkerJournalError({ operation: 'commit', code: 'InvalidData' }),
          ),
        );
        const result = yield* decoding;
        const accepted = Match.value(result).pipe(
          Match.tag('Committed', ({ snapshot }) => Result.succeed(snapshot)),
          Match.tag('Refused', ({ refusal }) => Result.fail(refusal)),
          Match.tag('Conflict', () =>
            Result.fail({ _tag: 'NotCurrent' as const, operationId: edit.operationId }),
          ),
          Match.exhaustive,
        );
        return yield* Effect.fromResult(accepted);
      }
      const program = Effect.gen(commitValidated);
      return program;
    }
    function register(entry: Owned) {
      function* registerAbsent() {
        const atMs = yield* Clock.currentTimeMillis;
        return yield* commit({
          _tag: 'Register',
          operationId: entry.operation.operationId,
          operation: entry.operation,
          createdAtMs: atMs,
          atMs,
        });
      }
      const program = Effect.gen(registerAbsent);
      return program;
    }
    function own(entry: Owned) {
      function* hostActor() {
        const operationId = entry.operation.operationId;
        const stored = yield* find(operationId);
        const snapshot = yield* Option.match(stored, {
          onNone: () => register(entry),
          onSome: Effect.succeed,
        });
        yield* Effect.fromResult(
          requireFact(sameOperation(snapshot.operation, entry.operation), {
            _tag: 'ConflictingOperation',
            operationId,
          }),
        );
        const released = Option.exists(snapshot.cleanup, (cleanup) =>
          Match.value(cleanup).pipe(
            Match.tag('CleanupConfirmed', () => true),
            Match.orElse(() => false),
          ),
        );
        function* hostUnreleased() {
          const actor = yield* createEffectActor(workerLifecycleMachine, {
            input: { operationId, issuerId },
          });
          yield* Deferred.succeed(entry.ready, actor);
          yield* supervise(entry, actor);
        }
        const hosting = Effect.gen(hostUnreleased);
        const selected = Match.value(released).pipe(
          Match.when(true, () => Deferred.succeed(entry.ready, null)),
          Match.orElse(() => hosting),
        );
        yield* selected;
      }
      const program = Effect.gen(hostActor);
      return program;
    }
    function start(entry: Owned) {
      function failAcquisition(
        error:
          | WorkerRefusal
          | WorkerJournalError
          | WorkerMechanismError
          | WorkerLifecycleRuntimeError,
      ) {
        return Deferred.fail(entry.ready, error);
      }
      const hosted = Effect.scoped(own(entry));
      const lifetime = hosted.pipe(
        Effect.catch(failAcquisition),
        Effect.catchDefect(() => failAcquisition(runtimeFailure(entry.operation.operationId))),
        Effect.raceFirst(Deferred.await(entry.stop)),
        Effect.ensuring(Deferred.fail(entry.ready, runtimeFailure(entry.operation.operationId))),
        Effect.ensuring(Deferred.succeed(entry.closed, undefined)),
      );
      const program = Effect.forkIn(lifetime, scope);
      return program;
    }
    function acquireDecoded(operation: WorkerOperation) {
      function* acquireOwned() {
        const candidate = yield* makeOwned(operation);
        const selection = yield* Ref.modify(registry, (state) => reserve(state, candidate));
        const selected = yield* Effect.fromResult(selection);
        const fresh = Effect.sync(() => selected.fresh);
        const starting = start(selected.entry).pipe(Effect.when(fresh));
        yield* starting;
        yield* Deferred.await(selected.entry.ready);
        yield* inspectFailure(selected.entry);
        return { _tag: 'Accepted' as const, operationId: operation.operationId };
      }
      const program = Effect.gen(acquireOwned);
      return program.pipe(
        Effect.catchDefect(() => Effect.fail(runtimeFailure(operation.operationId))),
      );
    }
    function acquire(input: unknown) {
      const decoding = Schema.decodeUnknownEffect(WorkerOperation)(input).pipe(
        Effect.mapError((): WorkerRefusal => ({ _tag: 'InvalidInput' })),
      );
      const program = decoding.pipe(
        Effect.flatMap(acquireDecoded),
        Effect.catchIf(Schema.is(WorkerRefusal), refusalValue),
      );
      return program;
    }
    function readyActor(entry: Owned) {
      function* requireActor() {
        const actor = yield* Deferred.await(entry.ready);
        yield* inspectFailure(entry);
        return actor;
      }
      const program = Effect.gen(requireActor);
      return program;
    }
    function notify(
      entry: Owned,
      type: 'RecordedCancellation' | 'RequestedCleanup' | 'RequestedReconciliation',
      revision: number,
    ) {
      function* deliverFact() {
        const actor = yield* Deferred.await(entry.ready);
        const available = Option.fromNullishOr(actor).pipe(Option.filter(active));
        const delivery = Option.match(available, {
          onNone: () => Effect.void,
          onSome: (actor) =>
            send(actor, { type, operationId: entry.operation.operationId, revision }),
        });
        yield* delivery;
      }
      const program = Effect.gen(deliverFact);
      return program;
    }
    function requestFact(entry: Owned, kind: 'RequestCancellation' | 'RequestCleanup') {
      function* persistThenNotify() {
        const operationId = entry.operation.operationId;
        const current = yield* load(operationId);
        const atMs = yield* Clock.currentTimeMillis;
        const snapshot = yield* commit({
          _tag: kind,
          operationId,
          expectedRevision: current.revision,
          atMs,
          cleanupWindowMs: 100,
        });
        const state = yield* Ref.get(registry);
        const peers = [...HashMap.values(state.entries)].filter((peer) =>
          Match.value(kind).pipe(
            Match.when(
              'RequestCancellation',
              () => peer.operation.identity.runId === entry.operation.identity.runId,
            ),
            Match.orElse(() => peer === entry),
          ),
        );
        const type = Match.value(kind).pipe(
          Match.when('RequestCancellation', () => 'RecordedCancellation' as const),
          Match.orElse(() => 'RequestedCleanup' as const),
        );
        function inform(peer: Owned) {
          function* persistPeerCleanup() {
            const latest = yield* load(peer.operation.operationId);
            const cleanup = yield* commit({
              _tag: 'RequestCleanup',
              operationId: peer.operation.operationId,
              expectedRevision: latest.revision,
              atMs,
              cleanupWindowMs: 100,
            }).pipe(Effect.result);
            const revision = Result.match(cleanup, {
              onFailure: () => latest.revision,
              onSuccess: (snapshot) => snapshot.revision,
            });
            // The cancellation fact is already committed, even if this separate cleanup CAS loses.
            yield* notify(peer, type, revision);
            yield* Effect.fromResult(cleanup);
          }
          const cancellation = Effect.gen(persistPeerCleanup);
          const action = Match.value(kind).pipe(
            Match.when('RequestCancellation', () => cancellation),
            Match.orElse(() => notify(peer, type, snapshot.revision)),
          );
          return action.pipe(Effect.result);
        }
        const results = yield* Effect.forEach(peers, inform, { concurrency: 'unbounded' });
        yield* Effect.forEach(results, Effect.fromResult);
        return yield* load(operationId);
      }
      const program = Effect.gen(persistThenNotify);
      return program;
    }
    function fencePeers(entry: Owned) {
      function* reconcileFencedPeers() {
        const state = yield* Ref.get(registry);
        const peers = [...HashMap.values(state.entries)].filter(
          (peer) =>
            peer !== entry && peer.operation.identity.runId === entry.operation.identity.runId,
        );
        for (const peer of peers) {
          const snapshot = yield* load(peer.operation.operationId);
          const fenced = Effect.sync(
            () =>
              !sameIdentity(snapshot.operation.identity, snapshot.authority.identity) ||
              Option.isSome(snapshot.authority.cancelledAtMs),
          );
          yield* notify(peer, 'RequestedReconciliation', snapshot.revision).pipe(
            Effect.when(fenced),
          );
        }
      }
      const program = Effect.gen(reconcileFencedPeers);
      return program;
    }
    function transition(
      entry: Owned,
      method: 'requestExecution' | 'reconcile',
      current: WorkerJournalSnapshot,
    ) {
      function* awaitCommittedTransition() {
        const operationId = entry.operation.operationId;
        const actor = yield* readyActor(entry);
        const execution = Match.value(method).pipe(
          Match.when('requestExecution', () => true),
          Match.orElse(() => false),
        );
        yield* Effect.fromResult(
          requireFact(!execution || actor !== null, { _tag: 'AlreadyClaimed', operationId }),
        );
        const reconciling = Effect.sync(() => !execution);
        yield* fencePeers(entry).pipe(Effect.when(reconciling));
        const available = Option.fromNullishOr(actor);
        function deliver(actor: EffectActor<typeof workerLifecycleMachine>) {
          function* deliverAndObserve() {
            const execution = Match.value(method).pipe(
              Match.when('requestExecution', () => true),
              Match.orElse(() => false),
            );
            yield* Effect.fromResult(
              requireFact(!execution || actor.getSnapshot().matches('ready'), {
                _tag: 'ReadinessMismatch',
                operationId,
              }),
            );
            const listening = yield* Deferred.make<void>();
            function settled(state: ReturnType<typeof actor.getSnapshot>) {
              return Match.value(execution).pipe(
                Match.when(
                  true,
                  () =>
                    Option.isSome(
                      state.context.snapshot?.executionAuthorizedAtMs ?? Option.none(),
                    ) ||
                    state.matches('blocked') ||
                    state.matches('reconciling'),
                ),
                Match.orElse(() => !state.matches('reconciling') && !state.matches('loading')),
              );
            }
            const waiting = snapshots(actor).pipe(
              Stream.tap(() => Deferred.succeed(listening, undefined)),
              Stream.drop(1),
              Stream.filter(settled),
              Stream.runHead,
            );
            const waiter = yield* Effect.forkScoped(waiting);
            const failure = Effect.fail(runtimeFailure(operationId));
            const ended = Deferred.await(entry.closed).pipe(Effect.andThen(failure));
            yield* Deferred.await(listening).pipe(Effect.raceFirst(ended), Effect.scoped);
            const type = Match.value(execution).pipe(
              Match.when(true, () => 'RequestedExecution' as const),
              Match.orElse(() => 'RequestedReconciliation' as const),
            );
            yield* send(actor, { type, operationId, revision: current.revision });
            const state = yield* Fiber.join(waiter);
            yield* inspectFailure(entry);
            const snapshot = yield* load(operationId);
            const code = Option.match(snapshot.authority.cancelledAtMs, {
              onNone: () => 'NotCurrent' as const,
              onSome: () => 'Cancelled' as const,
            });
            yield* Effect.fromResult(
              requireFact(!execution || Option.isSome(snapshot.executionAuthorizedAtMs), {
                _tag: code,
                operationId,
              }),
            );
            const issue = Option.flatMap(state, (state) =>
              Option.fromNullishOr(state.context.issue),
            );
            const refusal = Option.flatMap(issue, (issue) =>
              Schema.decodeUnknownOption(WorkerRefusal)(issue),
            ).pipe(Option.filter(() => !execution));
            yield* Option.match(refusal, { onNone: () => Effect.void, onSome: Effect.fail });
            return snapshot;
          }
          const program = Effect.gen(deliverAndObserve);
          return program;
        }
        const delivery = Option.match(available, {
          onNone: () => load(operationId),
          onSome: deliver,
        });
        return yield* delivery;
      }
      const program = Effect.gen(awaitCommittedTransition);
      const scoped = Effect.scoped(program);
      return scoped;
    }
    function operation(method: Method, input: WorkerOperationId) {
      function* runOperation() {
        const operationId = yield* Schema.decodeUnknownEffect(WorkerOperationId)(input).pipe(
          Effect.mapError((): WorkerRefusal => ({ _tag: 'InvalidInput' })),
        );
        const state = yield* Ref.get(registry);
        const found = HashMap.get(state.entries, operationId);
        const selected = Option.match(found, {
          onNone: () => Result.fail({ _tag: 'NotFound' as const, operationId }),
          onSome: Result.succeed,
        });
        const entry = yield* Effect.fromResult(selected);
        const current = yield* load(operationId);
        const action = Match.value(method).pipe(
          Match.when('cancel', () => requestFact(entry, 'RequestCancellation')),
          Match.when('requestCleanup', () => requestFact(entry, 'RequestCleanup')),
          Match.when('read', () => load(operationId)),
          Match.orElse((method) => transition(entry, method, current)),
        );
        const snapshot = yield* action;
        yield* inspectFailure(entry);
        return { _tag: 'Observed' as const, snapshot };
      }
      const program = Effect.gen(runOperation);
      return program.pipe(
        Effect.catchIf(Schema.is(WorkerRefusal), (reason) => Effect.succeed(refused(reason))),
        Effect.catchDefect(() => Effect.fail(runtimeFailure(input))),
      );
    }
    function drainEntry(entry: Owned) {
      function* requestAndObserveCleanup() {
        yield* Deferred.await(entry.ready);
        yield* requestFact(entry, 'RequestCleanup');
        const settling = Deferred.await(entry.closed).pipe(
          Effect.raceFirst(Deferred.await(entry.failed)),
          Effect.scoped,
        );
        yield* settling;
        yield* inspectFailure(entry);
        const snapshot = yield* load(entry.operation.operationId);
        const confirmed = Option.exists(snapshot.cleanup, (cleanup) =>
          Match.value(cleanup).pipe(
            Match.tag('CleanupConfirmed', () => true),
            Match.orElse(() => false),
          ),
        );
        yield* Effect.fromResult(
          requireFact(confirmed, {
            _tag: 'UnresolvedIntent',
            operationId: entry.operation.operationId,
          }),
        );
      }
      const program = Effect.gen(requestAndObserveCleanup);
      return program.pipe(
        Effect.catchIf(Schema.is(WorkerRefusal), () =>
          Effect.fail(runtimeFailure(entry.operation.operationId, 'ObservationFailed')),
        ),
      );
    }
    function attemptDrain(entries: readonly Owned[], deadlineMs: number) {
      function* drainWhileAlive() {
        const now = yield* Clock.currentTimeMillis;
        const draining = Effect.forEach(entries, (entry) => drainEntry(entry).pipe(Effect.result), {
          concurrency: 'unbounded',
        });
        const outcomes = yield* draining.pipe(
          Effect.timeout(Math.max(0, deadlineMs - now)),
          Effect.catchTag('TimeoutError', () =>
            Effect.fail(runtimeFailure(entries[0]!.operation.operationId, 'DrainExpired')),
          ),
        );
        yield* Effect.forEach(outcomes, Effect.fromResult);
        return { _tag: 'Drained' as const };
      }
      const program = Effect.gen(drainWhileAlive);
      return program;
    }
    function firstDrain(state: Registry, drain: Drain) {
      function* boundThenClose() {
        const entries = [...HashMap.values(state.entries)];
        const exit = yield* Effect.exit(attemptDrain(entries, drain.deadlineMs));
        for (const entry of entries) yield* Deferred.succeed(entry.stop, undefined);
        for (const entry of entries) yield* Deferred.await(entry.closed);
        const failures = yield* Effect.forEach(entries, (entry) => Ref.get(entry.failure));
        const retained = Option.fromNullishOr(failures.find(Option.isSome)).pipe(Option.flatten);
        const observed = Option.match(retained, { onNone: () => exit, onSome: Exit.fail });
        yield* Deferred.done(drain.result, observed);
        return yield* Exit.match(observed, {
          onSuccess: Effect.succeed,
          onFailure: Effect.failCause,
        });
      }
      const program = Effect.gen(boundThenClose);
      return program;
    }
    function shutdown() {
      function* beginDrainOnce() {
        const atMs = yield* Clock.currentTimeMillis;
        const result = yield* Deferred.make<
          Drained,
          WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError
        >();
        const drain = { deadlineMs: atMs + 100, result };
        function begin(state: Registry) {
          return Option.match(state.drain, {
            onSome: () => [state, state] as const,
            onNone: () =>
              [state, Struct.evolve(state, { drain: () => Option.some(drain) })] as const,
          });
        }
        const prior = yield* Ref.modify(registry, begin);
        const selected = Option.match(prior.drain, {
          onNone: () => firstDrain(prior, drain),
          onSome: (drain) => Deferred.await(drain.result),
        });
        return yield* selected;
      }
      const program = Effect.gen(beginDrainOnce);
      return program;
    }
    function handle(request: Request) {
      return Match.value(request).pipe(
        Match.tag('Acquire', (request) => Deferred.complete(request.reply, acquire(request.input))),
        Match.tag('Operation', (request) =>
          Deferred.complete(request.reply, operation(request.method, request.operationId)),
        ),
        Match.tag('Shutdown', (request) => Deferred.complete(request.reply, shutdown())),
        Match.exhaustive,
      );
    }
    function* acceptRequests() {
      const request = yield* Queue.take(requests);
      yield* Effect.forkIn(handle(request), scope);
    }
    const accepting = Effect.gen(acceptRequests);
    const owner = yield* accepting.pipe(Effect.forever, Effect.forkScoped);
    function dispatch<A>(makeRequest: (reply: Reply<A>) => Request) {
      function* submit() {
        const reply = yield* Deferred.make<
          A,
          WorkerJournalError | WorkerMechanismError | WorkerLifecycleRuntimeError
        >();
        yield* Queue.offer(requests, makeRequest(reply));
        const ended = Fiber.await(owner).pipe(Effect.andThen(Effect.interrupt));
        return yield* Deferred.await(reply).pipe(Effect.raceFirst(ended), Effect.scoped);
      }
      const program = Effect.gen(submit);
      return program;
    }
    const request = (method: Method, operationId: WorkerOperationId) =>
      dispatch<Observation>((reply) => ({ _tag: 'Operation', method, operationId, reply }));
    return {
      acquire: (input: unknown) =>
        dispatch<Acquisition>((reply) => ({ _tag: 'Acquire', input, reply })),
      requestExecution: (id: WorkerOperationId) => request('requestExecution', id),
      cancel: (id: WorkerOperationId) => request('cancel', id),
      reconcile: (id: WorkerOperationId) => request('reconcile', id),
      requestCleanup: (id: WorkerOperationId) => request('requestCleanup', id),
      read: (id: WorkerOperationId) => request('read', id),
      shutdown: () => dispatch<Drained>((reply) => ({ _tag: 'Shutdown', reply })),
    };
  }
  const acquisition = Effect.gen(acquireService);
  return acquisition;
}

export class WorkerLifecycle extends Context.Service<
  WorkerLifecycle,
  Effect.Success<ReturnType<typeof makeWorkerLifecycle>>
>()('@leviathan/engine/WorkerLifecycle') {}
export function workerLifecycleLayer(issuerId: WorkerIssuerId) {
  return Layer.effect(WorkerLifecycle, makeWorkerLifecycle(issuerId));
}
