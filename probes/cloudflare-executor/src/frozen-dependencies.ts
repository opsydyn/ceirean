import { Effect, Order, Schema } from 'effect';

import { fromBunLock, fromNpmLock, npmProfiles, requireInventory } from './dependency-inventory.ts';
import { dependencyPins } from './dependency-pins.ts';
import { reviewedInputs } from './pins.ts';
import { sha256 } from './preparation.ts';
import { readBounded } from './runner-input.ts';

export const inventoryDirectory = new URL('../fixtures/dependencies/', import.meta.url);
export const encodeInventory = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
export function readFrozenInputs(directory = inventoryDirectory) {
  function* read() {
    const texts = new Map<string, string>();
    for (const [name, expected] of Object.entries(dependencyPins.inputs)) {
      const path = decodeURIComponent(new URL(name, directory).pathname);
      const text = yield* readBounded(path, 2097152);
      yield* requireInventory((yield* sha256(text)) === expected, 'InputChanged');
      texts.set(name, text);
    }
    return texts;
  }
  const workflow = Effect.gen(read);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
export function frozenDependencyInventory(directory = inventoryDirectory) {
  function* inspect() {
    const texts = yield* readFrozenInputs(directory);
    function readBun(name: string) {
      const workflow = Effect.try(() => Bun.JSON5.parse(texts.get(name) ?? ''));
      return workflow;
    }
    const bun = yield* fromBunLock(yield* readBun('consumer.bun.lock'));
    const browser = yield* fromBunLock(yield* readBun('browser.bun.lock'));
    const npm = [];
    for (const profile of npmProfiles) {
      const raw = yield* decodeJson(texts.get(`npm-${profile.id}.lock`) ?? '');
      npm.push({ profile: profile.id, ...(yield* fromNpmLock(raw)) });
    }
    const unique = new Map<string, { identity: string; url: string; integrity: string }>();
    const selected = [
      ...bun.selected,
      ...browser.selected,
      ...npm.flatMap((profile) => profile.selected),
    ];
    for (const entry of selected) {
      const existing = unique.get(entry.url);
      yield* requireInventory(existing === undefined || existing.integrity === entry.integrity);
      unique.set(entry.url, {
        identity: entry.identity,
        url: entry.url,
        integrity: entry.integrity,
      });
    }
    const artifacts = [...unique.values()].sort((a, b) => Order.String(a.url, b.url));
    const fonts = bun.selected.filter(
      (entry) => entry.identity === dependencyPins.browser.fontIdentity,
    );
    yield* requireInventory(fonts.length === 1);
    return {
      _tag: 'DependencyInventoryFrozen',
      activation: 'Blocked',
      source: { revision: dependencyPins.sourceRevision, tree: dependencyPins.sourceTree },
      target: { os: 'linux', cpu: 'x64', libc: 'glibc' },
      selection: 'ConservativeRegistrySet',
      inputs: dependencyPins.inputs,
      toolchain: {
        bun: '1.3.11',
        node: '22.23.4',
        npm: dependencyPins.npm,
        git: '2.43.0',
        imageObservation: 'Unverified',
      },
      bun,
      npm,
      browser: {
        packages: browser,
        fonts,
        runtime: dependencyPins.browser,
        providedByImage: reviewedInputs.images.base,
        runtimeAcceptance: 'Unqualified',
      },
      artifacts,
      artifactBytes: 'Unmaterialized',
      blockers: [
        'LinuxInstallUnqualified',
        'NpmMetadataReplayUnqualified',
        'PackedArtifactEquivalenceUnqualified',
        'BunXTscResolutionUnqualified',
        'NativePostinstallUnqualified',
        'BrowserBinaryUnqualified',
        'CachesUnmaterialized',
        'PrivateInvocationHostedUnverified',
        'FinalImageUnbuilt',
      ],
    } as const;
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
