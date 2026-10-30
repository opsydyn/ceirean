import { Effect, Option, Schema } from 'effect';

import { fromNpmLockWithVendors, requireInventory } from './dependency-inventory.ts';
import { digestBytes } from './payload.ts';

export const currentNpmSourceHashes = {
  'apps/promo/src/lib/example-project.ts':
    '73be279de5cda16bc22f7b1b889f91f551a28c18d881b43a22c0fb07e3194cc4',
  'apps/promo/src/lib/dataset-project.ts':
    'de3e063007f92bcd873fcd680add6f7d316caf8eacbaff0af63f1006e1d44540',
  'packages/foldkit-viz/package.json':
    'd5b465c9682465da7f2f4160fd1cf237609bca6ca56f5f4243fe09dfecfce16d',
  'packages/foldkit-viz/test/package-import-smoke.test.ts':
    '0166d2352645fed04dd33335122fc53c21f493acce7a8dbd633dd89ce4920579',
} as const;
const generatedViz = {
  path: 'vendor/foldkit-viz',
  manifest: { name: '@opsydyn/foldkit-viz', version: '0.14.1' },
};
const highlighting = {
  path: 'vendor/source-highlighting',
  manifest: {
    name: '@opsydyn/dataset-explorer',
    private: true,
    type: 'module',
    dependencies: {
      '@wooorm/starry-night': '3.11.0',
      'vscode-oniguruma': '2.0.1',
      '@types/hast': '3.0.5',
      foldkit: '0.170.0',
      effect: '4.1.0',
    },
  },
};
const packedViz = {
  path: 'vendor/foldkit-viz',
  manifest: {
    ...generatedViz.manifest,
    peerDependencies: { effect: '>=4.0.0 <5.0.0', foldkit: '>=0.167.0 <0.171.0' },
    peerDependenciesMeta: { effect: { optional: true }, foldkit: { optional: true } },
  },
};
const toolchain = { vite: '8.3.1', typescript: '6.0.3', '@foldkit/vite-plugin': '0.29.0' };
export const currentNpmProfiles = [
  {
    id: 'generated-common',
    vendors: [generatedViz, highlighting],
    manifest: {
      name: 'ceirean-current-generated-common',
      private: true,
      type: 'module',
      dependencies: {
        '@opsydyn/foldkit-viz': 'file:./vendor/foldkit-viz',
        '@opsydyn/dataset-explorer': 'file:./vendor/source-highlighting',
        foldkit: '0.170.0',
        effect: '4.1.0',
        fflate: '0.8.3',
        '@stackblitz/sdk': '1.11.0',
      },
      devDependencies: toolchain,
    },
  },
  {
    id: 'generated-datasets',
    vendors: [generatedViz],
    manifest: {
      name: 'ceirean-current-generated-datasets',
      private: true,
      type: 'module',
      dependencies: {
        '@opsydyn/foldkit-viz': 'file:./vendor/foldkit-viz',
        ...highlighting.manifest.dependencies,
      },
      devDependencies: toolchain,
    },
  },
  {
    id: 'viz-pure',
    vendors: [packedViz],
    manifest: {
      name: 'ceirean-current-viz-pure',
      private: true,
      dependencies: { '@opsydyn/foldkit-viz': 'file:./vendor/foldkit-viz' },
    },
  },
  {
    id: 'viz-adapter',
    vendors: [packedViz],
    manifest: {
      name: 'ceirean-current-viz-adapter',
      private: true,
      dependencies: {
        '@opsydyn/foldkit-viz': 'file:./vendor/foldkit-viz',
        foldkit: '0.169.0',
        effect: '4.0.0',
      },
    },
  },
] as const;
export type CurrentNpmProfile = (typeof currentNpmProfiles)[number];
const optionalPeer = Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) });
const optionalPeers = Schema.Record(Schema.String, optionalPeer);
const DependencyMaps = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  peerDependenciesMeta: Schema.optionalKey(optionalPeers),
});
const sameDependencyMaps = Schema.toEquivalence(DependencyMaps);
const Lock = Schema.Struct({ packages: Schema.Record(Schema.String, Schema.Unknown) });
export function fromCurrentNpmLock(input: unknown, profile: CurrentNpmProfile) {
  function* inspect() {
    const lock = yield* Schema.decodeUnknownEffect(Lock)(input);
    for (const [path, manifest] of [
      ['', profile.manifest],
      ...profile.vendors.map((vendor) => [vendor.path, vendor.manifest] as const),
    ] as const) {
      const actual = yield* Schema.decodeUnknownEffect(DependencyMaps)(lock.packages[path]);
      const expected = yield* Schema.decodeUnknownEffect(DependencyMaps)(manifest);
      yield* requireInventory(sameDependencyMaps(actual, expected), 'InputChanged');
    }
    const readVersion = Schema.decodeUnknownOption(Schema.Struct({ version: Schema.String }));
    function vendorRule({ path, manifest }: CurrentNpmProfile['vendors'][number]) {
      const versions = Option.match(readVersion(manifest), {
        onNone: () => [],
        onSome: ({ version }) => [version],
      });
      return { path, name: manifest.name, versions };
    }
    const vendors = profile.vendors.map(vendorRule);
    return yield* fromNpmLockWithVendors(input, vendors);
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
export function validateCurrentNpmSources(files: readonly { path: string; bytes: Uint8Array }[]) {
  function* inspect() {
    for (const [path, expected] of Object.entries(currentNpmSourceHashes)) {
      const bytes = files.find((file) => file.path === path)?.bytes ?? new Uint8Array();
      yield* requireInventory((yield* digestBytes(bytes)) === expected, 'InputChanged');
    }
    return currentNpmProfiles;
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
