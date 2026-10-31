import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Arbitrary, Effect, FileSystem, Match, Result, Schema } from 'effect';

import * as Cache from '../src/linux-qualification/cache.ts';
import { digestBytes } from '../src/payload.ts';

const withPlatform = Effect.provide(BunServices.layer);
const withMetadata = Effect.provideService(Cache.CacheMetadata, Cache.makeCacheMetadata());
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const DescriptorData = Schema.Struct({
  schemaVersion: Schema.Number,
  policy: Schema.String,
  sourceSha256: Schema.String,
  sha256: Schema.String,
  materializedInventory: Schema.Array(Cache.CacheEntry),
  inventory: Schema.Array(Cache.CacheEntry),
});
const readDescriptor = Schema.decodeUnknownSync(DescriptorData);

function fixture() {
  function* prepare() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* Cache.CacheMetadata;
    const temporary = yield* fs.makeTempDirectoryScoped();
    const parent = yield* fs.realPath(temporary);
    function* restore() {
      const pending = [parent];
      while (pending.length > 0) {
        const root = pending.pop()!;
        yield* fs.chmod(root, 0o700);
        for (const name of yield* fs.readDirectory(root)) {
          const path = `${root}/${name}`;
          const info = yield* metadata.lstat(path);
          const isDirectory = Schema.is(Schema.Literal('Directory'));
          pending.push(...[path].filter(() => isDirectory(info.type)));
        }
      }
    }
    const restoring = Effect.gen(restore);
    const restored = restoring.pipe(Effect.result);
    const checked = restored.pipe(
      Effect.map((result) => expect(Result.isSuccess(result)).toBe(true)),
    );
    yield* Effect.addFinalizer(() => checked);
    const root = `${parent}/source`;
    yield* fs.makeDirectory(`${root}/nested`, { recursive: true, mode: 0o750 });
    yield* fs.writeFileString(`${root}/nested/data`, 'original');
    yield* fs.chmod(`${root}/nested/data`, 0o664);
    yield* fs.writeFileString(`${root}/.hidden`, 'hidden');
    yield* fs.symlink(`${root}/nested/data`, `${root}/absolute`);
    const source = yield* Cache.sealCache(root);
    const copy = yield* Cache.copyCaseCache(source, `${parent}/portable`);
    const portable = yield* Cache.sealPortableCase(source, copy);
    expect(yield* Cache.admitCaseCache(source, copy).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
    });
    return { fs, metadata, parent, source, portable };
  }
  const workflow = Effect.gen(prepare);
  return workflow;
}

function materialize(seed: Cache.SealedCache, destination: string) {
  function* copy() {
    const fs = yield* FileSystem.FileSystem;
    for (const entry of seed.inventory) {
      const path = `${destination}/${entry.path}`;
      const action = Match.value(entry).pipe(
        Match.when({ type: 'Directory' }, () =>
          fs.makeDirectory(path, { recursive: true, mode: 0o700 }),
        ),
        Match.when({ type: 'File' }, (file) => fs.copyFile(`${seed.root}/${file.path}`, path)),
        Match.when({ type: 'SymbolicLink' }, (link) => fs.symlink(link.target, path)),
        Match.exhaustive,
      );
      yield* action;
    }
    for (const entry of [...seed.inventory].reverse()) {
      const isLink = Schema.is(Schema.Literal('SymbolicLink'));
      const regular = Effect.succeed(!isLink(entry.type));
      yield* fs.chmod(`${destination}/${entry.path}`, entry.mode).pipe(Effect.when(regular));
    }
  }
  const workflow = Effect.gen(copy);
  return workflow;
}

async function durableTransfer() {
  expect(Cache).toHaveProperty('describePortableCache', expect.any(Function));
  expect(Cache).toHaveProperty('admitPortableCache', expect.any(Function));
  function* run() {
    const { fs, metadata, parent, source, portable } = yield* fixture();
    const description = yield* Cache.describePortableCache(portable, source);
    expect(description.sha256).toBe(yield* digestBytes(new TextEncoder().encode(description.text)));
    expect(description.text).not.toContain(parent);
    const destination = `${parent}/received`;
    yield* materialize(portable, destination);
    const reAdmitted = yield* Cache.admitPortableCache(
      destination,
      description.text,
      description.sha256,
    );
    expect(reAdmitted.sha256).toBe(portable.sha256);
    expect(yield* fs.readLink(`${destination}/absolute`)).toBe('nested/data');
    const original = yield* metadata.lstat(`${portable.root}/nested/data`);
    const fresh = yield* metadata.lstat(`${destination}/nested/data`);
    expect(original.ino === fresh.ino && original.dev === fresh.dev).toBe(false);
    expect((yield* Cache.verifySealedCache(reAdmitted)).sha256).toBe(portable.sha256);
    const counterfeit = yield* Cache.verifySealedCache({ ...portable }).pipe(Effect.result);
    expect(Result.isFailure(counterfeit)).toBe(true);
    const writable = yield* Cache.copyCaseCache(reAdmitted, `${parent}/consumer`);
    expect((yield* fs.stat(`${writable.root}/nested/data`)).mode & 0o777).toBe(0o664);
    yield* fs.writeFileString(`${writable.root}/nested/data`, 'consumer changed');
    expect((yield* Cache.verifySealedCache(reAdmitted)).sha256).toBe(portable.sha256);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test(
  'portable descriptors re-admit fresh identities without reviving serialized authority',
  durableTransfer,
);

async function rejectsTampering() {
  expect(Cache).toHaveProperty('describePortableCache', expect.any(Function));
  function* run() {
    const { fs, parent, source, portable } = yield* fixture();
    const invalidOrigin = yield* Cache.describePortableCache(source, source).pipe(Effect.result);
    expect(Result.isFailure(invalidOrigin)).toBe(true);
    const descriptor = yield* Cache.describePortableCache(portable, source);
    const destination = `${parent}/received`;
    yield* materialize(portable, destination);
    const wrongHash = yield* Cache.admitPortableCache(
      destination,
      descriptor.text,
      '0'.repeat(64),
    ).pipe(Effect.result);
    expect(Result.isFailure(wrongHash)).toBe(true);
    const oversized = yield* Cache.admitPortableCache(
      destination,
      ' '.repeat(67108865),
      descriptor.sha256,
    ).pipe(Effect.result);
    expect(Result.isFailure(oversized)).toBe(true);
    yield* fs.chmod(`${destination}/nested/data`, 0o644);
    yield* fs.writeFileString(`${destination}/nested/data`, 'tampered');
    yield* fs.chmod(`${destination}/nested/data`, 0o444);
    const changed = yield* Cache.admitPortableCache(
      destination,
      descriptor.text,
      descriptor.sha256,
    ).pipe(Effect.result);
    expect(Result.isFailure(changed)).toBe(true);
    const parsed = readDescriptor(decode(descriptor.text));
    const malformed = encode({ ...parsed, policy: 'Unknown' });
    const malformedHash = yield* digestBytes(new TextEncoder().encode(malformed));
    const badPolicy = yield* Cache.admitPortableCache(destination, malformed, malformedHash).pipe(
      Effect.result,
    );
    expect(Result.isFailure(badPolicy)).toBe(true);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test(
  'descriptor mismatch, oversized data, actual mutations and unknown policy fail closed',
  rejectsTampering,
);

async function mutationLaw() {
  expect(Cache).toHaveProperty('describePortableCache', expect.any(Function));
  function* run() {
    const { fs, parent, source, portable } = yield* fixture();
    const descriptor = yield* Cache.describePortableCache(portable, source);
    const destination = `${parent}/mutations`;
    yield* materialize(portable, destination);
    const ids = Arbitrary.schema(Schema.Int);
    function changed(id: number) {
      function* check() {
        yield* fs.chmod(`${destination}/nested/data`, 0o644);
        yield* fs.writeFileString(`${destination}/nested/data`, `changed-${id}`);
        yield* fs.chmod(`${destination}/nested/data`, 0o444);
        const result = yield* Cache.admitPortableCache(
          destination,
          descriptor.text,
          descriptor.sha256,
        ).pipe(Effect.result);
        return Result.isFailure(result);
      }
      const workflow = Effect.gen(check);
      return workflow;
    }
    expect(
      yield* Arbitrary.checkEffect(ids, changed, { seed: 31, runs: 100, maxShrinks: 100 }),
    ).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test('100 seeded payload substitutions cannot re-admit a qualified descriptor', mutationLaw);

async function rejectsFilesystemShapes() {
  function* run() {
    const { fs, metadata, parent, source, portable } = yield* fixture();
    const descriptor = yield* Cache.describePortableCache(portable, source);
    const mode = (yield* metadata.lstat(portable.root)).mode;
    const mutations = [
      (root: string) => fs.remove(`${root}/.hidden`),
      (root: string) => fs.writeFileString(`${root}/extra`, 'extra'),
      (root: string) => fs.chmod(`${root}/nested/data`, 0o4644),
      (root: string) =>
        fs
          .remove(`${root}/absolute`)
          .pipe(Effect.andThen(fs.symlink(`${root}/nested/data`, `${root}/absolute`))),
      (root: string) =>
        fs
          .remove(`${root}/absolute`)
          .pipe(Effect.andThen(fs.symlink(`${source.root}/nested/data`, `${root}/absolute`))),
    ];
    for (const [index, mutate] of mutations.entries()) {
      const destination = `${parent}/shape-${index}`;
      yield* materialize(portable, destination);
      yield* fs.chmod(destination, 0o700);
      yield* mutate(destination);
      yield* fs.chmod(destination, mode);
      const result = yield* Cache.admitPortableCache(
        destination,
        descriptor.text,
        descriptor.sha256,
      ).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }
    const alias = `${parent}/alias`;
    yield* fs.symlink(portable.root, alias);
    const aliased = yield* Cache.admitPortableCache(alias, descriptor.text, descriptor.sha256).pipe(
      Effect.result,
    );
    expect(Result.isFailure(aliased)).toBe(true);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test(
  'fresh intake rejects missing/extra entries, special modes, absolute/escaping links and root aliases',
  rejectsFilesystemShapes,
);
