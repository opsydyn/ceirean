import { expect, test } from 'bun:test';

import { BunFileSystem } from '@effect/platform-bun';
import { Arbitrary, Effect, FileSystem, Match, Result, Schema } from 'effect';

import {
  admitArchives,
  inspectArchive,
  archiveLimits,
} from '../src/linux-qualification/archives.ts';
import { goodTar, gzip, join, stage, tar } from './linux-archive-fixtures.ts';

const withTestPlatform = Effect.provide(BunFileSystem.layer);
async function inspect(
  raw: Uint8Array,
  limits: Parameters<typeof inspectArchive>[2] = archiveLimits,
  partition = 37,
) {
  const bytes = await gzip(raw);
  const chunks = Array.from({ length: Math.ceil(bytes.length / partition) }, (_, index) =>
    bytes.subarray(index * partition, (index + 1) * partition),
  );
  const result = await Effect.runPromise(
    inspectArchive(chunks, bytes.length, limits).pipe(Effect.result),
  );
  return result;
}
async function completeAdmission() {
  const bytes = await gzip(goodTar());
  function* verifyAdmission() {
    const inputs = yield* stage([bytes]);
    const admitted = yield* admitArchives(inputs);
    expect(admitted.summary).toMatchObject({ artifacts: 1, entries: 1, expandedBytes: 2048 });
    expect(admitted.read('/fixture-0/-/fixture-0-1.0.0.tgz')).toEqual(bytes);
    const fs = yield* FileSystem.FileSystem;
    expect(yield* fs.readDirectory(inputs.root)).toEqual(['artifacts']);
  }
  const workflow = Effect.gen(verifyAdmission);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
}
test('admits only complete archives and exposes no extracted files', completeAdmission);

for (const path of [
  '../outside',
  '/absolute',
  'package/../outside',
  'package//a',
  'package/./a',
  'package/a\\b',
  'C:/absolute',
  'package/%2e%2e/a',
  'package/a ',
  'package/a\n',
  'package/a:b',
]) {
  test(`refuses ambiguous destination ${path}`, async function verify() {
    expect(Result.isFailure(await inspect(tar([{ path, content: 'x' }])))).toBe(true);
  });
}
for (const type of [
  'SymbolicLink',
  'Link',
  'CharacterDevice',
  'BlockDevice',
  'FIFO',
  'ContiguousFile',
  'SparseFile',
  'ExtendedHeader',
  'GlobalExtendedHeader',
  'NextFileHasLongPath',
  'OldExtendedHeader',
  'SolarisACL',
]) {
  test(`refuses whole archive with ${type}`, async function verify() {
    const linkpath = Match.value(type.includes('Link')).pipe(
      Match.when(true, () => '../../outside'),
      Match.orElse(() => ''),
    );
    expect(
      Result.isFailure(
        await inspect(
          tar([
            { path: 'package/a', content: 'good' },
            {
              path: 'package/b',
              type,
              linkpath,
              content: 'x',
            },
          ]),
        ),
      ),
    ).toBe(true);
  });
}
async function conflictingPaths() {
  for (const entries of [
    [{ path: 'package/a' }, { path: 'package/a' }],
    [{ path: 'package/A' }, { path: 'package/a' }],
    [{ path: 'package/a' }, { path: 'package/a/b' }],
    [{ path: 'package/a/b' }, { path: 'package/a' }],
    [{ path: 'package/a/', type: 'Directory' }, { path: 'package/a' }],
  ])
    expect(Result.isFailure(await inspect(tar(entries)))).toBe(true);
}
test('refuses duplicate, case-folded and file-directory conflicts', conflictingPaths);
async function forbiddenMetadata() {
  for (const fields of [
    { uid: 1 },
    { uname: 'root' },
    { mode: 0o4644 },
    { mode: 0o2644 },
    { mode: 0o1644 },
    { type: 'Directory', size: 12 },
  ]) {
    expect(Result.isFailure(await inspect(tar([{ path: 'package/a', ...fields }])))).toBe(true);
  }
  const malformed = goodTar();
  malformed[0] = 255;
  expect(Result.isFailure(await inspect(malformed))).toBe(true);
}
test('refuses ownership, special modes and noncanonical headers', forbiddenMetadata);
async function tarFraming() {
  const padded = goodTar();
  padded[520] = 1;
  for (const raw of [
    goodTar().subarray(0, 600),
    goodTar().subarray(0, 1536),
    join([goodTar(), new Uint8Array(512)]),
    join([goodTar(), goodTar()]),
    padded,
  ]) {
    expect(Result.isFailure(await inspect(raw))).toBe(true);
  }
}
test('refuses truncated bodies, missing EOF, trailing tar and nonzero padding', tarFraming);
async function gzipFraming() {
  const bytes = await gzip(goodTar());
  const corrupt = new Uint8Array(bytes);
  corrupt[corrupt.length - 8] ^= 1;
  for (const raw of [
    goodTar(),
    bytes.subarray(0, bytes.length - 1),
    corrupt,
    join([bytes, new Uint8Array(8)]),
    join([bytes, await gzip(new Uint8Array())]),
    join([await gzip(new Uint8Array()), bytes]),
  ]) {
    const result = await Effect.runPromise(inspectArchive([raw], raw.length).pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
  }
}
test('refuses malformed, truncated, concatenated and trailing gzip', gzipFraming);
async function expansionCaps() {
  for (const limits of [
    { ...archiveLimits, expandedPackageBytes: 2047 },
    { ...archiveLimits, totalExpandedBytes: 2047 },
    { ...archiveLimits, expandedEntryBytes: 4 },
    { ...archiveLimits, pathBytes: 12 },
  ])
    expect(Result.isFailure(await inspect(goodTar(), limits))).toBe(true);
  const bomb = tar([{ path: 'package/meta', type: 'ExtendedHeader', content: 'x'.repeat(4096) }]);
  expect(
    Result.isFailure(await inspect(bomb, { ...archiveLimits, expandedPackageBytes: 1024 })),
  ).toBe(true);
  const many = tar(Array.from({ length: 3 }, (_, n) => ({ path: `package/a${n}` })));
  for (const limits of [
    { ...archiveLimits, packageEntries: 2 },
    { ...archiveLimits, totalEntries: 2 },
  ])
    expect(Result.isFailure(await inspect(many, limits))).toBe(true);
}
test(
  'reserves complete stream bytes, headers and skipped metadata against reduced caps',
  expansionCaps,
);
async function atomicAdmission() {
  const bytes = await gzip(goodTar());
  for (const change of ['hash', 'sri', 'size', 'path', 'aggregate', 'duplicate'] as const) {
    function* verifyAtomicAdmission() {
      const inputs = yield* stage([bytes, bytes]);
      const original = inputs.artifacts[1]!;
      const second = Match.value(change).pipe(
        Match.when('hash', () => ({ ...original, sha256: 'f'.repeat(64) })),
        Match.when('sri', () => ({ ...original, integrity: 'sha512-AAAA' })),
        Match.when('size', () => ({ ...original, size: bytes.length + 1 })),
        Match.when('path', () => ({ ...original, path: '../escape' })),
        Match.when('duplicate', () => ({ ...original, url: inputs.artifacts[0]!.url })),
        Match.orElse(() => original),
      );
      const next = { ...inputs, artifacts: [inputs.artifacts[0]!, second] };
      const operation = Match.value(change).pipe(
        Match.when('aggregate', () =>
          admitArchives(next, { ...archiveLimits, totalExpandedBytes: 4095 }),
        ),
        Match.orElse(() => admitArchives(next)),
      );
      expect(Result.isFailure(yield* Effect.result(operation))).toBe(true);
    }
    const workflow = Effect.gen(verifyAtomicAdmission);
    await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
  }
}
test(
  'all-or-nothing admission verifies exact bytes, totals and stage paths before replay',
  atomicAdmission,
);
async function archiveProperties() {
  const sample = Schema.Struct({
    size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 256 })),
    chunk: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 101 })),
  });
  async function law({ size, chunk }: typeof sample.Type) {
    const raw = tar([{ path: 'package/safe/file', content: 'x'.repeat(size) }]);
    const exact = {
      ...archiveLimits,
      expandedPackageBytes: raw.length,
      totalExpandedBytes: raw.length,
    };
    const admitted = await inspect(raw, exact, chunk);
    expect(admitted._tag).toBe('Success');
    expect(await inspect(raw, exact, 1)).toEqual(admitted);
    const value = Result.getOrThrow(admitted);
    expect(value.paths).toEqual(['package/safe/file']);
    expect(value.expandedBytes).toBe(raw.length);
    expect(
      Result.isFailure(await inspect(raw, { ...exact, totalExpandedBytes: raw.length - 1 }, chunk)),
    ).toBe(true);
    expect(
      Result.isFailure(
        await inspect(
          tar([{ path: 'package/../escape', content: 'x'.repeat(size) }]),
          exact,
          chunk,
        ),
      ),
    ).toBe(true);
    return true;
  }
  const checking = Arbitrary.checkEffect(
    Arbitrary.schema(sample),
    (value) => Effect.promise(() => law(value)),
    { seed: 31026, runs: 100, maxShrinks: 0 },
  );
  const result = await Effect.runPromise(checking);
  expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
}
test('100 fixed-seed chunk and boundary properties', archiveProperties);

async function emptyExtendedHeader() {
  const raw = tar([
    { path: 'package/metadata', type: 'ExtendedHeader' },
    { path: 'package/ok', content: 'allowed' },
  ]);
  expect(Result.isFailure(await inspect(raw))).toBe(true);
}
test(
  'refuses zero-size metadata even when the parser emits no metadata event',
  emptyExtendedHeader,
);

async function missingArtifact() {
  function* verify() {
    const bytes = yield* Effect.promise(() => gzip(goodTar()));
    const inputs = yield* stage([bytes]);
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(`${inputs.root}/${inputs.artifacts[0]!.path}`);
    expect((yield* Effect.result(admitArchives(inputs)))._tag).toBe('Failure');
  }
  const workflow = Effect.gen(verify);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
}
test('absent staged blob cannot be admitted or replayed', missingArtifact);
