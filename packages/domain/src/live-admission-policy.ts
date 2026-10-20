import { Match, Option, Result, Schema } from 'effect';

import {
  VerifiedCommand,
  commandKey,
  type AdmissionDecision,
  type AdmissionReason,
  type RejectedAssessment,
} from './command-admission.ts';
import {
  ClockReading,
  LiveEvidenceLease,
  LocalIngressPolicy,
  livePermissionAllowed,
} from './live-admission.ts';

function reject(reason: AdmissionReason): RejectedAssessment {
  return { _tag: 'Rejected', reason };
}
function requireFact(condition: boolean, reason: AdmissionReason) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.orElse(() => Result.fail(reject(reason))),
  );
}

const inputSchema = Schema.Struct({
  verified: VerifiedCommand,
  policy: LocalIngressPolicy,
  evidence: Schema.Unknown,
  now: Schema.Unknown,
});

export function decideLiveAdmission(input: unknown): AdmissionDecision {
  function* decide() {
    const decoded = yield* Schema.decodeUnknownResult(inputSchema)(input).pipe(
      Result.mapError(() => reject('MalformedInput')),
    );
    const now = yield* Schema.decodeUnknownResult(ClockReading)(decoded.now).pipe(
      Result.mapError(() => reject('InvalidClock')),
    );
    const { candidate } = decoded.verified;
    const { policy } = decoded;
    yield* requireFact(
      [
        candidate.ingressScopeId === policy.ingressScopeId,
        candidate.installationId === policy.installationId,
        candidate.ownerId === policy.ownerId,
        candidate.repositoryId === policy.repositoryId,
      ].every(Boolean),
      'IdentityMismatch',
    );
    yield* requireFact(policy.allowedOperatorIds.includes(candidate.operatorId), 'OperatorDenied');
    const profile = yield* Match.value(policy.profile).pipe(
      Match.tag('Enabled', (p) => Result.succeed(p)),
      Match.orElse(() => Result.fail(reject('ProfileUnavailable'))),
    );
    const leaseOption = Schema.Option(LiveEvidenceLease);
    const optional = yield* Schema.decodeUnknownResult(leaseOption)(decoded.evidence).pipe(
      Result.mapError(() => reject('InvalidAuthority')),
    );
    const lease = yield* Option.match(optional, {
      onNone: () => Result.fail(reject('AuthorityUnavailable')),
      onSome: (value) => Result.succeed(value),
    });
    const e = lease.evidence;
    yield* requireFact(
      [
        e.commandKey === commandKey(candidate),
        e.appId === policy.appId,
        e.installationId === candidate.installationId,
        e.ownerId === candidate.ownerId,
        e.repositoryId === candidate.repositoryId,
        e.operatorId === candidate.operatorId,
        e.localPolicyRevision === policy.revision,
        e.policyRevision === policy.policyRevision,
        e.profileId === profile.profileId,
        e.profileRevision === profile.profileRevision,
      ].every(Boolean),
      'IdentityMismatch',
    );
    yield* requireFact(
      e.checkedAtMs <= now.wallMs && lease.startedMonotonicMs <= now.monotonicMs,
      'InvalidClock',
    );
    yield* requireFact(
      now.wallMs < e.validUntilMs &&
        now.monotonicMs - lease.startedMonotonicMs < e.validUntilMs - e.observedAtMs,
      'AuthorityExpired',
    );
    yield* requireFact(livePermissionAllowed(e.basePermission), 'OperatorDenied');
    return {
      _tag: 'AdmittedPreview' as const,
      commandKey: e.commandKey,
      policyRevision: e.policyRevision,
      profileId: e.profileId,
      profileRevision: e.profileRevision,
      evidenceRevision: e.evidenceId,
    };
  }
  return Result.match(Result.gen(decide), {
    onSuccess: (value) => value,
    onFailure: (value) => value,
  });
}
