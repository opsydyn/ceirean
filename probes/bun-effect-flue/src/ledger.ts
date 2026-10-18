import { Database } from 'bun:sqlite';

import { Cause, Effect, Exit, Match, Option, Scope } from 'effect';

import type { FixtureRun } from './fixture.ts';
import type { ProbeReceipt } from './flue-probe.ts';
import { decodeCheckpoint, encodeCheckpoint } from './protocol.ts';

function initializeDatabase(db: Database) {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = FULL');
  db.run(
    'CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)',
  );
}

function throwInitializationFailure(cause: Cause.Cause<never>): never {
  const defects = cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect);
  throw Match.value(defects.length > 1).pipe(
    Match.when(true, () => new AggregateError(defects, 'SQLite initialization and cleanup failed')),
    Match.orElse(() => Cause.squash(cause)),
  );
}

export function openLedger(file: string) {
  const scope = Scope.makeUnsafe('sequential');
  // This exported native adapter owns the SQLite lifetime, including synchronous close.
  const acquire = Effect.sync(() => new Database(file, { create: true, strict: true }));
  const database = Effect.acquireRelease(acquire, (db) =>
    Effect.sync(() => {
      db.close();
    }),
  );
  const initialize = Effect.tap(database, (db) =>
    Effect.sync(() => {
      initializeDatabase(db);
    }),
  );
  const initialized = Scope.provide(scope)(initialize);
  const guarded = Effect.onError(initialized, (cause) => Scope.close(scope, Exit.failCause(cause)));
  // runSync would squash a combined initialization/cleanup cause to its first error.
  const db = Exit.match(Effect.runSyncExit(guarded), {
    onSuccess: (value) => value,
    onFailure: throwInitializationFailure,
  });
  function save(state: FixtureRun, receipt: ProbeReceipt) {
    db.query('INSERT OR REPLACE INTO checkpoint (id, payload) VALUES (1, ?)').run(
      encodeCheckpoint({ state, receipt }),
    );
  }
  function load(): { state: FixtureRun; receipt: ProbeReceipt } | null {
    const row = db
      .query<{ payload: string }, []>('SELECT payload FROM checkpoint WHERE id = 1')
      .get();
    return Option.match(Option.fromNullishOr(row), {
      onNone: () => null,
      onSome: (checkpoint) => decodeCheckpoint(checkpoint.payload),
    });
  }
  function close() {
    Effect.runSync(Scope.close(scope, Exit.void));
  }
  return { save, load, close };
}
