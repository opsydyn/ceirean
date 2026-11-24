import { allRules, jsPlugins } from '@opsydyn/oxlint-effect';
import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript'],
  jsPlugins: [...jsPlugins],
  rules: {
    ...allRules,
    // These exact adapters own platform access; model and protocol modules do not.
    'linteffect/no-node-platform-in-shared-code': [
      'error',
      {
        boundaryPaths: [
          'probes/cloudflare-executor/scripts/builder-stdin-platform.ts',
          'probes/cloudflare-executor/scripts/linux-replay-platform.ts',
          'probes/cloudflare-executor/scripts/linux-cache-platform.ts',
          'probes/cloudflare-executor/scripts/linux-control-platform.ts',
          'probes/bun-effect-flue/src/flue-probe.ts',
          'probes/bun-effect-flue/src/restart-child.ts',
          'probes/bun-effect-flue/tests/process.ts',
          'probes/flue-migration-tools/tests/checkout.ts',
          '**/*.test.ts',
        ],
      },
    ],
    'linteffect/no-process-env-direct-read': [
      'error',
      {
        boundaryPaths: ['probes/bun-effect-flue/tests/process.ts', '**/*.test.ts'],
        configPaths: [],
      },
    ],
    'linteffect/no-run-effect-outside-boundary': [
      'error',
      {
        effectVersion: 4,
        boundaryPaths: ['probes/bun-effect-flue/src/ledger.ts', '**/*.test.ts'],
      },
    ],
    'linteffect/no-hidden-effect-execution': [
      'error',
      {
        boundaryPaths: ['probes/bun-effect-flue/src/ledger.ts', '**/*.test.ts'],
      },
    ],
  },
  ignorePatterns: [
    // Vendored upstream source: see vendor/factory/PROVENANCE.md. Formatting or
    // --fix over it would destroy every hunk in patches/vendor-factory/.
    'vendor/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '.moon/cache/**',
    '.superpowers/**',
    '**/.local/**',
  ],
});
