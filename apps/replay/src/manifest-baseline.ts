import { ManifestInspectionInput } from '@ceirean/domain';
import { Schema } from 'effect';

const ManifestPath = Schema.String.check(Schema.isPattern(/^(?:[a-zA-Z0-9_-]+\/)*package\.json$/));
export const ManifestBaseline = Schema.Struct({
  repository: ManifestInspectionInput.fields.repository,
  commit: ManifestInspectionInput.fields.commit,
  paths: Schema.Array(ManifestPath).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isUnique(),
  ),
});
export type ManifestBaseline = typeof ManifestBaseline.Type;
export const foldkitManifestBaseline = ManifestBaseline.make({
  repository: 'opsydyn/fold-kit-experiments',
  commit: '1183e3c067f873fdd29f14f06030515929c1b956',
  paths: [
    'package.json',
    'apps/promo/package.json',
    'apps/tech-radar/package.json',
    'apps/three-promo/package.json',
    'apps/web/package.json',
    'infra/tech-radar/package.json',
    'packages/astro-foldkit/package.json',
    'packages/dataset-explorer/package.json',
    'packages/effect-three-foldkit/package.json',
    'packages/effect-three-rapier/package.json',
    'packages/effect-three-samples/package.json',
    'packages/effect-three-troika/package.json',
    'packages/effect-three/package.json',
    'packages/foldkit-viz/package.json',
  ],
});
export const manifestLimits = {
  perFile: 262144,
  source: 2097152,
  output: 262144,
  deadlineMs: 15000,
};
