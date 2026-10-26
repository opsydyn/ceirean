import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Match, Result, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import {
  CacheMetadata,
  makeCacheMetadata,
  admitCaseCache,
  cacheLimits,
  copyCaseCache,
  sealCache,
  verifySealedCache,
  type CacheEntry,
} from '../src/linux-qualification/cache.ts';

const withPlatform = Effect.provide(BunServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const isDirectory = Schema.is(Schema.Literal('Directory'));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const byPath = (path: string) => (entry: CacheEntry) => entry.path === path;
const canonicalEntry = ({ path, mode, ...entry }: CacheEntry) => ({ path, mode, ...entry });

function makeFifo(path: string) {
  function* create() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make('/usr/bin/mkfifo', [path]);
    expect(Number(yield* spawner.exitCode(command))).toBe(0);
  }
  const workflow = Effect.gen(create);
  return workflow;
}

function fixture() {
  function* prepare() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-cache-test-' });
    const parent = yield* fs.realPath(temporary);
    function restore() {
      function* permissions() {
        const pending = [parent];
        while (pending.length > 0) {
          const directory = pending.pop()!;
          yield* fs.chmod(directory, 0o700);
          for (const name of yield* fs.readDirectory(directory)) {
            const path = `${directory}/${name}`;
            const info = yield* metadata.lstat(path);
            const directories = isDirectory(info.type);
            const additions = [path].filter(() => directories);
            pending.push(...additions);
          }
        }
      }
      const workflow = Effect.gen(permissions);
      const restoring = workflow.pipe(Effect.result);
      const checked = restoring.pipe(Effect.map((result) => expect(result._tag).toBe('Success')));
      return checked;
    }
    yield* Effect.addFinalizer(restore);
    const root = `${parent}/seed`;
    yield* fs.makeDirectory(`${root}/opaque`, { recursive: true });
    yield* fs.chmod(root, 0o750);
    yield* fs.chmod(`${root}/opaque`, 0o755);
    yield* fs.writeFileString(`${root}/opaque/data.bin`, 'abc');
    yield* fs.chmod(`${root}/opaque/data.bin`, 0o640);
    yield* fs.writeFileString(`${root}/.opaque-state`, 'bookkeeping');
    yield* fs.chmod(`${root}/.opaque-state`, 0o600);
    yield* fs.writeFileString(`${root}/opaque/tool`, 'inert executable bytes');
    yield* fs.chmod(`${root}/opaque/tool`, 0o755);
    return { fs, metadata, parent, root };
  }
  const workflow = Effect.gen(prepare);
  return workflow;
}

async function inventoriesRealFiles() {
  function* check() {
    const { fs, root, parent } = yield* fixture();
    yield* fs.symlink('opaque/data.bin', `${root}/relative`);
    yield* fs.symlink(`${root}/opaque/data.bin`, `${root}/absolute`);
    const seed = yield* sealCache(root);
    expect(seed.materializedInventory.map((entry) => entry.path)).toEqual([
      '.',
      '.opaque-state',
      'absolute',
      'opaque',
      'opaque/data.bin',
      'opaque/tool',
      'relative',
    ]);
    const materializedFile = seed.materializedInventory.find(byPath('opaque/data.bin'));
    expect(materializedFile).toEqual({
      type: 'File',
      path: 'opaque/data.bin',
      mode: 0o640,
      size: 3,
      sha256: hash('abc'),
    });
    expect(seed.inventory.find(byPath('opaque/data.bin'))?.mode).toBe(0o440);
    expect(seed.inventory.find(byPath('.'))?.mode).toBe(0o550);
    expect((yield* fs.stat(`${root}/opaque/tool`)).mode & 0o7777).toBe(0o555);
    const canonical = seed.inventory.map(canonicalEntry);
    const serialized = encodeJson(canonical);
    expect(seed.sha256).toBe(hash(serialized));
    expect(Object.isFrozen(seed.inventory)).toBe(true);
    const copy = yield* copyCaseCache(seed, `${parent}/case-a`);
    expect(copy.seedSha256).toBe(seed.sha256);
    expect(copy.inventory.find(byPath('opaque/data.bin'))?.mode).toBe(0o640);
    expect(yield* fs.readLink(`${copy.root}/absolute`)).toBe('opaque/data.bin');
    expect(yield* fs.realPath(`${copy.root}/absolute`)).toBe(`${copy.root}/opaque/data.bin`);
    expect((yield* admitCaseCache(seed, copy)).sha256).toBe(copy.sha256);
    expect((yield* verifySealedCache(seed)).sha256).toBe(seed.sha256);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'inventories opaque bytes and all mode transitions and rebases internal cache links',
  inventoriesRealFiles,
);

async function acceptsPreDotFile(name: string) {
  function* check() {
    const { fs, root, parent } = yield* fixture();
    yield* fs.writeFileString(`${root}/${name}`, 'punctuation bytes');
    yield* fs.chmod(`${root}/${name}`, 0o600);
    const seed = yield* sealCache(root);
    expect(seed.inventory.map((entry) => entry.path)).toEqual([
      name,
      '.',
      '.opaque-state',
      'opaque',
      'opaque/data.bin',
      'opaque/tool',
    ]);
    const canonicalSeed = seed.inventory.map(canonicalEntry);
    const seedJson = encodeJson(canonicalSeed);
    expect(seed.sha256).toBe(hash(seedJson));
    const copy = yield* copyCaseCache(seed, `${parent}/case-a`);
    expect((yield* admitCaseCache(seed, copy)).sha256).toBe(copy.sha256);
    expect(yield* fs.readFileString(`${copy.root}/${name}`)).toBe('punctuation bytes');
    const canonicalCopy = copy.inventory.map(canonicalEntry);
    const copyJson = encodeJson(canonicalCopy);
    expect(copy.sha256).toBe(hash(copyJson));
    expect((yield* verifySealedCache(seed)).sha256).toBe(seed.sha256);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test.each(['!opaque', '-state'])(
  'seals, copies, and admits a punctuation file sorting before root: %s',
  acceptsPreDotFile,
);

async function acceptsPreDotDirectory(name: string) {
  function* check() {
    const { fs, root, parent } = yield* fixture();
    yield* fs.makeDirectory(`${root}/${name}`);
    yield* fs.chmod(`${root}/${name}`, 0o755);
    yield* fs.writeFileString(`${root}/${name}/data.bin`, 'punctuation bytes');
    yield* fs.chmod(`${root}/${name}/data.bin`, 0o600);
    yield* fs.symlink(name, `${root}/alias`);
    const seed = yield* sealCache(root);
    expect(seed.inventory.map((entry) => entry.path)).toEqual([
      name,
      `${name}/data.bin`,
      '.',
      '.opaque-state',
      'alias',
      'opaque',
      'opaque/data.bin',
      'opaque/tool',
    ]);
    const canonicalSeed = seed.inventory.map(canonicalEntry);
    const seedJson = encodeJson(canonicalSeed);
    expect(seed.sha256).toBe(hash(seedJson));
    const copy = yield* copyCaseCache(seed, `${parent}/case-a`);
    expect((yield* admitCaseCache(seed, copy)).sha256).toBe(copy.sha256);
    expect(yield* fs.realPath(`${copy.root}/alias`)).toBe(`${copy.root}/${name}`);
    expect(yield* fs.readFileString(`${copy.root}/alias/data.bin`)).toBe('punctuation bytes');
    const canonicalCopy = copy.inventory.map(canonicalEntry);
    const copyJson = encodeJson(canonicalCopy);
    expect(copy.sha256).toBe(hash(copyJson));
    expect((yield* verifySealedCache(seed)).sha256).toBe(seed.sha256);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test.each(['!opaque', '-state'])(
  'seals, copies, and admits a punctuation directory sorting before root: %s',
  acceptsPreDotDirectory,
);

async function refusesCorruptionBeforeInstall() {
  function* check() {
    const { fs, root, parent } = yield* fixture();
    const seed = yield* sealCache(root);
    const copy = yield* copyCaseCache(seed, `${parent}/case-a`);
    yield* fs.writeFileString(`${copy.root}/opaque/data.bin`, 'abd');
    let installs = 0;
    const installing = admitCaseCache(seed, copy).pipe(
      Effect.map(() => {
        installs++;
      }),
    );
    const result = yield* installing.pipe(Effect.result);
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'CacheError', code: 'InputChanged' },
    });
    expect(installs).toBe(0);
    expect((yield* verifySealedCache(seed)).sha256).toBe(seed.sha256);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'one-byte corruption is hash-refused before the install continuation',
  refusesCorruptionBeforeInstall,
);

async function refusesInventoryChanges() {
  for (const mutation of ['Missing', 'Extra', 'Mode', 'RootMode', 'Link'] as const) {
    function* check() {
      const { fs, root, parent } = yield* fixture();
      yield* fs.symlink('opaque/data.bin', `${root}/alias`);
      const seed = yield* sealCache(root);
      const copy = yield* copyCaseCache(seed, `${parent}/case-a`);
      const changes = {
        Missing: fs.remove(`${copy.root}/.opaque-state`),
        Extra: fs.writeFileString(`${copy.root}/opaque/extra`, 'x'),
        Mode: fs.chmod(`${copy.root}/opaque/data.bin`, 0o600),
        RootMode: fs.chmod(copy.root, 0o700),
        Link: fs
          .remove(`${copy.root}/alias`)
          .pipe(Effect.andThen(fs.symlink('opaque/tool', `${copy.root}/alias`))),
      };
      yield* changes[mutation];
      expect(
        Result.isFailure(yield* admitCaseCache(seed, copy).pipe(Effect.result)),
        mutation,
      ).toBe(true);
      expect((yield* verifySealedCache(seed)).sha256).toBe(seed.sha256);
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withMetadata, withPlatform);
    await Effect.runPromise(provided);
  }
}
test(
  'admission refuses missing, extra, permission, root-mode, and link-target changes',
  refusesInventoryChanges,
);

async function isolatesTwoCases() {
  function* check() {
    const { fs, metadata, root, parent } = yield* fixture();
    const seed = yield* sealCache(root);
    const first = yield* copyCaseCache(seed, `${parent}/case-a`);
    const second = yield* copyCaseCache(seed, `${parent}/case-b`);
    const paths = [root, first.root, second.root].map((path) => `${path}/opaque/data.bin`);
    const infos = yield* Effect.forEach(paths, metadata.lstat);
    expect(new Set(infos.map((info) => `${info.dev}:${info.ino}`)).size).toBe(3);
    expect(infos.every((info) => info.nlink === 1n)).toBe(true);
    yield* fs.makeDirectory(`${parent}/installed`);
    yield* fs.copyFile(paths[1]!, `${parent}/installed/data.bin`);
    yield* fs.chmod(`${parent}/installed/data.bin`, 0o600);
    yield* fs.writeFileString(`${parent}/installed/data.bin`, 'installed mutation');
    expect(yield* fs.readFileString(paths[1]!)).toBe('abc');
    yield* fs.writeFileString(paths[1]!, 'case mutation');
    expect(yield* fs.readFileString(paths[0]!)).toBe('abc');
    expect(yield* fs.readFileString(paths[2]!)).toBe('abc');
    expect((yield* verifySealedCache(seed)).sha256).toBe(seed.sha256);
    expect((yield* admitCaseCache(seed, second)).sha256).toBe(second.sha256);
    expect(Result.isFailure(yield* admitCaseCache(seed, first).pipe(Effect.result))).toBe(true);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'two physical cases and a synthetic installed-file copy have separate inodes and mutations',
  isolatesTwoCases,
);

async function refusesUnsafeLinks() {
  for (const target of ['/etc/passwd', '../outside', 'missing', 'alias', '.']) {
    function* check() {
      const { fs, root, parent } = yield* fixture();
      yield* fs.writeFileString(`${parent}/outside`, 'outside');
      yield* fs.symlink(target, `${root}/alias`);
      expect(Result.isFailure(yield* sealCache(root).pipe(Effect.result)), target).toBe(true);
      expect((yield* fs.stat(root)).mode & 0o777).toBe(0o750);
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withMetadata, withPlatform);
    await Effect.runPromise(provided);
  }
}
test(
  'escaping, broken, self-cyclic, and recursive directory aliases fail before sealing',
  refusesUnsafeLinks,
);

async function refusesSpecialsAndHardlinks() {
  for (const kind of ['Special', 'Hardlink', 'Sticky'] as const) {
    function* check() {
      const { fs, root } = yield* fixture();
      const changes = {
        Special: makeFifo(`${root}/fifo`),
        Hardlink: fs.link(`${root}/opaque/data.bin`, `${root}/shared`),
        Sticky: fs.chmod(root, 0o1750),
      };
      yield* changes[kind];
      expect(Result.isFailure(yield* sealCache(root).pipe(Effect.result)), kind).toBe(true);
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withMetadata, withPlatform);
    await Effect.runPromise(provided);
  }
}
test(
  'real FIFO, shared hardlinks, and special permission bits are refused',
  refusesSpecialsAndHardlinks,
);

async function refusesUnsafeDestinations() {
  function* check() {
    const { fs, root, parent } = yield* fixture();
    const seed = yield* sealCache(root);
    const first = yield* copyCaseCache(seed, `${parent}/case-a`);
    yield* fs.symlink(parent, `${parent}/alias-parent`);
    for (const destination of [
      root,
      `${root}/nested`,
      parent,
      first.root,
      `${first.root}/nested`,
      `${parent}/CASE-A`,
      `${parent}/alias-parent/new`,
    ]) {
      expect(
        Result.isFailure(yield* copyCaseCache(seed, destination).pipe(Effect.result)),
        destination,
      ).toBe(true);
    }
    expect(
      Result.isFailure(yield* copyCaseCache({ ...seed }, `${parent}/forged`).pipe(Effect.result)),
    ).toBe(true);
    expect(Result.isFailure(yield* admitCaseCache(seed, { ...first }).pipe(Effect.result))).toBe(
      true,
    );
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'duplicate, nested, case-conflicting, aliased, and serialized-authority destinations fail',
  refusesUnsafeDestinations,
);

async function detectsSeedChanges() {
  function* check() {
    const { fs, root, parent } = yield* fixture();
    const seed = yield* sealCache(root);
    const copy = yield* copyCaseCache(seed, `${parent}/case-a`);
    yield* fs.chmod(`${root}/opaque/data.bin`, 0o640);
    yield* fs.writeFileString(`${root}/opaque/data.bin`, 'abd');
    yield* fs.chmod(`${root}/opaque/data.bin`, 0o440);
    expect(Result.isFailure(yield* admitCaseCache(seed, copy).pipe(Effect.result))).toBe(true);
    expect(
      Result.isFailure(yield* copyCaseCache(seed, `${parent}/case-b`).pipe(Effect.result)),
    ).toBe(true);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test('every copy/admission independently rehashes the sealed seed', detectsSeedChanges);

async function enforcesReducedBounds() {
  for (const reduction of [
    { entryBytes: 10 },
    { totalBytes: 20 },
    { entries: 4 },
    { pathBytes: 10 },
  ]) {
    function* check() {
      const { root } = yield* fixture();
      const limits = { ...cacheLimits, ...reduction };
      expect(Result.isFailure(yield* sealCache(root, limits).pipe(Effect.result))).toBe(true);
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withMetadata, withPlatform);
    await Effect.runPromise(provided);
  }
}
test('entry, total-byte, entry-count, and UTF-8 path budgets fail closed', enforcesReducedBounds);

async function acceptsExactExpandedBounds() {
  function* check() {
    const { root } = yield* fixture();
    const seed = yield* sealCache(root, {
      entryBytes: 22,
      totalBytes: 36,
      entries: 5,
      pathBytes: 15,
    });
    expect(seed.inventory).toHaveLength(5);
    expect((yield* verifySealedCache(seed)).sha256).toBe(seed.sha256);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test('exact expanded byte, path, and count ceilings are inclusive', acceptsExactExpandedBounds);

async function acceptsExpandedNotRawCap() {
  function* check() {
    const { fs, root } = yield* fixture();
    yield* fs.writeFileString(`${root}/opaque/sparse`, '');
    yield* fs.truncate(`${root}/opaque/sparse`, 67108865);
    const seed = yield* sealCache(root);
    const sparse = seed.inventory.find(byPath('opaque/sparse'));
    expect(sparse).toMatchObject({ type: 'File', size: 67108865 });
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'an unpacked sparse fixture above 64 MiB is admitted under the expanded-entry cap',
  acceptsExpandedNotRawCap,
);

async function rejectsBeforeOpeningOversizedFile() {
  function* check() {
    const { fs, root } = yield* fixture();
    yield* fs.truncate(`${root}/opaque/data.bin`, cacheLimits.entryBytes + 1);
    const opened: string[] = [];
    const guarded = {
      ...fs,
      open: (...args: Parameters<typeof fs.open>) => {
        opened.push(args[0]);
        return fs.open(...args);
      },
    };
    const sealing = sealCache(root).pipe(
      Effect.provideService(FileSystem.FileSystem, guarded),
      Effect.result,
    );
    expect(Result.isFailure(yield* sealing)).toBe(true);
    expect(opened).not.toContain(`${root}/opaque/data.bin`);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'over-expanded file size is refused before open or allocation',
  rejectsBeforeOpeningOversizedFile,
);

async function rejectsListingAliases() {
  for (const names of [
    ['opaque', 'opaque'],
    ['opaque', 'OPAQUE'],
  ]) {
    function* check() {
      const { fs, root } = yield* fixture();
      function readDirectory(path: string, options?: { readonly recursive?: boolean }) {
        function select(original: string[]) {
          return Match.value(path === root).pipe(
            Match.when(true, () => names),
            Match.orElse(() => original),
          );
        }
        const reading = fs.readDirectory(path, options);
        const selected = reading.pipe(Effect.map(select));
        return selected;
      }
      const guarded = { ...fs, readDirectory };
      const sealing = sealCache(root).pipe(
        Effect.provideService(FileSystem.FileSystem, guarded),
        Effect.result,
      );
      expect(Result.isFailure(yield* sealing)).toBe(true);
      expect((yield* fs.stat(root)).mode & 0o777).toBe(0o750);
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withMetadata, withPlatform);
    await Effect.runPromise(provided);
  }
}
test(
  'duplicate and case-conflicting directory listings fail before chmod on case-insensitive hosts too',
  rejectsListingAliases,
);

async function rejectsDirectoryAliasCycle() {
  function* check() {
    const { fs, root } = yield* fixture();
    yield* fs.writeFileString(`${root}/!opaque`, 'inert punctuation state');
    yield* fs.makeDirectory(`${root}/other`);
    yield* fs.symlink('../other', `${root}/opaque/to-other`);
    yield* fs.symlink('../opaque', `${root}/other/to-opaque`);
    expect(Result.isFailure(yield* sealCache(root).pipe(Effect.result))).toBe(true);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'directory aliases that individually resolve internally but form a graph cycle are refused',
  rejectsDirectoryAliasCycle,
);

async function preservesModesUnderRestrictiveUmask() {
  function changeUmask(mask: number) {
    const changing = Effect.try(() => process.umask(mask));
    return changing;
  }
  function restoreUmask(mask: number) {
    const restoring = changeUmask(mask).pipe(Effect.result);
    const checked = restoring.pipe(Effect.map((result) => expect(result._tag).toBe('Success')));
    return checked;
  }
  function* check() {
    const { root, parent } = yield* fixture();
    const seed = yield* sealCache(root);
    yield* Effect.acquireRelease(changeUmask(0o777), restoreUmask);
    const copy = yield* copyCaseCache(seed, `${parent}/case-a`);
    expect(copy.inventory.find(byPath('opaque'))?.mode).toBe(0o755);
    expect((yield* admitCaseCache(seed, copy)).sha256).toBe(copy.sha256);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'copy mode readback is independent of a restrictive host umask',
  preservesModesUnderRestrictiveUmask,
);

async function cacheBundleIsNodeSafe() {
  const result = await Bun.build({
    entrypoints: [
      decodeURIComponent(new URL('../src/linux-qualification/cache.ts', import.meta.url).pathname),
    ],
    target: 'node',
    metafile: true,
  });
  expect(result.success).toBe(true);
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some((path) => path.includes('platform-bun'))).toBe(false);
  expect(inputs.some((path) => /(?:inputs|cache-download|source-payload)\.ts$/.test(path))).toBe(
    false,
  );
  for (const output of result.outputs)
    expect(await output.text()).not.toContain('Bun.CryptoHasher');
}
test(
  'cache and metadata boundary bundle for Node without host acquisition or Bun runtime code',
  cacheBundleIsNodeSafe,
);
