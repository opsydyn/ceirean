import { Console, Effect, Exit, FileSystem } from 'effect';

import { inspectCacheStorage, verifyCache } from './cache-candidate.ts';
import { composeOfflineCache } from './current-cache-composition.ts';
import { currentOfflineCachePlan } from './current-cache.ts';
import { replayCurrentNpm } from './current-npm-frozen.ts';
import { requireInventory } from './dependency-inventory.ts';
import { encodeInventory } from './frozen-dependencies.ts';
import { sha256 } from './preparation.ts';
import { readBounded } from './runner-input.ts';

export const retainedRegistryPins = {
  inventory: '26e90c75b2816a07cf5df9733062ede37e46664a4b0bf4a4c255aa3932840fc7',
  receipt: 'a112fa5612987803ec9a15e3f36a965b8b3e6caa297daafdf0bbd2b3a7c4c0f1',
} as const;
export function verifyRetainedRegistryInputs(root: string, inventory: unknown) {
  function* verify() {
    const fs = yield* FileSystem.FileSystem;
    yield* requireInventory(
      root.startsWith('/') && (yield* fs.realPath(root)) === root,
      'InputChanged',
    );
    const text = yield* readBounded(`${root}/inventory.json`, 2097152);
    const receipt = yield* readBounded(`${root}/preparation.json`, 2097152);
    yield* requireInventory(
      (yield* sha256(text)) === retainedRegistryPins.inventory,
      'InputChanged',
    );
    yield* requireInventory(
      (yield* sha256(receipt)) === retainedRegistryPins.receipt,
      'InputChanged',
    );
    yield* requireInventory(
      (yield* sha256(encodeInventory(inventory))) === retainedRegistryPins.inventory,
      'InputChanged',
    );
  }
  const workflow = Effect.gen(verify);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
export function prepareCurrentOfflineCaches(
  repository: string,
  retainedRoot: string,
  node: string,
  request: (url: string, init: RequestInit) => Promise<Response>,
) {
  function* prepare() {
    const plan = yield* currentOfflineCachePlan(repository);
    yield* verifyRetainedRegistryInputs(retainedRoot, plan.base);
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* Effect.acquireRelease(
      fs.makeTempDirectory({ directory: '/private/tmp', prefix: 'ceirean-current-offline-' }),
      (directory, exit) =>
        Exit.match(exit, {
          onSuccess: () => Effect.void,
          onFailure: () =>
            fs
              .remove(directory, { recursive: true })
              .pipe(
                Effect.catch(() =>
                  Console.error('{"_tag":"CurrentOfflinePreparationCleanupUnconfirmed"}'),
                ),
              ),
        }),
    );
    yield* fs.chmod(directory, 0o700);
    const composed = yield* composeOfflineCache(
      `${directory}/cache`,
      { root: retainedRoot, artifacts: plan.base.artifacts },
      plan.artifacts,
      plan.metadata,
      request,
    );
    const replay = yield* replayCurrentNpm(`${composed.candidate}/npm-cache`, node);
    const readback = yield* verifyCache(composed.candidate, plan.artifacts, plan.metadata);
    const inventory = {
      _tag: 'CurrentOfflineCacheInventory' as const,
      activation: 'Blocked' as const,
      source: plan.base.source,
      target: plan.base.target,
      base: retainedRegistryPins,
      npmSnapshotSha256: plan.npmSnapshotSha256,
      artifacts: readback.entries,
      metadata: plan.metadata.map(({ name, url, bytes, sha256 }) => ({ name, url, bytes, sha256 })),
    };
    const inventoryText = encodeInventory(inventory);
    const missingUrls = new Set(plan.missing.map(({ url }) => url));
    const deltaEntries = readback.entries.filter(({ url }) => missingUrls.has(url));
    const downloadedBytes = deltaEntries.reduce((total, entry) => total + entry.bytes, 0);
    const report = {
      _tag: 'CurrentOfflineCachesPrepared' as const,
      activation: 'Blocked' as const,
      directory,
      candidate: composed.candidate,
      source: plan.base.source,
      inventorySha256: yield* sha256(inventoryText),
      artifacts: readback.artifacts,
      registryBytes: readback.registryBytes,
      reused: composed.reused,
      downloaded: composed.downloaded,
      downloadedBytes,
      metadata: plan.metadata.length,
      replay,
      inputStatus: 'PortableRegistryAndNpmCache' as const,
      linuxBunCache: 'Unmaterialized' as const,
      blockers: [
        'LinuxBunCacheWarmupRequired',
        'LinuxInstallUnqualified',
        'NativePostinstallUnqualified',
        'ArchiveExtractionUnqualified',
        'BrowserHarnessClosurePending',
        'NativeWorkerAdmissionPending',
        'FinalImageUnbuilt',
        'HostedActivationBlocked',
      ],
    };
    for (const [name, text] of [
      ['inventory.json', inventoryText],
      ['preparation.json', encodeInventory(report)],
    ] as const) {
      const writing = fs.writeFileString(`${directory}/${name}`, text, { flag: 'wx', mode: 0o600 });
      yield* Effect.uninterruptible(writing);
    }
    const storage = yield* inspectCacheStorage(directory);
    return { ...report, storage };
  }
  const workflow = Effect.gen(prepare);
  return workflow.pipe(Effect.timeout('25 minutes'), Effect.scoped);
}
