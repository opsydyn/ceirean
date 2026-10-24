export function request(operationId = 'operation-1') {
  return {
    sessionId: 'session-1',
    operationId,
    kind: 'Baseline',
    sourceSha: 'b7484cb46e66b162c8afddcfba235c9507b4f0ab',
    durationMs: 1000,
    budget: { commandOutputBytes: 10485760, artifactBytes: 536870912 },
  };
}

export function sessionConfig() {
  return { sessionId: 'session-1', startsAtMs: 0, executionDeadlineMs: 2700000, endsAtMs: 3600000 };
}

export function collectorLimits(commandOutputBytes = 10485760, artifactBytes = 536870912) {
  return {
    request: request(),
    commandOutputBytes,
    artifactBytes,
    requiredArtifacts: ['commands.json'],
  };
}

export function header(name = 'commands.json', byteLength = 1) {
  return { name, entryType: 'File', byteLength, claimedSha256: 'a'.repeat(64) };
}

export function manifest() {
  return {
    sessionId: 'session-1',
    operationId: 'operation-1',
    sourceSha: 'b7484cb46e66b162c8afddcfba235c9507b4f0ab',
    activation: 'Blocked',
    outcome: 'Blocked',
    cleanup: 'CleanupUnconfirmed',
    integrity: 'Unverified',
    artifacts: [header()],
    commandOutput: [],
  };
}
