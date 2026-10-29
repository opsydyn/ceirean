import { expect, test } from 'bun:test';

import { Arbitrary, ConfigProvider, Deferred, Effect, Fiber, Layer, Logger, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { OperatorProbeRefusal } from '../src/readonly/operator.ts';
import { runOperatorCommand } from '../src/readonly/operator/command.ts';

const policy = {
  sessionId: 'command-test',
  installationId: 10,
  ownerId: 20,
  repositoryId: 30,
  issueNumber: 40,
  operatorId: 50,
  opensAtMs: 0,
  closesAtMs: 300000,
};
const report = { protocol: 'readonly-policy-v1' as const, policy, job: null };
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const failures = {
  disabled: '{"_tag":"OperatorRefused","code":"Disabled"}\n',
  unavailable: '{"_tag":"OperatorRefused","code":"Unavailable"}\n',
  timedOut: '{"_tag":"OperatorRefused","code":"TimedOut"}\n',
};
const approved = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ CEIREAN_OPERATOR_PREVIEW: 'approved' }),
);
const withApproved = Effect.provide(approved);
const noConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({}));
const withNoConfig = Effect.provide(noConfig);

async function disabledBeforeOperation() {
  let calls = 0;
  function called() {
    calls += 1;
    return report;
  }
  const operation = Effect.sync(called);
  const result = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withNoConfig),
  );
  expect(result).toEqual({ exitCode: 2, stdout: '', stderr: failures.disabled });
  expect(calls).toBe(0);
}
test('default-disabled command never constructs the operation', disabledBeforeOperation);

async function exactArguments() {
  let calls = 0;
  function called() {
    calls += 1;
    return report;
  }
  const operation = Effect.sync(called);
  for (const argv of [[], ['status'], ['probe', '--target=other'], ['probe', 'probe']]) {
    const result = await Effect.runPromise(runOperatorCommand(argv, operation).pipe(withApproved));
    expect(result).toEqual({
      exitCode: 64,
      stdout: '',
      stderr: '{"_tag":"OperatorRefused","code":"Usage"}\n',
    });
  }
  expect(calls).toBe(0);
}
test('even with a synthetic guard only the exact probe argument is accepted', exactArguments);

async function observesOnce() {
  let calls = 0;
  function called() {
    calls += 1;
    return report;
  }
  const operation = Effect.sync(called);
  const result = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withApproved),
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(decode(result.stdout)).toEqual({ _tag: 'OperatorObservation', ...report });
  expect(calls).toBe(1);
}
test('synthetic approved invocation returns one observation with no retries', observesOnce);

async function hidesErrorsAndLogs() {
  const logs: unknown[] = [];
  const collecting = Logger.layer([
    Logger.make((entry) => {
      logs.push(entry.message);
    }),
  ]);
  const withCollector = Effect.provide(collecting);
  function* failure() {
    yield* Effect.logError('SECRET preview capability');
    return yield* Effect.die({ message: 'SECRET token', stack: 'SECRET stack' });
  }
  const operation = Effect.gen(failure);
  const result = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withApproved, withCollector),
  );
  expect(result).toEqual({ exitCode: 1, stdout: '', stderr: failures.unavailable });
  expect(logs).toEqual([]);
}
test(
  'raw failures and upstream logs cannot disclose credentials or stack traces',
  hidesErrorsAndLogs,
);

async function rejectsExtraOutput() {
  const operation = Effect.succeed({ ...report, credentials: 'SECRET output' });
  const result = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withApproved),
  );
  expect(result).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"OperatorRefused","code":"InvalidReport"}\n',
  });
}
test('output with unexpected fields is refused rather than serialized', rejectsExtraOutput);

const withClock = Effect.provide(TestClock.layer());
function makeOwner(entered: Deferred.Deferred<void>, release: Deferred.Deferred<void>) {
  const pending = Deferred.await(release);
  const starting = Deferred.succeed(entered, undefined).pipe(Effect.andThen(pending));
  return Layer.effectDiscard(starting);
}
async function deadlineOwnsRuntime() {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  let cleaned = false;
  const owner = makeOwner(entered, release);
  const withOwner = Effect.provide(owner);
  const cleanup = Effect.sync(() => {
    cleaned = true;
  });
  const observation = Effect.sync(() => report);
  const operation = observation.pipe(withOwner, Effect.ensuring(cleanup));
  function* scenario() {
    const caller = yield* runOperatorCommand(['probe'], operation).pipe(
      withApproved,
      Effect.forkScoped,
    );
    yield* Deferred.await(entered);
    yield* TestClock.adjust(45001);
    return yield* Fiber.join(caller);
  }
  const result = await Effect.runPromise(Effect.gen(scenario).pipe(Effect.scoped, withClock));
  expect(result).toEqual({ exitCode: 1, stdout: '', stderr: failures.timedOut });
  expect(cleaned).toBe(true);
}
test(
  'whole-command deadline encloses runtime layer construction and cleanup',
  deadlineOwnsRuntime,
  3000,
);

async function invalidGuards() {
  let calls = 0;
  function called() {
    calls += 1;
    return report;
  }
  const operation = Effect.sync(called);
  const offset = Arbitrary.schema(Schema.Int);
  function law(value: number) {
    const config = ConfigProvider.layer(
      ConfigProvider.fromUnknown({ CEIREAN_OPERATOR_PREVIEW: `not-approved-${value}` }),
    );
    const withConfig = Effect.provide(config);
    return runOperatorCommand(['probe'], operation).pipe(
      withConfig,
      Effect.map((result) => result.exitCode === 2 && result.stderr === failures.disabled),
    );
  }
  const checked = await Effect.runPromise(
    Arbitrary.checkEffect(offset, law, { seed: 169, runs: 100 }),
  );
  expect(checked).toMatchObject({ _tag: 'Passed', runs: 100 });
  expect(calls).toBe(0);
}
test('property: non-approved guard values never start an operation', invalidGuards);

async function typedRefusal() {
  const error = new OperatorProbeRefusal({ code: 'Mismatch' });
  error.message = 'SECRET provider details';
  const operation = Effect.fail(error);
  const result = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withApproved),
  );
  expect(result).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"OperatorRefused","code":"Mismatch"}\n',
  });
}
test('a typed probe refusal retains only its safe code', typedRefusal);

async function deadlineDuringWork() {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  let closed = false;
  const cleanup = Effect.sync(() => {
    closed = true;
  });
  function* probe() {
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    return report;
  }
  const probing = Effect.gen(probe);
  const operation = probing.pipe(Effect.ensuring(cleanup));
  function* scenario() {
    const caller = yield* runOperatorCommand(['probe'], operation).pipe(
      withApproved,
      Effect.forkScoped,
    );
    yield* Deferred.await(entered);
    yield* TestClock.adjust(45001);
    return yield* Fiber.join(caller);
  }
  const result = await Effect.runPromise(Effect.gen(scenario).pipe(Effect.scoped, withClock));
  expect(result).toEqual({ exitCode: 1, stdout: '', stderr: failures.timedOut });
  expect(closed).toBe(true);
}
test(
  'deadline cancels probe work and finishes owned cleanup without retries',
  deadlineDuringWork,
  3000,
);

function cleanupOwner(cleanup: ReturnType<typeof Deferred.await<void, never>>) {
  return Layer.effectDiscard(Effect.addFinalizer(() => cleanup));
}
async function deadlineDuringDisposal() {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const released = await Effect.runPromise(Deferred.make<void>());
  let cleaned = false;
  function* dispose() {
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(released);
    cleaned = true;
  }
  const cleanup = Effect.gen(dispose);
  const owner = cleanupOwner(cleanup);
  const withOwner = Effect.provide(owner);
  const observation = Effect.sync(() => report);
  const operation = observation.pipe(withOwner);
  function* scenario() {
    const caller = yield* runOperatorCommand(['probe'], operation).pipe(
      withApproved,
      Effect.forkScoped,
    );
    yield* Deferred.await(entered);
    yield* TestClock.adjust(45001);
    const waiting = yield* Effect.sync(caller.pollUnsafe);
    yield* Deferred.succeed(released, undefined);
    const result = yield* Fiber.join(caller);
    return { result, waiting };
  }
  const observed = await Effect.runPromise(Effect.gen(scenario).pipe(Effect.scoped, withClock));
  expect(observed.waiting).toBeUndefined();
  expect(observed.result).toEqual({ exitCode: 1, stdout: '', stderr: failures.timedOut });
  expect(cleaned).toBe(true);
}
test(
  'deadline covers disposal but joins delayed finalizers before returning',
  deadlineDuringDisposal,
  3000,
);

async function boundedOutput() {
  const job = {
    _tag: 'Succeeded' as const,
    sessionId: policy.sessionId,
    queuedAtMs: 0,
    closesAtMs: 300000,
    startedAtMs: 1,
    runtime: `v${'1'.repeat(16300)}.0.0`,
  };
  const operation = Effect.succeed({ ...report, job });
  const result = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withApproved),
  );
  expect(result).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"OperatorRefused","code":"InvalidReport"}\n',
  });
}
test('even schema-valid output is refused when its encoded size exceeds budget', boundedOutput);

async function failureClosesOwner() {
  let closed = 0;
  const cleanup = Effect.sync(() => {
    closed += 1;
  });
  const owner = cleanupOwner(cleanup);
  const withOwner = Effect.provide(owner);
  const failure = Effect.die({ token: 'SECRET' });
  const operation = failure.pipe(withOwner);
  const result = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withApproved),
  );
  expect(result).toEqual({ exitCode: 1, stdout: '', stderr: failures.unavailable });
  expect(closed).toBe(1);
}
test('failed probe disposes its runtime before emitting a sanitized refusal', failureClosesOwner);

async function freshOwnerPerInvocation() {
  let closed = 0;
  const cleanup = Effect.sync(() => {
    closed += 1;
  });
  const owner = cleanupOwner(cleanup);
  const withOwner = Effect.provide(owner);
  const observation = Effect.sync(() => report);
  const operation = observation.pipe(withOwner);
  const first = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withApproved),
  );
  expect(first.exitCode).toBe(0);
  expect(closed).toBe(1);
  const second = await Effect.runPromise(
    runOperatorCommand(['probe'], operation).pipe(withApproved),
  );
  expect(second.exitCode).toBe(0);
  expect(closed).toBe(2);
}
test(
  'each invocation disposes a fresh owner instead of retaining a runtime',
  freshOwnerPerInvocation,
);

async function refusesConfigDumping() {
  let calls = 0;
  function called() {
    calls += 1;
    return report;
  }
  const operation = Effect.sync(called);
  const config = ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      CEIREAN_OPERATOR_PREVIEW: 'approved',
      WORKERD_DUMP_CONFIG: '/SECRET/capability-dump',
    }),
  );
  const withConfig = Effect.provide(config);
  const result = await Effect.runPromise(runOperatorCommand(['probe'], operation).pipe(withConfig));
  expect(result).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"OperatorRefused","code":"InvalidConfiguration"}\n',
  });
  expect(calls).toBe(0);
}
test(
  'SDK configuration dumping is refused before operation or credential access',
  refusesConfigDumping,
);
