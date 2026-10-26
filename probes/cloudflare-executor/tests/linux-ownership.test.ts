import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import {
  Deferred,
  Effect,
  Fiber,
  Match,
  PlatformError,
  Result,
  Schema,
  Sink,
  Stdio,
  Stream,
} from 'effect';
import { ChildProcessSpawner } from 'effect/process';

import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';
import { makeWorkerProcess } from '../src/linux-qualification/cases.ts';
import { LinuxInputs } from '../src/linux-qualification/inputs.ts';
import { WorkerWarmupReady } from '../src/linux-qualification/live-handoff.ts';
import * as Producer from '../src/linux-qualification/producer.ts';
import { ownedFixture } from './linux-owned-fixtures.ts';

const withPlatform = Effect.provide(BunServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());

const isText = Schema.is(Schema.String);
const decodeWarmup = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkerWarmupReady));
async function ownedIdentity() {
  function* run() {
    const { fs, prepared, boundary } = yield* ownedFixture();
    const owning = Producer.prepareOwnedProducer(prepared.admission.request).pipe(
      Effect.provideService(LinuxInputs, boundary),
    );
    const owned = yield* owning;
    for (const forged of [structuredClone(owned), { inputs: prepared }]) {
      const rejected = Producer.claimOwnedProducer(forged, prepared).pipe(Effect.result);
      expect(Result.isFailure(yield* rejected)).toBe(true);
    }
    const admitted = yield* Producer.claimOwnedProducer(owned, prepared);
    expect(admitted.tools.files.map((file) => file.path)).toEqual(['node', 'worker.mjs']);
    const replayed = Producer.claimOwnedProducer(owned, prepared).pipe(Effect.result);
    expect(Result.isFailure(yield* replayed)).toBe(true);
    const expired = yield* owning.pipe(Effect.scoped);
    const outsideScope = Producer.claimOwnedProducer(expired, prepared).pipe(Effect.result);
    expect(Result.isFailure(yield* outsideScope)).toBe(true);
    for (const path of ['source/fixture.txt', 'tools/worker.mjs']) {
      const original = yield* fs.readFile(`${prepared.root}/${path}`);
      const fresh = yield* owning;
      yield* fs.writeFileString(`${prepared.root}/${path}`, 'forged');
      const changed = Producer.claimOwnedProducer(fresh, prepared).pipe(Effect.result);
      expect(Result.isFailure(yield* changed)).toBe(true);
      yield* fs.writeFile(`${prepared.root}/${path}`, original);
    }
  }
  await Effect.runPromise(Effect.gen(run).pipe(withMetadata, Effect.scoped, withPlatform));
}
test(
  'owned producer cannot be forged, serialized, replayed or rebound to changed source/capsule',
  ownedIdentity,
);

async function warmupSpawn() {
  function* run() {
    const { prepared, fs } = yield* ownedFixture();
    const command = {
      kind: 'Install' as const,
      purpose: 'Warmup' as const,
      workspace: `${prepared.root}/workspace`,
      home: `${prepared.root}/home`,
      tmp: `${prepared.root}/tmp`,
      cache: `${prepared.root}/cache`,
    };
    for (const path of [command.workspace, command.home, command.tmp, command.cache])
      yield* fs.makeDirectory(path);
    const exited = yield* Deferred.make<void>();
    const announced = yield* Deferred.make<void>();
    const records: string[] = [];
    const state = { released: false, spawned: false };
    const timed = Deferred.await(exited).pipe(Effect.timeout(2000));
    const waiting = timed.pipe(
      Effect.map(() => ChildProcessSpawner.ExitCode(0)),
      Effect.mapError(() =>
        PlatformError.badArgument({
          module: 'Test',
          method: 'exitCode',
          description: 'owned fixture deadline',
        }),
      ),
    );
    const handle = ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(7),
      exitCode: waiting,
      isRunning: Effect.succeed(true),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: Stream.empty,
      stderr: Stream.empty,
      all: Stream.empty,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.sync(() => Effect.void),
    });
    function release() {
      const releasing = Effect.sync(() => {
        state.released = true;
      });
      return releasing;
    }
    function spawn(command: import('effect/process').ChildProcess.Command) {
      function* acquire() {
        expect(command).toMatchObject({ _tag: 'StandardCommand', command: '/usr/local/bin/bun' });
        state.spawned = true;
        yield* Effect.addFinalizer(release);
        return handle;
      }
      const workflow = Effect.gen(acquire);
      return workflow;
    }
    function output(chunk: string | Uint8Array) {
      function* capture() {
        expect(state.spawned).toBe(true);
        const text = Match.value(chunk).pipe(
          Match.when(isText, (value) => value),
          Match.orElse((value) => new TextDecoder().decode(value)),
        );
        records.push(text);
        yield* Deferred.succeed(announced, undefined);
      }
      const workflow = Effect.gen(capture);
      return workflow;
    }
    const stdio = Stdio.make({
      args: Effect.succeed([]),
      stdin: Stream.empty,
      stdout: () => Sink.forEach(output),
      stderr: () => Sink.drain,
    });
    const producerId = yield* Effect.try(() => crypto.randomUUID());
    const worker = makeWorkerProcess(
      { producerId, mode: 'InterruptWarmup', request: prepared.admission.request },
      prepared,
    );
    const spawner = ChildProcessSpawner.make(spawn);
    const running = worker
      .run(command)
      .pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Stdio.Stdio, stdio),
        Effect.forkChild,
      );
    const fiber = yield* running;
    yield* Deferred.await(announced).pipe(Effect.timeout(2000));
    yield* Fiber.interrupt(fiber);
    expect(state.released).toBe(true);
    expect(records).toHaveLength(1);
    const frame = yield* decodeWarmup(records[0]);
    expect(frame).toMatchObject({
      _tag: 'WorkerWarmupReady',
      producerId,
      mode: 'InterruptWarmup',
      pid: 7,
    });
  }
  await Effect.runPromise(Effect.gen(run).pipe(withMetadata, Effect.scoped, withPlatform));
}
test(
  'rehearsal is reached through actual fixed warmup spawn and interruption releases its process scope',
  warmupSpawn,
);
