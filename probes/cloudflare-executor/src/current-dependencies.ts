import { Console, Effect, Exit, FileSystem, Order, Schema } from 'effect';

import { inspectCacheStorage, persistCache, verifyCache } from './cache-candidate.ts';
import { currentBaseline } from './current-baseline.ts';
import { currentSourcePins, readCurrentSource } from './current-inputs.ts';
import {
  fromBunLock,
  fromBunLockWithWorkspaces,
  requireInventory,
} from './dependency-inventory.ts';
import { encodeInventory, readFrozenInputs } from './frozen-dependencies.ts';
import { digestBytes } from './payload.ts';

const workspacePaths = [
  ['astro-foldkit', 'packages/astro-foldkit'],
  ['dataset-explorer', 'packages/dataset-explorer'],
  ['effect-three', 'packages/effect-three'],
  ['effect-three-foldkit', 'packages/effect-three-foldkit'],
  ['effect-three-rapier', 'packages/effect-three-rapier'],
  ['effect-three-samples', 'packages/effect-three-samples'],
  ['effect-three-troika', 'packages/effect-three-troika'],
  ['foldkit-viz', 'packages/foldkit-viz'],
  ['promo', 'apps/promo'],
  ['tech-radar', 'apps/tech-radar'],
  ['tech-radar-infra', 'infra/tech-radar'],
  ['three-promo', 'apps/three-promo'],
  ['web', 'apps/web'],
] as const;
const workspaces = new Map(
  workspacePaths.map(([name, path]) => [`@opsydyn/${name}`, `@opsydyn/${name}@workspace:${path}`]),
);
const isLock = Schema.is(Schema.Literal('bun.lock'));

export function fromCurrentBunLock(input: unknown) {
  const workflow = fromBunLockWithWorkspaces(input, workspaces);
  return workflow;
}
export function uniqueCurrentArtifacts(
  entries: readonly { identity: string; url: string; integrity: string }[],
) {
  function* unique() {
    const artifacts = new Map<string, { identity: string; url: string; integrity: string }>();
    for (const entry of entries) {
      const previous = artifacts.get(entry.url);
      const sameArtifact = [
        previous?.integrity === entry.integrity,
        previous?.identity === entry.identity,
      ].every(Boolean);
      const noConflict = previous === undefined || sameArtifact;
      yield* requireInventory(noConflict);
      artifacts.set(entry.url, {
        identity: entry.identity,
        url: entry.url,
        integrity: entry.integrity,
      });
    }
    return [...artifacts.values()].sort((a, b) => Order.String(a.url, b.url));
  }
  const workflow = Effect.gen(unique);
  return workflow;
}
export function currentDependencyInventory(repository: string) {
  function* inspect() {
    const files = yield* readCurrentSource(repository);
    const lock = files.find(({ path }) => isLock(path));
    const lockBytes = lock?.bytes ?? new Uint8Array();
    const parse = Effect.try(() => Bun.JSON5.parse(new TextDecoder().decode(lockBytes)));
    const consumer = yield* fromCurrentBunLock(yield* parse);
    const frozen = yield* readFrozenInputs();
    const browserText = frozen.get('browser.bun.lock') ?? '';
    const browserParse = Effect.try(() => Bun.JSON5.parse(browserText));
    const browser = yield* fromBunLock(yield* browserParse);
    const artifacts = yield* uniqueCurrentArtifacts([...consumer.selected, ...browser.selected]);
    yield* requireInventory(artifacts.length > 0 && artifacts.length <= 1024);
    return {
      _tag: 'CurrentRegistryInventory' as const,
      activation: 'Blocked' as const,
      source: currentSourcePins,
      lockSha256: yield* digestBytes(lockBytes),
      target: { os: 'linux', cpu: 'x64', libc: 'glibc' },
      toolchain: currentBaseline().toolchain,
      consumer: {
        selected: consumer.selected.length,
        excluded: consumer.excluded.length,
        workspaces: consumer.workspaces,
      },
      browser: {
        packages: browser.selected.length,
        inputSha256: yield* digestBytes(new TextEncoder().encode(browserText)),
      },
      artifacts,
      selection: 'ConservativeRegistrySet' as const,
      linuxInstall: 'Unqualified' as const,
      generatedNpmClosure: 'Pending' as const,
    };
  }
  const workflow = Effect.gen(inspect);
  const bounded = workflow.pipe(Effect.timeout('2 minutes'));
  return bounded;
}
export function prepareCurrentRegistryCandidates(
  repository: string,
  request: (url: string, init: RequestInit) => Promise<Response>,
) {
  function* prepare() {
    const inventory = yield* currentDependencyInventory(repository);
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* Effect.acquireRelease(
      fs.makeTempDirectory({ directory: '/private/tmp', prefix: 'ceirean-current-registry-' }),
      (directory, exit) =>
        Exit.match(exit, {
          onSuccess: () => Effect.void,
          onFailure: () =>
            fs
              .remove(directory, { recursive: true })
              .pipe(
                Effect.catch(() =>
                  Console.error('{"_tag":"PartialCurrentCacheCleanupUnconfirmed"}'),
                ),
              ),
        }),
    );
    yield* fs.chmod(directory, 0o700);
    yield* persistCache(directory, inventory.artifacts, [], request);
    const verified = yield* verifyCache(directory, inventory.artifacts, []);
    const inventoryText = encodeInventory(inventory);
    const inventoryBytes = new TextEncoder().encode(inventoryText);
    const receipt = {
      _tag: 'CurrentRegistryCandidatesPrepared' as const,
      image: 'Unbuilt' as const,
      directory,
      source: currentSourcePins,
      inventorySha256: yield* digestBytes(inventoryBytes),
      ...verified,
      blockers: [
        'GeneratedNpmClosurePending',
        'NpmMetadataReplayPending',
        'BunCacheLayoutUnqualified',
        'LinuxInstallUnqualified',
        'NativePostinstallUnqualified',
        'BrowserHarnessClosurePending',
        'TrustedBaselineWorkerPending',
        'FinalImageUnbuilt',
        'HostedActivationBlocked',
      ],
    };
    for (const [name, data] of [
      ['inventory.json', inventory],
      ['preparation.json', receipt],
    ] as const) {
      const writing = fs.writeFileString(`${directory}/${name}`, encodeInventory(data), {
        flag: 'wx',
        mode: 0o600,
      });
      yield* Effect.uninterruptible(writing);
    }
    const storage = yield* inspectCacheStorage(directory);
    return { ...receipt, storage };
  }
  const workflow = Effect.gen(prepare);
  return workflow.pipe(Effect.timeout('20 minutes'), Effect.scoped);
}
