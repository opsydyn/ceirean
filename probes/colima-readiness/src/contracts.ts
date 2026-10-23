import { Match, Schema } from 'effect';

const strict = { parseOptions: { onExcessProperty: 'error' } } as const;
export const readinessBounds = {
  durationMs: 1200000,
  cpuCores: 2,
  memoryBytes: 8589934592,
  pidLimit: 256,
  writableBytes: 21474836480,
  commandOutputBytes: 10485760,
  retainedEvidenceBytes: 134217728,
} as const;

const NonNegative = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const Positive = NonNegative.check(Schema.isGreaterThan(0));
const bounded = (maximum: number) => Positive.check(Schema.isLessThanOrEqualTo(maximum));
const Identifier = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/));
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Architecture = Schema.Literals(['arm64', 'x64']);
const Version = Schema.String.check(
  Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  Schema.isMaxLength(64),
);
const traversal = new Set(['.', '..']);
const canonical = (path: string) => !path.split('/').some((p) => traversal.has(p));
const AbsolutePath = Schema.String.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/),
  Schema.makeFilter(canonical),
);
const Endpoint = Schema.String.check(
  Schema.isPattern(/^unix:\/\/\/[A-Za-z0-9_./-]+\.sock$/),
  Schema.isMaxLength(512),
  Schema.makeFilter(canonical),
);
const Arg = Schema.String.check(
  Schema.isMaxLength(1024),
  Schema.isPattern(/^[\x20-\x7e]*$/),
  Schema.makeFilter((arg) => !/^--no-sandbox(?:=|$)/.test(arg)),
);
const Argv = Schema.Array(Arg).check(Schema.isMinLength(1), Schema.isMaxLength(64));
const Ids = Schema.Array(Identifier).check(Schema.isMaxLength(64), Schema.isUnique());
const Empty = Schema.Array(Schema.Never).check(Schema.isMaxLength(0));

export const CheckId = Schema.Literals([
  'EndpointOwnership',
  'HostIsolation',
  'ContainerRestrictions',
  'ResourceEnforcement',
  'NetworkDenial',
  'BrowserSandbox',
  'CancellationCleanup',
]);
export type CheckId = typeof CheckId.Type;
export const Reason = Schema.Literals([
  'PrerequisiteUnavailable',
  'InvalidConfiguration',
  'UnknownConfiguration',
  'UnsafeConfiguration',
  'IdentityMismatch',
  'CheckFailed',
  'CheckBlocked',
  'MissingEvidence',
  'OutputTruncated',
  'TimedOut',
  'Cancelled',
  'CleanupUnconfirmed',
  'LimitExceeded',
  'ActivationUnresolved',
]);
export type Reason = typeof Reason.Type;
const Reasons = Schema.Array(Reason).check(Schema.isUnique(), Schema.isMaxLength(14));

export const DiagnosticIdentity = Schema.Struct({
  endpoint: Endpoint,
  daemonId: Identifier,
  imageDigest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  architecture: Architecture,
  configurationDigest: Digest,
  toolVersion: Version,
  browserVersion: Version,
}).annotate(strict);

const commandFields = {
  id: Identifier,
  executable: AbsolutePath,
  argv: Argv,
  timeoutMs: bounded(readinessBounds.durationMs),
  outputBytes: bounded(readinessBounds.commandOutputBytes),
};
const Check = Schema.Struct({
  id: CheckId,
  requiredArtifactIds: Ids.check(Schema.isMinLength(1)),
});

const ManifestFields = Schema.TaggedStruct('ActivationManifest', {
  manifestDigest: Digest,
  profile: Schema.Literal('ceirean'),
  identity: DiagnosticIdentity,
  durationMs: bounded(readinessBounds.durationMs),
  cleanupReserveMs: bounded(readinessBounds.durationMs),
  limits: Schema.Struct({
    cpuCores: bounded(readinessBounds.cpuCores),
    memoryBytes: bounded(readinessBounds.memoryBytes),
    pidLimit: bounded(readinessBounds.pidLimit),
    writableBytes: bounded(readinessBounds.writableBytes),
    commandOutputBytes: bounded(readinessBounds.commandOutputBytes),
    retainedEvidenceBytes: bounded(readinessBounds.retainedEvidenceBytes),
  }),
  vm: Schema.Struct({
    count: Schema.Literal(1),
    cpuCores: Positive,
    memoryBytes: Positive,
    diskBytes: Positive,
  }),
  security: Schema.Struct({
    maxContainers: Schema.Literal(1),
    hostBinds: Empty,
    forwardAgent: Schema.Literal(false),
    dockerSocket: Schema.Literal(false),
    privileged: Schema.Literal(false),
    rootUser: Schema.Literal(false),
    readOnlyRoot: Schema.Literal(true),
    droppedCapabilities: Schema.Tuple([Schema.Literal('ALL')]),
    noNewPrivileges: Schema.Literal(true),
    seccompDigest: Digest,
    hostPid: Schema.Literal(false),
    browserNoSandbox: Schema.Literal(false),
  }),
  // quotaBytes is the aggregate writable allowance, including temporary and volume storage.
  storage: Schema.Struct({
    quotaBytes: bounded(readinessBounds.writableBytes),
    temporaryBytes: NonNegative,
    volumeBytes: NonNegative,
  }),
  network: Schema.Struct({
    mode: Schema.Literal('none'),
    dnsDestination: Schema.String.check(
      Schema.isPattern(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/),
    ),
    ipDestination: Schema.String.check(
      Schema.isPattern(/^(?:\d{1,3}\.){3}\d{1,3}$/),
      Schema.makeFilter((ip) => ip.split('.').every((part) => Number(part) <= 255)),
    ),
    loopbackPort: Positive.check(Schema.isLessThanOrEqualTo(65535)),
  }),
  checks: Schema.Array(Check).check(
    Schema.isMinLength(7),
    Schema.isMaxLength(7),
    Schema.makeFilter((checks) => new Set(checks.map((c) => c.id)).size === 7),
  ),
  commands: Schema.Array(Schema.Struct({ ...commandFields, checkId: CheckId })).check(
    Schema.isMinLength(7),
    Schema.isMaxLength(64),
  ),
  cleanupCommands: Schema.Array(Schema.Struct(commandFields)).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
  ),
});
function coherentManifest(m: typeof ManifestFields.Type) {
  const commands = [...m.commands, ...m.cleanupCommands];
  const diagnosticMs = m.commands.reduce((sum, c) => sum + c.timeoutMs, 0);
  const cleanupMs = m.cleanupCommands.reduce((sum, c) => sum + c.timeoutMs, 0);
  return [
    new Set(commands.map((c) => c.id)).size === commands.length,
    m.checks.every((check) => m.commands.some((command) => command.checkId === check.id)),
    diagnosticMs + m.cleanupReserveMs <= m.durationMs,
    cleanupMs <= m.cleanupReserveMs,
    commands.every((c) => c.outputBytes <= m.limits.commandOutputBytes),
    m.storage.quotaBytes <= m.limits.writableBytes,
    m.storage.temporaryBytes + m.storage.volumeBytes <= m.storage.quotaBytes,
  ].every(Boolean);
}
export const ActivationManifest = ManifestFields.check(
  Schema.makeFilter(coherentManifest),
).annotate(strict);
export type ActivationManifest = typeof ActivationManifest.Type;

export const ActivationApproval = Schema.TaggedStruct('ActivationApproval', {
  manifestDigest: Digest,
  startMs: NonNegative,
  deadlineMs: NonNegative,
})
  .check(
    Schema.makeFilter(
      (a) => a.deadlineMs > a.startMs && a.deadlineMs - a.startMs <= readinessBounds.durationMs,
    ),
  )
  .annotate(strict);

export const Artifact = Schema.Struct({
  id: Identifier,
  digest: Digest,
  bytes: NonNegative.check(Schema.isLessThanOrEqualTo(readinessBounds.retainedEvidenceBytes)),
  complete: Schema.Boolean,
});
const Artifacts = Schema.Array(Artifact).check(
  Schema.isMaxLength(64),
  Schema.makeFilter((artifacts) => new Set(artifacts.map((a) => a.id)).size === artifacts.length),
);
const bindingFields = {
  invocationId: Identifier,
  manifestDigest: Digest,
  identity: DiagnosticIdentity,
};
export const CheckEvidence = Schema.Struct({
  ...bindingFields,
  checkId: CheckId,
  outcome: Schema.Literals(['Pass', 'Fail', 'Blocked']),
  reasons: Reasons,
  artifacts: Artifacts,
})
  .check(
    Schema.makeFilter((e) =>
      Match.value(e.outcome).pipe(
        Match.when('Pass', () => e.reasons.length === 0),
        Match.orElse(() => e.reasons.length > 0),
      ),
    ),
  )
  .annotate(strict);
export type CheckEvidence = typeof CheckEvidence.Type;

export const CleanupEvidence = Schema.Union([
  Schema.TaggedStruct('Confirmed', {
    ...bindingFields,
    containersAbsent: Schema.Literal(true),
    volumesAbsent: Schema.Literal(true),
    vmStopped: Schema.Literal(true),
    unresolvedResourceIds: Empty,
    artifacts: Artifacts,
  }),
  Schema.TaggedStruct('Unresolved', {
    ...bindingFields,
    unresolvedResourceIds: Ids,
    artifacts: Artifacts,
  }),
]).annotate(strict);
export type CleanupEvidence = typeof CleanupEvidence.Type;

const unknown = Schema.TaggedStruct('Unknown', {});
const knownNumber = Schema.Union([unknown, Schema.TaggedStruct('Known', { value: NonNegative })]);
export const PreflightReport = Schema.TaggedStruct('PreflightReport', {
  profile: Schema.Literal('ceirean'),
  canExecuteReplay: Schema.Literal(false),
  nativeReadiness: Schema.Literal('Unqualified'),
  host: Schema.Struct({
    architecture: Schema.Union([unknown, Schema.TaggedStruct('Known', { value: Architecture })]),
    totalMemoryBytes: knownNumber,
    freeMemoryBytes: knownNumber,
    cpuCount: knownNumber,
  }),
  versions: Schema.Array(
    Schema.Union([
      Schema.Struct({
        tool: Schema.Literals(['Colima', 'Docker']),
        status: Schema.Literal('Available'),
        version: Version,
      }),
      Schema.Struct({
        tool: Schema.Literals(['Colima', 'Docker']),
        status: Schema.Literals(['Unavailable', 'Invalid', 'TimedOut', 'Truncated']),
      }),
    ]),
  ).check(
    Schema.isMaxLength(2),
    Schema.makeFilter((v) => new Set(v.map((t) => t.tool)).size === v.length),
  ),
  config: Schema.Struct({
    status: Schema.Literals(['Read', 'Missing', 'Unreadable', 'Invalid', 'Unsupported']),
    mounts: Schema.Literals(['Disabled', 'Enabled', 'Unknown']),
    forwardAgent: Schema.Literals(['Disabled', 'Enabled', 'Unknown']),
    proposedEndpoint: Schema.Union([
      unknown,
      Schema.TaggedStruct('Proposed', { endpoint: Endpoint }),
    ]),
  }),
  blockers: Reasons,
  activationDraft: Schema.TaggedStruct('Unresolved', {
    missing: Schema.Array(
      Schema.Literals([
        'Image',
        'DaemonIdentity',
        'Commands',
        'Security',
        'Storage',
        'Network',
        'VmAllocation',
        'Budgets',
        'Cleanup',
        'Approval',
      ]),
    ).check(Schema.isMinLength(1), Schema.isUnique(), Schema.isMaxLength(10)),
  }),
}).annotate(strict);
export type PreflightReport = typeof PreflightReport.Type;

const sameIdentity = Schema.toEquivalence(DiagnosticIdentity);
function completeArtifacts(artifacts: ReadonlyArray<typeof Artifact.Type>) {
  return artifacts.length > 0 && artifacts.every((a) => a.complete && a.bytes > 0);
}
function failed(e: CheckEvidence) {
  return Match.value(e.outcome).pipe(
    Match.when('Fail', () => true),
    Match.orElse(() => false),
  );
}
function blocked(e: CheckEvidence) {
  return Match.value(e.outcome).pipe(
    Match.when('Blocked', () => true),
    Match.orElse(() => false),
  );
}

// This decides diagnostic completeness only; it never creates operational authority.
export function diagnosticOutcome(
  m: ActivationManifest,
  invocationId: string,
  evidence: ReadonlyArray<CheckEvidence>,
  cleanup: CleanupEvidence,
) {
  const bound = (e: CheckEvidence | CleanupEvidence) =>
    e.invocationId === invocationId &&
    e.manifestDigest === m.manifestDigest &&
    sameIdentity(e.identity, m.identity);
  const checksComplete =
    evidence.length === 7 &&
    new Set(evidence.map((e) => e.checkId)).size === 7 &&
    m.checks.every((check) =>
      evidence.some(
        (e) =>
          e.checkId === check.id &&
          check.requiredArtifactIds.every((id) =>
            e.artifacts.some((a) => a.id === id && a.complete && a.bytes > 0),
          ),
      ),
    );
  const artifacts = [...evidence.flatMap((e) => e.artifacts), ...cleanup.artifacts];
  const complete =
    checksComplete &&
    evidence.every((e) => bound(e) && completeArtifacts(e.artifacts)) &&
    bound(cleanup) &&
    Schema.is(CleanupEvidence.members[0])(cleanup) &&
    completeArtifacts(cleanup.artifacts) &&
    artifacts.reduce((sum, a) => sum + a.bytes, 0) <= m.limits.retainedEvidenceBytes;
  return Match.value({
    complete,
    failed: evidence.some(failed),
    blocked: evidence.some(blocked),
  }).pipe(
    Match.when({ complete: false }, () => 'Blocked' as const),
    Match.when({ failed: true }, () => 'Fail' as const),
    Match.when({ blocked: true }, () => 'Blocked' as const),
    Match.orElse(() => 'Pass' as const),
  );
}

export const DiagnosticReport = Schema.TaggedStruct('DiagnosticReport', {
  canExecuteReplay: Schema.Literal(false),
  evidenceBoundary: Schema.Literal('DiagnosticOnly'),
  manifest: ActivationManifest,
  invocationId: Identifier,
  evidence: Schema.Array(CheckEvidence).check(Schema.isMaxLength(7)),
  cleanup: CleanupEvidence,
  outcome: Schema.Literals(['Pass', 'Fail', 'Blocked']),
})
  .check(
    Schema.makeFilter(
      (r) => r.outcome === diagnosticOutcome(r.manifest, r.invocationId, r.evidence, r.cleanup),
    ),
  )
  .annotate(strict);
export type DiagnosticReport = typeof DiagnosticReport.Type;

export const ReadinessProblem = Schema.TaggedStruct('ReadinessProblem', {
  code: Schema.Literals([
    'InvalidManifest',
    'InvalidApproval',
    'InvalidClock',
    'ApprovalMismatch',
    'OutsideWindow',
    'InsufficientBudget',
    'InvalidEvidence',
  ]),
});
