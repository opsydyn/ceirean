export function manifestInput() {
  return {
    repository: 'opsydyn/fold-kit-experiments',
    commit: 'a'.repeat(40),
    manifests: [
      {
        path: 'package.json',
        blobId: 'b'.repeat(40),
        sha256: 'c'.repeat(64),
        document: {
          name: 'workspace',
          packageManager: 'bun@1.4.3',
          engines: { node: '>=22' },
          workspaces: {
            packages: ['packages/*'],
            catalog: { foldkit: '0.170.0', effect: '4.1.0' },
            catalogs: { default: { foldkit: '0.169.0' } },
          },
        },
      },
      {
        path: 'packages/example/package.json',
        blobId: 'd'.repeat(40),
        sha256: 'e'.repeat(64),
        document: {
          name: '@example/chart',
          dependencies: {
            foldkit: 'catalog:',
            effect: 'catalog:',
            alias: 'npm:other@1',
            sibling: 'workspace:*',
          },
          devDependencies: { foldkit: 'catalog:default' },
          peerDependencies: { foldkit: '>=0.169.0 <0.171.0' },
          optionalDependencies: { tool: '^1.0.0' },
        },
      },
    ],
  };
}
