import { ManifestInspectionInput } from '@ceirean/domain';

import { foldkitManifestBaseline } from '../src/manifest-baseline.ts';

export function fakeManifestSource() {
  const manifests = foldkitManifestBaseline.paths.map((path, i) => ({
    path,
    blobId: 'b'.repeat(40),
    sha256: 'c'.repeat(64),
    document: { name: `fixture-${i}`, dependencies: { foldkit: '0.170.0' } },
  }));
  return ManifestInspectionInput.make({
    repository: foldkitManifestBaseline.repository,
    commit: foldkitManifestBaseline.commit,
    manifests,
  });
}
