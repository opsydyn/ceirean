import type { Database } from 'bun:sqlite';

import { requireStorage } from './errors.ts';

export const applicationId = 0x4345524d;
export const ledgerTables = {
  metadata:
    'CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), ledger_id TEXT NOT NULL, identity TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>=0 AND sequence<=4096)) STRICT',
  runs: 'CREATE TABLE runs (run_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991), payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT',
  workers:
    'CREATE TABLE workers (operation_id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES runs(run_id), revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991), payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT',
  commits:
    'CREATE TABLE commits (sequence INTEGER PRIMARY KEY CHECK(sequence>0 AND sequence<=4096), payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT',
};
export const ownershipTables = {
  ownership:
    'CREATE TABLE ownership (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL) STRICT',
};

export function validateSchema(
  db: Database,
  tables: Readonly<Record<string, string>>,
  mode: 'wal' | 'delete' | 'memory',
) {
  const rows = db
    .query<{ name: string; sql: string }, []>(
      "SELECT name,sql FROM sqlite_master WHERE type='table'",
    )
    .all();
  requireStorage(
    rows.length === Object.keys(tables).length && rows.every((row) => tables[row.name] === row.sql),
    'IncompatibleSchema',
  );
  requireStorage(
    db.query<{ application_id: number }, []>('PRAGMA application_id').get()?.application_id ===
      applicationId,
    'IncompatibleSchema',
  );
  requireStorage(
    db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version === 1,
    'IncompatibleSchema',
  );
  requireStorage(
    db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode === mode,
    'IncompatibleSchema',
  );
  requireStorage(
    db
      .query(
        "SELECT name FROM sqlite_master WHERE type IN ('trigger','view') OR (type='index' AND sql IS NOT NULL)",
      )
      .all().length === 0,
    'IncompatibleSchema',
  );
  const checks = db.query<{ quick_check: string }, []>('PRAGMA quick_check').all();
  requireStorage(
    checks.length === 1 &&
      checks[0]?.quick_check === 'ok' &&
      db.query('PRAGMA foreign_key_check').all().length === 0,
    'InvalidData',
  );
}
export function settings(db: Database) {
  db.run('PRAGMA synchronous=FULL');
  db.run('PRAGMA foreign_keys=ON');
  db.run('PRAGMA busy_timeout=0');
}
