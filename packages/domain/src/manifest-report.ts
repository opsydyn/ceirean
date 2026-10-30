import { Data, Schema } from 'effect';

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));
const ObjectId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const Path = Text.check(Schema.isPattern(/^(?:[a-zA-Z0-9_-]+\/)*package\.json$/));
const Repository = Text.check(Schema.isPattern(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/));
const Evidence = { path: Path, blobId: ObjectId, sha256: Digest };
const RootPath = Schema.Literal('package.json');
export const ManifestInspectionInput = Schema.Struct({
  repository: Repository,
  commit: ObjectId,
  manifests: Schema.Array(Schema.Struct({ ...Evidence, document: Schema.Unknown })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.makeFilter(
      (ms) =>
        new Set(ms.map((m) => m.path)).size === ms.length &&
        ms.some((m) => Schema.is(RootPath)(m.path)),
    ),
  ),
});
export type ManifestInspectionInput = typeof ManifestInspectionInput.Type;

const Dependency = Schema.Struct({
  section: Schema.Literals([
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]),
  name: Text,
  declared: Text,
  catalog: Schema.NullOr(
    Schema.Struct({
      name: Schema.NullOr(Text),
      sourcePath: Schema.Literal('package.json'),
      declaration: Text,
    }),
  ),
});
export const ManifestDeclarationReport = Schema.TaggedStruct('ManifestDeclarationReport', {
  schemaVersion: Schema.Literal(1),
  repository: Repository,
  commit: ObjectId,
  provenance: Schema.Literal('LocalGitObjects'),
  coverage: Schema.Array(Path).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isUnique(),
  ),
  toolchain: Schema.Struct({
    packageManager: Schema.optionalKey(Text),
    engines: Schema.Record(Text, Text),
  }),
  manifests: Schema.Array(
    Schema.Struct({ ...Evidence, packageName: Text, dependencies: Schema.Array(Dependency) }),
  ),
});
export type ManifestDeclarationReport = typeof ManifestDeclarationReport.Type;
export class ManifestInspectionError extends Data.TaggedError('ManifestInspectionError')<{
  readonly code: 'InvalidSource' | 'InvalidManifest' | 'InvalidCatalog' | 'MissingCatalog';
}> {}
