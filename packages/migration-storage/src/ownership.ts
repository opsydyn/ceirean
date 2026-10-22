import type { Database } from 'bun:sqlite';

import { requireStorage } from './errors.ts';
import { applicationId, ownershipTables, settings, validateSchema } from './schema.ts';

export function seedOwnership(db: Database, identity: string) {
  db.run('PRAGMA journal_mode=DELETE');
  settings(db);
  db.transaction(() => {
    db.run(ownershipTables.ownership);
    db.run(`PRAGMA application_id=${applicationId}`);
    db.run('PRAGMA user_version=1');
    db.query('INSERT INTO ownership VALUES(1,?)').run(identity);
  }).immediate();
}
export function lockOwnership(db: Database, identity: string) {
  db.run('PRAGMA busy_timeout=0');
  db.run('BEGIN EXCLUSIVE');
  validateSchema(db, ownershipTables, 'delete');
  validateOwnershipIdentity(db, identity);
}
export function validateOwnershipIdentity(db: Database, identity: string) {
  const rows = db.query<{ identity: string }, []>('SELECT identity FROM ownership').all();
  requireStorage(rows.length === 1 && rows[0]?.identity === identity, 'InvalidData');
}
