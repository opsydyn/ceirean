import { Data, Match, Result, Schema } from 'effect';

const id = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  Schema.isFinite(),
);
const timestamp = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  Schema.isFinite(),
);
const identities = {
  installationId: id,
  ownerId: id,
  repositoryId: id,
  issueNumber: id,
  operatorId: id,
};
export const Candidate = Schema.Struct(identities);
export type Candidate = typeof Candidate.Type;
export const Policy = Schema.Struct({
  ...identities,
  sessionId: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,63}$/)),
  opensAtMs: timestamp,
  closesAtMs: timestamp,
}).check(
  Schema.makeFilter(
    (policy) =>
      policy.closesAtMs > policy.opensAtMs && policy.closesAtMs - policy.opensAtMs <= 300000,
  ),
);
export type Policy = typeof Policy.Type;

const fields = {
  sessionId: Policy.fields.sessionId,
  queuedAtMs: timestamp,
  closesAtMs: timestamp,
};
const active = { ...fields, startedAtMs: timestamp };
export const Outcome = Schema.Union([
  Schema.TaggedStruct('Completed', {
    runtime: Schema.String.check(Schema.isPattern(/^v\d+\.\d+\.\d+$/)),
  }),
  Schema.TaggedStruct('Failed', { code: Schema.Literals(['CommandFailed', 'Interrupted']) }),
]);
export type Outcome = typeof Outcome.Type;
export const Job = Schema.Union([
  Schema.TaggedStruct('Queued', fields),
  Schema.TaggedStruct('Running', active),
  Schema.TaggedStruct('Succeeded', { ...active, runtime: Outcome.members[0].fields.runtime }),
  Schema.TaggedStruct('Failed', {
    ...fields,
    code: Schema.Literals(['CommandFailed', 'Interrupted', 'Expired']),
  }),
  Schema.TaggedStruct('CleanupRequired', {
    ...active,
    outcome: Outcome,
    cleanupAttempts: Schema.Literals([0, 1, 2]),
  }),
]);
export type Job = typeof Job.Type;

export class JobRefusal extends Data.TaggedError('JobRefusal')<{
  readonly code: 'NotAllowed' | 'NotQueued';
}> {}
const decodePolicy = Schema.decodeUnknownResult(Policy);
const sameCandidate = Schema.toEquivalence(Candidate);

export function admitJob(policy: Policy, candidate: Candidate, existing: Job | null, now: number) {
  const sameSession = existing === null || existing.sessionId === policy.sessionId;
  const allowed =
    Result.isSuccess(decodePolicy(policy)) &&
    sameCandidate(policy, candidate) &&
    Number.isSafeInteger(now) &&
    now >= policy.opensAtMs &&
    now < policy.closesAtMs &&
    sameSession;
  return Match.value(allowed).pipe(
    Match.when(true, () =>
      Result.succeed(
        existing ?? {
          _tag: 'Queued' as const,
          sessionId: policy.sessionId,
          queuedAtMs: now,
          closesAtMs: policy.closesAtMs,
        },
      ),
    ),
    Match.orElse(() => Result.fail(new JobRefusal({ code: 'NotAllowed' }))),
  );
}

export function claimJob(job: Job, now: number) {
  function claimQueued(queued: Extract<Job, { readonly _tag: 'Queued' }>) {
    const inWindow =
      Number.isSafeInteger(now) && now >= queued.queuedAtMs && now < queued.closesAtMs;
    return Match.value(inWindow).pipe(
      Match.when(true, () =>
        Result.succeed({ ...queued, _tag: 'Running' as const, startedAtMs: now }),
      ),
      Match.orElse(() => Result.fail(new JobRefusal({ code: 'NotQueued' }))),
    );
  }
  return Match.value(job).pipe(
    Match.tag('Queued', claimQueued),
    Match.orElse(() => Result.fail(new JobRefusal({ code: 'NotQueued' }))),
  );
}

type RunningJob = Extract<Job, { readonly _tag: 'Running' }>;
export function finishJob(job: RunningJob, outcome: Outcome, cleaned: boolean): Job {
  const queued = {
    sessionId: job.sessionId,
    queuedAtMs: job.queuedAtMs,
    closesAtMs: job.closesAtMs,
  };
  const active = { ...queued, startedAtMs: job.startedAtMs };
  function finished() {
    return Match.value(outcome).pipe(
      Match.tag('Completed', ({ runtime }) => ({ ...active, _tag: 'Succeeded' as const, runtime })),
      Match.tag('Failed', ({ code }) => ({ ...queued, _tag: 'Failed' as const, code })),
      Match.exhaustive,
    );
  }
  return Match.value(cleaned).pipe(
    Match.when(false, () => ({
      ...active,
      _tag: 'CleanupRequired' as const,
      outcome,
      cleanupAttempts: 0 as const,
    })),
    Match.orElse(finished),
  );
}

export function recoverJob(
  job: RunningJob | Extract<Job, { readonly _tag: 'CleanupRequired' }>,
  cleaned: boolean,
): Job {
  const result = finishJob(
    { ...job, _tag: 'Running' },
    { _tag: 'Failed', code: 'Interrupted' },
    cleaned,
  );
  const cleanupAttempts = Match.value(job).pipe(
    Match.tag('Running', () => 0 as const),
    Match.tag('CleanupRequired', (pending) => pending.cleanupAttempts),
    Match.exhaustive,
  );
  return Match.value(result).pipe(
    Match.tag('CleanupRequired', (pending) => ({ ...pending, cleanupAttempts })),
    Match.orElse((terminal) => terminal),
  );
}
