import { FrozenRun, VerificationContract } from '@ceirean/domain';
import { recoverMigrationLedger, type MigrationLedgerReply } from '@ceirean/engine/journal-policy';
import { Effect, Match, Result, Schema } from 'effect';

import { unwrap } from './codec.ts';
import type { MigrationLedgerConfig } from './config.ts';
import { initializeDatabase, readDatabaseStatus } from './database.ts';
import { openOwnedMigrationDatabase } from './database.ts';
import { makeDrivers } from './drivers.ts';
import { MigrationStorageError } from './errors.ts';
import { makeTransactions } from './transaction.ts';

export function initializeMigrationLedger(config: MigrationLedgerConfig) {
  return initializeDatabase(config);
}
export function readMigrationLedgerStatus(config: MigrationLedgerConfig) {
  return readDatabaseStatus(config);
}

const registration = Schema.Struct({ state: FrozenRun, contract: VerificationContract });
export function openMigrationLedger(config: MigrationLedgerConfig) {
  function release(transactions: ReturnType<typeof makeTransactions>) {
    const closing = Effect.sync(() => {
      const result = transactions
        .close()
        .pipe(
          Result.mapError(
            () => new MigrationStorageError({ operation: 'close', code: 'CloseFailed' }),
          ),
        );
      unwrap(result);
    });
    return closing;
  }
  const owned = Effect.acquireRelease(
    openOwnedMigrationDatabase(config).pipe(
      Effect.map((db) => makeTransactions(db, config.testFault)),
    ),
    release,
  );
  function services(transactions: ReturnType<typeof makeTransactions>) {
    function selectRegistration(reply: MigrationLedgerReply) {
      return Match.value(reply).pipe(
        Match.tag('Registered', 'RegistrationRefused', (value) => Result.succeed(value)),
        Match.orElse(() =>
          Result.fail(new MigrationStorageError({ operation: 'register', code: 'InvalidData' })),
        ),
      );
    }
    function registerRun(input: unknown) {
      function* register() {
        yield* Effect.fromResult(transactions.ensureOpen());
        const value = yield* Schema.decodeUnknownEffect(registration, {
          onExcessProperty: 'error',
        })(input).pipe(
          Effect.mapError(
            () => new MigrationStorageError({ operation: 'register', code: 'InvalidData' }),
          ),
        );
        const reply = yield* Effect.fromResult(
          transactions.commit({ _tag: 'RegisterRun', ...value }),
        );
        return yield* Effect.fromResult(selectRegistration(reply));
      }
      const registering = Effect.gen(register);
      return registering;
    }
    function readRecovery() {
      const reading = Effect.suspend(() =>
        Effect.fromResult(
          transactions.read().pipe(
            Result.flatMap(recoverMigrationLedger),
            Result.mapError(
              (error) => new MigrationStorageError({ operation: 'read', code: error.code }),
            ),
          ),
        ),
      );
      return reading;
    }
    return { ...makeDrivers(transactions), registerRun, readRecovery };
  }
  const opening = owned.pipe(Effect.map(services));
  return opening;
}
