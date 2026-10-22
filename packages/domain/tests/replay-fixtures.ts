export function validDraft() {
  return {
    schemaVersion: 1,
    profileId: 'foldkit-0166-replay',
    status: 'Draft',
    repository: {
      slug: 'opsydyn/fold-kit-experiments',
      baseSha: 'b7484cb46e66b162c8afddcfba235c9507b4f0ab',
    },
    targets: { fromFoldkit: '0.165.0', foldkit: '0.166.0', vitePlugin: '0.26.1', effect: '4.0.0' },
    host: { provider: 'ColimaDocker', profile: 'ceirean', qualification: 'Unqualified' },
    publication: 'Disabled',
    limits: {
      durationMs: 2700000,
      maxRepairAttempts: 2,
      maxActiveRuns: 1,
      cpuCores: 2,
      memoryBytes: 8589934592,
      pidLimit: 256,
      writableBytes: 21474836480,
      commandOutputBytes: 10485760,
      artifactBytes: 536870912,
    },
    scope: {
      manifests: [
        {
          path: 'apps/web/package.json',
          allowedJsonPointers: ['/dependencies/foldkit', '/dependencies/@foldkit~1vite-plugin'],
        },
        { path: 'apps/promo/package.json', allowedJsonPointers: ['/dependencies/foldkit'] },
        {
          path: 'packages/astro-foldkit/package.json',
          allowedJsonPointers: [
            '/devDependencies/foldkit',
            '/dependencies/@foldkit~1vite-plugin',
            '/peerDependencies/foldkit',
          ],
        },
        {
          path: 'packages/foldkit-viz/package.json',
          allowedJsonPointers: ['/devDependencies/foldkit', '/peerDependencies/foldkit'],
        },
      ],
      sourceRules: [
        { path: 'apps/web/src/apps/carousel/subscription.ts', rule: 'CarouselLiftAccessor' },
        { path: 'apps/promo/src/lib/example-project.ts', rule: 'PromoTemplatePins' },
      ],
      generatedPaths: ['bun.lock'],
      documentationPaths: [
        'packages/astro-foldkit/README.md',
        'packages/foldkit-viz/README.md',
        'docs/migrations/foldkit-0.166.md',
      ],
      forbiddenPaths: [
        '.github',
        'scripts',
        'AGENTS.md',
        'CLAUDE.md',
        'oxlint.config.ts',
        'tsconfig.json',
        'apps/web/tests',
        'packages/astro-foldkit/tests',
        'packages/foldkit-viz/tests',
      ],
      allowedFoldkitPeerRange: '>=0.165.0 <0.167.0',
    },
    checks: [
      { id: 'install', cwd: '.', argv: ['bun', 'install', '--frozen-lockfile'] },
      { id: 'check', cwd: '.', argv: ['bun', 'run', 'check'] },
      { id: 'typecheck', cwd: '.', argv: ['bun', 'typecheck'] },
      { id: 'test', cwd: '.', argv: ['bun', 'run', 'test'] },
      { id: 'build', cwd: '.', argv: ['bun', 'run', 'build'] },
      { id: 'storybook', cwd: 'apps/web', argv: ['bun', 'run', 'build-storybook'] },
    ],
    journeys: [
      {
        id: 'carousel',
        path: '/carousel',
        interactions: [
          'button-navigation',
          'pointer-drag-and-settle',
          'mobile-pointer-drag-and-settle',
        ],
        viewports: [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
        ],
      },
      {
        id: 'promo-line',
        path: '/examples/line',
        interactions: ['point-editing', 'generated-settings-consistency'],
        viewports: [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
        ],
      },
    ],
    qualification: {
      image: 'Unqualified',
      toolchain: 'Unqualified',
      acceptance: 'Unqualified',
      execution: 'Unqualified',
      modelPolicy: 'Unqualified',
    },
  };
}

export function validRequest() {
  const profile = validDraft();
  return {
    mode: 'InspectOnly',
    repository: profile.repository.slug,
    baseSha: profile.repository.baseSha,
    targets: { ...profile.targets },
  };
}
