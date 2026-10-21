import { Database } from 'bun:sqlite';
import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { ByteSize, Data, Effect, FileSystem, Layer, Option, Path, Result, Schema } from 'effect';

import {
  initializeLiveInbox,
  openLiveInbox,
  readLiveInboxStatus,
} from '../src/live-sqlite-inbox.ts';
import { prepareLocalState } from '../src/local-state.ts';
import { ownedConfig } from './live-sqlite-fixtures.ts';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
afterEach(() => mock.restore());

async function descendantExclusion() {
  const paths = {
    stateRoot: '/synthetic-state',
    file: '/synthetic-state/build/admission.sqlite',
    buildRoot: '/synthetic-state/build',
    homeDirectory: '/synthetic-home',
  };
  const { file } = paths;
  const directoryInfo = {
    type: 'Directory' as const,
    mtime: Option.none(),
    atime: Option.none(),
    birthtime: Option.none(),
    dev: 1n,
    ino: Option.some(1n),
    mode: 0o700,
    nlink: Option.some(1n),
    uid: Option.some(501),
    gid: Option.none(),
    rdev: Option.none(),
    size: ByteSize.bytes(0),
    blksize: Option.none(),
    blocks: Option.none(),
  };
  const fileInfo = { ...directoryInfo, type: 'File' as const, mode: 0o600 };
  const files = new Set([file, `${file}.owner.sqlite`]);
  const entries = new Set(['/', paths.stateRoot, paths.buildRoot, ...files]);
  function stat(value: string) {
    const info = Option.match(
      Option.liftPredicate(value, (path) => files.has(path)),
      {
        onSome: () => fileInfo,
        onNone: () => directoryInfo,
      },
    );
    const reading = Effect.sync(() => info);
    return reading;
  }
  const filesystem = FileSystem.makeNoop({
    stat,
    exists: (value) => Effect.succeed(entries.has(value)),
    realPath: (value) => Effect.sync(() => value),
  });
  const filesystemLayer = Layer.succeed(FileSystem.FileSystem, filesystem);
  const syntheticPlatform = Layer.merge(filesystemLayer, Path.layer);
  const policy = {
    _tag: 'Production' as const,
    stateRoot: paths.stateRoot,
    ownerUid: 501,
    homeDirectory: paths.homeDirectory,
    repositoryRoots: [],
    buildRoots: [paths.buildRoot],
    temporaryRoots: [],
    syncedRoots: [],
    filesystem: 'OperatorDeclaredLocalNonSynced' as const,
  };
  const program = prepareLocalState(policy, file, 'Open').pipe(Effect.result);
  const provided = Effect.provide(program, syntheticPlatform);
  const result = await Effect.runPromise(provided);
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'UnsafePath' } });
  const allowed = prepareLocalState({ ...policy, buildRoots: [] }, file, 'Open');
  const allowedPlatform = Effect.provide(allowed, syntheticPlatform);
  expect((await Effect.runPromise(allowedPlatform)).file).toBe(file);
}
test(
  'synthetic production policy accepts a custom root but excludes a banned descendant database path',
  descendantExclusion,
);

async function zeroFile() {
  function* scenario() {
    const { config, fs } = yield* ownedConfig();
    yield* fs.open(config.file, { flag: 'wx', mode: 0o600, noFollow: true });
    const before = yield* fs.readFile(config.file);
    expect((yield* initializeLiveInbox(config).pipe(Effect.result))._tag).toBe('Failure');
    expect((yield* openLiveInbox(config).pipe(Effect.result))._tag).toBe('Failure');
    expect(yield* fs.readFile(config.file)).toEqual(before);
    expect(yield* fs.exists(`${config.file}.owner.sqlite`)).toBe(false);
    expect(yield* fs.exists(`${config.file}-wal`)).toBe(false);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test('existing zero-byte file is neither initialized nor repaired on start', zeroFile);

async function permissionsAndLinks() {
  function* scenario() {
    const { config, fs, root } = yield* ownedConfig();
    yield* fs.chmod(root, 0o755);
    expect(yield* initializeLiveInbox(config).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'UnsafePath' },
    });
    expect(yield* fs.exists(config.file)).toBe(false);
    yield* fs.chmod(root, 0o700);
    yield* initializeLiveInbox(config);
    yield* fs.chmod(config.file, 0o644);
    expect(yield* openLiveInbox(config).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'UnsafePath' },
    });
    yield* fs.chmod(config.file, 0o600);
    const linked = `${root}/alias.sqlite`;
    yield* fs.symlink(config.file, linked);
    expect((yield* openLiveInbox({ ...config, file: linked }).pipe(Effect.result))._tag).toBe(
      'Failure',
    );
    const directory = `${root}/nested`;
    yield* fs.makeDirectory(directory, { mode: 0o700 });
    yield* fs.symlink(directory, `${root}/linked-parent`);
    const unsafeFile = `${root}/linked-parent/new.sqlite`;
    expect(
      (yield* initializeLiveInbox({ ...config, file: unsafeFile }).pipe(Effect.result))._tag,
    ).toBe('Failure');
    expect(yield* fs.exists(`${directory}/new.sqlite`)).toBe(false);
    const ownershipBefore = yield* fs.readFile(`${config.file}.owner.sqlite`);
    yield* readLiveInboxStatus(config);
    expect(yield* fs.readFile(`${config.file}.owner.sqlite`)).toEqual(ownershipBefore);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'native owner-only root/files, symlinked final/parent paths and status preservation',
  permissionsAndLinks,
);

async function explicitProductionPolicy() {
  function* scenario() {
    const { config, root, fs } = yield* ownedConfig();
    const production = {
      _tag: 'Production' as const,
      stateRoot: root,
      ownerUid: config.pathPolicy.ownerUid,
      homeDirectory: '/synthetic-home',
      filesystem: 'OperatorDeclaredLocalNonSynced' as const,
      repositoryRoots: [],
      buildRoots: [],
      temporaryRoots: [root],
      syncedRoots: [],
    };
    const refused = yield* initializeLiveInbox({ ...config, pathPolicy: production }).pipe(
      Effect.result,
    );
    expect(refused).toMatchObject({ _tag: 'Failure', failure: { code: 'UnsafePath' } });
    expect(yield* fs.exists(config.file)).toBe(false);
    const outside = yield* initializeLiveInbox({ ...config, file: `${root}-outside.sqlite` }).pipe(
      Effect.result,
    );
    expect(outside._tag).toBe('Failure');
    const badBypass = { ...config.pathPolicy, ownedTemporaryRoot: `${root}/other` };
    const invalid = yield* initializeLiveInbox({ ...config, pathPolicy: badBypass }).pipe(
      Effect.result,
    );
    expect(invalid._tag).toBe('Failure');
    const badFault = yield* openLiveInbox({
      ...config,
      pathPolicy: production,
      testFault: () => undefined,
    }).pipe(Effect.result);
    expect(Result.isFailure(badFault)).toBe(true);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'production excludes explicit temp roots; test bypass is explicit and contained',
  explicitProductionPolicy,
);

async function ownedChildDeath() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const script = `import { Effect, FileSystem, Layer } from 'effect';
      import { BunFileSystem, BunPath } from '@effect/platform-bun';
      import { openLiveInbox } from './src/live-sqlite-inbox.ts';
      const config = JSON.parse(Bun.argv[1]);
      config.clock = () => ({wallMs:1000,monotonicMs:200});
      const program = Effect.gen(function* () {
        yield* openLiveInbox(config); console.log('OWNED');
        yield* Effect.promise(() => Bun.stdin.text());
      });
      await Effect.runPromise(Effect.provide(Effect.scoped(program), Layer.merge(BunFileSystem.layer,BunPath.layer)));`;
    const wire = Schema.Struct({
      file: Schema.String,
      ingressScopeId: Schema.String,
      pathPolicy: Schema.Struct({
        _tag: Schema.Literal('TestOwnedTemporary'),
        stateRoot: Schema.String,
        ownerUid: Schema.Number,
        ownedTemporaryRoot: Schema.String,
      }),
      limits: Schema.Struct({
        decisions: Schema.Number,
        receipts: Schema.Number,
        authorityRevisions: Schema.Number,
      }),
    });
    const encode = Schema.encodeSync(Schema.fromJsonString(wire));
    const args = encode(config);
    function spawnChild() {
      return Bun.spawn([process.execPath, '--no-env-file', '--no-install', '-e', script, args], {
        cwd: new URL('..', import.meta.url).pathname,
        env: {},
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    }
    const spawning = Effect.try({
      try: spawnChild,
      catch: () => new ChildFailure({ phase: 'Spawn' }),
    });
    function stopChild(child: ReturnType<typeof spawnChild>) {
      function stopNative() {
        const result = Result.try({
          try: () => child.kill('SIGKILL'),
          catch: () => new ChildFailure({ phase: 'Stop' }),
        });
        Result.getOrThrow(result);
      }
      const stopping = Effect.sync(stopNative);
      return stopping;
    }
    const child = yield* Effect.acquireRelease(spawning, stopChild);
    const reader = child.stdout.getReader();
    function readReady(signal: AbortSignal) {
      const abort = () => child.kill('SIGKILL');
      signal.addEventListener('abort', abort, { once: true });
      return reader.read().finally(() => signal.removeEventListener('abort', abort));
    }
    const reading = Effect.promise(readReady);
    const ready = yield* reading.pipe(Effect.timeout('5 seconds'));
    expect(new TextDecoder().decode(ready.value)).toContain('OWNED');
    const blocked = yield* openLiveInbox(config).pipe(Effect.result);
    expect(blocked).toMatchObject({ _tag: 'Failure', failure: { code: 'OwnershipBusy' } });
    expect((yield* readLiveInboxStatus(config)).decisions).toBe(0);
    child.kill('SIGKILL');
    yield* Effect.promise(() => child.exited);
    reader.releaseLock();
    const reopened = yield* openLiveInbox(config);
    expect(reopened.driver.loadPolicy('fixture-app').pipe(Result.getOrThrow).policy.revision).toBe(
      'local-1',
    );
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'actual scoped inbox owner excludes a child competitor, permits status, releases on child death',
  ownedChildDeath,
);

class ChildFailure extends Data.TaggedError('ChildFailure')<{ readonly phase: 'Spawn' | 'Stop' }> {}

async function firstCreationAndNoDdl() {
  function* scenario() {
    const { config, fs } = yield* ownedConfig();
    const queries: string[] = [];
    const nativeRun = Database.prototype.run;
    function observe(this: Database, ...args: Parameters<typeof nativeRun>) {
      const result = nativeRun.apply(this, args);
      queries.push(args[0]);
      return result;
    }
    spyOn(Database.prototype, 'run').mockImplementation(observe);
    yield* initializeLiveInbox(config);
    queries.length = 0;
    const { driver } = yield* openLiveInbox(config);
    for (const suffix of ['', '-wal', '-shm', '.owner.sqlite']) {
      expect((yield* fs.stat(`${config.file}${suffix}`)).mode & 0o777).toBe(0o600);
    }
    expect(driver.loadPolicy('fixture-app')._tag).toBe('Success');
    expect(queries.some((sql) => /\b(CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);
    expect(queries.some((sql) => /journal_mode\s*=/i.test(sql))).toBe(false);
    const native = new Database(config.file, { readonly: true, create: false });
    expect(native.query('SELECT count(*) AS n FROM decisions').get()).toEqual({ n: 0 });
    native.close();
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  '0600 database and fresh sidecars without chmod repair; normal open executes no DDL/journal transition',
  firstCreationAndNoDdl,
);

async function incompatibleVersion() {
  function* scenario() {
    const { config, fs } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const db = new Database(config.file, { create: false, readwrite: true });
    db.run('PRAGMA user_version=2');
    db.close();
    const before = yield* fs.readFile(config.file);
    const result = yield* openLiveInbox(config).pipe(Effect.result);
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'IncompatibleSchema' } });
    expect(yield* fs.readFile(config.file)).toEqual(before);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'unsupported schema version is finite IncompatibleSchema without migration',
  incompatibleVersion,
);

async function inaccessibleAndReplacement() {
  function* scenario() {
    const { config, fs, root } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const before = yield* fs.readFile(config.file);
    yield* fs.chmod(root, 0o000);
    expect((yield* openLiveInbox(config).pipe(Effect.result))._tag).toBe('Failure');
    yield* fs.chmod(root, 0o700);
    expect(yield* fs.readFile(config.file)).toEqual(before);
    const backup = `${root}/backup.sqlite`;
    yield* fs.copyFile(config.file, backup);
    yield* fs.rename(backup, config.file);
    const restored = yield* openLiveInbox(config).pipe(Effect.result);
    expect(restored).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidData' } });
    expect(yield* fs.readFile(config.file)).toEqual(before);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'inaccessible state and replaced backup identity refuse startup without repair',
  inaccessibleAndReplacement,
);

async function strictNativeClose() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    const closed: { db: Database; strict: boolean | undefined }[] = [];
    const nativeClose = Database.prototype.close;
    function observe(this: Database, strict?: boolean) {
      closed.push({ db: this, strict });
      return nativeClose.call(this, strict);
    }
    spyOn(Database.prototype, 'close').mockImplementation(observe);
    yield* initializeLiveInbox(config);
    expect(closed).toHaveLength(2);
    expect(closed.every((entry) => entry.strict)).toBe(true);
    function* lifetime() {
      const { driver } = yield* openLiveInbox(config);
      expect(driver.loadPolicy('fixture-app')._tag).toBe('Success');
    }
    const lifetimeProgram = Effect.gen(lifetime);
    yield* Effect.scoped(lifetimeProgram);
    expect(closed).toHaveLength(5);
    for (const entry of closed) {
      expect(entry.strict).toBe(true);
      expect(() => entry.db.query('SELECT 1').get()).toThrow();
    }
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'scopes strictly finalize every owned native connection and its cached statements',
  strictNativeClose,
);

async function danglingSidecar() {
  function* scenario() {
    const { config, fs, root } = yield* ownedConfig();
    yield* initializeLiveInbox(config);
    const target = `${root}/untrusted-target`;
    const native = new Database(config.file, { create: false, readwrite: true });
    expect(native.query('PRAGMA wal_checkpoint(TRUNCATE)').get()).toMatchObject({ busy: 0 });
    native.close();
    yield* fs.remove(`${config.file}-wal`, { force: true });
    yield* fs.symlink(target, `${config.file}-wal`);
    const reply = yield* openLiveInbox(config).pipe(Effect.result);
    expect(reply).toMatchObject({ _tag: 'Failure', failure: { code: 'UnsafePath' } });
    expect(yield* fs.exists(target)).toBe(false);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'dangling WAL symlink is rejected before SQLite can follow/create its target',
  danglingSidecar,
);
