import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Deferred, Effect, Fiber, Match, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';

import { collectHostObservations } from '../src/host-observations.ts';

async function syntheticObservations() {
  function* scenario() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const commands: unknown[] = [];
    const outputs = [
      'Darwin\n',
      'arm64\n',
      '17179869184\n',
      '8\n',
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100.\n',
    ];
    function spawn(command: Parameters<typeof spawner.spawn>[0]) {
      commands.push(command);
      const text = outputs.shift() ?? '';
      const program = Effect.succeed({
        all: Stream.make(new TextEncoder().encode(text)),
        exitCode: Effect.succeed(0),
      } as unknown as ChildProcessSpawner.ChildProcessHandle);
      return program;
    }
    const collecting = collectHostObservations('/private/tmp/synthetic-home');
    const host = yield* Effect.provideService(collecting, ChildProcessSpawner.ChildProcessSpawner, {
      ...spawner,
      spawn,
    });
    expect(host).toEqual({
      architecture: 'arm64',
      totalMemoryBytes: 17179869184,
      cpuCount: 8,
      freeMemoryBytes: 1638400,
    });
    expect(commands).toMatchObject([
      { command: '/usr/bin/uname', args: ['-s'] },
      { command: '/usr/bin/uname', args: ['-m'] },
      { command: '/usr/sbin/sysctl', args: ['-n', 'hw.memsize'] },
      { command: '/usr/sbin/sysctl', args: ['-n', 'hw.logicalcpu'] },
      { command: '/usr/bin/vm_stat', args: [] },
    ]);
    for (const command of commands)
      expect(command).toMatchObject({
        options: {
          shell: false,
          extendEnv: false,
          env: { HOME: '/private/tmp/synthetic-home' },
          cwd: '/private/tmp/synthetic-home',
          stdin: 'ignore',
        },
      });
  }
  const program = Effect.gen(scenario);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'fixed platform observations acquire Darwin architecture and true host resources',
  syntheticObservations,
);

async function unavailableObservations() {
  function* scenario() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    for (const outputs of [
      ['Linux\n', 'x86_64\n'],
      ['Darwin\n', 'mystery\n', 'process-limited: 1234', '-1', 'malformed'],
      ['Darwin\n', 'arm64\n', '999999999999999999999', '8\nextra', 'x'.repeat(4097)],
    ]) {
      const commands: unknown[] = [];
      function spawn(command: Parameters<typeof spawner.spawn>[0]) {
        commands.push(command);
        const program = Effect.succeed({
          all: Stream.make(new TextEncoder().encode(outputs.shift() ?? '')),
          exitCode: Effect.succeed(0),
        } as unknown as ChildProcessSpawner.ChildProcessHandle);
        return program;
      }
      const collecting = collectHostObservations('/private/tmp/synthetic-home');
      const host = yield* Effect.provideService(
        collecting,
        ChildProcessSpawner.ChildProcessSpawner,
        { ...spawner, spawn },
      );
      expect(host.totalMemoryBytes).toBeUndefined();
      expect(host.cpuCount).toBeUndefined();
      expect(host.freeMemoryBytes).toBeUndefined();
      expect(commands.length).toBeLessThanOrEqual(5);
    }
    const collecting = collectHostObservations('/private/tmp/synthetic-home');
    const failed = yield* Effect.provideService(
      collecting,
      ChildProcessSpawner.ChildProcessSpawner,
      { ...spawner, spawn: () => Effect.die('PRIVATE_DIAGNOSTIC') },
    );
    expect(failed).toEqual({
      architecture: undefined,
      totalMemoryBytes: undefined,
      cpuCount: undefined,
      freeMemoryBytes: undefined,
    });
  }
  const program = Effect.gen(scenario);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'unsupported OS, invalid metrics, excessive output and unavailable APIs stay unknown',
  unavailableObservations,
);

async function boundedObservationLifetime() {
  function* scenario() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    function* check(cancel: boolean) {
      const started = yield* Deferred.make<void>();
      let released = 0;
      let calls = 0;
      function spawn() {
        calls += 1;
        const handle = Effect.succeed({
          all: Stream.never,
          exitCode: Effect.succeed(0),
        } as unknown as ChildProcessSpawner.ChildProcessHandle);
        const acquire = handle.pipe(Effect.tap(() => Deferred.succeed(started, undefined)));
        const release = Effect.sync(() => {
          released += 1;
        });
        const program = Effect.acquireRelease(acquire, () => release);
        return program;
      }
      const collecting = collectHostObservations('/private/tmp/synthetic-home');
      const provided = Effect.provideService(collecting, ChildProcessSpawner.ChildProcessSpawner, {
        ...spawner,
        spawn,
      });
      const fiber = yield* Effect.forkChild(provided);
      yield* Deferred.await(started).pipe(Effect.timeout('1 second'));
      const interrupt = Fiber.interrupt(fiber);
      const shouldCancel = Effect.sync(() => cancel);
      yield* interrupt.pipe(Effect.when(shouldCancel));
      yield* Fiber.await(fiber);
      expect(released).toBe(calls);
      expect(calls).toBeLessThanOrEqual(2);
    }
    yield* Effect.forEach([false, true], (cancel) => Effect.gen(() => check(cancel)), {
      concurrency: 1,
    });
  }
  const program = Effect.gen(scenario);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'synthetic stalled observations time out and caller cancellation closes every acquired scope',
  boundedObservationLifetime,
  6000,
);

async function boundedInvalidStreams() {
  function* scenario() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    for (const mode of ['Overflow', 'Nonzero', 'InvalidUtf8'] as const) {
      let calls = 0;
      let pulls = 0;
      function* chunks() {
        for (let index = 0; index < 20; index += 1) {
          pulls += 1;
          yield new Uint8Array(4096);
        }
      }
      function spawn() {
        calls += 1;
        const bad = {
          Overflow: Stream.fromIterable(chunks(), { chunkSize: 1 }),
          Nonzero: Stream.make(new TextEncoder().encode('Darwin\n')),
          InvalidUtf8: Stream.make(new Uint8Array([0xff])),
        };
        const all = Match.value(calls).pipe(
          Match.when(1, () => bad[mode]),
          Match.orElse(() => Stream.make(new TextEncoder().encode('x86_64\n'))),
        );
        const exitCode = Match.value({ calls, mode }).pipe(
          Match.when({ calls: 1, mode: 'Nonzero' }, () => Effect.succeed(7)),
          Match.orElse(() => Effect.succeed(0)),
        );
        const program = Effect.succeed({
          all,
          exitCode,
        } as unknown as ChildProcessSpawner.ChildProcessHandle);
        return program;
      }
      const collecting = collectHostObservations('/private/tmp/synthetic-home');
      const result = yield* Effect.provideService(
        collecting,
        ChildProcessSpawner.ChildProcessSpawner,
        { ...spawner, spawn },
      );
      expect(result).toEqual({
        architecture: 'x64',
        totalMemoryBytes: undefined,
        cpuCount: undefined,
        freeMemoryBytes: undefined,
      });
      expect(pulls).toBeLessThanOrEqual(2);
      expect(calls).toBe(2);
    }
  }
  const program = Effect.gen(scenario);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'bounded stream collection stops pulling on excess; nonzero and invalid UTF-8 cannot produce facts',
  boundedInvalidStreams,
);
