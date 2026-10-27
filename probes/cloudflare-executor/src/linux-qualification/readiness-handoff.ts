import { Deferred, Effect, Match, Predicate, Result, Schema, Stream } from 'effect';

import { decodeReadiness, ReadinessOnly } from './readiness-worker.ts';

type Session = object;
type Identity = object;
type Created = { session: Session; identity: Identity; output: Stream.Stream<Uint8Array> };
type Owner = { _tag: 'Owned'; session: Session; identity: Identity };
type Readback = {
  _tag: 'Absent' | 'Present' | 'Unknown';
  session: Session;
  identity: Identity | undefined;
};
// This shape supplies types only; there is no production process provider.
function unavailablePort() {
  function create(_session: Session) {
    const unavailable = Effect.fail(new Error('Unavailable'));
    const workflow = unavailable.pipe(Effect.map(() => ({}) as Created));
    return workflow;
  }
  function inspect(_session: Session) {
    const unavailable = Effect.fail(new Error('Unavailable'));
    const workflow = unavailable.pipe(Effect.map(() => ({}) as Owner));
    return workflow;
  }
  function remove(_session: Session, _identity: Identity) {
    const unavailable = Effect.fail(new Error('Unavailable'));
    return unavailable.pipe(Effect.asVoid);
  }
  function readback(_session: Session, _identity: Identity | undefined) {
    const unavailable = Effect.fail(new Error('Unavailable'));
    const workflow = unavailable.pipe(Effect.map(() => ({}) as Readback));
    return workflow;
  }
  return { create, inspect, remove, readback };
}
export type CanaryPort = ReturnType<typeof unavailablePort>;
// These deadlines require cooperative interruption; a real provider must independently
// establish process termination and resource absence before any operational claim.
export function readReadinessFrame(input: Stream.Stream<Uint8Array, unknown>) {
  function* read() {
    let size = 0;
    function reserve(chunk: Uint8Array) {
      size += chunk.length;
      const checked = Result.succeed(chunk).pipe(
        Result.filterOrFail(
          () => size <= 262144,
          () => 'InvalidFrame' as const,
        ),
      );
      const workflow = Effect.fromResult(checked);
      return workflow;
    }
    const chunks = yield* input.pipe(
      Stream.filter((chunk) => chunk.length > 0),
      Stream.mapEffect(reserve),
      Stream.runCollect,
    );
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    function framed(value: Uint8Array) {
      const hasBom = [value[0] === 0xef, value[1] === 0xbb, value[2] === 0xbf].every(Boolean);
      return [
        value.length > 0,
        !hasBom,
        value[value.length - 1] === 10,
        value.indexOf(10) === value.length - 1,
      ].every(Boolean);
    }
    const checked = Result.succeed(bytes).pipe(
      Result.filterOrFail(framed, () => 'InvalidFrame' as const),
    );
    yield* Effect.fromResult(checked);
    const text = yield* Effect.try(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1)),
    );
    const jsonSchema = Schema.fromJsonString(Schema.Unknown);
    const json = yield* Schema.decodeUnknownEffect(jsonSchema)(text);
    const readiness = yield* decodeReadiness(json);
    const encode = Schema.encodeSync(Schema.fromJsonString(ReadinessOnly));
    const canonical = yield* Effect.try(() => encode(readiness));
    const same = Result.succeed(text).pipe(
      Result.filterOrFail(
        (value) => value === canonical,
        () => 'InvalidFrame' as const,
      ),
    );
    yield* Effect.fromResult(same);
    return readiness;
  }
  const workflow = Effect.gen(read);
  const bounded = workflow.pipe(
    Effect.timeout(90000),
    Effect.catchDefect(() => Effect.fail('ReadinessFrameRefused' as const)),
    Effect.mapError(() => 'ReadinessFrameRefused' as const),
  );
  return bounded;
}
export function simulateReadinessHandoff(port: CanaryPort) {
  function* run() {
    const session = {};
    let identity: Identity | undefined;
    const state: { cleanup: 'Unknown' | 'ConfirmedRemoval' } = { cleanup: 'Unknown' };
    function* owned() {
      const raw = yield* port.inspect(session);
      const isOwned = Schema.is(
        Schema.Struct({
          _tag: Schema.Literal('Owned'),
          session: Schema.Unknown,
          identity: Schema.Unknown,
        }),
      );
      const checked = Result.succeed(raw).pipe(
        Result.filterOrFail(isOwned, () => 'OwnershipUnknown' as const),
      );
      const observed = yield* Effect.fromResult(checked);
      function matches(value: Owner) {
        return [
          identity !== undefined,
          value.session === session,
          value.identity === identity,
        ].every(Boolean);
      }
      yield* Effect.fromResult(
        Result.succeed(observed).pipe(
          Result.filterOrFail(matches, () => 'OwnershipUnknown' as const),
        ),
      );
    }
    function* clean() {
      const settled = yield* Deferred.make<void>();
      let removalSucceeded = false;
      function* removePhase() {
        const removal = yield* Effect.gen(function* () {
          yield* owned();
          yield* port.remove(session, identity!);
        }).pipe(
          Effect.timeout(20000),
          Effect.catchDefect(() => Effect.fail('CleanupUnknown' as const)),
          Effect.result,
        );
        removalSucceeded = Result.isSuccess(removal);
        yield* Deferred.succeed(settled, undefined);
        return removal;
      }
      function* readPhase() {
        yield* Deferred.await(settled).pipe(Effect.timeoutOption(20000));
        // An early absence observation cannot confirm a removal still in flight.
        const afterRemoval = removalSucceeded;
        const reading = Effect.suspend(() => port.readback(session, identity));
        const raw = yield* reading.pipe(
          Effect.timeout(10000),
          Effect.catchDefect(() => Effect.fail('ReadbackUnknown' as const)),
          Effect.result,
        );
        return { raw, afterRemoval };
      }
      const [removal, observation] = yield* Effect.all(
        [Effect.gen(removePhase), Effect.gen(readPhase)],
        { concurrency: 2 },
      );
      const validReadback = Schema.is(
        Schema.Struct({
          _tag: Schema.Literals(['Absent', 'Present', 'Unknown']),
          session: Schema.Unknown,
          identity: Schema.Unknown,
        }),
      );
      const readback = observation.raw.pipe(
        Result.filterOrFail(validReadback, () => 'ReadbackUnknown' as const),
      );
      const isAbsent = Schema.is(Schema.Literal('Absent'));
      const confirmed = [
        identity !== undefined && Result.isSuccess(removal),
        observation.afterRemoval,
        Result.isSuccess(readback) && isAbsent(readback.success._tag),
        Result.isSuccess(readback) && readback.success.session === session,
        Result.isSuccess(readback) && readback.success.identity === identity,
      ].every(Boolean);
      state.cleanup = Match.value(confirmed).pipe(
        Match.when(true, () => 'ConfirmedRemoval' as const),
        Match.orElse(() => 'Unknown' as const),
      );
    }
    function cleanup() {
      const workflow = Effect.gen(clean);
      const bounded = workflow.pipe(
        Effect.interruptible,
        Effect.timeout(30000),
        Effect.catchDefect(() => Effect.fail('CleanupUnknown' as const)),
        Effect.result,
        Effect.asVoid,
      );
      return bounded;
    }
    function* execute() {
      yield* Effect.addFinalizer(cleanup);
      const raw = yield* port.create(session);
      const isCreated = Schema.is(
        Schema.Struct({
          session: Schema.ObjectKeyword,
          identity: Schema.ObjectKeyword,
        }),
      );
      const decoded = Result.succeed(raw).pipe(
        Result.filterOrFail(isCreated, () => 'ChannelMismatch' as const),
      );
      const created = yield* Effect.fromResult(decoded);
      const candidate = { session: created.session, identity: created.identity };
      function matches(value: { session: Session; identity: Identity }) {
        return [value.session === session, Predicate.isObject(value.identity)].every(Boolean);
      }
      const checked = Result.succeed(candidate).pipe(
        Result.filterOrFail(matches, () => 'ChannelMismatch' as const),
      );
      const acknowledged = yield* Effect.fromResult(checked);
      identity = acknowledged.identity;
      const output = Result.succeed(created.output).pipe(
        Result.filterOrFail(Stream.isStream, () => 'ChannelMismatch' as const),
      );
      const channel = yield* Effect.fromResult(output);
      yield* Effect.gen(owned);
      const readiness = yield* readReadinessFrame(channel);
      yield* Effect.gen(owned);
      return readiness;
    }
    const attempted = yield* Effect.gen(execute).pipe(
      Effect.catchDefect(() => Effect.fail('ExecutionUnknown' as const)),
      Effect.scoped,
      Effect.timeout(90000),
      Effect.result,
    );
    const isConfirmed = Schema.is(Schema.Literal('ConfirmedRemoval'));
    function selectReadiness(value: import('./readiness-worker.ts').ReadinessOnly) {
      return Match.value(isConfirmed(state.cleanup)).pipe(
        Match.when(true, () => value),
        Match.orElse(() => undefined),
      );
    }
    const readiness = Result.match(attempted, {
      onFailure: () => undefined,
      onSuccess: selectReadiness,
    });
    return {
      complete: false as const,
      authority: 'Unavailable' as const,
      cleanup: state.cleanup,
      readiness,
    };
  }
  const workflow = Effect.gen(run);
  return workflow;
}
