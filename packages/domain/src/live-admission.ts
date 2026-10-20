import { Match, Schema } from 'effect';

import {
  AdmissionLimits,
  AdmittedPreview,
  AssessmentProfile,
  AuthorityRevision,
  CommandCandidate,
  CommandKey,
  DecisionId,
  GitHubId,
  IngressScopeId,
  NonAdmittedDecision,
  PolicyRevision,
  ProfileId,
  ProfileRevision,
  RecordedAssessmentDecision,
  RejectedAssessment,
  VerifiedCommand,
  commandKey,
} from './command-admission.ts';
import { NonNegativeSafeInteger } from './identities.ts';

export const LocalIngressPolicy = Schema.Struct({
  revision: AuthorityRevision,
  ingressScopeId: IngressScopeId,
  appId: GitHubId,
  installationId: GitHubId,
  ownerId: GitHubId,
  repositoryId: GitHubId,
  profile: AssessmentProfile,
  policyRevision: PolicyRevision,
  allowedOperatorIds: Schema.Array(GitHubId).check(
    Schema.isUnique(),
    Schema.isMaxLength(AdmissionLimits.operators),
  ),
});
export type LocalIngressPolicy = typeof LocalIngressPolicy.Type;

export const ClockReading = Schema.Struct({
  wallMs: NonNegativeSafeInteger,
  monotonicMs: NonNegativeSafeInteger,
});
export type ClockReading = typeof ClockReading.Type;
export const AuthorityQuery = Schema.Struct({
  verified: VerifiedCommand,
  policy: LocalIngressPolicy,
});
export type AuthorityQuery = typeof AuthorityQuery.Type;

export const LivePermissionEvidence = Schema.Struct({
  evidenceId: AuthorityRevision,
  commandKey: CommandKey,
  appId: GitHubId,
  installationId: GitHubId,
  ownerId: GitHubId,
  repositoryId: GitHubId,
  operatorId: GitHubId,
  localPolicyRevision: AuthorityRevision,
  policyRevision: PolicyRevision,
  profileId: ProfileId,
  profileRevision: ProfileRevision,
  basePermission: Schema.Literals(['write', 'admin', 'read', 'none']),
  observedAtMs: NonNegativeSafeInteger,
  checkedAtMs: NonNegativeSafeInteger,
  validUntilMs: NonNegativeSafeInteger,
}).check(
  Schema.makeFilter((e) =>
    [
      e.observedAtMs <= e.checkedAtMs,
      e.checkedAtMs < e.validUntilMs,
      e.validUntilMs - e.observedAtMs <= 6000,
    ].every(Boolean),
  ),
);
export type LivePermissionEvidence = typeof LivePermissionEvidence.Type;
export const LiveEvidenceLease = Schema.Struct({
  evidence: LivePermissionEvidence,
  startedMonotonicMs: NonNegativeSafeInteger,
});
export type LiveEvidenceLease = typeof LiveEvidenceLease.Type;

const LocalPolicy = Schema.TaggedStruct('LocalPolicy', { revision: AuthorityRevision });
const LiveChecked = Schema.TaggedStruct('LiveChecked', { evidence: LivePermissionEvidence });
const liveDecision = Schema.Union([
  AdmittedPreview,
  Schema.TaggedStruct('Rejected', { reason: Schema.Literal('OperatorDenied') }),
]);
const localRefusal = RejectedAssessment.check(
  Schema.makeFilter((decision) =>
    Match.value(decision.reason).pipe(
      Match.when('IdentityMismatch', () => true),
      Match.when('OperatorDenied', () => true),
      Match.when('ProfileUnavailable', () => true),
      Match.orElse(() => false),
    ),
  ),
);
export const DecisionProvenance = Schema.Union([LocalPolicy, LiveChecked]);
export type DecisionProvenance = typeof DecisionProvenance.Type;

function boundCandidate(candidate: CommandCandidate, evidence: LivePermissionEvidence) {
  return [
    evidence.commandKey === commandKey(candidate),
    evidence.installationId === candidate.installationId,
    evidence.ownerId === candidate.ownerId,
    evidence.repositoryId === candidate.repositoryId,
    evidence.operatorId === candidate.operatorId,
  ].every(Boolean);
}

export function livePermissionAllowed(permission: LivePermissionEvidence['basePermission']) {
  return Match.value(permission).pipe(
    Match.when('write', () => true),
    Match.when('admin', () => true),
    Match.when('read', () => false),
    Match.when('none', () => false),
    Match.exhaustive,
  );
}

function boundDecision(decision: RecordedAssessmentDecision, evidence: LivePermissionEvidence) {
  return Match.value(decision).pipe(
    Match.when(
      { _tag: 'Rejected', reason: 'OperatorDenied' },
      () => !livePermissionAllowed(evidence.basePermission),
    ),
    Match.tag('Rejected', () => false),
    Match.tag('AdmittedPreview', (preview) =>
      [
        livePermissionAllowed(evidence.basePermission),
        preview.commandKey === evidence.commandKey,
        preview.evidenceRevision === evidence.evidenceId,
        preview.policyRevision === evidence.policyRevision,
        preview.profileId === evidence.profileId,
        preview.profileRevision === evidence.profileRevision,
      ].every(Boolean),
    ),
    Match.exhaustive,
  );
}

const draftFields = {
  verified: VerifiedCommand,
  expectedLocalRevision: AuthorityRevision,
  evaluatedAtMs: NonNegativeSafeInteger,
  evaluatedMonotonicMs: NonNegativeSafeInteger,
};
const localDraft = Schema.Struct({
  ...draftFields,
  decision: localRefusal,
  provenance: LocalPolicy,
}).check(Schema.makeFilter((d) => d.provenance.revision === d.expectedLocalRevision));
const liveDraft = Schema.Struct({
  ...draftFields,
  decision: liveDecision,
  provenance: LiveChecked,
  startedMonotonicMs: NonNegativeSafeInteger,
}).check(
  Schema.makeFilter((d) =>
    [
      d.expectedLocalRevision === d.provenance.evidence.localPolicyRevision,
      boundCandidate(d.verified.candidate, d.provenance.evidence),
      boundDecision(d.decision, d.provenance.evidence),
      d.provenance.evidence.checkedAtMs <= d.evaluatedAtMs,
      d.evaluatedAtMs < d.provenance.evidence.validUntilMs,
      d.startedMonotonicMs <= d.evaluatedMonotonicMs,
      d.evaluatedMonotonicMs - d.startedMonotonicMs <
        d.provenance.evidence.validUntilMs - d.provenance.evidence.observedAtMs,
    ].every(Boolean),
  ),
);
export const LiveAdmissionDraft = Schema.Union([localDraft, liveDraft]);
export type LiveAdmissionDraft = typeof LiveAdmissionDraft.Type;

const recordFields = {
  decisionId: DecisionId,
  commandKey: CommandKey,
  candidate: CommandCandidate,
  localPolicyRevision: AuthorityRevision,
  evaluatedAtMs: NonNegativeSafeInteger,
  committedAtMs: NonNegativeSafeInteger,
};
const recordSchema = Schema.Union([
  Schema.Struct({ ...recordFields, decision: localRefusal, provenance: LocalPolicy }),
  Schema.Struct({ ...recordFields, decision: liveDecision, provenance: LiveChecked }),
]);
function validRecord(r: typeof recordSchema.Type) {
  const internal = [
    r.commandKey === commandKey(r.candidate),
    r.evaluatedAtMs <= r.committedAtMs,
  ].every(Boolean);
  return Match.value(r.provenance).pipe(
    Match.tag('LocalPolicy', (local) => internal && local.revision === r.localPolicyRevision),
    Match.tag('LiveChecked', ({ evidence: e }) =>
      [
        internal,
        boundCandidate(r.candidate, e),
        boundDecision(r.decision, e),
        e.localPolicyRevision === r.localPolicyRevision,
        e.checkedAtMs <= r.evaluatedAtMs,
        r.committedAtMs < e.validUntilMs,
      ].every(Boolean),
    ),
    Match.exhaustive,
  );
}
export const LiveAdmissionRecord = recordSchema.check(Schema.makeFilter(validRecord));
export type LiveAdmissionRecord = typeof LiveAdmissionRecord.Type;
export const LiveAdmissionReply = Schema.Union([
  Schema.TaggedStruct('Recorded', { record: LiveAdmissionRecord }),
  Schema.TaggedStruct('Duplicate', { record: LiveAdmissionRecord }),
  Schema.TaggedStruct('Unrecorded', { decision: NonAdmittedDecision }),
]);
export type LiveAdmissionReply = typeof LiveAdmissionReply.Type;
export const ReplayResolution = Schema.Union([
  Schema.TaggedStruct('Absent', {}),
  Schema.TaggedStruct('Duplicate', { record: LiveAdmissionRecord }),
  Schema.TaggedStruct('Conflict', {
    reason: Schema.Literals(['DeliveryConflict', 'CommandConflict']),
  }),
  Schema.TaggedStruct('CapacityExceeded', {}),
]);
export type ReplayResolution = typeof ReplayResolution.Type;
export const LocalPolicyObservation = Schema.Struct({
  policy: LocalIngressPolicy,
  at: ClockReading,
});
export type LocalPolicyObservation = typeof LocalPolicyObservation.Type;
