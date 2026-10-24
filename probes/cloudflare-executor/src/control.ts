import {
  Clock,
  Deferred,
  Effect,
  Match,
  Option,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
} from 'effect';

import { makeAdmissionGate, SessionConfig, type AdmissionDecision } from './admission.ts';
import { decodeRequest, type ProbeRequest, strict } from './contract.ts';
import type { DriverQuery, DriverReply, Observation, OwnedOperation } from './driver-protocol.ts';
import type { makeSimulationDriver } from './driver.ts';

type Startup =
  | { readonly _tag: 'Started' | 'Unknown'; readonly activation: 'Blocked' }
  | {
      readonly _tag: 'Refused';
      readonly reason: 'AuthorizationDenied';
      readonly activation: 'Blocked';
    };
type Cleanup = {
  readonly cleanup: 'Confirmed' | 'CleanupUnconfirmed';
  readonly activation: 'Blocked';
};
type Entry = {
  readonly operation: OwnedOperation;
  readonly startup: Deferred.Deferred<Startup>;
  readonly stop: Deferred.Deferred<void>;
  readonly cleaned: Deferred.Deferred<Cleanup>;
  readonly authorized: Ref.Ref<boolean>;
};
type StartResult =
  | Startup
  | { readonly _tag: 'Replayed'; readonly activation: 'Blocked' }
  | {
      readonly _tag: 'Refused';
      readonly reason: Extract<AdmissionDecision, { _tag: 'Refused' }>['reason'] | 'OwnerClosed';
      readonly activation: 'Blocked';
    };
type Reservation =
  | { readonly _tag: 'Waiting'; readonly entry: Entry }
  | { readonly _tag: 'Immediate'; readonly value: StartResult };
const unknown = { _tag: 'Unknown', activation: 'Blocked' } as const;
const unconfirmed: Cleanup = { cleanup: 'CleanupUnconfirmed', activation: 'Blocked' };
const confirmed: Cleanup = { cleanup: 'Confirmed', activation: 'Blocked' };
const absent = Schema.is(Schema.TaggedStruct('Absent', {}));
const notStarted = Effect.succeed({ _tag: 'Unknown', activation: 'Blocked' } as const);
const notCleaned = Effect.succeed({
  cleanup: 'CleanupUnconfirmed',
  activation: 'Blocked',
} as const);
const emptyOwner = Effect.succeed({ cleanup: 'Confirmed', activation: 'Blocked' } as const);
const isPristine = Schema.is(
  Schema.Struct({
    attempt: Schema.Literal('NeverIssued'),
    settlement: Schema.Literal('Quiescent'),
  }),
);
const isSettled = Schema.is(Schema.Struct({ settlement: Schema.Literal('Quiescent') }));
const isAuthorized = Schema.is(Schema.TaggedStruct('Authorized', { identity: Schema.Unknown }));
function permitsStart(observation: Observation) {
  return absent(observation.state) && isPristine(observation);
}
function provesCleanup(observation: Observation) {
  return absent(observation.state) && isSettled(observation);
}
function observationOf(reply: DriverReply) {
  return Match.value(reply).pipe(
    Match.tag('Observed', ({ observation }) => Option.some(observation)),
    Match.orElse(() => Option.none()),
  );
}
function startupFrom(observation: Observation): Startup {
  return Match.value(observation.state).pipe(
    Match.tag('Running', () => ({ _tag: 'Started', activation: 'Blocked' }) as const),
    Match.orElse(() => unknown),
  );
}

/** One local owner, not distributed admission or hosted qualification. */
export function makeExecutor(driver: ReturnType<typeof makeSimulationDriver>, input: unknown) {
  function* construct() {
    const decoded = yield* Schema.decodeUnknownEffect(SessionConfig, strict)(input);
    const config = structuredClone(decoded);
    const gate = yield* makeAdmissionGate(config);
    const scope = yield* Scope.Scope;
    yield* driver.claimSession(config.sessionId);
    const mutex = yield* Semaphore.make(1);
    const closed = yield* Ref.make(false);
    const current = yield* Ref.make<Option.Option<Entry>>(Option.none());
    function rpc(query: DriverQuery) {
      const operation = driver
        .request(query)
        .pipe(
          Effect.interruptible,
          Effect.option,
          Effect.timeoutOption('1 second'),
          Effect.map(Option.flatten),
        );
      return operation;
    }
    function inspectOwned(entry: Entry) {
      const operation = rpc({ _tag: 'Inspect', identity: entry.operation.identity }).pipe(
        Effect.map(Option.flatMap(observationOf)),
      );
      return operation;
    }
    function cleanup(entry: Entry) {
      function* release() {
        yield* Ref.set(closed, true);
        yield* Deferred.succeed(entry.startup, unknown);
        const authorized = yield* Ref.get(entry.authorized);
        function* remove() {
          const terminated = yield* rpc({ _tag: 'Terminate', identity: entry.operation.identity });
          const destroyed = yield* rpc({ _tag: 'Destroy', identity: entry.operation.identity });
          const observed = yield* inspectOwned(entry);
          const verified =
            Option.isSome(terminated) &&
            Option.isSome(destroyed) &&
            Option.exists(observed, provesCleanup);
          return Match.value(verified).pipe(
            Match.when(true, () => confirmed),
            Match.orElse(() => unconfirmed),
          );
        }
        const result = yield* Match.value(authorized).pipe(
          Match.when(true, () => Effect.gen(remove)),
          Match.orElse(() => notCleaned),
        );
        yield* Deferred.succeed(entry.cleaned, result);
      }
      const workflow = Effect.gen(release);
      const operation = Effect.uninterruptible(workflow);
      return operation;
    }
    function initialize(entry: Entry) {
      function* allocate() {
        const before = yield* inspectOwned(entry);
        function* startAbsent() {
          yield* rpc({ _tag: 'Start', operation: entry.operation });
          const after = yield* inspectOwned(entry);
          return Option.match(after, { onNone: () => unknown, onSome: startupFrom });
        }
        return yield* Match.value(Option.exists(before, permitsStart)).pipe(
          Match.when(true, () => Effect.gen(startAbsent)),
          Match.orElse(() => notStarted),
        );
      }
      function* begin() {
        const authorization = yield* rpc({ _tag: 'Authorize', identity: entry.operation.identity });
        const permitted = Option.exists(authorization, isAuthorized);
        yield* Ref.set(entry.authorized, permitted);
        const startup = yield* Match.value(permitted).pipe(
          Match.when(true, () => Effect.gen(allocate)),
          Match.orElse(() =>
            Effect.succeed({
              _tag: 'Refused',
              reason: 'AuthorizationDenied',
              activation: 'Blocked',
            } as const),
          ),
        );
        yield* Deferred.succeed(entry.startup, startup);
        yield* Deferred.await(entry.stop);
      }
      const workflow = Effect.gen(begin);
      return workflow;
    }
    function launch(entry: Entry) {
      function* deadline() {
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(Math.max(0, entry.operation.deadlineMs - now));
      }
      const timer = Effect.gen(deadline);
      const lifetime = initialize(entry).pipe(
        Effect.raceFirst(timer),
        Effect.raceFirst(Deferred.await(entry.stop)),
        Effect.ensuring(cleanup(entry)),
        Effect.interruptible,
      );
      const operation = Effect.forkIn(lifetime, scope);
      return operation;
    }
    function stop(entry: Entry) {
      function* finish() {
        yield* Deferred.succeed(entry.stop, undefined);
        return yield* Deferred.await(entry.cleaned);
      }
      const workflow = Effect.gen(finish);
      return workflow;
    }
    function close(sessionId: string) {
      const retire = mutex.withPermit(Ref.set(closed, true).pipe(Effect.andThen(Ref.get(current))));
      const finish = retire.pipe(
        Effect.flatMap(Option.match({ onNone: () => emptyOwner, onSome: stop })),
      );
      function* finishSession() {
        return yield* Match.value(sessionId === config.sessionId).pipe(
          Match.when(false, () => notCleaned),
          Match.orElse(() => finish),
        );
      }
      const workflow = Effect.gen(finishSession);
      return workflow;
    }
    function start(input: unknown) {
      const retired = Effect.succeed({
        _tag: 'Immediate',
        value: { _tag: 'Refused', reason: 'OwnerClosed', activation: 'Blocked' },
      } as const);
      function* reserve() {
        const isRetired = yield* Ref.get(closed);
        function* admit(request: ProbeRequest) {
          const now = yield* Clock.currentTimeMillis;
          const decision = yield* gate.admit(request, now);
          function* accepted(deadlineMs: number) {
            const identity = {
              sessionId: request.sessionId,
              operationId: request.operationId,
              resourceId: `ceirean:${request.sessionId}:${request.operationId}`,
            };
            const entry: Entry = {
              operation: structuredClone({ identity, request, deadlineMs }),
              startup: yield* Deferred.make<Startup>(),
              stop: yield* Deferred.make<void>(),
              cleaned: yield* Deferred.make<Cleanup>(),
              authorized: yield* Ref.make(false),
            };
            yield* Ref.set(current, Option.some(entry));
            yield* launch(entry);
            return { _tag: 'Waiting', entry } as Reservation;
          }
          const replayed = Effect.succeed({
            _tag: 'Immediate',
            value: { _tag: 'Replayed', activation: 'Blocked' },
          } as const);
          function refused(refusal: Extract<typeof decision, { _tag: 'Refused' }>) {
            const operation = Effect.succeed({
              _tag: 'Immediate',
              value: { ...refusal, activation: 'Blocked' as const },
            } as const);
            return operation;
          }
          return yield* Match.value(decision).pipe(
            Match.tag('Accepted', ({ deadlineMs }) => Effect.gen(() => accepted(deadlineMs))),
            Match.tag('Replay', () => replayed),
            Match.tag('Refused', refused),
            Match.exhaustive,
          );
        }
        function snapshotAndAdmit() {
          const decoded = decodeRequest(input);
          return Result.match(decoded, {
            onFailure: () =>
              Effect.succeed({
                _tag: 'Immediate',
                value: { _tag: 'Refused', reason: 'InvalidRequest', activation: 'Blocked' },
              } as const),
            onSuccess: (decoded) => {
              const request = structuredClone(decoded);
              const operation = Effect.gen(() => admit(request));
              return operation;
            },
          });
        }
        return yield* Match.value(isRetired).pipe(
          Match.when(true, () => retired),
          Match.orElse(snapshotAndAdmit),
        );
      }
      const reservation = mutex.withPermit(Effect.gen(reserve));
      function waitOwned({ entry }: Extract<Reservation, { _tag: 'Waiting' }>) {
        const operation = Deferred.await(entry.startup).pipe(Effect.onInterrupt(() => stop(entry)));
        return operation;
      }
      function* waitReserved() {
        const reserved = yield* Effect.uninterruptible(reservation);
        return yield* Match.value(reserved).pipe(
          Match.tag('Waiting', waitOwned),
          Match.tag('Immediate', ({ value }) => Effect.succeed({ ...value })),
          Match.exhaustive,
        );
      }
      const workflow = Effect.gen(waitReserved);
      return workflow;
    }
    function select(operationId: string) {
      return Ref.get(current).pipe(
        Effect.map(Option.filter((entry) => entry.operation.identity.operationId === operationId)),
      );
    }
    function cancel(operationId: string) {
      const operation = select(operationId).pipe(
        Effect.flatMap(Option.match({ onNone: () => notCleaned, onSome: stop })),
      );
      return operation;
    }
    function inspect(operationId: string) {
      function* read(entry: Entry) {
        const observed = yield* inspectOwned(entry);
        return Option.match(observed, {
          onNone: () => unknown,
          onSome: ({ state }) => ({ ...state, activation: 'Blocked' as const }),
        });
      }
      const operation = select(operationId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => notStarted,
            onSome: (entry) => Effect.gen(() => read(entry)),
          }),
        ),
      );
      return operation;
    }
    yield* Effect.addFinalizer(() => close(config.sessionId));
    return { start, inspect, cancel, close };
  }
  const workflow = Effect.gen(construct);
  return workflow;
}
