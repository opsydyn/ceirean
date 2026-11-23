import { expect, test } from 'bun:test';

import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, Match, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import * as Ci from '../src/current-ci-controller.ts';
import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';
import { SupervisorError } from '../src/linux-qualification/docker-process.ts';
const withPlatform = Effect.provide(NodeServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
const withClock = Effect.provide(TestClock.layer());

function inertCli() {
  expect(typeof Ci.currentCiCheck).toBe('function');
  expect(Ci.currentCiCheck([])).toMatchObject({ code: 2, activation: 'Blocked' });
  expect(Ci.currentCiCheck(['--check'])).toMatchObject({ code: 2, activation: 'Blocked' });
  for (const argv of [['--run'], ['--activate'], ['--check', 'x']])
    expect(Ci.currentCiCheck(argv).code).toBe(64);
}
test('CI CLI is inert by default and refuses all execution arguments', inertCli);

async function ownedController() {
  expect(typeof Ci.runCurrentCiCache).toBe('function');
  for (const failAt of [
    '',
    'create:inputs',
    'create:tools',
    'create:work',
    'stage',
    'consumer',
    'start',
    'wait',
    'stop',
    'export',
    'cleanup',
  ]) {
    const events: string[] = [];
    function action(name: string) {
      function* execute() {
        events.push(name);
        const failing = Effect.fail(new SupervisorError({ code: 'InputChanged' }));
        const selected = Effect.succeed(name === failAt);
        yield* failing.pipe(Effect.when(selected));
        return undefined;
      }
      const workflow = Effect.gen(execute);
      return workflow;
    }
    const ports = {
      prepare: () => action('prepare'),
      createVolume: (_owner: string, kind: string) => action(`create:${kind}`),
      stage: () => action('stage'),
      createConsumer: () => action('consumer'),
      start: () => action('start'),
      wait: () => action('wait'),
      stop: () => action('stop'),
      export: () =>
        action('export').pipe(
          Effect.map(() => ({
            bytes: 123,
            sha256: 'a'.repeat(64),
            descriptorSha256: 'b'.repeat(64),
            seedSha256: 'c'.repeat(64),
          })),
        ),
      cleanup: () => action('cleanup'),
    };
    const outcome = await Effect.runPromise(
      Ci.runCurrentCiCache('00000000-0000-4000-8000-000000000001', ports).pipe(
        withMetadata,
        withPlatform,
      ),
    );
    expect(events.at(-1)).toBe('cleanup');
    const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
    expect(encode(outcome)).not.toContain('private child output');
    const expected = Match.value(failAt).pipe(
      Match.when('', () => 'CacheOnlyRetained' as const),
      Match.orElse(() => 'CacheOnlyFailed' as const),
    );
    expect(outcome.status).toBe(expected);
    expect(!events.includes('export') || events.indexOf('stop') < events.indexOf('export')).toBe(
      true,
    );
    expect(!events.includes('start') || events.indexOf('consumer') < events.indexOf('start')).toBe(
      true,
    );
  }
}
test(
  'every partial acquisition is owned before start, cleaned after failure, and cannot pass without export',
  ownedController,
);

async function cancellationBoundaries() {
  for (const phase of [
    'prepare',
    'create:inputs',
    'create:tools',
    'create:work',
    'stage',
    'consumer',
    'start',
    'wait',
    'stop',
    'export',
  ]) {
    function* check() {
      const entered = yield* Deferred.make<void>();
      const events: string[] = [];
      function action(name: string) {
        function* act() {
          events.push(name);
          const selected = Effect.sync(() => name === phase);
          const delay = Effect.sleep('1 hour');
          const stalling = Deferred.succeed(entered, undefined).pipe(Effect.andThen(delay));
          yield* stalling.pipe(Effect.when(selected));
        }
        const workflow = Effect.gen(act);
        return workflow;
      }
      const ports = {
        prepare: () => action('prepare'),
        createVolume: (_owner: string, kind: string) => action(`create:${kind}`),
        stage: () => action('stage'),
        createConsumer: () => action('consumer'),
        start: () => action('start'),
        wait: () => action('wait'),
        stop: () => action('stop'),
        cleanup: () => action('cleanup'),
        export: () =>
          action('export').pipe(
            Effect.map(() => ({
              bytes: 1,
              sha256: 'a'.repeat(64),
              descriptorSha256: 'b'.repeat(64),
              seedSha256: 'c'.repeat(64),
            })),
          ),
      };
      const child = yield* Ci.runCurrentCiCache('00000000-0000-4000-8000-000000000001', ports).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(entered).pipe(Effect.timeout('5 seconds'));
      yield* Fiber.interrupt(child);
      expect(events.at(-1)).toBe('cleanup');
      const isCleanup = Schema.is(Schema.Literal('cleanup'));
      const cleanupEvents = events.filter(isCleanup);
      expect(cleanupEvents.length).toBe(1);
    }
    const workflow = Effect.gen(check);
    await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
  }
}
test(
  'cancellation at every acquisition/execution boundary joins cleanup before exit',
  cancellationBoundaries,
);

async function hardDeadlines() {
  for (const [phase, milliseconds] of [
    ['prepare', Ci.currentCiBudgets.acquisitionMs],
    ['wait', Ci.currentCiBudgets.workerMs],
    ['cleanup', Ci.currentCiBudgets.cleanupMs],
  ] as const) {
    function* check() {
      const entered = yield* Deferred.make<void>();
      function action(name: string) {
        function* act() {
          const selected = Effect.sync(() => name === phase);
          const delay = Effect.sleep('1 hour');
          const stalling = Deferred.succeed(entered, undefined).pipe(Effect.andThen(delay));
          yield* stalling.pipe(Effect.when(selected));
        }
        const workflow = Effect.gen(act);
        return workflow;
      }
      const ports = {
        prepare: () => action('prepare'),
        createVolume: () => action('volume'),
        stage: () => action('stage'),
        createConsumer: () => action('consumer'),
        start: () => action('start'),
        wait: () => action('wait'),
        stop: () => action('stop'),
        cleanup: () => action('cleanup'),
        export: () =>
          action('export').pipe(
            Effect.map(() => ({
              bytes: 1,
              sha256: 'a'.repeat(64),
              descriptorSha256: 'b'.repeat(64),
              seedSha256: 'c'.repeat(64),
            })),
          ),
      };
      const execution = Ci.runCurrentCiCache('00000000-0000-4000-8000-000000000001', ports);
      const child = yield* execution.pipe(Effect.forkChild);
      yield* Deferred.await(entered).pipe(Effect.timeout('5 seconds'));
      yield* TestClock.adjust(milliseconds + 1);
      const outcome = yield* Fiber.join(child);
      expect(outcome.status).toBe('CacheOnlyFailed');
    }
    const workflow = Effect.gen(check);
    await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform, withClock));
  }
}
test('acquisition, worker and teardown all retain hard deadlines', hardDeadlines, 5000);

function cliProcessIsInert() {
  const script = new URL('../scripts/current-cache-ci.ts', import.meta.url).pathname;
  for (const [argv, expected] of [
    [[], 2],
    [['--check'], 2],
    [['--run'], 64],
    [['--activate'], 64],
  ] as const) {
    const child = Bun.spawnSync(
      [process.execPath, '--no-env-file', '--no-install', script, ...argv],
      {
        cwd: '/tmp',
        env: { PATH: '/usr/bin:/bin' },
        timeout: 5000,
      },
    );
    expect(child.exitCode).toBe(expected);
    expect(new TextDecoder().decode(child.stdout)).toContain('"activation":"Blocked"');
    expect(child.stderr.length).toBe(0);
  }
}
test(
  'real CLI process has inspection-only exit codes without operational imports',
  cliProcessIsInert,
);
