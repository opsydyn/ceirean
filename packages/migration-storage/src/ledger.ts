import type { MigrationLedgerConfig } from './config.ts';
import { initializeDatabase, readDatabaseStatus } from './database.ts';

export function initializeMigrationLedger(config: MigrationLedgerConfig) {
  return initializeDatabase(config);
}
export function readMigrationLedgerStatus(config: MigrationLedgerConfig) {
  return readDatabaseStatus(config);
}
