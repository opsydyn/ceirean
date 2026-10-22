import { Database } from 'bun:sqlite';
import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import { Cause, Data, Effect, Exit, Match, Schema } from 'effect';

import { openOwnedMigrationDatabase } from '../src/database.ts';
import { initializeMigrationLedger, readMigrationLedgerStatus } from '../src/index.ts';
import { ownedConfig, platform } from './fixtures.ts';

afterEach(() => mock.restore());
class InjectedNativeFailure extends Data.TaggedError('InjectedNativeFailure')<{
  readonly secret: string;
}> {}

async function initialization() {
  function* scenario() {
    const { config, fs, root, file, guard } = yield* ownedConfig();
    expect(yield* initializeMigrationLedger(config)).toEqual({
      ledgerId: 'test-ledger',
      schemaVersion: 1,
    });
    const names = (yield* fs.readDirectory(root)).sort();
    const isShm = Schema.is(Schema.Literal('migration.sqlite-shm'));
    const stable = names.filter((name) => !isShm(name));
    const before = yield* Effect.forEach(stable, (name) => fs.readFile(`${root}/${name}`));
    const shm = yield* fs.stat(`${file}-shm`);
    expect(yield* readMigrationLedgerStatus(config)).toEqual({
      ledgerId: 'test-ledger',
      schemaVersion: 1,
      sequence: 0,
      runCount: 0,
      workerCount: 0,
    });
    expect((yield* fs.readDirectory(root)).sort()).toEqual(names);
    expect(yield* Effect.forEach(stable, (name) => fs.readFile(`${root}/${name}`))).toEqual(before);
    const afterShm = yield* fs.stat(`${file}-shm`);
    expect([afterShm.dev, afterShm.ino, afterShm.size, afterShm.mode, afterShm.uid]).toEqual([
      shm.dev,
      shm.ino,
      shm.size,
      shm.mode,
      shm.uid,
    ]);
    expect(names).toContain('migration.sqlite');
    expect(names).toContain('migration.sqlite.owner.sqlite');
    for (const name of [file, guard]) expect((yield* fs.stat(name)).mode & 0o777).toBe(0o600);
    expect(yield* initializeMigrationLedger(config).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
      failure: { operation: 'initialize', code: 'AlreadyExists' },
    });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'initialization creates only a validated empty ledger and refuses reinitialization',
  initialization,
);

for (const corruption of [
  'zero',
  'foreign',
  'version',
  'extra-table',
  'metadata',
  'nonempty',
] as const) {
  async function corrupted() {
    function* scenario() {
      const { config, fs, file, guard } = yield* ownedConfig();
      yield* initializeMigrationLedger(config);
      const db = new Database(file, { create: false, readwrite: true });
      const sql = Match.value(corruption).pipe(
        Match.when('foreign', () => 'PRAGMA application_id=42'),
        Match.when('version', () => 'PRAGMA user_version=2'),
        Match.when('extra-table', () => 'CREATE TABLE extra(x)'),
        Match.when('metadata', () => "UPDATE metadata SET ledger_id='other'"),
        Match.when('nonempty', () => 'UPDATE metadata SET sequence=1'),
        Match.when('zero', () => 'SELECT 1'),
        Match.exhaustive,
      );
      db.run(sql);
      db.close(true);
      const zero = fs.writeFile(file, new Uint8Array());
      const isZero = Schema.is(Schema.Literal('zero'));
      const zeroCase = Effect.succeed(isZero(corruption));
      yield* zero.pipe(Effect.when(zeroCase));
      const before = yield* fs.readFile(file);
      const closed: Database[] = [];
      const nativeClose = Database.prototype.close;
      function observe(this: Database, strict?: boolean) {
        expect(strict).toBe(true);
        closed.push(this);
        return nativeClose.call(this, strict);
      }
      spyOn(Database.prototype, 'close').mockImplementation(observe);
      const opening = openOwnedMigrationDatabase(config).pipe(Effect.result);
      const result = yield* Effect.scoped(opening);
      expect(result._tag).toBe('Failure');
      expect(closed.length).toBeGreaterThan(0);
      for (const connection of closed) expect(() => connection.query('SELECT 1').get()).toThrow();
      expect(yield* fs.readFile(file)).toEqual(before);
      const owner = new Database(guard, { create: false, readwrite: true });
      owner.run('BEGIN EXCLUSIVE');
      owner.close(true);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
  test(`refuses ${corruption} without repair and releases acquisition resources`, corrupted);
}

async function readonlyStatus() {
  function* scenario() {
    const { config, fs, root, file } = yield* ownedConfig();
    yield* initializeMigrationLedger(config);
    yield* openOwnedMigrationDatabase(config);
    const names = (yield* fs.readDirectory(root)).sort();
    const isShm = Schema.is(Schema.Literal('migration.sqlite-shm'));
    const stable = names.filter((name) => !isShm(name));
    const bytes = yield* Effect.forEach(stable, (name) => fs.readFile(`${root}/${name}`));
    const owner = new Database(file, { readonly: true, create: false });
    const schema = owner.query('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
    const metadata = owner.query('SELECT * FROM metadata').all();
    const statements: string[] = [];
    const nativeRun = Database.prototype.run;
    function observe(this: Database, ...args: Parameters<typeof nativeRun>) {
      statements.push(args[0]);
      return nativeRun.apply(this, args);
    }
    spyOn(Database.prototype, 'run').mockImplementation(observe);
    const output = spyOn(console, 'log');
    expect(yield* readMigrationLedgerStatus(config)).toEqual({
      ledgerId: 'test-ledger',
      schemaVersion: 1,
      sequence: 0,
      runCount: 0,
      workerCount: 0,
    });
    expect((yield* fs.readDirectory(root)).sort()).toEqual(names);
    expect(yield* Effect.forEach(stable, (name) => fs.readFile(`${root}/${name}`))).toEqual(bytes);
    expect(owner.query('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(
      schema,
    );
    expect(owner.query('SELECT * FROM metadata').all()).toEqual(metadata);
    expect(statements.every((sql) => /^PRAGMA busy_timeout=0$/.test(sql))).toBe(true);
    owner.close(true);
    expect(output).not.toHaveBeenCalled();
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'read-only status under live ownership changes no bytes, files or schema and stays silent',
  readonlyStatus,
);

async function cleanupFailure() {
  function* scenario() {
    const { config, guard } = yield* ownedConfig();
    yield* initializeMigrationLedger(config);
    const nativeClose = Database.prototype.close;
    const closed: Database[] = [];
    function failAfterClose(this: Database, strict?: boolean) {
      expect(strict).toBe(true);
      nativeClose.call(this, strict);
      closed.push(this);
      throw new InjectedNativeFailure({ secret: 'secret raw cause must not escape' });
    }
    const close = spyOn(Database.prototype, 'close').mockImplementation(failAfterClose);
    const result = yield* Effect.scoped(openOwnedMigrationDatabase(config)).pipe(Effect.exit);
    expect(Exit.isFailure(result)).toBe(true);
    expect(closed.length).toBe(2);
    const defects = Match.value(result).pipe(
      Match.tag('Failure', ({ cause }) =>
        cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect),
      ),
      Match.orElse(() => []),
    );
    expect(defects).toHaveLength(2);
    for (const defect of defects)
      expect(defect).toMatchObject({
        _tag: 'MigrationStorageError',
        operation: 'close',
        code: 'CloseFailed',
      });
    const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
    expect(encode(defects)).not.toContain('secret raw cause');
    close.mockRestore();
    for (const db of closed) expect(() => db.query('SELECT 1').get()).toThrow();
    const owner = new Database(guard, { create: false, readwrite: true });
    owner.run('BEGIN EXCLUSIVE');
    owner.close(true);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'strict close failures remain redacted and do not prevent the other native finalizer',
  cleanupFailure,
);

async function partialInitialization() {
  function* scenario() {
    const { config, fs, file, guard, root } = yield* ownedConfig();
    const nativeRun = Database.prototype.run;
    const closed: Database[] = [];
    const nativeClose = Database.prototype.close;
    function fault(this: Database, ...args: Parameters<typeof nativeRun>) {
      return Match.value(args[0]).pipe(
        Match.when(
          'CREATE TABLE runs (run_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991), payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT',
          () => {
            throw new InjectedNativeFailure({ secret: 'injected native DDL failure' });
          },
        ),
        Match.orElse(() => nativeRun.apply(this, args)),
      );
    }
    function observeClose(this: Database, strict?: boolean) {
      expect(strict).toBe(true);
      closed.push(this);
      return nativeClose.call(this, strict);
    }
    const run = spyOn(Database.prototype, 'run').mockImplementation(fault);
    spyOn(Database.prototype, 'close').mockImplementation(observeClose);
    expect(yield* initializeMigrationLedger(config).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
      failure: { operation: 'initialize' },
    });
    run.mockRestore();
    expect(closed).toHaveLength(2);
    expect(yield* fs.exists(file)).toBe(true);
    expect(yield* fs.exists(guard)).toBe(true);
    const names = (yield* fs.readDirectory(root)).sort();
    const before = yield* Effect.forEach(names, (name) => fs.readFile(`${root}/${name}`));
    expect((yield* initializeMigrationLedger(config).pipe(Effect.result))._tag).toBe('Failure');
    expect((yield* openOwnedMigrationDatabase(config).pipe(Effect.result))._tag).toBe('Failure');
    expect((yield* fs.readDirectory(root)).sort()).toEqual(names);
    expect(yield* Effect.forEach(names, (name) => fs.readFile(`${root}/${name}`))).toEqual(before);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'native DDL failure retains partial initialization without repair and closes every connection',
  partialInitialization,
);

for (const corruption of [
  'identity',
  'schema',
  'version',
  'application',
  'rollback-mode',
  'missing',
  'oversize',
  'truncated',
  'missing-wal',
  'missing-shm',
] as const) {
  async function liveGuardValidation() {
    function* scenario() {
      const { config, fs, root, guard, file } = yield* ownedConfig();
      yield* initializeMigrationLedger(config);
      const original = yield* fs.readFile(guard);
      const image = Database.deserialize(original, { strict: true });
      const sql = Match.value(corruption).pipe(
        Match.when('identity', () => "UPDATE ownership SET identity='wrong'"),
        Match.when('schema', () => 'CREATE TABLE foreign_table(x)'),
        Match.when('version', () => 'PRAGMA user_version=2'),
        Match.when('application', () => 'PRAGMA application_id=42'),
        Match.orElse(() => 'SELECT 1'),
      );
      image.run(sql);
      const encoded = image.serialize();
      image.close(true);
      yield* openOwnedMigrationDatabase(config);
      const invalidMode = original.slice();
      invalidMode[18] = 2;
      invalidMode[19] = 2;
      const replacement = Match.value(corruption).pipe(
        Match.when('rollback-mode', () => invalidMode),
        Match.when('oversize', () => new Uint8Array(1048577)),
        Match.when('truncated', () => original.subarray(0, 101)),
        Match.orElse(() => encoded),
      );
      const mutation = Match.value(corruption).pipe(
        Match.when('missing', () => fs.rename(guard, `${root}/removed-guard`)),
        Match.when('missing-wal', () => fs.remove(`${file}-wal`)),
        Match.when('missing-shm', () => fs.remove(`${file}-shm`)),
        Match.orElse(() => fs.writeFile(guard, replacement)),
      );
      yield* mutation;
      const names = (yield* fs.readDirectory(root)).sort();
      const before = yield* Effect.forEach(names, (name) => fs.readFile(`${root}/${name}`));
      const result = yield* readMigrationLedgerStatus(config).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: 'Failure', failure: { operation: 'status' } });
      expect((yield* fs.readDirectory(root)).sort()).toEqual(names);
      expect(yield* Effect.forEach(names, (name) => fs.readFile(`${root}/${name}`))).toEqual(
        before,
      );
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    await Effect.runPromise(provided);
  }
  test(
    `status refuses ${corruption} guard/state under live ownership without repair`,
    liveGuardValidation,
  );
}

async function guardImageSemantics() {
  function* scenario() {
    const { config, fs, guard } = yield* ownedConfig();
    yield* initializeMigrationLedger(config);
    yield* openOwnedMigrationDatabase(config);
    const bytes = yield* fs.readFile(guard);
    expect([...bytes.subarray(18, 20)]).toEqual([1, 1]);
    const image = Database.deserialize(bytes, { readonly: true, strict: true });
    expect(image.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'memory' });
    expect(() => image.query('UPDATE ownership SET identity=?').run('mutated')).toThrow('readonly');
    expect(image.query('SELECT $value AS value').get({ value: 7 })).toEqual({ value: 7 });
    image.close(true);
    expect(() => image.query('SELECT 1').get()).toThrow();
    expect(yield* fs.readFile(guard)).toEqual(bytes);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'pinned native readonly strict guard deserialize uses memory mode without changing disk rollback mode',
  guardImageSemantics,
);
