import { expect, test } from 'bun:test';

import type { ContainerExecOptions, ContainerStartupOptions } from 'alchemy/Cloudflare/Containers';
import { RuntimeContext } from 'alchemy/RuntimeContext';
import { Arbitrary, Context, Deferred, Effect, Fiber, Result, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { makeSmokeContainer, SmokeError } from '../src/readonly/container.ts';
import { Job, admitJob, claimJob, finishJob, recoverJob } from '../src/readonly/job.ts';
import { runSmoke } from '../src/readonly/runner.ts';

const policy = {
  sessionId: 'rehearsal-1',
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
const context = Context.make(RuntimeContext, {
  Type: 'Test',
  id: 'readonly-test',
  env: {},
  get: () => Effect.sync(() => undefined),
  set: (key) => Effect.sync(() => key),
});
const runTest = Effect.runPromiseWith(context);

export function runTestSmoke(container: Parameters<typeof runSmoke>[0]) {
  const running = runSmoke(container);
  return runTest(running);
}

function admission() {
  const admitted = Result.getOrThrow(admitJob(policy, candidate, null, 1000));
  expect(admitted).toMatchObject({ _tag: 'Queued', sessionId: policy.sessionId });
  for (const field of [
    'installationId',
    'ownerId',
    'repositoryId',
    'issueNumber',
    'operatorId',
  ] as const) {
    const rejected = admitJob(policy, { ...candidate, [field]: 999 }, null, 1000);
    expect(Result.isFailure(rejected)).toBe(true);
  }
  for (const time of [999, 301000, NaN, Infinity]) {
    const rejected = admitJob(policy, candidate, null, time);
    expect(Result.isFailure(rejected)).toBe(true);
  }
  const replay = Result.getOrThrow(admitJob(policy, candidate, admitted, 1001));
  expect(replay).toEqual(admitted);
  const forbiddenReplay = admitJob(policy, { ...candidate, operatorId: 999 }, admitted, 1001);
  expect(Result.isFailure(forbiddenReplay)).toBe(true);
}
test('only the fixed identities during the finite window admit one job', admission);

function claim() {
  const queued = Result.getOrThrow(admitJob(policy, candidate, null, 1000));
  const running = Result.getOrThrow(claimJob(queued, 1100));
  expect(running).toMatchObject({ _tag: 'Running', startedAtMs: 1100 });
  const repeated = claimJob(running, 1101);
  const expired = claimJob(queued, policy.closesAtMs);
  expect(Result.isFailure(repeated)).toBe(true);
  expect(Result.isFailure(expired)).toBe(true);
}
test('a job is claimed before execution and cannot be claimed twice', claim);

function completion() {
  const queued = Result.getOrThrow(admitJob(policy, candidate, null, 1000));
  const running = Result.getOrThrow(claimJob(queued, 1100));
  const success = finishJob(running, { _tag: 'Completed', runtime: 'v22.16.0' }, true);
  const failed = finishJob(running, { _tag: 'Failed', code: 'CommandFailed' }, true);
  const pending = finishJob(running, { _tag: 'Completed', runtime: 'v22.16.0' }, false);
  expect(success).toMatchObject({ _tag: 'Succeeded' });
  expect(failed).toMatchObject({ _tag: 'Failed' });
  expect(pending).toMatchObject({ _tag: 'CleanupRequired' });
  const decode = Schema.decodeUnknownSync(Job, { onExcessProperty: 'error' });
  for (const job of [success, failed, pending]) {
    expect(decode(job)).toEqual(job);
  }
}
test('success requires a successful command and confirmed stopped container', completion);

function recovery() {
  const queued = Result.getOrThrow(admitJob(policy, candidate, null, 1000));
  const running = Result.getOrThrow(claimJob(queued, 1100));
  const stopped = recoverJob(running, true);
  const unknown = recoverJob(running, false);
  expect(stopped).toMatchObject({ _tag: 'Failed', code: 'Interrupted' });
  expect(unknown).toMatchObject({ _tag: 'CleanupRequired' });
  const retried = recoverJob(
    {
      ...running,
      _tag: 'CleanupRequired',
      outcome: { _tag: 'Completed', runtime: 'v22.16.0' },
      cleanupAttempts: 1,
    },
    true,
  );
  const decode = Schema.decodeUnknownSync(Job, { onExcessProperty: 'error' });
  expect(decode(retried)).toMatchObject({ _tag: 'Failed', code: 'Interrupted' });
}
test('restart recovery never promotes an unknown command to success', recovery);

async function lifecycle() {
  const events: string[] = [];
  function recordStart() {
    events.push('start');
  }
  function execute() {
    function record() {
      events.push('execute');
      return 'v22.16.0';
    }
    const reading = Effect.sync(record);
    return reading;
  }
  function recordDestroy() {
    events.push('destroy');
  }
  function stopped() {
    events.push('stopped');
    return true;
  }
  const container = {
    start: () => Effect.sync(recordStart),
    execute,
    destroy: () => Effect.sync(recordDestroy),
    stopped: Effect.sync(stopped),
  };
  const result = await runTestSmoke(container);
  expect(result).toEqual({ outcome: { _tag: 'Completed', runtime: 'v22.16.0' }, cleaned: true });
  expect(events).toEqual(['start', 'execute', 'destroy', 'stopped']);
}
test('runner destroys and independently reads stopped status after success', lifecycle);

async function failureCleanup() {
  let destroyed = 0;
  function recordDestroy() {
    destroyed += 1;
  }
  const container = {
    start: () => Effect.void,
    execute: () => Effect.fail(new SmokeError({ code: 'ContainerFailed' })),
    destroy: () => Effect.sync(recordDestroy),
    stopped: Effect.succeed(true),
  };
  const result = await runTestSmoke(container);
  expect(result).toMatchObject({ outcome: { _tag: 'Failed' }, cleaned: true });
  expect(destroyed).toBe(1);
}
test('a failed command still destroys its container', failureCleanup);

async function uncertainCleanup() {
  let readbacks = 0;
  function stopped() {
    readbacks += 1;
    return true;
  }
  const container = {
    start: () => Effect.void,
    execute: () => Effect.succeed(`v${22}.${16}.${0}`),
    destroy: () => Effect.fail(new SmokeError({ code: 'ContainerFailed' })),
    stopped: Effect.sync(stopped),
  };
  const result = await runTestSmoke(container);
  expect(result.cleaned).toBe(false);
  expect(readbacks).toBe(1);
}
test('cleanup failure is not success even if the readback says stopped', uncertainCleanup);

async function singleClaimProperty() {
  const offset = Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: 299999 }),
  );
  const arbitrary = Arbitrary.schema(offset);
  function law(offset: number) {
    const queued = Result.getOrThrow(admitJob(policy, candidate, null, policy.opensAtMs + offset));
    const running = Result.getOrThrow(claimJob(queued, policy.opensAtMs + offset));
    return Result.isFailure(claimJob(running, policy.opensAtMs + offset));
  }
  const checked = await Effect.runPromise(
    Arbitrary.checkEffect(arbitrary, law, { seed: 167, runs: 1000 }),
  );
  expect(checked).toMatchObject({ _tag: 'Passed', runs: 1000 });
}
test('property: every admitted time permits at most one execution claim', singleClaimProperty);

function nativeFixture(output = 'v22.16.0\n', exitCode = 0, initiallyRunning = false) {
  const calls: {
    starts: ContainerStartupOptions[];
    argv: string[][];
    options: ContainerExecOptions[];
    destroys: number;
  } = {
    starts: [],
    argv: [],
    options: [],
    destroys: 0,
  };
  let running = initiallyRunning;
  function start(options?: ContainerStartupOptions) {
    function record() {
      calls.starts.push(options ?? { enableInternet: true });
      running = true;
    }
    const starting = Effect.sync(record);
    return starting;
  }
  function exec(argv: string[], options?: ContainerExecOptions) {
    function record() {
      calls.argv.push(argv);
      calls.options.push(options ?? {});
      return {
        pid: 123,
        isPty: false,
        stdin: undefined,
        stdout: Stream.make(new TextEncoder().encode(output)),
        stderr: undefined,
        exitCode: Effect.sync(() => exitCode),
        output: () => Effect.die(new SmokeError({ code: 'InvalidOutput' })),
        kill: () => Effect.void,
        resize: () => Effect.void,
      };
    }
    const executing = Effect.sync(record);
    return executing;
  }
  function destroy() {
    function record() {
      calls.destroys += 1;
      running = false;
    }
    const destroying = Effect.sync(record);
    return destroying;
  }
  const native = {
    start,
    exec,
    destroy,
    running: Effect.sync(() => running),
    setInactivityTimeout: () => Effect.void,
  };
  return { calls, adapter: makeSmokeContainer(native) };
}
async function nativeContract() {
  const fixture = nativeFixture();
  const result = await runTestSmoke(fixture.adapter);
  expect(result.cleaned).toBe(true);
  expect(result.outcome).toMatchObject({ _tag: 'Completed', runtime: 'v22.16.0' });
  expect(fixture.calls.starts).toEqual([
    { enableInternet: false, entrypoint: ['/bin/sleep', 'infinity'], instance: 'lite', env: {} },
  ]);
  expect(fixture.calls.argv).toEqual([['/usr/local/bin/node', '--version']]);
  expect(fixture.calls.options).toEqual([{ stdout: 'pipe', stderr: 'ignore' }]);
  expect(fixture.calls.destroys).toBe(1);
}
test('native adapter fixes argv, disables Internet and passes no secrets', nativeContract);

async function badOutputs() {
  for (const [output, exitCode] of [
    ['v22.16.0\n', 1],
    ['unexpected', 0],
    ['x'.repeat(129), 0],
  ] as const) {
    const fixture = nativeFixture(output, exitCode);
    const result = await runTestSmoke(fixture.adapter);
    expect(result).toMatchObject({ outcome: { _tag: 'Failed' }, cleaned: true });
    expect(fixture.calls.destroys).toBe(1);
  }
}
test('bad exit codes, malformed and oversized output fail with cleanup', badOutputs);

async function existingRuntime() {
  const fixture = nativeFixture('v22.16.0\n', 0, true);
  const result = await runTestSmoke(fixture.adapter);
  expect(result.outcome).toMatchObject({ _tag: 'Failed' });
  expect(fixture.calls.starts).toHaveLength(0);
  expect(fixture.calls.argv).toHaveLength(0);
  expect(fixture.calls.destroys).toBe(1);
}
test('an unexpectedly running container cannot bypass fresh startup policy', existingRuntime);

const withClock = Effect.provide(TestClock.layer());
async function cleanupDeadline() {
  function* scenario() {
    const destroying = yield* Deferred.make<void>();
    function* destroyForever() {
      yield* Deferred.succeed(destroying, undefined);
      yield* Effect.sleep('2 days');
    }
    const container = {
      start: () => Effect.void,
      execute: () => Effect.succeed(`v${22}.${16}.${0}`),
      destroy: () => Effect.gen(destroyForever),
      stopped: Effect.succeed(true),
    };
    const fiber = yield* runSmoke(container).pipe(Effect.forkScoped);
    yield* Deferred.await(destroying).pipe(Effect.timeout('1 second'));
    yield* TestClock.adjust(15001);
    const result = yield* Fiber.join(fiber);
    expect(result.cleaned).toBe(false);
  }
  const checking = Effect.gen(scenario);
  await runTest(checking.pipe(Effect.scoped, withClock));
}
test('cleanup observation has a finite cooperative budget', cleanupDeadline, 3000);

async function executionDeadline() {
  let destroyed = 0;
  function recordDestroy() {
    destroyed += 1;
  }
  function* scenario() {
    const executing = yield* Deferred.make<void>();
    function* slowCommand() {
      yield* Deferred.succeed(executing, undefined);
      yield* Effect.sleep('2 days');
      return `v${22}.${16}.${0}`;
    }
    const container = {
      start: () => Effect.void,
      execute: () => Effect.gen(slowCommand),
      destroy: () => Effect.sync(recordDestroy),
      stopped: Effect.succeed(true),
    };
    const fiber = yield* runSmoke(container).pipe(Effect.forkScoped);
    yield* Deferred.await(executing).pipe(Effect.timeout('1 second'));
    yield* TestClock.adjust(60001);
    const result = yield* Fiber.join(fiber);
    expect(result).toMatchObject({ outcome: { _tag: 'Failed' }, cleaned: true });
  }
  const checking = Effect.gen(scenario);
  await runTest(checking.pipe(Effect.scoped, withClock));
  expect(destroyed).toBe(1);
}
test('execution deadline still runs owned cleanup', executionDeadline, 3000);
