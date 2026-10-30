import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Arbitrary, Effect, FileSystem, Result, Schema } from 'effect';

import {
  getInertArchiveOwnership,
  isInertArchiveOwnership,
} from '../src/inert-archive-ownership.ts';
import { inspectArchive } from '../src/linux-qualification/archives.ts';
import { gzip, tar } from './linux-archive-fixtures.ts';

const status = [
  'Uid:\t1000\t1000\t1000\t1000',
  'Gid:\t1000\t1000\t1000\t1000',
  'Groups:\t1000',
  'CapInh:\t0000000000000000',
  'CapPrm:\t0000000000000000',
  'CapEff:\t0000000000000000',
  'CapBnd:\t0000000000000000',
  'CapAmb:\t0000000000000000',
  'NoNewPrivs:\t1',
].join('\n');
const withPlatform = Effect.provide(BunServices.layer);
async function gatedOwnership() {
  const bytes = await gzip(tar([{ path: 'package/a', content: 'hello', uid: 501, gid: 20 }]));
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const kernel = `${root}/status`;
    yield* fs.writeFileString(kernel, status);
    const withKernel = Effect.provideService(FileSystem.FileSystem, {
      ...fs,
      readFileString: () => fs.readFileString(kernel),
    });
    const admitting = getInertArchiveOwnership().pipe(withKernel);
    const authority = yield* admitting;
    expect(isInertArchiveOwnership(authority)).toBe(true);
    expect(isInertArchiveOwnership({ uid: 1000, gid: 1000 })).toBe(false);
    const forged = { ...authority };
    expect(isInertArchiveOwnership(forged)).toBe(false);
    expect(Object.isFrozen(authority)).toBe(true);
    const counterfeit = yield* inspectArchive(
      [bytes],
      bytes.length,
      undefined,
      undefined,
      forged,
    ).pipe(Effect.result);
    expect(Result.isFailure(counterfeit)).toBe(true);
    const strict = yield* inspectArchive([bytes], bytes.length).pipe(Effect.result);
    expect(Result.isFailure(strict)).toBe(true);
    const inert = yield* inspectArchive(
      [bytes],
      bytes.length,
      undefined,
      undefined,
      authority,
    ).pipe(Effect.result);
    expect(Result.isSuccess(inert)).toBe(true);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withPlatform));
}
test('legacy IDs are inert only behind an unforgeable verified nonroot capability', gatedOwnership);
async function inertIdLaw() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const kernel = `${root}/status`;
    yield* fs.writeFileString(kernel, status);
    const withKernel = Effect.provideService(FileSystem.FileSystem, {
      ...fs,
      readFileString: () => fs.readFileString(kernel),
    });
    const authority = yield* getInertArchiveOwnership().pipe(withKernel);
    const idSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2097151 }));
    const ids = Arbitrary.schema(idSchema);
    const isRegularPath = Schema.is(Schema.Literal('package/a'));
    function checkId(uid: number) {
      function* check() {
        for (const entry of [
          { path: 'package/a', uid, gid: uid },
          { path: 'package/../outside', uid, gid: uid },
          { path: 'package/a', uid, gid: uid, uname: 'root' },
        ]) {
          const bytes = yield* Effect.promise(() => gzip(tar([entry])));
          const result = yield* inspectArchive(
            [bytes],
            bytes.length,
            undefined,
            undefined,
            authority,
          ).pipe(Effect.result);
          const expected = isRegularPath(entry.path) && !('uname' in entry);
          expect(Result.isSuccess(result)).toBe(expected);
          const strict = yield* inspectArchive([bytes], bytes.length).pipe(Effect.result);
          expect(Result.isFailure(strict)).toBe(true);
        }
        return true;
      }
      const workflow = Effect.gen(check);
      return workflow;
    }
    const result = yield* Arbitrary.checkEffect(ids, checkId, {
      seed: 501,
      runs: 100,
      maxShrinks: 100,
    });
    expect(result).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withPlatform));
}
test('seeded inert numeric IDs never relax paths, names or the strict default', inertIdLaw);
for (const bad of [
  status.replaceAll('1000', '0'),
  status.replace('CapEff:\t0000000000000000', 'CapEff:\t0000000000000001'),
  status.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0'),
  status + '\nUid:\t1000\t1000\t1000\t1000',
]) {
  async function rejectsUnsafeKernel() {
    function* run() {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const kernel = `${root}/status`;
      yield* fs.writeFileString(kernel, bad);
      const withKernel = Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        readFileString: () => fs.readFileString(kernel),
      });
      return yield* getInertArchiveOwnership().pipe(withKernel, Effect.result);
    }
    const workflow = Effect.gen(run);
    const result = await Effect.runPromise(workflow.pipe(Effect.scoped, withPlatform));
    expect(Result.isFailure(result)).toBe(true);
  }
  test(
    'root, retained capabilities, privilege escalation or duplicate kernel fields refuse',
    rejectsUnsafeKernel,
  );
}
