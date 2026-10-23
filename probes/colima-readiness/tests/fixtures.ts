import type { ActivationManifest } from '../src/contracts.ts';

export const checkIds = [
  'EndpointOwnership',
  'HostIsolation',
  'ContainerRestrictions',
  'ResourceEnforcement',
  'NetworkDenial',
  'BrowserSandbox',
  'CancellationCleanup',
] as const;

export function manifestFixture(): ActivationManifest {
  return {
    _tag: 'ActivationManifest',
    manifestDigest: 'a'.repeat(64),
    profile: 'ceirean',
    identity: {
      endpoint: 'unix:///synthetic/ceirean.sock',
      daemonId: 'synthetic-daemon',
      imageDigest: `sha256:${'b'.repeat(64)}`,
      architecture: 'arm64',
      configurationDigest: 'c'.repeat(64),
      toolVersion: '1.0.0',
      browserVersion: '123.0.0',
    },
    durationMs: 1200000,
    cleanupReserveMs: 60000,
    limits: {
      cpuCores: 2,
      memoryBytes: 8589934592,
      pidLimit: 256,
      writableBytes: 21474836480,
      commandOutputBytes: 10485760,
      retainedEvidenceBytes: 134217728,
    },
    vm: { count: 1, cpuCores: 4, memoryBytes: 12884901888, diskBytes: 42949672960 },
    security: {
      maxContainers: 1,
      hostBinds: [],
      forwardAgent: false,
      dockerSocket: false,
      privileged: false,
      rootUser: false,
      readOnlyRoot: true,
      droppedCapabilities: ['ALL'],
      noNewPrivileges: true,
      seccompDigest: 'd'.repeat(64),
      hostPid: false,
      browserNoSandbox: false,
    },
    storage: { quotaBytes: 21474836480, temporaryBytes: 1048576, volumeBytes: 1048576 },
    network: {
      mode: 'none',
      dnsDestination: 'synthetic.invalid',
      ipDestination: '192.0.2.1',
      loopbackPort: 12345,
    },
    checks: checkIds.map((id) => ({ id, requiredArtifactIds: [`proof-${id}`] })),
    commands: checkIds.map((checkId) => ({
      id: `command-${checkId}`,
      checkId,
      executable: '/synthetic/probe',
      argv: ['probe', checkId],
      timeoutMs: 1000,
      outputBytes: 1048576,
    })),
    cleanupCommands: [
      {
        id: 'cleanup',
        executable: '/synthetic/probe',
        argv: ['probe', 'cleanup'],
        timeoutMs: 30000,
        outputBytes: 1048576,
      },
    ],
  };
}

export function diagnosticFixture() {
  const manifest = manifestFixture();
  const invocationId = ['synthetic', 'invocation'].join('-');
  const evidence = checkIds.map((checkId) => ({
    invocationId,
    manifestDigest: manifest.manifestDigest,
    identity: { ...manifest.identity },
    checkId,
    outcome: 'Pass' as const,
    reasons: [],
    artifacts: [{ id: `proof-${checkId}`, digest: 'e'.repeat(64), bytes: 1024, complete: true }],
  }));
  const cleanup = {
    _tag: 'Confirmed' as const,
    invocationId,
    manifestDigest: manifest.manifestDigest,
    identity: { ...manifest.identity },
    containersAbsent: true,
    volumesAbsent: true,
    vmStopped: true,
    unresolvedResourceIds: [],
    artifacts: [{ id: 'cleanup-proof', digest: 'f'.repeat(64), bytes: 1024, complete: true }],
  };
  return { manifest, invocationId, evidence, cleanup };
}

export function preflightFixture() {
  return {
    _tag: 'PreflightReport',
    profile: 'ceirean',
    canExecuteReplay: false,
    nativeReadiness: 'Unqualified',
    host: {
      architecture: { _tag: 'Unknown' },
      totalMemoryBytes: { _tag: 'Unknown' },
      freeMemoryBytes: { _tag: 'Unknown' },
      cpuCount: { _tag: 'Unknown' },
    },
    versions: [{ tool: 'Colima', status: 'Unavailable' }],
    config: {
      status: 'Missing',
      mounts: 'Unknown',
      forwardAgent: 'Unknown',
      proposedEndpoint: { _tag: 'Unknown' },
    },
    blockers: ['PrerequisiteUnavailable'],
    activationDraft: { _tag: 'Unresolved', missing: ['Image', 'DaemonIdentity', 'Commands'] },
  };
}
