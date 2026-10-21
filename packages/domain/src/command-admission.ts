import { Match, Result, Schema } from 'effect';

import { Digest, NonNegativeSafeInteger } from './identities.ts';

export const AdmissionLimits = {
  bodyBytes: 65536,
  commentBodyBytes: 4096,
  identifierBytes: 128,
  displayNameBytes: 255,
  operators: 100,
  reasonBytes: 128,
} as const;

function isMetadataCharacter(character: string) {
  const code = character.charCodeAt(0);
  return [code >= 32, code < 127 || code > 159].every(Boolean);
}

function boundedText(maxBytes: number) {
  return Schema.String.check(
    Schema.isPattern(/\S/),
    Schema.makeFilter(
      (value: string) =>
        new TextEncoder().encode(value).length <= maxBytes && [...value].every(isMetadataCharacter),
    ),
  );
}

export const IngressScopeId = boundedText(AdmissionLimits.identifierBytes);
export type IngressScopeId = typeof IngressScopeId.Type;
export const DeliveryId = boundedText(AdmissionLimits.identifierBytes);
export type DeliveryId = typeof DeliveryId.Type;
export const AuthorityRevision = boundedText(AdmissionLimits.identifierBytes);
export type AuthorityRevision = typeof AuthorityRevision.Type;
export const PolicyRevision = boundedText(AdmissionLimits.identifierBytes);
export type PolicyRevision = typeof PolicyRevision.Type;
export const ProfileId = boundedText(AdmissionLimits.identifierBytes);
export type ProfileId = typeof ProfileId.Type;
export const ProfileRevision = boundedText(AdmissionLimits.identifierBytes);
export type ProfileRevision = typeof ProfileRevision.Type;
export const GitHubDisplayName = boundedText(AdmissionLimits.displayNameBytes);
export type GitHubDisplayName = typeof GitHubDisplayName.Type;
export const GitHubId = NonNegativeSafeInteger.check(Schema.isGreaterThan(0));
export type GitHubId = typeof GitHubId.Type;

export const CommandCandidate = Schema.Struct({
  ingressScopeId: IngressScopeId,
  installationId: GitHubId,
  repositoryId: GitHubId,
  ownerId: GitHubId,
  issueId: GitHubId,
  issueNumber: GitHubId,
  commentId: GitHubId,
  operatorId: GitHubId,
  command: Schema.Literal('Assess'),
  ownerLogin: GitHubDisplayName,
  repositoryName: GitHubDisplayName,
});
export type CommandCandidate = typeof CommandCandidate.Type;

const commandTuple = Schema.Tuple([GitHubId, GitHubId, GitHubId]);
const transportTuple = Schema.Tuple([IngressScopeId, DeliveryId]);

function canonicalTuple<S extends Schema.ConstraintCodec<unknown, unknown, never, never>>(
  tuple: S,
) {
  const json = Schema.fromJsonString(tuple);
  const decode = Schema.decodeUnknownResult(json);
  const encode = Schema.encodeSync(json);
  return Schema.String.check(
    Schema.makeFilter((value: string) => {
      const decoded = decode(value);
      return Result.match(decoded, {
        onFailure: () => false,
        onSuccess: (data) => encode(data) === value,
      });
    }),
  );
}

export const CommandKey = canonicalTuple(commandTuple);
export type CommandKey = typeof CommandKey.Type;
export const TransportKey = canonicalTuple(transportTuple);
export type TransportKey = typeof TransportKey.Type;

export function commandKey(candidate: CommandCandidate): CommandKey {
  const validated = CommandCandidate.make(candidate);
  const encode = Schema.encodeSync(Schema.fromJsonString(commandTuple));
  const encoded = encode([validated.installationId, validated.repositoryId, validated.commentId]);
  return CommandKey.make(encoded);
}

export function transportKey(scopeId: IngressScopeId, deliveryId: DeliveryId): TransportKey {
  const validated = transportTuple.make([scopeId, deliveryId]);
  const encode = Schema.encodeSync(Schema.fromJsonString(transportTuple));
  return TransportKey.make(encode(validated));
}

export const AssessCommand = Schema.Union([
  Schema.TaggedStruct('Assess', {}),
  Schema.TaggedStruct('NotCommand', {}),
]);
export type AssessCommand = typeof AssessCommand.Type;

export function parseAssessCommand(body: string): AssessCommand {
  return Match.value(body).pipe(
    Match.when('/ceirean assess', () => ({ _tag: 'Assess' as const })),
    Match.orElse(() => ({ _tag: 'NotCommand' as const })),
  );
}

export const AssessmentProfile = Schema.Union([
  Schema.TaggedStruct('Enabled', { profileId: ProfileId, profileRevision: ProfileRevision }),
  Schema.TaggedStruct('Disabled', {}),
  Schema.TaggedStruct('Unknown', {}),
]);
export type AssessmentProfile = typeof AssessmentProfile.Type;
export const AuthorityAvailable = Schema.TaggedStruct('Available', {
  revision: AuthorityRevision,
  ingressScopeId: IngressScopeId,
  installationId: GitHubId,
  repositoryId: GitHubId,
  ownerId: GitHubId,
  access: Schema.Literals(['Granted', 'Revoked']),
  profile: AssessmentProfile,
  allowedOperatorIds: Schema.Array(GitHubId).check(
    Schema.isUnique(),
    Schema.isMaxLength(AdmissionLimits.operators),
  ),
  policyRevision: PolicyRevision,
  observedAtMs: NonNegativeSafeInteger,
  validUntilMs: NonNegativeSafeInteger,
});
export type AuthorityAvailable = typeof AuthorityAvailable.Type;
export const AuthorityState = Schema.Union([
  Schema.TaggedStruct('Unavailable', { revision: AuthorityRevision }),
  AuthorityAvailable,
]);
export type AuthorityState = typeof AuthorityState.Type;

export const AdmissionReason = Schema.Literals([
  'AuthorityUnavailable',
  'InvalidAuthority',
  'AuthorityExpired',
  'AccessRevoked',
  'IdentityMismatch',
  'OperatorDenied',
  'ProfileUnavailable',
  'MalformedInput',
  'FieldTooLarge',
  'DeliveryConflict',
  'CommandConflict',
  'AuthorityChanged',
  'CapacityExceeded',
  'InvalidClock',
  'UnsupportedEvent',
  'UnsupportedAction',
  'PullRequestComment',
  'BotActor',
  'NotCommand',
]);
export type AdmissionReason = typeof AdmissionReason.Type;
export const RejectedAssessment = Schema.TaggedStruct('Rejected', { reason: AdmissionReason });
export type RejectedAssessment = typeof RejectedAssessment.Type;
export const NonAdmittedDecision = Schema.Union([
  RejectedAssessment,
  Schema.TaggedStruct('Ignored', { reason: AdmissionReason }),
]);
export type NonAdmittedDecision = typeof NonAdmittedDecision.Type;
export const AdmittedPreview = Schema.TaggedStruct('AdmittedPreview', {
  commandKey: CommandKey,
  policyRevision: PolicyRevision,
  profileId: ProfileId,
  profileRevision: ProfileRevision,
  evidenceRevision: AuthorityRevision,
});
export type AdmittedPreview = typeof AdmittedPreview.Type;
export const RecordedAssessmentDecision = Schema.Union([AdmittedPreview, RejectedAssessment]);
export type RecordedAssessmentDecision = typeof RecordedAssessmentDecision.Type;
export const AdmissionDecision = Schema.Union([AdmittedPreview, NonAdmittedDecision]);
export type AdmissionDecision = typeof AdmissionDecision.Type;

export const VerifiedCommand = Schema.Struct({
  receipt: Schema.Struct({
    ingressScopeId: IngressScopeId,
    deliveryId: DeliveryId,
    eventName: Schema.Literal('issue_comment'),
    rawBodyDigest: Digest,
  }),
  candidate: CommandCandidate,
}).check(
  Schema.makeFilter((value) => value.receipt.ingressScopeId === value.candidate.ingressScopeId),
);
export type VerifiedCommand = typeof VerifiedCommand.Type;
export const DecisionId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/));
export type DecisionId = typeof DecisionId.Type;
export const AdmissionRecord = Schema.Struct({
  decisionId: DecisionId,
  commandKey: CommandKey,
  candidate: CommandCandidate,
  decision: RecordedAssessmentDecision,
  evaluatedAtMs: NonNegativeSafeInteger,
  committedAtMs: NonNegativeSafeInteger,
  authorityRevision: AuthorityRevision,
});
export type AdmissionRecord = typeof AdmissionRecord.Type;
export const AdmissionReply = Schema.Union([
  Schema.TaggedStruct('Recorded', { record: AdmissionRecord }),
  Schema.TaggedStruct('Duplicate', { record: AdmissionRecord }),
  Schema.TaggedStruct('Unrecorded', { decision: NonAdmittedDecision }),
]);
export type AdmissionReply = typeof AdmissionReply.Type;
export const AuthorityObservation = Schema.Struct({
  state: AuthorityState,
  atMs: NonNegativeSafeInteger,
});
export type AuthorityObservation = typeof AuthorityObservation.Type;
export const AdmissionDraft = Schema.Struct({
  verified: VerifiedCommand,
  expectedAuthorityRevision: AuthorityRevision,
  evaluatedAtMs: NonNegativeSafeInteger,
  decision: RecordedAssessmentDecision,
});
export type AdmissionDraft = typeof AdmissionDraft.Type;
export const CommitReply = AdmissionReply;
export type CommitReply = typeof CommitReply.Type;
