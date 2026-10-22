import { expect, test } from 'bun:test';

import { Effect, FileSystem, Layer, Match, Option, Path, Schema } from 'effect';

import { openOwnedMigrationDatabase } from '../src/database.ts';
import { initializeMigrationLedger, readMigrationLedgerStatus } from '../src/index.ts';
import { prepareMigrationPaths } from '../src/paths.ts';
import { ownedConfig, platform } from './fixtures.ts';

function productionPlatform(
  fs: FileSystem.FileSystem,
  directoryInfo: FileSystem.File.Info,
  nativeNames: ReadonlyMap<string, string>,
  opened: string[],
) {
  function nativePath(value: string) {
    const found = Option.fromNullishOr(nativeNames.get(value));
    return Option.getOrThrow(found);
  }
  function open(value: string, options?: Parameters<typeof fs.open>[1]) {
    opened.push(value);
    return fs.open(nativePath(value), options);
  }
  function stat(value: string) {
    const selected = Match.value(nativeNames.has(value)).pipe(
      Match.when(true, () => fs.stat(nativePath(value))),
      Match.orElse(() => Effect.sync(() => directoryInfo)),
    );
    return selected;
  }
  const syntheticFs = FileSystem.makeNoop({
    exists: (value) => Effect.sync(() => !value.endsWith('/.git') && !value.includes('.sqlite-')),
    realPath: (value) => Effect.sync(() => value),
    stat,
    open,
  });
  const filesystem = Layer.succeed(FileSystem.FileSystem, syntheticFs);
  const platform = Layer.merge(filesystem, Path.layer);
  return platform;
}

const productionCases = [
  { name: 'custom positive', root: '/synthetic-state', excluded: {}, allowed: true },
  {
    name: 'repository',
    root: '/synthetic-state',
    excluded: { repositoryRoots: ['/synthetic-state'] },
    allowed: false,
  },
  {
    name: 'build',
    root: '/synthetic-state',
    excluded: { buildRoots: ['/synthetic-state'] },
    allowed: false,
  },
  {
    name: 'temporary',
    root: '/synthetic-state',
    excluded: { temporaryRoots: ['/synthetic-state'] },
    allowed: false,
  },
  {
    name: 'synced',
    root: '/synthetic-state',
    excluded: { syncedRoots: ['/synthetic-state'] },
    allowed: false,
  },
  {
    name: 'ledger descendant',
    root: '/synthetic-state',
    excluded: { buildRoots: ['/synthetic-state/migration.sqlite'] },
    allowed: false,
  },
  {
    name: 'guard descendant',
    root: '/synthetic-state',
    excluded: { syncedRoots: ['/synthetic-state/migration.sqlite.owner.sqlite'] },
    allowed: false,
  },
  ...[
    '/tmp',
    '/private/tmp',
    '/var/tmp',
    '/private/var/tmp',
    '/dev/shm',
    '/var/folders',
    '/private/var/folders',
    '/synthetic-home/Library/CloudStorage',
    '/synthetic-home/Library/Mobile Documents',
  ].map((root) => ({ name: root, root: `${root}/state`, excluded: {}, allowed: false })),
];
for (const control of productionCases) {
  async function productionPolicy() {
    function* scenario() {
      const { config, root, fs, file, guard } = yield* ownedConfig();
      yield* fs.open(file, { flag: 'wx', mode: 0o600 });
      yield* fs.open(guard, { flag: 'wx', mode: 0o600 });
      const directoryInfo = yield* fs.stat(root);
      const nativeNames = new Map([
        [`${control.root}/migration.sqlite`, file],
        [`${control.root}/migration.sqlite.owner.sqlite`, guard],
      ]);
      const opened: string[] = [];
      const policy = {
        _tag: 'Production' as const,
        stateRoot: control.root,
        ownerUid: config.pathPolicy.ownerUid,
        homeDirectory: '/synthetic-home',
        repositoryRoots: [],
        buildRoots: [],
        temporaryRoots: [],
        syncedRoots: [],
        filesystem: 'OperatorDeclaredLocalNonSynced' as const,
        ...control.excluded,
      };
      const syntheticPlatform = productionPlatform(fs, directoryInfo, nativeNames, opened);
      const preparation = prepareMigrationPaths(
        { ledgerId: 'test-ledger', pathPolicy: policy },
        false,
      ).pipe(Effect.result);
      const provided = Effect.provide(preparation, syntheticPlatform);
      const result = yield* provided;
      const expected = Match.value(control.allowed).pipe(
        Match.when(true, () => 'Success' as const),
        Match.orElse(() => 'Failure' as const),
      );
      expect(result._tag).toBe(expected);
      expect(opened).toHaveLength(Number(control.allowed) * 2);
      expect((yield* fs.readDirectory(root)).sort()).toEqual([
        'migration.sqlite',
        'migration.sqlite.owner.sqlite',
      ]);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
  test(
    `production policy ${control.name} uses synthetic paths and only owned temporary descriptors`,
    productionPolicy,
  );
}

for (const unsafe of [
  'root-mode',
  'uid',
  'relative',
  'test-root',
  'production-temp',
  'dangling-final',
  'parent-link',
  'sidecar-link',
] as const) {
  async function unsafePath() {
    function* scenario() {
      const { config, root, fs, file } = yield* ownedConfig();
      function* parentLink() {
        yield* fs.makeDirectory(`${root}/real`, { mode: 0o700 });
        yield* fs.symlink(`${root}/real`, `${root}/alias`);
      }
      const policy = {
        _tag: 'Production' as const,
        stateRoot: root,
        ownerUid: config.pathPolicy.ownerUid,
        homeDirectory: '/synthetic-home',
        repositoryRoots: [],
        buildRoots: [],
        temporaryRoots: [root],
        syncedRoots: [],
        filesystem: 'OperatorDeclaredLocalNonSynced' as const,
      };
      const chmod = fs.chmod(root, 0o755);
      const finalLink = fs.symlink(`${root}/absent`, file);
      const sidecarLink = fs.symlink(`${root}/absent`, `${file}-wal`);
      const parent = Effect.gen(parentLink);
      const mutation = Match.value(unsafe).pipe(
        Match.when('root-mode', () => chmod),
        Match.when('dangling-final', () => finalLink),
        Match.when('sidecar-link', () => sidecarLink),
        Match.when('parent-link', () => parent),
        Match.orElse(() => fs.stat(root)),
      );
      yield* mutation;
      const input = Match.value(unsafe).pipe(
        Match.when('uid', () => ({
          ...config,
          pathPolicy: { ...config.pathPolicy, ownerUid: config.pathPolicy.ownerUid + 1 },
        })),
        Match.when('relative', () => ({
          ...config,
          pathPolicy: { ...config.pathPolicy, stateRoot: 'relative' },
        })),
        Match.when('test-root', () => ({
          ...config,
          pathPolicy: { ...config.pathPolicy, ownedTemporaryRoot: `${root}/other` },
        })),
        Match.when('production-temp', () => ({ ...config, pathPolicy: policy })),
        Match.when('parent-link', () => ({
          ...config,
          pathPolicy: {
            ...config.pathPolicy,
            stateRoot: `${root}/alias`,
            ownedTemporaryRoot: `${root}/alias`,
          },
        })),
        Match.orElse(() => config),
      );
      const result = yield* initializeMigrationLedger(input).pipe(Effect.result);
      expect(result).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'MigrationStorageError', operation: 'initialize' },
      });
      const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
      const encoded = encode(result);
      expect(encoded).not.toContain(root);
      expect(yield* fs.exists(`${root}/absent`)).toBe(false);
      expect(yield* fs.exists(`${root}/real/migration.sqlite`)).toBe(false);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
  test(`refuses unsafe ${unsafe} before native open`, unsafePath);
}

for (const kind of [
  'fifo',
  'directory',
  'mode',
  'hardlink',
  'final-link',
  'replaced-ledger',
  'replaced-guard',
] as const) {
  async function unsafeExistingFile() {
    function* scenario() {
      const { config, fs, file, guard, root } = yield* ownedConfig();
      yield* initializeMigrationLedger(config);
      const target = Match.value(kind).pipe(
        Match.when('replaced-guard', () => guard),
        Match.orElse(() => file),
      );
      function* replaceInode() {
        yield* fs.copyFile(target, `${root}/replacement`);
        yield* fs.chmod(`${root}/replacement`, 0o600);
        yield* fs.rename(`${root}/replacement`, target);
      }
      function* fifo() {
        yield* fs.remove(file);
        const child = Bun.spawnSync(['/usr/bin/mkfifo', '-m', '600', file], {
          env: {},
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(child.exitCode).toBe(0);
      }
      function* directory() {
        yield* fs.remove(file);
        yield* fs.makeDirectory(file, { mode: 0o700 });
      }
      function* finalLink() {
        yield* fs.rename(file, `${root}/original`);
        yield* fs.symlink(`${root}/original`, file);
      }
      const replacement = Effect.gen(replaceInode);
      const special = Effect.gen(fifo);
      const folder = Effect.gen(directory);
      const link = Effect.gen(finalLink);
      const mutation = Match.value(kind).pipe(
        Match.when('fifo', () => special),
        Match.when('directory', () => folder),
        Match.when('mode', () => fs.chmod(file, 0o644)),
        Match.when('hardlink', () => fs.link(file, `${root}/hardlink`)),
        Match.when('final-link', () => link),
        Match.when('replaced-ledger', () => replacement),
        Match.when('replaced-guard', () => replacement),
        Match.exhaustive,
      );
      yield* mutation;
      const attempt = openOwnedMigrationDatabase(config).pipe(Effect.result);
      const result = yield* attempt;
      expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'MigrationStorageError' } });
      const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
      expect(encode(result)).not.toContain(root);
    }
    const program = Effect.gen(scenario);
    const bounded = program.pipe(Effect.timeout('3 seconds'));
    const scoped = Effect.scoped(bounded);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
  test(
    `known ${kind} refuses without blocking or returning a partial connection`,
    unsafeExistingFile,
  );
}

for (const partial of ['missing', 'ledger-only', 'guard-only'] as const) {
  async function partialState() {
    function* scenario() {
      const { config, fs, root, file, guard } = yield* ownedConfig();
      const reservation = Match.value(partial).pipe(
        Match.when('missing', () => Effect.void),
        Match.when('ledger-only', () => fs.open(file, { flag: 'wx', mode: 0o600 })),
        Match.when('guard-only', () => fs.open(guard, { flag: 'wx', mode: 0o600 })),
        Match.exhaustive,
      );
      yield* reservation;
      const before = yield* fs.readDirectory(root);
      expect((yield* readMigrationLedgerStatus(config).pipe(Effect.result))._tag).toBe('Failure');
      expect(yield* fs.readDirectory(root)).toEqual(before);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
  test(`status refuses ${partial} without creating files`, partialState);
}

for (const suffix of [
  '-journal',
  '.owner.sqlite-journal',
  '.owner.sqlite-wal',
  '.owner.sqlite-shm',
]) {
  async function incompleteNativeState() {
    function* scenario() {
      const { config, fs, root, file } = yield* ownedConfig();
      yield* initializeMigrationLedger(config);
      const sidecar = yield* fs.open(`${file}${suffix}`, { flag: 'wx', mode: 0o600 });
      yield* sidecar.writeAll(new Uint8Array(512));
      const names = (yield* fs.readDirectory(root)).sort();
      const bytes = yield* Effect.forEach(names, (name) => fs.readFile(`${root}/${name}`));
      expect(yield* openOwnedMigrationDatabase(config).pipe(Effect.result)).toMatchObject({
        _tag: 'Failure',
        failure: { code: 'UnsafePath' },
      });
      expect(yield* readMigrationLedgerStatus(config).pipe(Effect.result)).toMatchObject({
        _tag: 'Failure',
        failure: { code: 'UnsafePath' },
      });
      expect((yield* fs.readDirectory(root)).sort()).toEqual(names);
      expect(yield* Effect.forEach(names, (name) => fs.readFile(`${root}/${name}`))).toEqual(bytes);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
  test(
    `unexpected ${suffix} refuses before native recovery can modify partial state`,
    incompleteNativeState,
  );
}
