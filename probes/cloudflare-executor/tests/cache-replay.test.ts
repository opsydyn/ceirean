import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Schema } from 'effect';

import { frozenMetadata } from '../src/cache-metadata.ts';
import { replayMetadata } from '../src/cache-replay.ts';
import { seedReplayMetadata } from '../src/npm-cache-store.ts';

const node = process.execPath;
async function replaysWithoutLock() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const cache = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-replay-test-' });
    yield* seedReplayMetadata(cache, yield* frozenMetadata());
    return yield* replayMetadata(cache, node);
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, BunServices.layer);
  const result = await Effect.runPromise(provided);
  expect(result).toMatchObject({
    activation: 'Blocked',
    profiles: [
      { profile: 'generated', selected: 41, excluded: 23 },
      { profile: 'viz-pure', selected: 0, excluded: 0 },
      { profile: 'viz-adapter', selected: 5, excluded: 0 },
    ],
  });
}
test(
  'npm resolves all inert profiles offline from no lockfile and exact minimal metadata',
  replaysWithoutLock,
  30000,
);
for (const kind of ['empty', 'missing-vite']) {
  async function refusesIncomplete() {
    function* run() {
      const fs = yield* FileSystem.FileSystem;
      const cache = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-replay-negative-' });
      const metadata = yield* frozenMetadata();
      const isMissingVite = Schema.is(Schema.Literal('missing-vite'));
      const isVite = Schema.is(Schema.Literal('vite'));
      const entries = metadata.filter((entry) => isMissingVite(kind) && !isVite(entry.name));
      yield* seedReplayMetadata(cache, entries);
      return yield* replayMetadata(cache, node);
    }
    const workflow = Effect.gen(run);
    const scoped = Effect.scoped(workflow);
    const checking = scoped.pipe(Effect.result);
    const provided = Effect.provide(checking, BunServices.layer);
    const result = await Effect.runPromise(provided);
    expect(result._tag).toBe('Failure');
  }
  test(`offline replay fails closed with ${kind} metadata cache`, refusesIncomplete, 30000);
}
