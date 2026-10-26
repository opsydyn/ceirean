import { Schema } from 'effect';

import { GitSha, QualificationAdmission, QualificationRequest, Sha256 } from './contract.ts';

export const trustedToolLimits = { fileBytes: 201326592, totalBytes: 268435456 } as const;
export function trustedToolsFit(
  sizes: readonly number[],
  limits: { fileBytes: number; totalBytes: number } = trustedToolLimits,
) {
  const boundedLimits = Object.entries(limits).every(
    ([key, value]) =>
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= trustedToolLimits[key as keyof typeof trustedToolLimits],
  );
  return (
    boundedLimits &&
    sizes.length === 2 &&
    sizes.every((size) => Number.isSafeInteger(size) && size > 0 && size <= limits.fileBytes) &&
    sizes.reduce((total, size) => total + size, 0) <= limits.totalBytes
  );
}

// Worker-safe data only. Host acquisition (including Bun-only code) lives in inputs.ts.
export const FileDigest = Schema.Struct({
  path: Schema.String,
  mode: Schema.Literals(['100644', '100755']),
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 67108864 })),
  sha256: Sha256,
});
export const ToolDigest = Schema.Struct({
  ...FileDigest.fields,
  size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: trustedToolLimits.fileBytes })),
});
export const SourceDigest = Schema.Struct({
  path: Schema.String,
  mode: Schema.Literals(['100644', '100755']),
  objectId: GitSha,
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1048576 })),
  sha256: Sha256,
});
export const ArtifactDigest = Schema.Struct({
  identity: Schema.String,
  url: Schema.String,
  integrity: Schema.String,
  path: Schema.String,
  size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 67108864 })),
  sha256: Sha256,
});
export const ToolReadbacks = Schema.Struct({
  os: Schema.Literal('Linux'),
  git: Schema.Struct({
    path: Schema.Literals(['/usr/bin/git', '/bin/git']),
    version: Schema.String,
  }),
  docker: Schema.Struct({
    path: Schema.Literals(['/usr/bin/docker', '/usr/local/bin/docker']),
    version: Schema.String,
  }),
});
export const PreparedInputs = Schema.Struct({
  activation: Schema.Literal('Blocked'),
  root: Schema.String,
  admission: Schema.Struct({
    request: QualificationRequest,
    source: QualificationAdmission.fields.source,
  }),
  source: Schema.Struct({ files: Schema.Array(SourceDigest), sha256: Sha256 }),
  artifacts: Schema.Array(ArtifactDigest),
  catalog: Schema.Struct({
    path: Schema.Literal('catalog/inventory.lock'),
    sha256: Sha256,
    inputs: Schema.Array(FileDigest),
  }),
  tools: Schema.Struct({
    files: Schema.Array(ToolDigest),
    sha256: Sha256,
    lockBlob: GitSha,
    lockSha256: Sha256,
    nodeConfigSha256: Sha256,
  }),
  readbacks: ToolReadbacks,
});
export type PreparedInputs = typeof PreparedInputs.Type;
