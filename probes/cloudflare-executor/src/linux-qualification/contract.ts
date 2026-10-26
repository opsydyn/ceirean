import { Schema } from 'effect';

import { inputPins, toolPins } from './tool-pins.ts';

export const strict = { onExcessProperty: 'error' } as const;
export const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const GitSha = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const identity = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/));
const evidenceName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,90}\.json$/),
);
const evidence = Schema.Array(evidenceName).check(Schema.isMaxLength(64));
const confirmedEvidence = evidence.check(Schema.isMinLength(1));

export const QualificationLimits = Schema.Struct({
  jobMs: Schema.Literal(900000),
  qualificationMs: Schema.Literal(540000),
  commandMs: Schema.Literal(90000),
  cleanupMs: Schema.Literal(30000),
  jobs: Schema.Literal(1),
  automaticRetries: Schema.Literal(0),
  cpus: Schema.Literal(2),
  memoryBytes: Schema.Literal(4294967296),
  swapBytes: Schema.Literal(4294967296),
  pids: Schema.Literal(128),
  tmpfsBytes: Schema.Literal(3221225472),
  artifactBytes: Schema.Literal(67108864),
  totalArtifactBytes: Schema.Literal(536870912),
  expandedPackageBytes: Schema.Literal(268435456),
  expandedEntryBytes: Schema.Literal(201326592),
  totalExpandedBytes: Schema.Literal(2147483648),
  packageEntries: Schema.Literal(10000),
  totalEntries: Schema.Literal(200000),
  pathBytes: Schema.Literal(512),
  evidenceBytes: Schema.Literal(16777216),
  streamBytes: Schema.Literal(262144),
  retentionDays: Schema.Literal(7),
});
export const QualificationTools = Schema.Struct({
  installerImage: Schema.Literal(toolPins.installerImage),
  nodeImage: Schema.Literal(toolPins.nodeImage),
  controller: Schema.Struct({
    package: Schema.Literal(toolPins.controller.package),
    url: Schema.Literal(toolPins.controller.url),
    integrity: Schema.Literal(toolPins.controller.integrity),
  }),
  effect: Schema.Literal(toolPins.effect),
  npm: Schema.Literal(toolPins.npm),
  uploadArtifact: Schema.Literal(toolPins.uploadArtifact),
});
export const QualificationRequest = Schema.Struct({
  // These output identities must be bound by the later, separately approved worksheet.
  authority: Schema.Literal('RequiresRunWorksheet'),
  ceireanRevision: GitSha,
  lockBlob: GitSha,
  harnessSha256: Sha256,
  toolCapsuleSha256: Sha256,
  sourceRevision: Schema.Literal(inputPins.sourceRevision),
  sourceTree: Schema.Literal(inputPins.sourceTree),
  inventorySha256: Schema.Literal(inputPins.inventorySha256),
  registry: Schema.Literal('http://127.0.0.1:4873'),
  run: Schema.Struct({
    runner: Schema.Literal('ubuntu-24.04'),
    runId: identity,
    attempt: Schema.Literal(1),
  }),
  tools: QualificationTools,
  limits: QualificationLimits,
});
export type QualificationRequest = typeof QualificationRequest.Type;

export const requiredCases = [
  'RuntimeIsolationPreflight',
  'ArchiveAdmissionNegatives',
  'ScriptCanaries',
  'Warmup',
  'FreshPositive',
  'EmptyCache',
  'MissingRequiredArtifact',
  'CorruptCacheContent',
  'CaseIsolation',
  'CancellationDeadline',
] as const;
export const CaseId = Schema.Literals(requiredCases);
export const QualificationReason = Schema.Literals([
  'Verified',
  'ArchiveRefused',
  'ScriptsSuppressed',
  'CacheMaterialized',
  'InstalledFromCache',
  'EmptyCacheRefused',
  'MissingArtifactRefused',
  'CacheIntegrityRefused',
  'CopiesIsolated',
  'CancellationConfirmed',
  'BlockedMissingBunMetadata',
  'BlockedRuntime',
  'BlockedControls',
  'BlockedChildObservation',
  'InputChanged',
  'EvidenceIncomplete',
  'CleanupUnknown',
  'UnsupportedInvocation',
]);
export type QualificationReason = typeof QualificationReason.Type;
export const ControlReadbacks = Schema.Union([
  Schema.TaggedStruct('Unknown', {}),
  Schema.TaggedStruct('Verified', {
    os: Schema.Literal('Linux'),
    architecture: Schema.Literal('x86_64'),
    libc: Schema.Literal('glibc'),
    bun: Schema.Literal('1.3.11'),
    node: Schema.Literal('22.23.4'),
    runnerImage: identity,
    runnerVersion: identity,
    dockerVersion: identity,
    installerConfigSha256: Sha256,
    nodeConfigSha256: Sha256,
    nodeExecutableSha256: Sha256,
    controllerExecutableSha256: Sha256,
    controls: Schema.Struct({
      networkNone: Schema.Literal(true),
      readOnlyRoot: Schema.Literal(true),
      unprivileged: Schema.Literal(true),
      capabilitiesDropped: Schema.Literal(true),
      noNewPrivileges: Schema.Literal(true),
      noExtraDevices: Schema.Literal(true),
      privatePidIpc: Schema.Literal(true),
      noPublishedPorts: Schema.Literal(true),
      noDockerSocket: Schema.Literal(true),
      boundedTmpfs: Schema.Literal(true),
      noexecNosuidNodev: Schema.Literal(true),
      networkDnsTcpDenied: Schema.Literal(true),
      resourceLimitsVerified: Schema.Literal(true),
      runnerEligible: Schema.Literal(true),
    }),
  }),
]);
export const IdentityDigests = Schema.Union([
  Schema.TaggedStruct('Unknown', {}),
  Schema.TaggedStruct('Recorded', {
    sourceBefore: Sha256,
    sourceAfter: Sha256,
    lockBefore: Sha256,
    lockAfter: Sha256,
    seedBefore: Sha256,
    seedAfter: Sha256,
    harnessSha256: Sha256,
    toolCapsuleSha256: Sha256,
  }),
]);
export const CaseObservation = Schema.Struct({
  caseId: CaseId,
  stage: Schema.Literals([
    'Preflight',
    'Admission',
    'Canaries',
    'Warmup',
    'Offline',
    'Isolation',
    'Cleanup',
  ]),
  outcome: Schema.Literals(['Passed', 'Failed', 'Blocked']),
  reason: QualificationReason,
  evidence,
  readbacks: ControlReadbacks,
  digests: IdentityDigests,
});
export type CaseObservation = typeof CaseObservation.Type;
export const CleanupObservation = Schema.Union([
  Schema.TaggedStruct('ConfirmedRemoval', { evidence: confirmedEvidence }),
  Schema.TaggedStruct('RemainingResources', {
    resources: Schema.Array(identity).check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    evidence,
  }),
  Schema.TaggedStruct('Unknown', { evidence }),
]);
export type CleanupObservation = typeof CleanupObservation.Type;
export const QualificationReceipt = Schema.Struct({
  authority: Schema.Literal('EvidenceOnly'),
  activation: Schema.Literal('Blocked'),
  request: QualificationRequest,
  observations: Schema.Array(CaseObservation).check(Schema.isMaxLength(requiredCases.length)),
  cleanup: CleanupObservation,
  outcome: Schema.Literals(['Passed', 'Failed', 'Blocked']),
  reasons: Schema.Array(QualificationReason).check(Schema.isMaxLength(32)),
});
export type QualificationReceipt = typeof QualificationReceipt.Type;
export const decodeRequest = Schema.decodeUnknownEffect(QualificationRequest, strict);
export const decodeObservation = Schema.decodeUnknownEffect(CaseObservation, strict);
export const decodeCleanup = Schema.decodeUnknownEffect(CleanupObservation, strict);
export const decodeReceipt = Schema.decodeUnknownEffect(QualificationReceipt, strict);
