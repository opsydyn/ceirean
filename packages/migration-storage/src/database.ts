import { Database } from 'bun:sqlite';

import { migrationLedgerBounds } from '@ceirean/engine/journal-policy';
import { Effect, Exit, FileSystem, Match, Option, Result, Scope, Schema } from 'effect';

import { validateEmptyLedger } from './codec.ts';
import { MigrationLedgerConfig } from './config.ts';
import { MigrationStorageError, requireStorage, sanitized } from './errors.ts';
import { lockOwnership, seedOwnership, validateOwnershipIdentity } from './ownership.ts';
import { prepareMigrationPaths } from './paths.ts';
import {
  applicationId,
  ledgerTables,
  ownershipTables,
  settings,
  validateSchema,
} from './schema.ts';

function validateGuardImage(file: FileSystem.File, identity: string) {
  function checked(valid: boolean) {
    const checking = Effect.try({
      try: () => requireStorage(valid, 'InvalidData'),
      catch: (error) => sanitized(error, 'status', 'InvalidData'),
    });
    return checking;
  }
  function* read() {
    const before = yield* file.stat;
    const size = Number(before.size);
    yield* checked(size >= 100 && size <= migrationLedgerBounds.maxRecordBytes);
    const bytes = new Uint8Array(size);
    let used = 0;
    while (used < size) {
      const count = yield* file.read(bytes.subarray(used));
      yield* checked(count > 0);
      used += count;
    }
    const after = yield* file.stat;
    const stable = [
      before.dev === after.dev,
      Option.getOrElse(before.ino, () => -1n) === Option.getOrElse(after.ino, () => -2n),
      before.size === after.size,
      bytes[18] === 1,
      bytes[19] === 1,
    ].every(Boolean);
    yield* checked(stable);
    // Guard only: its schema/identity is immutable after initialization. The main
    // ledger always uses SQLite's real WAL-aware connection, never an image.
    const opening = Effect.try({
      try: () => Database.deserialize(bytes, { readonly: true, strict: true }),
      catch: (error) => sanitized(error, 'status', 'InvalidData'),
    });
    const image = yield* Effect.acquireRelease(opening, (db) =>
      Effect.sync(() => {
        const closed = Result.try({
          try: () => db.close(true),
          catch: () => new MigrationStorageError({ operation: 'close', code: 'CloseFailed' }),
        });
        Result.getOrThrow(closed);
      }),
    );
    yield* Effect.try({
      try: () => {
        validateSchema(image, ownershipTables, 'memory');
        validateOwnershipIdentity(image, identity);
      },
      catch: (error) => sanitized(error, 'status', 'InvalidData'),
    });
  }
  const validation = Effect.gen(read);
  return validation.pipe(Effect.scoped);
}

function ownedConnection(file: string, readonly: boolean) {
  const opening = Effect.try({
    try: () => new Database(file, { create: false, readonly, readwrite: !readonly, strict: true }),
    catch: (error) => sanitized(error, 'open', 'OpenFailed'),
  });
  const owned = Effect.acquireRelease(opening, (db) =>
    Effect.sync(() => {
      const closed = Result.try({
        try: () => db.close(true),
        catch: () => new MigrationStorageError({ operation: 'close', code: 'CloseFailed' }),
      });
      Result.getOrThrow(closed);
    }),
  );
  return owned;
}
function createLedger(db: Database, config: MigrationLedgerConfig, identity: string) {
  db.run('PRAGMA journal_mode=WAL');
  settings(db);
  function create() {
    for (const sql of Object.values(ledgerTables)) db.run(sql);
    db.run(`PRAGMA application_id=${applicationId}`);
    db.run('PRAGMA user_version=1');
    db.query('INSERT INTO metadata VALUES(1,?,?,0)').run(config.ledgerId, identity);
  }
  db.transaction(create).immediate();
}
function acquire(input: MigrationLedgerConfig, intent: 'initialize' | 'open' | 'status') {
  const isInitialize = Schema.is(Schema.Literal('initialize'));
  const isStatus = Schema.is(Schema.Literal('status'));
  function* open() {
    const config = yield* Schema.decodeUnknownEffect(MigrationLedgerConfig, {
      onExcessProperty: 'error',
    })(input).pipe(
      Effect.mapError(
        () => new MigrationStorageError({ operation: intent, code: 'InvalidConfig' }),
      ),
    );
    const paths = yield* prepareMigrationPaths(config, isInitialize(intent));
    function* validateExistingSidecars() {
      const fs = yield* FileSystem.FileSystem;
      const wal = yield* fs.exists(`${paths.file}-wal`);
      const shm = yield* fs.exists(`${paths.file}-shm`);
      yield* Effect.try({
        try: () => requireStorage(wal && shm, 'UnsafePath'),
        catch: (error) => sanitized(error, intent, 'UnsafePath'),
      });
    }
    const sidecarValidation = Effect.gen(validateExistingSidecars);
    const existing = Effect.succeed(!isInitialize(intent));
    yield* sidecarValidation.pipe(Effect.when(existing));
    const guardValidation = validateGuardImage(paths.guardFile, paths.identity);
    const status = Effect.succeed(isStatus(intent));
    yield* guardValidation.pipe(Effect.when(status));
    function* own() {
      const guard = yield* ownedConnection(paths.guard, false);
      const seed = Effect.try({
        try: () => seedOwnership(guard, paths.identity),
        catch: (error) => sanitized(error, intent, 'OpenFailed'),
      });
      const initializing = Effect.succeed(isInitialize(intent));
      yield* seed.pipe(Effect.when(initializing));
      yield* Effect.try({
        try: () => lockOwnership(guard, paths.identity),
        catch: (error) => sanitized(error, intent, 'OpenFailed'),
      });
    }
    const ownership = Effect.gen(own);
    const needsOwner = Effect.sync(() => !isStatus(intent));
    yield* ownership.pipe(Effect.when(needsOwner));
    const db = yield* ownedConnection(paths.file, isStatus(intent));
    function validate() {
      const action = Match.value(intent).pipe(
        Match.when('initialize', () => () => createLedger(db, config, paths.identity)),
        Match.when('open', () => () => settings(db)),
        Match.when('status', () => () => db.run('PRAGMA busy_timeout=0')),
        Match.exhaustive,
      );
      action();
      validateEmptyLedger(db, config, paths.identity);
    }
    yield* Effect.try({ try: validate, catch: (error) => sanitized(error, intent, 'InvalidData') });
    const readback = yield* prepareMigrationPaths(config, false);
    yield* Effect.try({
      try: () => requireStorage(readback.identity === paths.identity, 'UnsafePath'),
      catch: (error) => sanitized(error, intent, 'UnsafePath'),
    });
    return { db, config, identity: paths.identity };
  }
  const opening = Effect.gen(open);
  return opening.pipe(Effect.mapError((error) => sanitized(error, intent, 'OpenFailed')));
}

// Internal module only: never re-export a native handle through the package boundary.
export function openOwnedMigrationDatabase(config: MigrationLedgerConfig) {
  function* open() {
    const parent = yield* Effect.scope;
    const child = yield* Scope.fork(parent);
    const acquired = yield* acquire(config, 'open').pipe(
      Scope.provide(child),
      Effect.onError((cause) => Scope.close(child, Exit.failCause(cause))),
    );
    return acquired.db;
  }
  const opening = Effect.gen(open);
  return opening;
}
export function initializeDatabase(config: MigrationLedgerConfig) {
  return acquire(config, 'initialize').pipe(
    Effect.map(({ config: valid }) => ({ ledgerId: valid.ledgerId, schemaVersion: 1 as const })),
    Effect.scoped,
  );
}
export function readDatabaseStatus(config: MigrationLedgerConfig) {
  return acquire(config, 'status').pipe(
    Effect.map(({ db, config: valid, identity }) => validateEmptyLedger(db, valid, identity)),
    Effect.scoped,
  );
}
