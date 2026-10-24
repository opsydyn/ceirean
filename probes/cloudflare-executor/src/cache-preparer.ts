import { Console, Effect, Exit, FileSystem } from 'effect';

import {
  inspectCacheStorage,
  persistCache,
  storageLimits,
  verifyCache,
} from './cache-candidate.ts';
import { cacheLimits } from './cache-download.ts';
import { frozenMetadata } from './cache-metadata.ts';
import { replayMetadata } from './cache-replay.ts';
import { requireInventory } from './dependency-inventory.ts';
import { encodeInventory, frozenDependencyInventory } from './frozen-dependencies.ts';
import { sha256 } from './preparation.ts';

export function prepareCacheCandidates(
  request: (url: string, init: RequestInit) => Promise<Response>,
  node: string,
) {
  function* prepare() {
    yield* requireInventory(node.startsWith('/'), 'ResolutionRefused');
    const inventory = yield* frozenDependencyInventory();
    const metadata = yield* frozenMetadata();
    const fs = yield* FileSystem.FileSystem;
    const acquiring = fs.makeTempDirectory({ prefix: 'ceirean-cache-candidate-' });
    function release(output: string, exit: Exit.Exit<unknown, unknown>) {
      const cleanup = fs
        .remove(output, { recursive: true })
        .pipe(
          Effect.catch(() =>
            Console.error(
              encodeInventory({ _tag: 'PartialCacheCleanupUnconfirmed', directory: output }),
            ),
          ),
        );
      return Exit.match(exit, { onSuccess: () => Effect.void, onFailure: () => cleanup });
    }
    const output = yield* Effect.acquireRelease(acquiring, release);
    yield* fs.chmod(output, 0o700);
    yield* persistCache(output, inventory.artifacts, metadata, request);
    const replay = yield* replayMetadata(`${output}/npm-cache`, node);
    const verified = yield* verifyCache(output, inventory.artifacts, metadata);
    const report = {
      _tag: 'CacheCandidatesPrepared',
      directory: output,
      inventorySha256: yield* sha256(encodeInventory(inventory) + '\n'),
      limits: {
        ...cacheLimits,
        storage: storageLimits,
        metadataBytes: 16777216,
        metadataEntryBytes: 2097152,
      },
      ...verified,
      metadata: metadata.map(({ name, url, bytes, sha256 }) => ({ name, url, bytes, sha256 })),
      replay,
      provenance: {
        metadata: 'MinimalPinnedLockProjection',
        tarballs: 'FrozenRegistrySriVerified',
        runtime: 'LocalHostOnly',
      },
      blockers: [
        'BunCacheLayoutUnqualified',
        'LinuxInstallUnqualified',
        'NativePostinstallUnqualified',
        'PackedArtifactEquivalenceUnqualified',
        'BunXTscResolutionUnqualified',
        'BrowserBinaryUnqualified',
        'ArchiveExtractionUnqualified',
        'PrivateInvocationHostedUnverified',
        'FinalImageUnbuilt',
      ],
    } as const;
    const text = encodeInventory(report) + '\n';
    const writing = fs.writeFileString(`${output}/cache-manifest.json`, text, {
      flag: 'wx',
      mode: 0o600,
    });
    yield* Effect.uninterruptible(writing);
    const storageIncludingManifest = yield* inspectCacheStorage(output);
    return { ...report, storageIncludingManifest, manifestSha256: yield* sha256(text) };
  }
  const workflow = Effect.gen(prepare);
  const bounded = workflow.pipe(Effect.timeout('20 minutes'));
  const scoped = Effect.scoped(bounded);
  return scoped;
}
