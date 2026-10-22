import { Result, Schema } from 'effect';

import { NonNegativeSafeInteger } from './identities.ts';

const Identifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/));
const Slug = Schema.String.check(
  Schema.isMaxLength(256),
  Schema.isPattern(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/),
);
const GitSha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const ExactVersion = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
);
const PositiveInteger = NonNegativeSafeInteger.check(Schema.isGreaterThan(0));
const DisallowedSegments = new Set(['', '.', '..']);
function validSegment(part: string) {
  return !DisallowedSegments.has(part);
}
function printable(value: string) {
  return Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
}
function normalizedPath(path: string) {
  return !path.includes('\\') && printable(path) && path.split('/').every(validSegment);
}
const Path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter(normalizedPath),
);
const Paths = Schema.Array(Path).check(Schema.isMaxLength(128), Schema.isUnique());
const Targets = Schema.Struct({
  fromFoldkit: ExactVersion,
  foldkit: ExactVersion,
  vitePlugin: ExactVersion,
  effect: ExactVersion,
});
const Limits = Schema.Struct({
  durationMs: PositiveInteger,
  maxRepairAttempts: NonNegativeSafeInteger,
  maxActiveRuns: PositiveInteger,
  cpuCores: PositiveInteger,
  memoryBytes: PositiveInteger,
  pidLimit: PositiveInteger,
  writableBytes: PositiveInteger,
  commandOutputBytes: PositiveInteger,
  artifactBytes: PositiveInteger,
});
const Pointer = Schema.Literals([
  '/dependencies/foldkit',
  '/devDependencies/foldkit',
  '/peerDependencies/foldkit',
  '/dependencies/@foldkit~1vite-plugin',
]);
const Scope = Schema.Struct({
  manifests: Schema.Array(
    Schema.Struct({
      path: Path,
      allowedJsonPointers: Schema.Array(Pointer).check(
        Schema.isMinLength(1),
        Schema.isUnique(),
        Schema.isMaxLength(4),
      ),
    }),
  ).check(Schema.isMaxLength(128)),
  sourceRules: Schema.Array(
    Schema.Struct({
      path: Path,
      rule: Schema.Literals(['CarouselLiftAccessor', 'PromoTemplatePins']),
    }),
  ).check(Schema.isMaxLength(128)),
  generatedPaths: Paths,
  documentationPaths: Paths,
  forbiddenPaths: Paths,
  allowedFoldkitPeerRange: Schema.Literal('>=0.165.0 <0.167.0'),
}).check(
  Schema.makeFilter((scope) => {
    const paths = [
      ...scope.manifests.map((m) => m.path),
      ...scope.sourceRules.map((r) => r.path),
      ...scope.generatedPaths,
      ...scope.documentationPaths,
      ...scope.forbiddenPaths,
    ];
    return paths.length <= 128 && new Set(paths).size === paths.length;
  }),
);
const ArgvToken = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1024),
  Schema.makeFilter(printable),
);
const Check = Schema.Struct({
  id: Identifier,
  cwd: Schema.Union([Schema.Literal('.'), Path]),
  argv: Schema.Array(ArgvToken).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
});
const Journey = Schema.Struct({
  id: Identifier,
  path: Schema.String.check(
    Schema.isMaxLength(512),
    Schema.isPattern(/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
  ),
  interactions: Schema.Array(Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32),
    Schema.isUnique(),
  ),
  viewports: Schema.Array(Schema.Struct({ width: PositiveInteger, height: PositiveInteger })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
  ),
});

export const DraftReplayProfile = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  profileId: Identifier,
  status: Schema.Literal('Draft'),
  repository: Schema.Struct({ slug: Slug, baseSha: GitSha }),
  targets: Targets,
  host: Schema.Struct({
    provider: Schema.Literal('ColimaDocker'),
    profile: Schema.Literal('ceirean'),
    qualification: Schema.Literal('Unqualified'),
  }),
  publication: Schema.Literal('Disabled'),
  limits: Limits,
  scope: Scope,
  checks: Schema.Array(Check).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
    Schema.makeFilter((checks) => new Set(checks.map((c) => c.id)).size === checks.length),
  ),
  journeys: Schema.Array(Journey).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    Schema.makeFilter((journeys) => new Set(journeys.map((j) => j.id)).size === journeys.length),
  ),
  qualification: Schema.Struct({
    image: Schema.Literal('Unqualified'),
    toolchain: Schema.Literal('Unqualified'),
    acceptance: Schema.Literal('Unqualified'),
    execution: Schema.Literal('Unqualified'),
    modelPolicy: Schema.Literal('Unqualified'),
  }),
});
export type DraftReplayProfile = typeof DraftReplayProfile.Type;

export const ReplayRequest = Schema.Struct({
  mode: Schema.Literal('InspectOnly'),
  repository: Slug,
  baseSha: GitSha,
  targets: Targets,
});
export type ReplayRequest = typeof ReplayRequest.Type;

export const ProfileProblem = Schema.Union([
  Schema.TaggedStruct('InvalidProfile', {}),
  Schema.TaggedStruct('InvalidRequest', {}),
  Schema.TaggedStruct('RepositoryMismatch', {}),
  Schema.TaggedStruct('BaseMismatch', {}),
  Schema.TaggedStruct('TargetsMismatch', {}),
]);
export type ProfileProblem = typeof ProfileProblem.Type;

export function decodeDraftProfile(
  input: unknown,
): Result.Result<DraftReplayProfile, ProfileProblem> {
  return Schema.decodeUnknownResult(DraftReplayProfile, { onExcessProperty: 'error' })(input).pipe(
    Result.mapError(() => ({ _tag: 'InvalidProfile' })),
  );
}

export function decodeReplayRequest(input: unknown): Result.Result<ReplayRequest, ProfileProblem> {
  return Schema.decodeUnknownResult(ReplayRequest, { onExcessProperty: 'error' })(input).pipe(
    Result.mapError(() => ({ _tag: 'InvalidRequest' })),
  );
}
