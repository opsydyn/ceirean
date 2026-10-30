import { Console, Effect, Exit, FileSystem, Match } from 'effect';

import {
  inspectCacheStorage,
  persistCache,
  readCacheBlob,
  verifyCache,
} from './cache-candidate.ts';
import { planCacheUnion, type CacheArtifact } from './current-cache.ts';
import { requireInventory } from './dependency-inventory.ts';
import { seedReplayMetadata, writeTarball } from './npm-cache-store.ts';

export function composeOfflineCache(
  output: string,
  base: { readonly root: string; readonly artifacts: readonly CacheArtifact[] },
  requested: readonly CacheArtifact[],
  metadata: readonly { url: string; text: string }[],
  request: (url: string, init: RequestInit) => Promise<Response>,
) {
  function* compose() {
    const fs = yield* FileSystem.FileSystem;
    yield* requireInventory(
      output.startsWith('/') && (yield* fs.realPath(base.root)) === base.root,
    );
    const plan = yield* planCacheUnion(base.artifacts, requested);
    const retained = yield* verifyCache(base.root, base.artifacts, []);
    const creating = fs.makeDirectory(output, { mode: 0o700 }).pipe(Effect.map(() => output));
    yield* Effect.acquireRelease(creating, (directory, exit) =>
      Exit.match(exit, {
        onSuccess: () => Effect.void,
        onFailure: () =>
          fs
            .remove(directory, { recursive: true })
            .pipe(
              Effect.catch(() => Console.error('{"_tag":"PartialOfflineCacheCleanupUnconfirmed"}')),
            ),
      }),
    );
    const delta = `${output}/delta`;
    const creatingDelta = fs.makeDirectory(delta, { mode: 0o700 });
    yield* Effect.uninterruptible(creatingDelta);
    const acquiring = persistCache(delta, plan.missing, [], request, retained.registryBytes);
    const missing = yield* Match.value(plan.missing.length).pipe(
      Match.when(0, () => Effect.succeed([])),
      Match.orElse(() => acquiring),
    );
    const candidate = `${output}/offline`;
    const creatingArtifacts = fs.makeDirectory(`${candidate}/artifacts`, {
      recursive: true,
      mode: 0o700,
    });
    const creatingNpm = fs.makeDirectory(`${candidate}/npm-cache`, { mode: 0o700 });
    yield* Effect.uninterruptible(creatingArtifacts);
    yield* Effect.uninterruptible(creatingNpm);
    const locations = new Map([
      ...retained.entries.map((entry) => [entry.url, `${base.root}/${entry.path}`] as const),
      ...missing.map((entry) => [entry.url, `${delta}/${entry.path}`] as const),
    ]);
    for (const [index, artifact] of plan.artifacts.entries()) {
      const location = yield* Effect.fromNullishOr(locations.get(artifact.url));
      const bytes = yield* readCacheBlob(location);
      const integrity = 'sha512-' + new Bun.CryptoHasher('sha512').update(bytes).digest('base64');
      yield* requireInventory(integrity === artifact.integrity, 'InputChanged');
      const path = `${candidate}/artifacts/${String(index).padStart(4, '0')}.tgz`;
      const writing = fs.writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      yield* Effect.uninterruptible(writing);
      yield* writeTarball(`${candidate}/npm-cache`, artifact.url, bytes, artifact.integrity);
    }
    yield* seedReplayMetadata(`${candidate}/npm-cache`, metadata);
    const verified = yield* verifyCache(candidate, plan.artifacts, metadata);
    const storage = yield* inspectCacheStorage(output);
    return {
      ...verified,
      directory: output,
      candidate,
      reused: plan.reused,
      downloaded: plan.missing.length,
      storage,
    };
  }
  const workflow = Effect.gen(compose);
  return workflow.pipe(Effect.timeout('20 minutes'), Effect.scoped);
}
