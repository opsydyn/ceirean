import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import {
  Arbitrary,
  Array as Arr,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Match,
  Ref,
  Result,
  Schema,
  Stream,
} from 'effect';
import { TestClock } from 'effect/testing';

import { currentBaseline } from '../src/current-baseline.ts';
import {
  CurrentBaselinePlatform,
  makeCurrentBaselinePlatform,
  runCurrentBaseline,
  inspectTestSummary,
  collectCurrentCommandOutput,
} from '../src/current-worker.ts';

const withPlatform = Effect.provide(BunServices.layer);
function fixture(failIndex = -1, holdBrowser = false, passed = 4, skipped = 0) {
  const calls = Ref.makeUnsafe<ReadonlyArray<string>>([]);
  const released = Ref.makeUnsafe(0);
  const serversStarted = Deferred.makeUnsafe<void>();
  const native = makeCurrentBaselinePlatform();
  function run(index: number) {
    const contract = currentBaseline();
    const check = contract.checks[index]!;
    const result = {
      index,
      id: check.id,
      exitCode: Number(index === failIndex),
      outputBytes: 10,
      tests: { passed, failed: 0, skipped },
    };
    function* execute() {
      yield* Ref.update(calls, (values) => Arr.append(values, check.id));
      const latency = Match.value(holdBrowser && index === 15).pipe(
        Match.when(true, () => currentBaseline().limits.executionMs + 1000),
        Match.orElse(() => 0),
      );
      const slow = Effect.sleep(latency);
      const delayed = Effect.sync(() => latency > 0);
      yield* slow.pipe(Effect.when(delayed));
      return result;
    }
    const workflow = Effect.gen(execute);
    return workflow;
  }
  function* startServers() {
    const acquiring = Ref.update(calls, (values) => Arr.append(values, 'ServersStarted'));
    yield* Effect.acquireRelease(acquiring, () => Ref.update(released, (count) => count + 1));
    yield* Deferred.succeed(serversStarted, undefined);
    const unavailable = Effect.fail(new Error('fake preview exited'));
    const alive = Effect.sleep(currentBaseline().limits.executionMs + 1000);
    return { watch: alive.pipe(Effect.andThen(unavailable)) };
  }
  const platform = {
    ...native,
    admit: () =>
      Effect.succeed({
        sourceSha: 'be0427e2aba2cf951ef4dbbbe9296e307ed41ad3' as const,
        contractSha256: '487b4fa0a24dde7de46d41cbbc349b1b1103f4da41ce9c630b69554b617c50be' as const,
        imageSha256: 'a'.repeat(64),
        controls: 'Verified' as const,
      }),
    initialize: () => Effect.void,
    run,
    startServers: () => Effect.gen(startServers),
  };
  return {
    platform,
    calls: () => Ref.getUnsafe(calls),
    serversStarted,
    released: () => Ref.getUnsafe(released),
  };
}
async function refusesNativeAdmission() {
  const platform = makeCurrentBaselinePlatform();
  const provided = Effect.provideService(CurrentBaselinePlatform, platform);
  const result = await Effect.runPromise(
    runCurrentBaseline().pipe(provided, Effect.result, withPlatform),
  );
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'AdmissionUnavailable' } });
}
test(
  'native worker refuses before any source process or filesystem preparation',
  refusesNativeAdmission,
);

async function orderedExecution() {
  const fake = fixture();
  const provided = Effect.provideService(CurrentBaselinePlatform, fake.platform);
  const result = await Effect.runPromise(runCurrentBaseline().pipe(provided, withPlatform));
  expect(fake.calls()).toEqual([
    ...currentBaseline()
      .checks.slice(0, 15)
      .map(({ id }) => id),
    'ServersStarted',
    'BrowserJourneys',
  ]);
  expect(result.status).toBe('ChecksCompleted');
  expect(result.qualified).toBe(false);
  expect(result.commands).toHaveLength(16);
  expect(fake.released()).toBe(1);
}
test(
  'worker executes all fixed checks in order and scopes preview servers around the four cases',
  orderedExecution,
);

async function stopsAfterFailure() {
  const fake = fixture(2);
  const provided = Effect.provideService(CurrentBaselinePlatform, fake.platform);
  const result = await Effect.runPromise(
    runCurrentBaseline().pipe(provided, Effect.result, withPlatform),
  );
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'CommandFailed' } });
  expect(fake.calls()).toEqual(['Install', 'Check', 'Typecheck']);
  expect(fake.released()).toBe(0);
}
test('failed command stops the plan before later checks or server acquisition', stopsAfterFailure);

async function cancelsBrowserWork() {
  const fake = fixture(-1, true);
  const provided = Effect.provideService(CurrentBaselinePlatform, fake.platform);
  function* check() {
    const fiber = yield* runCurrentBaseline().pipe(provided, Effect.forkChild);
    yield* Deferred.await(fake.serversStarted).pipe(Effect.timeout('1 second'));
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    expect(Exit.hasInterrupts(exit)).toBe(true);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  await Effect.runPromise(scoped.pipe(withPlatform));
  expect(fake.released()).toBe(1);
}
test(
  'cancellation during the browser command releases its owned preview servers',
  cancelsBrowserWork,
);

const withClock = Effect.provide(TestClock.layer());
async function deadlineReleasesServers() {
  const fake = fixture(-1, true);
  const provided = Effect.provideService(CurrentBaselinePlatform, fake.platform);
  function* check() {
    const fiber = yield* runCurrentBaseline().pipe(provided, Effect.forkChild);
    yield* Deferred.await(fake.serversStarted).pipe(Effect.timeout('1 second'));
    yield* TestClock.adjust(currentBaseline().limits.executionMs);
    const exit = yield* Fiber.await(fiber);
    expect(Exit.isFailure(exit)).toBe(true);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  await Effect.runPromise(scoped.pipe(withClock, withPlatform));
  expect(fake.released()).toBe(1);
}
test(
  'the fixed execution deadline releases previews during a hung browser check',
  deadlineReleasesServers,
);

for (const [name, passed, skipped] of [
  ['zero tests', 0, 0],
  ['skipped tests', 4, 1],
  ['missing browser case', 3, 0],
] as const) {
  async function refusesIncompleteTests() {
    const fake = fixture(-1, false, passed, skipped);
    const provided = Effect.provideService(CurrentBaselinePlatform, fake.platform);
    const result = await Effect.runPromise(
      runCurrentBaseline().pipe(provided, Effect.result, withPlatform),
    );
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'MissingTests' } });
  }
  test(`worker refuses ${name} despite zero command exit`, refusesIncompleteTests);
}

function checksSummary() {
  expect(inspectTestSummary('33 pass\n0 fail\nTests 408 passed (408)\n4 passed (1s)\n')).toEqual({
    passed: 445,
    failed: 0,
    skipped: 0,
  });
  expect(inspectTestSummary('Found 4 tests\n')).toEqual({ passed: 0, failed: 0, skipped: 0 });
  expect(inspectTestSummary('1 fail\n2 skipped\n')).toEqual({ passed: 0, failed: 1, skipped: 2 });
}
test(
  'summary counts Bun, Vitest and Playwright outcomes without treating discovery as passing tests',
  checksSummary,
);

const Capacity = Schema.Struct({
  available: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4096 })),
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4096 })),
});
function outputCapacityLaw(seed: number) {
  async function check() {
    const inputs = Arbitrary.schema(Capacity);
    function capacity(example: typeof Capacity.Type) {
      function* run() {
        const spent = yield* Ref.make(
          currentBaseline().limits.commandOutputBytes - example.available,
        );
        const stream = Stream.fromIterable([new Uint8Array(example.size)]);
        const result = yield* collectCurrentCommandOutput(stream, spent).pipe(Effect.result);
        return Result.isSuccess(result) === example.size <= example.available;
      }
      const workflow = Effect.gen(run);
      return workflow;
    }
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(inputs, capacity, { seed, runs: 200 }),
    );
    expect(result).toMatchObject({ _tag: 'Passed', runs: 200 });
  }
  return check;
}
for (const seed of [0, 1, 163])
  test(`shared command-output capacity cannot overflow; seed ${seed}`, outputCapacityLaw(seed));
