import { Database } from 'bun:sqlite';
import { Schema } from 'effect';
import type { FixtureRun } from './fixture.ts';
import type { ProbeReceipt } from './flue-probe.ts';

const Checkpoint = Schema.Struct({
  state: Schema.Struct({
    phase: Schema.Literals(['pending', 'frozen', 'verified', 'cancelled']),
    generation: Schema.Number, digest: Schema.NullOr(Schema.String),
    deadlineMs: Schema.Number, spentMicros: Schema.Number, repairs: Schema.Number,
  }),
  receipt: Schema.Struct({ submissionId: Schema.String, uid: Schema.String }),
});

export function openLedger(file: string) {
  const db = new Database(file, { create: true, strict: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = FULL');
  db.run('CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)');
  return {
    save(state: FixtureRun, receipt: ProbeReceipt) {
      db.query('INSERT OR REPLACE INTO checkpoint (id, payload) VALUES (1, ?)')
        .run(JSON.stringify({ state, receipt }));
    },
    load(): { state: FixtureRun; receipt: ProbeReceipt } | null {
      const row = db.query<{ payload: string }, []>('SELECT payload FROM checkpoint WHERE id = 1').get();
      return row ? Schema.decodeUnknownSync(Checkpoint)(JSON.parse(row.payload)) : null;
    },
    close() { db.close(); },
  };
}
