import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Console, Effect, Fiber, FileSystem, Match } from 'effect';

import { put } from '../node_modules/npm/node_modules/cacache/lib/index.js';
import { persistCache, verifyCache } from '../src/cache-candidate.ts';
import { seedReplayMetadata, writeTarball } from '../src/npm-cache-store.ts';

const content = new TextEncoder().encode('inert tarball fixture, never extracted');
const artifact = {
  identity: 'fixture@1.0.0',
  url: 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz',
  integrity: 'sha512-' + new Bun.CryptoHasher('sha512').update(content).digest('base64'),
};
function request() {
  return Promise.resolve(new Response(content));
}
async function runCase(tamper: boolean) {
  function* exercise() {
    const fs = yield* FileSystem.FileSystem;
    const output = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-cache-fixture-' });
    yield* persistCache(output, [artifact], [], request);
    const bytes = Match.value(tamper).pipe(
      Match.when(true, () => new TextEncoder().encode('wrong')),
      Match.orElse(() => content),
    );
    yield* fs.writeFile(`${output}/artifacts/0000.tgz`, bytes);
    return yield* verifyCache(output, [artifact], []);
  }
  const workflow = Effect.gen(exercise);
  const scoped = Effect.scoped(workflow);
  const checking = scoped.pipe(Effect.result);
  const provided = Effect.provide(checking, BunServices.layer);
  return await Effect.runPromise(provided);
}
async function verifiedCandidate() {
  const result = await runCase(false);
  expect(result).toMatchObject({
    _tag: 'Success',
    success: { activation: 'Blocked', artifacts: 1, registryBytes: content.length },
  });
}
test(
  'candidate re-reads both blob and npm content cache without extracting code',
  verifiedCandidate,
);
async function changedCandidate() {
  const result = await runCase(true);
  expect(result._tag).toBe('Failure');
}
test('changed candidate blob is not accepted as verified', changedCandidate);

for (const kind of ['tarball', 'metadata']) {
  async function cancellationDrainsWrites() {
    let release = () => {};
    let started = () => {};
    let settled = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const beginning = new Promise<void>((resolve) => {
      started = resolve;
    });
    const ending = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const delayed: typeof put = (cache, key, data, options) => {
      started();
      return gate.then(() => put(cache, key, data, options)).finally(settled);
    };
    function* exercise() {
      const fs = yield* FileSystem.FileSystem;
      const parent = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-cache-write-race-' });
      const output = `${parent}/partial`;
      yield* fs.makeDirectory(output);
      const writing = Match.value(kind).pipe(
        Match.when('tarball', () =>
          writeTarball(output, artifact.url, content, artifact.integrity, delayed),
        ),
        Match.orElse(() =>
          seedReplayMetadata(
            output,
            [{ url: 'https://registry.npmjs.org/fixture', text: '{}' }],
            delayed,
          ),
        ),
      );
      const cleanup = fs
        .remove(output, { recursive: true })
        .pipe(Effect.catch(() => Console.error('cleanup failed')));
      const owned = writing.pipe(Effect.onExit(() => cleanup));
      const fiber = yield* Effect.forkChild(owned);
      yield* Effect.promise(() => beginning);
      const interrupting = Fiber.interrupt(fiber);
      const interrupter = yield* Effect.forkChild(interrupting);
      yield* Effect.sleep('20 millis');
      const existedWhilePending = yield* fs.exists(output);
      yield* Effect.sync(release);
      yield* Effect.promise(() => ending);
      yield* Fiber.await(fiber);
      yield* Fiber.await(interrupter);
      return { existedWhilePending, existsAfterSettlement: yield* fs.exists(output) };
    }
    const workflow = Effect.gen(exercise);
    const scoped = Effect.scoped(workflow);
    const provided = Effect.provide(scoped, BunServices.layer);
    const observed = await Effect.runPromise(provided);
    expect(observed).toEqual({ existedWhilePending: true, existsAfterSettlement: false });
  }
  test(
    `cancelling ${kind} persistence drains native writes before deleting partial cache`,
    cancellationDrainsWrites,
  );
}
