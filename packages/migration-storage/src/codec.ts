import type { Database } from 'bun:sqlite';

import { recoverMigrationLedger } from '@ceirean/engine/journal-policy';
import { Result } from 'effect';

import type { MigrationLedgerConfig } from './config.ts';
import { requireStorage } from './errors.ts';
import { ledgerTables, validateSchema } from './schema.ts';

// Task 3 accepts empty ledgers only. Nonempty history needs Task 4's command replay.
export function validateEmptyLedger(db: Database, config: MigrationLedgerConfig, identity: string) {
  validateSchema(db, ledgerTables, 'wal');
  const rows = db
    .query<{ ledger_id: string; identity: string; sequence: number }, []>(
      'SELECT ledger_id,identity,sequence FROM metadata',
    )
    .all();
  const metadataValid = [
    rows.length === 1,
    rows[0]?.ledger_id === config.ledgerId,
    rows[0]?.identity === identity,
    rows[0]?.sequence === 0,
  ].every(Boolean);
  requireStorage(metadataValid, 'InvalidData');
  const totals = db
    .query<{ runs: number; workers: number; commits: number }, []>(
      'SELECT (SELECT count(*) FROM runs) AS runs,(SELECT count(*) FROM workers) AS workers,(SELECT count(*) FROM commits) AS commits',
    )
    .get();
  const empty = [totals?.runs === 0, totals?.workers === 0, totals?.commits === 0].every(Boolean);
  requireStorage(empty, 'InvalidData');
  const recovered = recoverMigrationLedger({ runs: [], workers: [], sequence: 0 });
  requireStorage(Result.isSuccess(recovered), 'InvalidData');
  return {
    ledgerId: config.ledgerId,
    schemaVersion: 1 as const,
    sequence: 0,
    runCount: 0,
    workerCount: 0,
  };
}
