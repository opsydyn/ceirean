import { expect, test } from 'bun:test';

import { Data, Effect, Fiber, Match, Option, Result, Tracer } from 'effect';

import { WorkerJournalError, WorkerMechanismError } from '../src/worker-errors.ts';
import { WorkerJournal, WorkerMechanism } from '../src/worker-ports.ts';
import {
  makeWorkerJournal,
  makeWorkerMechanism,
  type WorkerJournalDriver,
  type WorkerMechanismDriver,
} from '../src/worker-service-factories.ts';
import {
  claimEdit,
  makeWorkerCase,
  makeWorkerIntent,
  makeWorkerSnapshot,
} from './worker-fixtures.ts';
import { makeMemoryWorkerJournal } from './worker-memory-journal.ts';

class NativeFailure extends Data.TaggedError('NativeFailure')<{ readonly secret: string }> {}

async function deferredJournal() {
  const seed = makeWorkerSnapshot();
  const edit = claimEdit(seed);
  const calls: unknown[] = [];
  function load(id: typeof seed.operation.operationId) {
    calls.push(id);
    return Result.succeed(Option.some(seed));
  }
  function commit(request: Parameters<WorkerJournalDriver['commit']>[0]) {
    calls.push(request);
    return Result.succeed({ _tag: 'Conflict' as const, operationId: request.operationId });
  }
  const journal = makeWorkerJournal({ load, commit });
  const loading = journal.load(seed.operation.operationId);
  const committing = journal.commit(edit);
  expect(calls).toEqual([]);
  expect(await Effect.runPromise(loading)).toEqual(Option.some(seed));
  expect(await Effect.runPromise(loading)).toEqual(Option.some(seed));
  expect(await Effect.runPromise(committing)).toEqual({
    _tag: 'Conflict',
    operationId: seed.operation.operationId,
  });
  expect(calls).toEqual([seed.operation.operationId, seed.operation.operationId, edit]);
}
test(
  'journal driver calls are deferred and repeatable with unmodified Result values',
  deferredJournal,
);

function journalCall(service: ReturnType<typeof makeWorkerJournal>, operation: 'load' | 'commit') {
  const seed = makeWorkerSnapshot();
  return Match.value(operation).pipe(
    Match.when('load', () => service.load(seed.operation.operationId)),
    Match.when('commit', () => service.commit(claimEdit(seed))),
    Match.exhaustive,
    Effect.asVoid,
    Effect.result,
  );
}

for (const operation of ['load', 'commit'] as const) {
  async function journalFailure() {
    const error = new WorkerJournalError({ operation, code: 'InvalidData' });
    const typed = makeWorkerJournal({
      load: () => Result.fail(error),
      commit: () => Result.fail(error),
    });
    const result = await Effect.runPromise(journalCall(typed, operation));
    const failure = Result.getFailure(result);
    expect(Option.getOrThrow(failure)).toBe(error);
    function explode(): never {
      throw new NativeFailure({ secret: 'private' });
    }
    const native = makeWorkerJournal({ load: explode, commit: explode });
    const code = Match.value(operation).pipe(
      Match.when('load', () => 'ReadFailed' as const),
      Match.when('commit', () => 'CommitFailed' as const),
      Match.exhaustive,
    );
    const expected = new WorkerJournalError({ operation, code });
    expect(await Effect.runPromise(journalCall(native, operation))).toEqual(Result.fail(expected));
  }
  test(`journal ${operation} preserves typed failure and sanitizes a native throw`, journalFailure);
}

function invoke(driver: WorkerMechanismDriver, operation: 'mutate' | 'observe' | 'execute') {
  const c = makeWorkerCase();
  const mechanism = makeWorkerMechanism(driver);
  return Match.value(operation).pipe(
    Match.when('mutate', () =>
      mechanism.mutate({ operation: c.operation, intent: makeWorkerIntent() }),
    ),
    Match.when('observe', () =>
      mechanism.observe({ operation: c.operation, containerId: Option.some(c.containerId) }),
    ),
    Match.when('execute', () =>
      mechanism.execute({
        operation: c.operation,
        readiness: {
          ...c.resource,
          hostId: c.operation.hostId,
          daemonId: c.operation.daemonId,
          observedAtMs: 999,
        },
        authorizedAtMs: 999,
      }),
    ),
    Match.exhaustive,
  );
}

for (const operation of ['mutate', 'observe', 'execute'] as const) {
  async function mechanismContract() {
    let calls = 0;
    let signal: AbortSignal | undefined;
    function driver(_request: unknown, received: AbortSignal) {
      calls++;
      signal = received;
      return Promise.resolve(Result.succeed('reply'));
    }
    const effect = invoke({ mutate: driver, observe: driver, execute: driver }, operation);
    expect(calls).toBe(0);
    expect(await Effect.runPromise(effect)).toBe('reply');
    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(false);
    const error = new WorkerMechanismError({ operation, code: 'InvalidReply' });
    const fail = () => Promise.resolve(Result.fail(error));
    const failed = await Effect.runPromise(
      invoke({ mutate: fail, observe: fail, execute: fail }, operation).pipe(Effect.result),
    );
    const failure = Result.getFailure(failed);
    expect(Option.getOrThrow(failure)).toBe(error);
    function explode(): never {
      throw new NativeFailure({ secret: 'private' });
    }
    const reject = () => Promise.reject(new NativeFailure({ secret: 'private' }));
    for (const native of [explode, reject]) {
      expect(
        await Effect.runPromise(
          invoke({ mutate: native, observe: native, execute: native }, operation).pipe(
            Effect.result,
          ),
        ),
      ).toEqual(Result.fail(new WorkerMechanismError({ operation, code: 'Unavailable' })));
    }
    function* interrupted() {
      function pending(_request: unknown, received: AbortSignal) {
        signal = received;
        return new Promise<Result.Result<unknown, WorkerMechanismError>>(() => {});
      }
      const fiber = yield* Effect.forkChild(
        invoke({ mutate: pending, observe: pending, execute: pending }, operation),
        { startImmediately: true },
      );
      yield* Fiber.interrupt(fiber);
      expect(signal?.aborted).toBe(true);
    }
    await Effect.runPromise(
      Effect.gen(interrupted).pipe(Effect.scoped, Effect.timeout('2 seconds')),
    );
  }
  test(
    `${operation} defers Promise calls, preserves typed failures, sanitizes throws/rejections and propagates abort`,
    mechanismContract,
  );
}

async function workerContract1() {
  function* scenario() {
    const c = makeWorkerCase();
    const seed = { ...makeWorkerSnapshot(), containerId: Option.some(c.containerId) };
    const first = yield* makeMemoryWorkerJournal([seed]);
    const persisted = Option.getOrThrow(yield* first.service.load(seed.operation.operationId));
    const second = yield* makeMemoryWorkerJournal([persisted]);
    const requests: unknown[] = [];
    function observe(request: Parameters<WorkerMechanismDriver['observe']>[0]) {
      requests.push(request);
      return Promise.resolve(
        Result.succeed({
          ...c.observation,
          resources: [{ ...c.resource, operationId: 'changed-label' }],
        }),
      );
    }
    const mechanism = makeWorkerMechanism({
      mutate: () => Promise.resolve(Result.succeed(undefined)),
      execute: () => Promise.resolve(Result.succeed(undefined)),
      observe: observe,
    });
    const loaded = Option.getOrThrow(yield* second.service.load(seed.operation.operationId));
    yield* mechanism.observe({ operation: loaded.operation, containerId: loaded.containerId });
    yield* mechanism.observe({ operation: loaded.operation, containerId: Option.none() });
    expect(requests).toEqual([
      { operation: c.operation, containerId: Option.some(c.containerId) },
      { operation: c.operation, containerId: Option.none() },
    ]);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'fresh service reconstruction receives explicit immutable-ID readback, including differing labels',
  workerContract1,
);

async function tracedBoundaries() {
  const spans: string[] = [];
  const tracer = Tracer.make({
    span: function span(options) {
      spans.push(options.name);
      return new Tracer.NativeSpan(options);
    },
  });
  const seed = makeWorkerSnapshot();
  const journal = makeWorkerJournal({
    load: () => Result.succeed(Option.none()),
    commit: () =>
      Result.succeed({ _tag: 'Conflict' as const, operationId: seed.operation.operationId }),
  });
  const native = () => Promise.resolve(Result.succeed(undefined));
  const driver = { mutate: native, observe: native, execute: native };
  function* scenario() {
    const journalNative = WorkerJournal.of({
      load: () => Effect.succeed(Option.none()),
      commit: () => Effect.succeed({ _tag: 'Conflict', operationId: seed.operation.operationId }),
    });
    const mechanismNative = WorkerMechanism.of({
      mutate: () => Effect.void,
      observe: () => Effect.void,
      execute: () => Effect.void,
    });
    yield* journalNative.load(seed.operation.operationId);
    yield* mechanismNative.observe({ operation: seed.operation, containerId: Option.none() });
    yield* journal.load(seed.operation.operationId);
    yield* journal.commit(claimEdit(seed));
    for (const operation of ['mutate', 'observe', 'execute'] as const)
      yield* invoke(driver, operation);
  }
  await Effect.runPromise(Effect.gen(scenario).pipe(Effect.withTracer(tracer)));
  expect(spans).toEqual([
    'WorkerJournal.load',
    'WorkerJournal.commit',
    'WorkerMechanism.mutate',
    'WorkerMechanism.observe',
    'WorkerMechanism.execute',
  ]);
}
test(
  'inferred ports accept Effect-native implementations and named spans cover each native boundary',
  tracedBoundaries,
);
