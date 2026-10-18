import { Database } from 'bun:sqlite';

import { Effect, Exit, Option, Scope } from 'effect';

import type { FixtureRun } from './fixture.ts';
import type { ProbeReceipt } from './flue-probe.ts';
import { decodeCheckpoint, encodeCheckpoint } from './protocol.ts';

export function openLedger(file: string) {
  const scope = Scope.makeUnsafe('sequential');
  // This exported native adapter owns the SQLite lifetime, including synchronous close.
  const acquire = Effect.sync(() => new Database(file, { create: true, strict: true }));
  const database = Effect.acquireRelease(acquire, (db) =>
    Effect.sync(() => {
      db.close();
    }),
  );
  const db = Effect.runSync(Scope.provide(scope)(database));
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = FULL');
  db.run(
    'CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)',
  );
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
