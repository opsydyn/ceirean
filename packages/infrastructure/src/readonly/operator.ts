import { decodeRpcResult } from 'alchemy/Cloudflare/Workers/Rpc';
import { Data, Effect, Match, Predicate, Schema } from 'effect';

import { Job, type Policy } from './job.ts';
import { inspectReadiness } from './readiness.ts';

export class OperatorProbeRefusal extends Data.TaggedError('OperatorProbeRefusal')<{
  readonly code: 'Unavailable' | 'Mismatch' | 'InvalidStatus';
}> {}

const wire = Schema.String.check(Schema.isMaxLength(16384));
const method = Schema.declare((value: unknown): value is () => Promise<unknown> =>
  Predicate.isFunction(value),
);
const decodeClient = Schema.decodeUnknownEffect(
  Schema.Struct({ readiness: method, status: method }),
);
const decodeWire = Schema.decodeUnknownEffect(wire);
const statusSchema = Schema.Union([Job, Schema.Null]);
const statusCodec = Schema.fromJsonString(statusSchema);
const decodeJob = Schema.decodeUnknownEffect(statusCodec, { onExcessProperty: 'error' });

function refuse(error: unknown) {
  return Match.value(error).pipe(
    Match.when(
      (value: unknown): value is OperatorProbeRefusal => value instanceof OperatorProbeRefusal,
      Effect.fail,
    ),
    Match.orElse(() => Effect.fail(new OperatorProbeRefusal({ code: 'Unavailable' }))),
  );
}

export function qualifyReadOnlyOperator(source: unknown, policy: Policy) {
  function* readiness() {
    const client = yield* decodeClient(source);
    const observed = yield* Effect.tryPromise({
      try: () => client.readiness(),
      catch: () => new OperatorProbeRefusal({ code: 'Unavailable' }),
    }).pipe(Effect.flatMap(decodeRpcResult));
    const bounded = yield* decodeWire(observed).pipe(
      Effect.mapError(() => new OperatorProbeRefusal({ code: 'Mismatch' })),
    );
    return yield* Effect.fromResult(inspectReadiness(policy, bounded)).pipe(
      Effect.mapError(() => new OperatorProbeRefusal({ code: 'Mismatch' })),
    );
  }
  function* inspect() {
    yield* Effect.gen(readiness);
    const client = yield* decodeClient(source);
    const raw = yield* Effect.tryPromise({
      try: () => client.status(),
      catch: () => new OperatorProbeRefusal({ code: 'Unavailable' }),
    }).pipe(Effect.flatMap(decodeRpcResult));
    const job = yield* decodeWire(raw).pipe(
      Effect.flatMap(decodeJob),
      Effect.mapError(() => new OperatorProbeRefusal({ code: 'InvalidStatus' })),
    );
    const sameSession = job === null || job.sessionId === policy.sessionId;
    const wrongSession = new OperatorProbeRefusal({ code: 'InvalidStatus' });
    const mismatched = Effect.succeed(!sameSession);
    yield* Effect.fail(wrongSession).pipe(Effect.when(mismatched));
    const descriptor = yield* Effect.gen(readiness);
    return { ...descriptor, job };
  }
  const probing = Effect.gen(inspect);
  return probing.pipe(Effect.timeout('15 seconds'), Effect.catch(refuse));
}
