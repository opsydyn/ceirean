import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';

import { openLedger } from '../src/ledger.ts';

async function initializationFailure(step: number) {
  const originalRun = Database.prototype.run;
  const failure = new Error('Injected SQLite initialization failure');
  const databases: Database[] = [];
  let statements = 0;
  function runWithFailure(this: Database, ...args: Parameters<Database['run']>) {
    databases.push(this);
    statements++;
    if (statements === step) throw failure;
    return originalRun.apply(this, args);
  }
  const run = spyOn(Database.prototype, 'run').mockImplementation(runWithFailure);

  await Promise.resolve()
    .then(async () => {
      const outcome = await Promise.resolve()
        .then(() => openLedger(':memory:'))
        .catch((cause: unknown) => cause);
      expect(outcome).toBe(failure);
      run.mockRestore();
      expect(databases[0]).toBeDefined();
      expect(() => databases[0]!.query('SELECT 1').get()).toThrow(/closed/i);
    })
    .finally(() => {
      run.mockRestore();
      databases[0]?.close();
    });
}

test.each([1, 2, 3])(
  'initialization failure at statement %i closes the database',
  initializationFailure,
);

test('successful ledger stays usable until explicit idempotent close', async () => {
  const ledger = openLedger(':memory:');
  await Promise.resolve()
    .then(() => {
      expect(ledger.load()).toBeNull();
      ledger.close();
      expect(() => ledger.load()).toThrow(/closed/i);
      expect(() => ledger.close()).not.toThrow();
    })
    .finally(() => ledger.close());
});

test('explicit close reports a cleanup failure', async () => {
  const originalClose = Database.prototype.close;
  const ledger = openLedger(':memory:');
  const failure = new Error('Injected SQLite close failure');
  function closeWithFailure(this: Database, ...args: Parameters<Database['close']>) {
    originalClose.apply(this, args);
    throw failure;
  }
  const close = spyOn(Database.prototype, 'close').mockImplementation(closeWithFailure);
  await Promise.resolve()
    .then(() => {
      expect(() => ledger.close()).toThrow(failure.message);
      expect(() => ledger.load()).toThrow(/closed/i);
    })
    .finally(() => close.mockRestore());
});

test('initialization and cleanup failures are both reported', async () => {
  const originalClose = Database.prototype.close;
  const initializationFailure = new Error('Injected SQLite initialization failure');
  const cleanupFailure = new Error('Injected SQLite close failure');
  function failInitialization(): never {
    throw initializationFailure;
  }
  function closeWithFailure(this: Database, ...args: Parameters<Database['close']>) {
    originalClose.apply(this, args);
    throw cleanupFailure;
  }
  const run = spyOn(Database.prototype, 'run').mockImplementation(failInitialization);
  const close = spyOn(Database.prototype, 'close').mockImplementation(closeWithFailure);
  await Promise.resolve()
    .then(async () => {
      const outcome = await Promise.resolve()
        .then(() => openLedger(':memory:'))
        .catch((cause: unknown) => cause);
      expect(outcome).toBeInstanceOf(AggregateError);
      expect((outcome as AggregateError).errors).toContain(initializationFailure);
      expect((outcome as AggregateError).errors).toContain(cleanupFailure);
    })
    .finally(() => {
      run.mockRestore();
      close.mockRestore();
    });
});
