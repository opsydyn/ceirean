import { expect, test } from 'bun:test';

import { fromDurableObjectStorage } from 'alchemy/Cloudflare/Workers/DurableObjectStorage';
import { RuntimeContext } from 'alchemy/RuntimeContext';
import { Context, Data, Effect, Exit, Match, Option, Schema } from 'effect';

import type { Job } from '../src/readonly/job.ts';
import { makeJobStore } from '../src/readonly/store.ts';

type NativeStorage = Parameters<typeof fromDurableObjectStorage>[0];
type NativeTransaction = Parameters<Parameters<NativeStorage['transaction']>[0]>[0];

class InjectedAlarmFailure extends Data.TaggedError('InjectedAlarmFailure')<{
  readonly scheduledAtMs: number;
}> {}
class UnsupportedStorageOperation extends Data.TaggedError('UnsupportedStorageOperation')<{
  readonly operation: string;
}> {}

function unsupported(operation: string): never {
  throw new UnsupportedStorageOperation({ operation });
}

const policy = {
  sessionId: 'store-rehearsal',
  installationId: 10,
  ownerId: 20,
  repositoryId: 30,
  issueNumber: 40,
  operatorId: 50,
  opensAtMs: 1000,
  closesAtMs: 301000,
};
const candidate = {
  installationId: 10,
  ownerId: 20,
  repositoryId: 30,
  issueNumber: 40,
  operatorId: 50,
};
const queued = {
  _tag: 'Queued',
  sessionId: 'store-rehearsal',
  queuedAtMs: 1000,
  closesAtMs: 301000,
} as const satisfies Job;
const running = { ...queued, _tag: 'Running', startedAtMs: 1100 } as const satisfies Job;
const cleanup0 = {
  ...running,
  _tag: 'CleanupRequired',
  cleanupAttempts: 0,
  outcome: { _tag: 'Completed', runtime: 'v22.16.0' },
} as const satisfies Job;
const cleanup1 = {
  ...running,
  _tag: 'CleanupRequired',
  cleanupAttempts: 1,
  outcome: { _tag: 'Failed', code: 'Interrupted' },
} as const satisfies Job;
const cleanup2 = { ...cleanup1, cleanupAttempts: 2 } as const satisfies Job;
const interrupted = { ...queued, _tag: 'Failed', code: 'Interrupted' } as const satisfies Job;
const commandFailed = { ...queued, _tag: 'Failed', code: 'CommandFailed' } as const satisfies Job;
const succeeded = { ...running, _tag: 'Succeeded', runtime: 'v22.16.0' } as const satisfies Job;

const context = Context.make(RuntimeContext, {
  Type: 'Test',
  id: 'readonly-store-test',
  env: {},
  get: () => Effect.sync(() => undefined),
  set: (key) => Effect.sync(() => key),
});
const run = Effect.runPromiseWith(context);
const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);

function transactionalStorage(seed?: Job, initialAlarm: number | null = null) {
  const initialValues = Option.fromUndefinedOr(seed).pipe(
    Option.map((job) => ['readonly-job', structuredClone(job)] as const),
  );
  let committed = {
    values: new Map<string, unknown>(Option.toArray(initialValues)),
    alarm: initialAlarm,
    alarmWrites: [] as number[],
  };
  let active: typeof committed | undefined;
  let tail = Promise.resolve();
  let failAlarm = false;
  const current = () => active ?? committed;

  function readValue<T>(key: string) {
    // Native get<T> trusts the caller's type at this serialization boundary.
    return structuredClone(current().values.get(key)) as T | undefined;
  }
  function get<T = unknown>(key: string): Promise<T | undefined>;
  function get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async function get<T = unknown>(key: string | string[]) {
    function readMany(keys: string[]) {
      function pair(name: string) {
        const found = Option.fromUndefinedOr(readValue<T>(name));
        const entry = Option.map(found, (value) => [name, value] as const);
        return Option.toArray(entry);
      }
      return new Map(keys.flatMap(pair));
    }
    return Match.value(key).pipe(
      Match.when(isString, (name) => readValue<T>(name)),
      Match.orElse(readMany),
    );
  }
  async function put(key: string | Record<string, unknown>, value?: unknown) {
    const entries = Match.value(key).pipe(
      Match.when(isString, (name) => [[name, value] as const]),
      Match.orElse(Object.entries),
    );
    for (const [name, entry] of entries) current().values.set(name, structuredClone(entry));
  }
  function remove(key: string): Promise<boolean>;
  function remove(keys: string[]): Promise<number>;
  async function remove(key: string | string[]) {
    return Match.value(key).pipe(
      Match.when(isString, (name) => current().values.delete(name)),
      Match.orElse((keys) =>
        keys.reduce((count, name) => count + Number(current().values.delete(name)), 0),
      ),
    );
  }
  async function setAlarm(time: number | Date) {
    const timestamp = Match.value(time).pipe(
      Match.when(isNumber, (value) => value),
      Match.orElse((value) => value.getTime()),
    );
    current().alarm = timestamp;
    current().alarmWrites.push(timestamp);
    return Match.value(failAlarm).pipe(
      Match.when(true, () => {
        failAlarm = false;
        throw new InjectedAlarmFailure({ scheduledAtMs: timestamp });
      }),
      Match.orElse(() => undefined),
    );
  }
  async function deleteAlarm() {
    current().alarm = null;
  }
  async function getAlarm() {
    return current().alarm;
  }
  async function transaction<A>(closure: (transaction: NativeTransaction) => Promise<A>) {
    const previous = tail;
    let unlock = () => {};
    tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    const draft = structuredClone(committed);
    let rolledBack = false;
    active = draft;
    const transaction = {
      get,
      put,
      delete: remove,
      setAlarm,
      deleteAlarm,
      getAlarm,
      list: () => unsupported('transaction.list'),
      rollback: () => {
        rolledBack = true;
      },
    } satisfies NativeTransaction;
    function commit(result: A) {
      committed = Match.value(rolledBack).pipe(
        Match.when(false, () => draft),
        Match.orElse(() => committed),
      );
      return result;
    }
    return Promise.resolve()
      .then(() => closure(transaction))
      .then(commit)
      .finally(() => {
        active = undefined;
        unlock();
      });
  }
  const raw = {
    get,
    put,
    delete: remove,
    setAlarm,
    deleteAlarm,
    getAlarm,
    transaction,
    list: () => unsupported('list'),
    deleteAll: () => unsupported('deleteAll'),
    sync: async () => {},
    transactionSync: () => unsupported('transactionSync'),
    getCurrentBookmark: () => unsupported('getCurrentBookmark'),
    getBookmarkForTime: () => unsupported('getBookmarkForTime'),
    onNextSessionRestoreBookmark: () => unsupported('onNextSessionRestoreBookmark'),
    sql: {
      exec: () => unsupported('sql.exec'),
      databaseSize: 0,
      get Cursor() {
        return unsupported('sql.Cursor');
      },
      get Statement() {
        return unsupported('sql.Statement');
      },
    },
    kv: {
      get: () => unsupported('kv.get'),
      put: () => unsupported('kv.put'),
      delete: () => unsupported('kv.delete'),
      list: () => unsupported('kv.list'),
    },
  } satisfies NativeStorage;
  function restart() {
    return makeJobStore(fromDurableObjectStorage(raw));
  }
  function fireAlarm() {
    const alarm = committed.alarm;
    committed.alarm = null;
    return alarm;
  }
  return {
    store: restart(),
    restart,
    fireAlarm,
    snapshot: () => structuredClone(committed),
    failNextAlarm: () => {
      failAlarm = true;
    },
  };
}

async function duplicateAdmission() {
  const fixture = transactionalStorage();
  expect(await run(fixture.store.read())).toBeNull();
  expect(await run(fixture.store.admit(policy, candidate, 1000))).toEqual(queued);
  const restarted = fixture.restart();
  expect(await run(restarted.admit(policy, candidate, 1001))).toEqual(queued);
  expect(await run(restarted.read())).toEqual(queued);
  expect(fixture.snapshot().values.size).toBe(1);
  expect(fixture.snapshot().alarmWrites).toEqual([1001]);
  expect(fixture.fireAlarm()).toBe(1001);
  const dispatch = await run(restarted.take(1100));
  expect(dispatch).toEqual({ _tag: 'Run', job: running });
  expect(await run(restarted.admit(policy, candidate, 1200))).toEqual(running);
  expect(fixture.snapshot().alarmWrites).toEqual([1001, 76100]);
}
test(
  'duplicate admission across reconstruction persists one job and one dispatch alarm',
  duplicateAdmission,
);

async function admissionRollback() {
  const fixture = transactionalStorage();
  fixture.failNextAlarm();
  const exit = await run(fixture.store.admit(policy, candidate, 1000).pipe(Effect.exit));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(await run(fixture.restart().read())).toBeNull();
  expect(fixture.snapshot()).toEqual({ values: new Map(), alarm: null, alarmWrites: [] });
  expect(await run(fixture.store.admit(policy, candidate, 1000))).toEqual(queued);
  expect(fixture.snapshot().alarmWrites).toEqual([1001]);
}
test('alarm failure rolls back admission and allows the same session to retry', admissionRollback);

async function claimRollback() {
  const fixture = transactionalStorage(queued, 1001);
  fixture.failNextAlarm();
  const exit = await run(fixture.store.take(1100).pipe(Effect.exit));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(await run(fixture.restart().read())).toEqual(queued);
  expect(fixture.snapshot().alarm).toBe(1001);
  expect(fixture.snapshot().alarmWrites).toEqual([]);
  expect(await run(fixture.store.take(1100))).toEqual({ _tag: 'Run', job: running });
}
test('watchdog failure rolls back the claim instead of stranding a Running job', claimRollback);

async function finishRollback() {
  const fixture = transactionalStorage(running, 76100);
  fixture.failNextAlarm();
  const exit = await run(fixture.store.finish(cleanup0, running, 1200).pipe(Effect.exit));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(await run(fixture.restart().read())).toEqual(running);
  expect(fixture.snapshot().alarm).toBe(76100);
  expect(fixture.snapshot().alarmWrites).toEqual([]);
  expect(await run(fixture.store.finish(cleanup0, running, 1300))).toEqual(cleanup0);
  expect(fixture.snapshot().alarm).toBe(16300);
}
test('failed cleanup rearming rolls back both the new job and the alarm', finishRollback);

async function terminalReadback() {
  for (const terminal of [succeeded, commandFailed]) {
    const fixture = transactionalStorage(running, 76100);
    expect(await run(fixture.store.finish(terminal, running, 1200))).toEqual(terminal);
    expect(await run(fixture.restart().read())).toEqual(terminal);
    expect(fixture.snapshot().alarm).toBeNull();
    expect(await run(fixture.restart().take(80000))).toEqual({ _tag: 'None' });
    expect(fixture.snapshot().alarmWrites).toEqual([]);
  }
}
test(
  'terminal success and command failure roundtrip after restart and cancel the watchdog',
  terminalReadback,
);

async function restartRecovery() {
  const fixture = transactionalStorage(running, 76100);
  expect(fixture.fireAlarm()).toBe(76100);
  const restarted = fixture.restart();
  expect(await run(restarted.take(76100))).toEqual({ _tag: 'Recover', job: cleanup1 });
  expect(await run(fixture.restart().read())).toEqual(cleanup1);
  expect(fixture.snapshot().alarm).toBe(106100);
  expect(await run(restarted.finish(interrupted, cleanup1, 76200))).toEqual(interrupted);
  expect(fixture.snapshot().alarm).toBeNull();
  expect(await run(fixture.restart().take(107000))).toEqual({ _tag: 'None' });
}
test(
  'a reconstructed Running job persists cleanup attempt one and never dispatches Run again',
  restartRecovery,
);

async function cleanupRetries() {
  const fixture = transactionalStorage(running, 76100);
  expect(await run(fixture.store.finish(cleanup0, running, 1200))).toEqual(cleanup0);
  expect(fixture.snapshot().alarm).toBe(16200);
  expect(fixture.fireAlarm()).toBe(16200);
  const first = fixture.restart();
  expect(await run(first.take(16200))).toEqual({ _tag: 'Recover', job: cleanup1 });
  expect(fixture.snapshot().alarm).toBe(46200);
  expect(await run(first.finish(cleanup1, cleanup1, 16300))).toEqual(cleanup1);
  expect(fixture.snapshot().alarm).toBe(31300);
  expect(fixture.fireAlarm()).toBe(31300);
  const second = fixture.restart();
  expect(await run(second.take(31300))).toEqual({ _tag: 'Recover', job: cleanup2 });
  expect(fixture.snapshot().alarm).toBe(61300);
  expect(await run(second.finish(cleanup2, cleanup2, 31400))).toEqual(cleanup2);
  expect(fixture.snapshot().alarm).toBeNull();
  expect(await run(fixture.restart().take(62000))).toEqual({ _tag: 'None' });
  expect(await run(fixture.store.read())).toEqual(cleanup2);
  expect(fixture.snapshot().alarmWrites).toEqual([16200, 46200, 31300, 61300]);
}
test('uncertain cleanup rearms attempts zero and one but stops after attempt two', cleanupRetries);

async function recoveryCrashExhaustion() {
  const fixture = transactionalStorage(running, 76100);
  fixture.fireAlarm();
  expect(await run(fixture.restart().take(76100))).toEqual({ _tag: 'Recover', job: cleanup1 });
  expect(fixture.fireAlarm()).toBe(106100);
  expect(await run(fixture.restart().take(106100))).toEqual({ _tag: 'Recover', job: cleanup2 });
  expect(fixture.fireAlarm()).toBe(136100);
  expect(await run(fixture.restart().take(136100))).toEqual({ _tag: 'None' });
  expect(await run(fixture.store.read())).toEqual(cleanup2);
  expect(fixture.snapshot().alarm).toBeNull();
  expect(fixture.snapshot().alarmWrites).toEqual([106100, 136100]);
}
test(
  'crashes during both recovery attempts exhaust the watchdog without reexecution',
  recoveryCrashExhaustion,
);

async function lateRunningResult() {
  const fixture = transactionalStorage(running, 76100);
  fixture.fireAlarm();
  expect(await run(fixture.store.take(76100))).toEqual({ _tag: 'Recover', job: cleanup1 });
  const before = fixture.snapshot();
  expect(await run(fixture.store.finish(succeeded, running, 76200))).toEqual(cleanup1);
  expect(fixture.snapshot()).toEqual(before);
  expect(await run(fixture.store.finish(interrupted, cleanup1, 76300))).toEqual(interrupted);
  expect(await run(fixture.restart().finish(succeeded, running, 76400))).toEqual(interrupted);
  expect(await run(fixture.store.read())).toEqual(interrupted);
  expect(fixture.snapshot().alarm).toBeNull();
}
test(
  'a late Running completion returns the recovery or terminal record without overwriting it',
  lateRunningResult,
);

async function lateCleanupResult() {
  const fixture = transactionalStorage(cleanup1, 46200);
  fixture.fireAlarm();
  expect(await run(fixture.store.take(46200))).toEqual({ _tag: 'Recover', job: cleanup2 });
  const before = fixture.snapshot();
  expect(await run(fixture.store.finish(interrupted, cleanup1, 46300))).toEqual(cleanup2);
  expect(await run(fixture.store.finish(cleanup1, cleanup1, 46400))).toEqual(cleanup2);
  expect(fixture.snapshot()).toEqual(before);
  expect(await run(fixture.store.finish(interrupted, cleanup2, 46500))).toEqual(interrupted);
  expect(fixture.snapshot().alarm).toBeNull();
}
test(
  'full-job CAS rejects stale attempt one after attempt two has been persisted',
  lateCleanupResult,
);

async function finishWithoutJob() {
  const fixture = transactionalStorage();
  expect(await run(fixture.store.finish(succeeded, running, 1200))).toBeNull();
  expect(fixture.snapshot()).toEqual({ values: new Map(), alarm: null, alarmWrites: [] });
}
test(
  'finish returns null and allocates nothing when the expected prior job is absent',
  finishWithoutJob,
);
