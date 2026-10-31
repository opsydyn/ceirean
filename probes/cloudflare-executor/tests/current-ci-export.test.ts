import { expect, test } from 'bun:test';

import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';

import { preparePortableBunSeed } from '../src/current-bun-seed.ts';
import { exportCurrentCiSeed } from '../src/current-ci-export.ts';
import { CacheMetadata, makeCacheMetadata, sealCache } from '../src/linux-qualification/cache.ts';

const withPlatform = Effect.provide(NodeServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
async function retainedExport() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-ci-export-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.makeDirectory(`${root}/original`);
    yield* fs.writeFileString(`${root}/original/.hidden`, 'content', { mode: 0o644 });
    yield* fs.symlink('.hidden', `${root}/original/link`);
    const source = yield* sealCache(`${root}/original`);
    const portable = yield* preparePortableBunSeed(source, {
      root: `${root}/portable-bun-seed`,
      descriptorPath: `${root}/bun-seed-descriptor.json`,
    });
    const identity = {
      seedSha256: source.sha256,
      portableSeedSha256: portable.seed.sha256,
      descriptorSha256: portable.descriptor.sha256,
      descriptorBytes: portable.descriptor.bytes,
    };
    yield* fs.makeDirectory(`${root}/host`);
    yield* fs.copy(`${root}/portable-bun-seed`, `${root}/host/portable-bun-seed`);
    // Node's generic copy resolves symlinks; model Docker's verbatim link transport.
    yield* fs.chmod(`${root}/host/portable-bun-seed`, 0o700);
    yield* fs.remove(`${root}/host/portable-bun-seed/link`);
    yield* fs.symlink('.hidden', `${root}/host/portable-bun-seed/link`);
    const metadata = yield* CacheMetadata;
    yield* fs.chmod(
      `${root}/host/portable-bun-seed`,
      (yield* metadata.lstat(`${root}/portable-bun-seed`)).mode,
    );
    yield* fs.copyFile(`${root}/bun-seed-descriptor.json`, `${root}/host/bun-seed-descriptor.json`);
    const result = yield* exportCurrentCiSeed(`${root}/host`, `${root}/seed.tar.gz`, identity);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.seedSha256).toBe(portable.seed.sha256);
    const overwrite = yield* exportCurrentCiSeed(
      `${root}/host`,
      `${root}/seed.tar.gz`,
      identity,
    ).pipe(Effect.result);
    expect(overwrite._tag).toBe('Failure');
    const mismatch = yield* exportCurrentCiSeed(`${root}/host`, `${root}/bad.tar.gz`, {
      ...identity,
      descriptorSha256: '0'.repeat(64),
    }).pipe(Effect.result);
    expect(mismatch._tag).toBe('Failure');
    expect(yield* fs.exists(`${root}/bad.tar.gz`)).toBe(false);
    for (const path of ['original', 'portable-bun-seed', 'host/portable-bun-seed'])
      yield* fs.chmod(`${root}/${path}`, 0o700);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test(
  'retained export re-admits actual seed bytes and reads back a hidden-file and link-preserving archive',
  retainedExport,
);
