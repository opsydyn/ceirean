import { Clock, Data, Effect, Match, Result, Schema } from 'effect';

import { Candidate, Policy } from './job.ts';
import type { makeJobStore } from './store.ts';

export const Readiness = Schema.Struct({
  protocol: Schema.Literal('readonly-policy-v1'),
  policy: Policy,
});
const codec = Schema.fromJsonString(Readiness);
const encode = Schema.encodeSync(codec);
const decode = Schema.decodeUnknownResult(codec);
const samePolicy = Schema.toEquivalence(Policy);
const encodeJob = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export class ReadOnlyNotReady extends Data.TaggedError('ReadOnlyNotReady')<{
  readonly code: 'Mismatch' | 'Unavailable';
}> {}

export function describeReadiness(policy: Policy) {
  return encode({ protocol: 'readonly-policy-v1', policy });
}

export function inspectReadiness(policy: Policy, observed: unknown) {
  function compare(descriptor: typeof Readiness.Type) {
    return Match.value(samePolicy(policy, descriptor.policy)).pipe(
      Match.when(true, () => Result.succeed(descriptor)),
      Match.orElse(() => Result.fail(new ReadOnlyNotReady({ code: 'Mismatch' }))),
    );
  }
  return decode(observed).pipe(
    Result.mapError(() => new ReadOnlyNotReady({ code: 'Mismatch' })),
    Result.flatMap(compare),
  );
}

export function makeReadOnlyJobAdmission(
  policy: Policy,
  store: Pick<ReturnType<typeof makeJobStore>, 'admit'>,
) {
  function enqueueReadyV1(candidate: Candidate, expectedReadiness: string) {
    function* admit() {
      yield* Effect.fromResult(inspectReadiness(policy, expectedReadiness));
      const now = yield* Clock.currentTimeMillis;
      const job = yield* store.admit(policy, candidate, now);
      return encodeJob(job);
    }
    const admitting = Effect.gen(admit);
    return admitting;
  }
  function readDescriptor() {
    return describeReadiness(policy);
  }
  function readiness() {
    const reading = Effect.sync(readDescriptor);
    return reading;
  }
  return { readiness, enqueueReadyV1 };
}
