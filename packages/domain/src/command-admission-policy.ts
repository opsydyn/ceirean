import { Match, Result, Schema } from 'effect';

import { AuthorityState, CommandCandidate, commandKey } from './command-admission.ts';
import type {
  AdmissionDecision,
  AdmissionReason,
  AuthorityAvailable,
  RejectedAssessment,
} from './command-admission.ts';
import { NonNegativeSafeInteger } from './identities.ts';

function rejected(reason: AdmissionReason): RejectedAssessment {
  return { _tag: 'Rejected', reason };
}

function requireFact(condition: boolean, reason: AdmissionReason) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () => Result.fail(rejected(reason))),
    Match.exhaustive,
  );
}

function availableDecision(
  candidate: CommandCandidate,
  authority: AuthorityAvailable,
  nowMs: number,
) {
  function* validateEvidence() {
    yield* requireFact(
      authority.observedAtMs <= nowMs && authority.observedAtMs < authority.validUntilMs,
      'InvalidAuthority',
    );
    yield* requireFact(nowMs < authority.validUntilMs, 'AuthorityExpired');
    yield* requireFact(
      [
        candidate.ingressScopeId === authority.ingressScopeId,
        candidate.installationId === authority.installationId,
        candidate.repositoryId === authority.repositoryId,
        candidate.ownerId === authority.ownerId,
      ].every(Boolean),
      'IdentityMismatch',
    );
    const accessGranted = Match.value(authority.access).pipe(
      Match.when('Granted', () => true),
      Match.when('Revoked', () => false),
      Match.exhaustive,
    );
    yield* requireFact(accessGranted, 'AccessRevoked');
    yield* requireFact(
      authority.allowedOperatorIds.includes(candidate.operatorId),
      'OperatorDenied',
    );
    const profile = yield* Match.value(authority.profile).pipe(
      Match.tag('Enabled', (enabled) => Result.succeed(enabled)),
      Match.tag('Disabled', 'Unknown', () => Result.fail(rejected('ProfileUnavailable'))),
      Match.exhaustive,
    );
    return {
      _tag: 'AdmittedPreview' as const,
      commandKey: commandKey(candidate),
      policyRevision: authority.policyRevision,
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      evidenceRevision: authority.revision,
    };
  }
  return Result.gen(validateEvidence);
}

const assessmentInput = Schema.Struct({
  candidate: CommandCandidate,
  authority: Schema.Unknown,
  nowMs: Schema.Unknown,
});

// This pure boundary accepts unknown data and never invokes a throwing constructor until decoded.
export function decideAssessment(input: unknown): AdmissionDecision {
  function* validateInput() {
    const decoded = yield* Schema.decodeUnknownResult(assessmentInput)(input).pipe(
      Result.mapError(() => rejected('MalformedInput')),
    );
    const nowMs = yield* Schema.decodeUnknownResult(NonNegativeSafeInteger)(decoded.nowMs).pipe(
      Result.mapError(() => rejected('InvalidClock')),
    );
    const authority = yield* Schema.decodeUnknownResult(AuthorityState)(decoded.authority).pipe(
      Result.mapError(() => rejected('InvalidAuthority')),
    );
    return yield* Match.value(authority).pipe(
      Match.tag('Unavailable', () => Result.fail(rejected('AuthorityUnavailable'))),
      Match.tag('Available', (available) => availableDecision(decoded.candidate, available, nowMs)),
      Match.exhaustive,
    );
  }
  return Result.match(Result.gen(validateInput), {
    onFailure: (decision) => decision,
    onSuccess: (decision) => decision,
  });
}
