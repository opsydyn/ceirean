import { Result, Schema } from 'effect';

export const limits = {
  commandOutputBytes: 10485760,
  artifactBytes: 536870912,
  executionMs: 2700000,
  sessionMs: 3600000,
  cleanupMs: 900000,
  artifactCount: 64,
  commandCount: 64,
} as const;
export const strict = { onExcessProperty: 'error' } as const;
export const Identity = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/));
export const ArtifactName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/),
);
export const Timestamp = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const outputBytes = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: limits.commandOutputBytes }),
);
const artifactBytes = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: limits.artifactBytes }),
);
const byteLength = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: limits.artifactBytes }),
);
const duration = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: limits.executionMs }));
export const ProbeOutcome = Schema.Literals(['Feasible', 'Blocked', 'Inconclusive']);
export const CleanupStatus = Schema.Literals(['Confirmed', 'CleanupUnconfirmed']);
export const ProbeOperation = Schema.Literals([
  'Baseline',
  'NetworkDenial',
  'CancelTree',
  'Deadline',
  'Disconnect',
  'Isolation',
]);
export const ProbeRequest = Schema.Struct({
  sessionId: Identity,
  operationId: Identity,
  kind: ProbeOperation,
  sourceSha: Schema.Literal('b7484cb46e66b162c8afddcfba235c9507b4f0ab'),
  durationMs: duration,
  budget: Schema.Struct({ commandOutputBytes: outputBytes, artifactBytes }),
});
export type ProbeRequest = typeof ProbeRequest.Type;
export const ArtifactHeader = Schema.Struct({
  name: ArtifactName,
  entryType: Schema.Literal('File'),
  byteLength,
  claimedSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
export type ArtifactHeader = typeof ArtifactHeader.Type;
const artifacts = Schema.Array(ArtifactHeader).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(limits.artifactCount),
);
const commandOutput = Schema.Array(Schema.Struct({ commandId: Identity, byteLength })).check(
  Schema.isMaxLength(limits.commandCount),
);
export const ProbeManifest = Schema.Struct({
  sessionId: Identity,
  operationId: Identity,
  sourceSha: ProbeRequest.fields.sourceSha,
  activation: Schema.Literal('Blocked'),
  outcome: Schema.Literal('Blocked'),
  cleanup: CleanupStatus,
  integrity: Schema.Literal('Unverified'),
  artifacts,
  commandOutput,
});
export type ProbeManifest = typeof ProbeManifest.Type;
export const EvidenceLimits = Schema.Struct({
  request: ProbeRequest,
  commandOutputBytes: outputBytes,
  artifactBytes,
  requiredArtifacts: Schema.Array(ArtifactName).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(limits.artifactCount),
  ),
});
export type EvidenceLimits = typeof EvidenceLimits.Type;
export const decodeRequest = Schema.decodeUnknownResult(ProbeRequest, strict);
export const decodeHeader = Schema.decodeUnknownResult(ArtifactHeader, strict);
const decodeManifestShape = Schema.decodeUnknownResult(ProbeManifest, strict);

function validManifest(value: ProbeManifest) {
  const names = value.artifacts.map((artifact) => artifact.name);
  const commands = value.commandOutput.map((output) => output.commandId);
  const artifactTotal = value.artifacts.reduce((sum, artifact) => sum + artifact.byteLength, 0);
  const outputTotal = value.commandOutput.reduce((sum, output) => sum + output.byteLength, 0);
  return [
    new Set(names).size === names.length,
    new Set(commands).size === commands.length,
    artifactTotal + outputTotal <= limits.artifactBytes,
    value.commandOutput.every((output) => output.byteLength <= limits.commandOutputBytes),
  ].every(Boolean);
}

export function decodeManifest(input: unknown) {
  const decoded = decodeManifestShape(input);
  return decoded.pipe(Result.filterOrFail(validManifest, () => 'InvalidManifest' as const));
}
