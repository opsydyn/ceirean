import {
  AuthorityQuery,
  CommandCandidate,
  DecisionProvenance,
  IngressScopeId,
  LiveAdmissionDraft,
  LiveAdmissionReply,
  LiveEvidenceLease,
  LocalPolicyObservation,
  ReplayResolution,
  RecordedAssessmentDecision,
  VerifiedCommand,
  decideLiveAdmission,
} from '@leviathan/domain';
import { Effect, Match, Option, Result, Schema } from 'effect';

import { sameCommandFacts } from './command-inbox-factory.ts';
import {
  LiveAuthorityError,
  LiveAuthorityErrorCode,
  LiveAuthorityPhase,
  LiveInboxError,
  LiveInboxErrorCode,
  LiveInboxOperation,
} from './live-admission-errors.ts';

export interface LiveInboxDriver {
  readonly loadPolicy: (
    scopeId: IngressScopeId,
  ) => Result.Result<LocalPolicyObservation, LiveInboxError>;
  readonly resolveReplay: (
    verified: VerifiedCommand,
  ) => Result.Result<ReplayResolution, LiveInboxError>;
  readonly commit: (draft: LiveAdmissionDraft) => Result.Result<LiveAdmissionReply, LiveInboxError>;
}
export type LiveAuthorityDriver = (
  query: AuthorityQuery,
  signal: AbortSignal,
) => Promise<Result.Result<LiveEvidenceLease, LiveAuthorityError>>;

const inboxFailure = Schema.Struct({
  _tag: Schema.Literal('LiveInboxError'),
  operation: LiveInboxOperation,
  code: LiveInboxErrorCode,
});
const authorityFailure = Schema.Struct({
  _tag: Schema.Literal('LiveAuthorityError'),
  phase: LiveAuthorityPhase,
  code: LiveAuthorityErrorCode,
});

function safeInbox(error: unknown, operation: LiveInboxError['operation']) {
  const decoded = Schema.decodeUnknownResult(inboxFailure)(error);
  return Result.match(decoded, {
    onSuccess: (fields) => new LiveInboxError(fields),
    onFailure: () => new LiveInboxError({ operation, code: 'InvalidData' }),
  });
}
function safeAuthority(error: unknown) {
  const decoded = Schema.decodeUnknownResult(authorityFailure)(error);
  return Result.match(decoded, {
    onSuccess: (fields) => new LiveAuthorityError(fields),
    onFailure: () => new LiveAuthorityError({ phase: 'permission', code: 'InvalidResponse' }),
  });
}

function decodeClone<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown,
) {
  const decoding = Effect.try({
    try: () => Schema.decodeUnknownResult(schema)(structuredClone(input)),
    catch: () => undefined,
  });
  return decoding.pipe(Effect.result, Effect.map(Result.flatMap((value) => value)));
}

export function makeLiveInbox(driver: LiveInboxDriver) {
  function loadPolicy(scopeId: IngressScopeId) {
    function* load() {
      const scope = yield* decodeClone(IngressScopeId, scopeId).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(() => new LiveInboxError({ operation: 'load', code: 'InvalidData' })),
      );
      const raw = yield* Effect.try({
        try: () => driver.loadPolicy(scope),
        catch: () => new LiveInboxError({ operation: 'load', code: 'ReadFailed' }),
      }).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError((error) => safeInbox(error, 'load')),
      );
      const observation = yield* decodeClone(LocalPolicyObservation, raw).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(() => new LiveInboxError({ operation: 'load', code: 'InvalidData' })),
      );
      return yield* Effect.fromResult(
        Match.value(observation.policy.ingressScopeId === scope).pipe(
          Match.when(true, () => Result.succeed(observation)),
          Match.orElse(() =>
            Result.fail(new LiveInboxError({ operation: 'load', code: 'InvalidData' })),
          ),
        ),
      );
    }
    const program = Effect.gen(load);
    return program.pipe(Effect.withSpan('LiveInbox.loadPolicy'));
  }
  function resolveReplay(input: VerifiedCommand) {
    function* replay() {
      const verified = yield* decodeClone(VerifiedCommand, input).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(() => new LiveInboxError({ operation: 'replay', code: 'InvalidData' })),
      );
      const raw = yield* Effect.try({
        try: () => driver.resolveReplay(structuredClone(verified)),
        catch: () => new LiveInboxError({ operation: 'replay', code: 'ReadFailed' }),
      }).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError((error) => safeInbox(error, 'replay')),
      );
      const reply = yield* decodeClone(ReplayResolution, raw).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(() => new LiveInboxError({ operation: 'replay', code: 'InvalidData' })),
      );
      const bound = Match.value(reply).pipe(
        Match.tag('Duplicate', ({ record }) =>
          sameCommandFacts(record.candidate, verified.candidate),
        ),
        Match.orElse(() => true),
      );
      return yield* Effect.fromResult(
        Match.value(bound).pipe(
          Match.when(true, () => Result.succeed(reply)),
          Match.orElse(() =>
            Result.fail(new LiveInboxError({ operation: 'replay', code: 'InvalidData' })),
          ),
        ),
      );
    }
    const program = Effect.gen(replay);
    return program.pipe(Effect.withSpan('LiveInbox.resolveReplay'));
  }
  function commit(input: LiveAdmissionDraft) {
    function* commitValidated() {
      const draft = yield* decodeClone(LiveAdmissionDraft, input).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(() => new LiveInboxError({ operation: 'commit', code: 'InvalidData' })),
      );
      const raw = yield* Effect.try({
        try: () => driver.commit(structuredClone(draft)),
        catch: () => new LiveInboxError({ operation: 'commit', code: 'CommitFailed' }),
      }).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError((error) => safeInbox(error, 'commit')),
      );
      const reply = yield* decodeClone(LiveAdmissionReply, raw).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(() => new LiveInboxError({ operation: 'commit', code: 'InvalidData' })),
      );
      const bound = Match.value(reply).pipe(
        Match.tag('Unrecorded', () => true),
        Match.tag('Duplicate', ({ record }) =>
          sameCommandFacts(record.candidate, draft.verified.candidate),
        ),
        Match.tag('Recorded', ({ record }) =>
          [
            Schema.toEquivalence(CommandCandidate)(record.candidate, draft.verified.candidate),
            record.localPolicyRevision === draft.expectedLocalRevision,
            record.evaluatedAtMs === draft.evaluatedAtMs,
            Schema.toEquivalence(RecordedAssessmentDecision)(draft.decision, record.decision),
            Schema.toEquivalence(DecisionProvenance)(draft.provenance, record.provenance),
          ].every(Boolean),
        ),
        Match.exhaustive,
      );
      return yield* Effect.fromResult(
        Match.value(bound).pipe(
          Match.when(true, () => Result.succeed(reply)),
          Match.orElse(() =>
            Result.fail(new LiveInboxError({ operation: 'commit', code: 'InvalidData' })),
          ),
        ),
      );
    }
    const program = Effect.gen(commitValidated);
    return program.pipe(Effect.withSpan('LiveInbox.commit'));
  }
  return { loadPolicy, resolveReplay, commit };
}

export function makeLiveAuthority(driver: LiveAuthorityDriver) {
  function check(input: AuthorityQuery) {
    function* checkValidated() {
      const query = yield* decodeClone(AuthorityQuery, input).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(
          () => new LiveAuthorityError({ phase: 'permission', code: 'InvalidResponse' }),
        ),
      );
      const local = decideLiveAdmission({
        ...query,
        evidence: Option.none(),
        now: { wallMs: 0, monotonicMs: 0 },
      });
      const eligible = Match.value(local).pipe(
        Match.when({ _tag: 'Rejected', reason: 'AuthorityUnavailable' }, () => true),
        Match.orElse(() => false),
      );
      yield* Effect.fromResult(
        Match.value(eligible).pipe(
          Match.when(true, () => Result.succeed(undefined)),
          Match.orElse(() =>
            Result.fail(new LiveAuthorityError({ phase: 'permission', code: 'IdentityMismatch' })),
          ),
        ),
      );
      const raw = yield* Effect.tryPromise({
        try: (signal) => driver(structuredClone(query), signal),
        catch: () => new LiveAuthorityError({ phase: 'permission', code: 'Unavailable' }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.mapError(safeAuthority));
      const lease = yield* decodeClone(LiveEvidenceLease, raw).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(
          () => new LiveAuthorityError({ phase: 'permission', code: 'InvalidResponse' }),
        ),
      );
      const decision = decideLiveAdmission({
        ...query,
        evidence: Option.some(lease),
        now: { wallMs: lease.evidence.checkedAtMs, monotonicMs: lease.startedMonotonicMs },
      });
      const valid = Match.value(decision).pipe(
        Match.tag('AdmittedPreview', () => true),
        Match.when({ _tag: 'Rejected', reason: 'OperatorDenied' }, () => true),
        Match.orElse(() => false),
      );
      return yield* Effect.fromResult(
        Match.value(valid).pipe(
          Match.when(true, () => Result.succeed(lease)),
          Match.orElse(() =>
            Result.fail(new LiveAuthorityError({ phase: 'permission', code: 'IdentityMismatch' })),
          ),
        ),
      );
    }
    const program = Effect.gen(checkValidated);
    return program.pipe(Effect.withSpan('LiveAuthority.check'));
  }
  return { check };
}
