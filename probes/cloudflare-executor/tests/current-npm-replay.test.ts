import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Schema } from 'effect';

import {
  readCurrentNpmSnapshot,
  replayCurrentNpm,
  validateCurrentNpmSnapshot,
} from '../src/current-npm-frozen.ts';
import { resolveCurrentNpm } from '../src/current-npm-resolver.ts';
import { encodeInventory } from '../src/frozen-dependencies.ts';
import { seedReplayMetadata } from '../src/npm-cache-store.ts';

async function emptyCacheRefused() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const cache = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-current-empty-' });
    return yield* resolveCurrentNpm(cache, process.execPath);
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  const checking = scoped.pipe(Effect.result);
  const provided = Effect.provide(checking, BunServices.layer);
  const result = await Effect.runPromise(provided);
  expect(result._tag).toBe('Failure');
}
test('current npm resolution fails closed with an empty offline cache', emptyCacheRefused, 30000);

async function frozenReplay() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const cache = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-current-replay-' });
    const snapshot = yield* readCurrentNpmSnapshot();
    yield* seedReplayMetadata(cache, snapshot.metadata);
    return yield* replayCurrentNpm(cache, process.execPath);
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, BunServices.layer);
  const report = await Effect.runPromise(provided);
  expect(report).toMatchObject({
    activation: 'Blocked',
    network: 'OfflineWithNativeTripwire',
    scripts: 'Disabled',
    profiles: [
      { id: 'generated-common', selected: 48, excluded: 23 },
      { id: 'generated-datasets', selected: 46, excluded: 23 },
      { id: 'viz-pure', selected: 0, excluded: 0 },
      { id: 'viz-adapter', selected: 5, excluded: 0 },
    ],
  });
}
test(
  'all current profiles replay their complete frozen locks from metadata only',
  frozenReplay,
  30000,
);

async function missingViteRefused() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const cache = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-current-missing-' });
    const snapshot = yield* readCurrentNpmSnapshot();
    const isVite = Schema.is(Schema.Literal('vite'));
    const entries = snapshot.metadata.filter(({ name }) => !isVite(name));
    yield* seedReplayMetadata(cache, entries);
    return yield* replayCurrentNpm(cache, process.execPath);
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  const checking = scoped.pipe(Effect.result);
  const provided = Effect.provide(checking, BunServices.layer);
  const result = await Effect.runPromise(provided);
  expect(result._tag).toBe('Failure');
}
test(
  'current replay cannot fall back to the network when required Vite metadata is absent',
  missingViteRefused,
  30000,
);

async function changedCacheRefused() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const cache = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-current-tampered-' });
    const snapshot = yield* readCurrentNpmSnapshot();
    const isVite = Schema.is(Schema.Literal('vite'));
    const vite = snapshot.metadata.find(({ name }) => isVite(name))!;
    const codec = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
    const packument = yield* Schema.decodeUnknownEffect(codec)(vite.text);
    const text = encodeInventory({
      ...packument,
      description: 'tampered-without-changing-resolution',
    });
    const metadata = [...snapshot.metadata.filter(({ name }) => !isVite(name)), { ...vite, text }];
    yield* seedReplayMetadata(cache, metadata);
    return yield* replayCurrentNpm(cache, process.execPath);
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  const checking = scoped.pipe(Effect.result);
  const provided = Effect.provide(checking, BunServices.layer);
  const result = await Effect.runPromise(provided);
  expect(result._tag).toBe('Failure');
}
test(
  'replay authenticates cache packument bytes even when lock resolution is unchanged',
  changedCacheRefused,
  30000,
);

async function tamperedSnapshotRefused() {
  const reading = readCurrentNpmSnapshot();
  const provided = Effect.provide(reading, BunServices.layer);
  const snapshot = await Effect.runPromise(provided);
  const changed = encodeInventory({ ...snapshot, activation: 'Ready' });
  const checking = validateCurrentNpmSnapshot(changed).pipe(Effect.result);
  const result = await Effect.runPromise(checking);
  expect(result._tag).toBe('Failure');
}
test(
  'modified snapshots cannot become readiness or change pinned metadata',
  tamperedSnapshotRefused,
);
