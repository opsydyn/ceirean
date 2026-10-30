import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Deferred, Effect, Fiber, FileSystem, Match, Schema } from 'effect';

import { persistCache } from '../src/cache-candidate.ts';
import { cacheLimits } from '../src/cache-download.ts';
import { composeOfflineCache } from '../src/current-cache-composition.ts';
import { verifyRetainedRegistryInputs } from '../src/current-cache-preparer.ts';

const oldBytes = new TextEncoder().encode('retained inert archive');
const newBytes = new TextEncoder().encode('new inert archive');
function artifact(name: string, bytes: Uint8Array) {
  return {
    identity: `${name}@1.0.0`,
    url: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
    integrity: 'sha512-' + new Bun.CryptoHasher('sha512').update(bytes).digest('base64'),
  };
}
const retained = artifact('retained', oldBytes);
const added = artifact('added', newBytes);
const metadata = [{ url: 'https://registry.npmjs.org/added', text: '{}' }];
const platform = Effect.provide(BunServices.layer);

async function composeOnlyMissing() {
  const requests: string[] = [];
  function request(url: string) {
    requests.push(url);
    return Promise.resolve(new Response(newBytes));
  }
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-composition-test-' });
    const parent = yield* fs.realPath(temporary);
    const base = `${parent}/base`;
    yield* fs.makeDirectory(base);
    yield* persistCache(base, [retained], [], () => Promise.resolve(new Response(oldBytes)));
    const result = yield* composeOfflineCache(
      `${parent}/output`,
      { root: base, artifacts: [retained] },
      [retained, added],
      metadata,
      request,
    );
    expect(requests).toEqual([added.url]);
    expect(result).toMatchObject({
      activation: 'Blocked',
      reused: 1,
      downloaded: 1,
      artifacts: 2,
      registryBytes: oldBytes.length + newBytes.length,
    });
    expect(yield* fs.readFile(`${base}/artifacts/0000.tgz`)).toEqual(oldBytes);
    expect(yield* fs.readFile(`${result.candidate}/artifacts/0000.tgz`)).toEqual(newBytes);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, platform));
}
test(
  'composition reuses retained bytes, downloads only the delta and verifies the complete new cache',
  composeOnlyMissing,
);

async function noDeltaNoNetwork() {
  function request() {
    return Promise.reject(new Error('no missing archive may be requested'));
  }
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-no-delta-' });
    const parent = yield* fs.realPath(temporary);
    const base = `${parent}/base`;
    yield* fs.makeDirectory(base);
    yield* persistCache(base, [retained], [], () => Promise.resolve(new Response(oldBytes)));
    return yield* composeOfflineCache(
      `${parent}/output`,
      { root: base, artifacts: [retained] },
      [retained],
      [],
      request,
    );
  }
  const workflow = Effect.gen(run);
  const result = await Effect.runPromise(workflow.pipe(Effect.scoped, platform));
  expect(result).toMatchObject({ reused: 1, downloaded: 0, artifacts: 1 });
}
test('complete retained input sets compose with no registry requests', noDeltaNoNetwork);

async function cancelledAcquisition() {
  const started = Deferred.makeUnsafe<void>();
  let observed: AbortSignal | null | undefined;
  function request(_url: string, init: RequestInit) {
    observed = init.signal;
    Deferred.doneUnsafe(started, Effect.void);
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject('aborted'), { once: true });
    });
  }
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-cancel-composition-' });
    const parent = yield* fs.realPath(temporary);
    const base = `${parent}/base`;
    const output = `${parent}/output`;
    yield* fs.makeDirectory(base);
    yield* persistCache(base, [retained], [], () => Promise.resolve(new Response(oldBytes)));
    const composing = composeOfflineCache(
      output,
      { root: base, artifacts: [retained] },
      [added],
      [],
      request,
    );
    const fiber = yield* Effect.forkScoped(composing);
    yield* Deferred.await(started).pipe(Effect.timeout('1 second'));
    yield* Fiber.interrupt(fiber);
    expect(yield* fs.exists(output)).toBe(false);
    expect(yield* fs.readFile(`${base}/artifacts/0000.tgz`)).toEqual(oldBytes);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, platform));
  expect(observed?.aborted).toBe(true);
}
test(
  'cancelling composition aborts acquisition and removes only its owned partial output',
  cancelledAcquisition,
);

async function pendingDirectoryOwnership() {
  const started = Deferred.makeUnsafe<void>();
  const settled = Deferred.makeUnsafe<void>();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-pending-directory-' });
    const parent = yield* fs.realPath(temporary);
    const base = `${parent}/base`;
    const output = `${parent}/output`;
    const held = `${output}/offline/artifacts`;
    yield* fs.makeDirectory(base);
    yield* persistCache(base, [retained], [], () => Promise.resolve(new Response(oldBytes)));
    const requested = yield* Deferred.make<Parameters<typeof fs.makeDirectory>[1]>();
    // Model a native callback that outlives its interrupted caller, behind the FS service.
    function* completeDirectory() {
      const options = yield* Deferred.await(requested).pipe(Effect.timeout('2 seconds'));
      yield* Effect.promise(() => gate);
      yield* fs.makeDirectory(held, options);
      yield* Deferred.succeed(settled, undefined);
    }
    const nativeCompletion = Effect.gen(completeDirectory);
    yield* Effect.forkScoped(nativeCompletion);
    function makeDirectory(path: string, options?: Parameters<typeof fs.makeDirectory>[1]) {
      function* waitForDirectory() {
        yield* Deferred.succeed(requested, options);
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(settled).pipe(Effect.timeout('2 seconds'));
      }
      const creating = Effect.gen(waitForDirectory);
      return Match.value(path === held).pipe(
        Match.when(true, () => creating),
        Match.orElse(() => fs.makeDirectory(path, options)),
      );
    }
    const withDirectoryBoundary = Effect.provideService(FileSystem.FileSystem, {
      ...fs,
      makeDirectory,
    });
    const composing = composeOfflineCache(
      output,
      { root: base, artifacts: [retained] },
      [retained],
      [],
      () => Promise.reject(new Error('no fetch')),
    ).pipe(withDirectoryBoundary);
    const fiber = yield* Effect.forkScoped(composing);
    yield* Deferred.await(started).pipe(Effect.timeout('1 second'));
    const interrupting = Fiber.interrupt(fiber);
    const interrupter = yield* Effect.forkScoped(interrupting);
    yield* Effect.sleep('20 millis');
    const existedWhileNativePending = yield* fs.exists(output);
    yield* Effect.sync(release);
    yield* Deferred.await(settled).pipe(Effect.timeout('1 second'));
    yield* Fiber.await(fiber);
    yield* Fiber.await(interrupter);
    return {
      existedWhileNativePending,
      existsAfterSettlement: yield* fs.exists(output),
      source: yield* fs.readFile(`${base}/artifacts/0000.tgz`),
    };
  }
  const workflow = Effect.gen(run);
  const result = await Effect.runPromise(workflow.pipe(Effect.scoped, platform));
  expect(result.existedWhileNativePending).toBe(true);
  expect(result.existsAfterSettlement).toBe(false);
  expect(result.source).toEqual(oldBytes);
}
test(
  'cancelling directory creation drains native mkdir before removing owned output',
  pendingDirectoryOwnership,
);

async function reservedAggregateBudget() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const reserved = cacheLimits.totalBytes - newBytes.length + 1;
    const checking = persistCache(
      root,
      [added],
      [],
      () => Promise.resolve(new Response(newBytes)),
      reserved,
    ).pipe(Effect.result);
    const result = yield* checking;
    expect(result._tag).toBe('Failure');
    expect(yield* fs.exists(`${root}/artifacts/0000.tgz`)).toBe(false);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, platform));
}
test(
  'retained bytes count against the same aggregate archive budget before delta persistence',
  reservedAggregateBudget,
);

async function replacedRetainedManifest() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped();
    const root = yield* fs.realPath(temporary);
    yield* fs.writeFileString(`${root}/inventory.json`, '{}');
    yield* fs.writeFileString(`${root}/preparation.json`, '{}');
    const result = yield* verifyRetainedRegistryInputs(root, {}).pipe(Effect.result);
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'InventoryError', code: 'InputChanged' },
    });
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, platform));
}
test(
  'retained manifests cannot self-assert a new source or trusted readback identity',
  replacedRetainedManifest,
);

for (const fault of ['changed', 'symlink', 'hardlink', 'download', 'collision']) {
  async function refusesUnsafeInput() {
    let requests = 0;
    function request() {
      requests++;
      return Promise.resolve(new Response('wrong bytes'));
    }
    function* run() {
      const fs = yield* FileSystem.FileSystem;
      const temporary = yield* fs.makeTempDirectoryScoped({
        prefix: 'ceirean-composition-negative-',
      });
      const parent = yield* fs.realPath(temporary);
      const base = `${parent}/base`;
      const output = `${parent}/output`;
      yield* fs.makeDirectory(base);
      yield* persistCache(base, [retained], [], () => Promise.resolve(new Response(oldBytes)));
      const path = `${base}/artifacts/0000.tgz`;
      function* changed() {
        yield* fs.writeFileString(path, 'changed');
      }
      function* link() {
        yield* fs.rename(path, `${base}/original.tgz`);
        yield* Match.value(fault).pipe(
          Match.when('symlink', () => fs.symlink(`${base}/original.tgz`, path)),
          Match.orElse(() => fs.link(`${base}/original.tgz`, path)),
        );
      }
      function* collision() {
        yield* fs.makeDirectory(output);
        yield* fs.writeFileString(`${output}/keep`, 'existing');
      }
      yield* Match.value(fault).pipe(
        Match.when('changed', () => Effect.gen(changed)),
        Match.when(Schema.is(Schema.Literals(['symlink', 'hardlink'])), () => Effect.gen(link)),
        Match.when('collision', () => Effect.gen(collision)),
        Match.orElse(() => fs.exists(base)),
      );
      const result = yield* composeOfflineCache(
        output,
        { root: base, artifacts: [retained] },
        [added],
        metadata,
        request,
      ).pipe(Effect.result);
      expect(result._tag).toBe('Failure');
      expect(yield* fs.exists(base)).toBe(true);
      const isCollision = Schema.is(Schema.Literal('collision'));
      expect(yield* fs.exists(output)).toBe(isCollision(fault));
      const isDownload = Schema.is(Schema.Literal('download'));
      const expectedRequests = Number(isDownload(fault));
      expect(requests).toBe(expectedRequests);
    }
    const workflow = Effect.gen(run);
    await Effect.runPromise(workflow.pipe(Effect.scoped, platform));
  }
  test(
    `composition refuses ${fault} without changing retained inputs or deleting foreign output`,
    refusesUnsafeInput,
  );
}
