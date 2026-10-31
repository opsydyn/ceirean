import { expect, test } from 'bun:test';

import { NodeServices } from '@effect/platform-node';
import {
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Match,
  Option,
  PlatformError,
  Result,
  Schema,
  Sink,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import { currentCiNames } from '../src/current-ci-docker.ts';
import { makeCurrentCiPorts } from '../src/current-ci-platform.ts';
import { CacheError, CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';

const session = { owner: '00000000-0000-4000-8000-000000000001', root: '/controlled' };
const withPlatform = Effect.provide(NodeServices.layer);
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
type Resource = { readonly kind: 'container' | 'volume'; readonly name: string };
type Answer = { readonly stdout: string; readonly code: number; readonly pending: boolean };

function fixture(blockedKind?: 'volume' | 'stager' | 'consumer') {
  function* prepare() {
    const entered = yield* Deferred.make<void>();
    const exited = yield* Deferred.make<void>();
    const names = currentCiNames(session.owner);
    const root = `${session.root}/.local/current-ci-${session.owner}`;
    const directories = new Set<string>([session.root]);
    const writes: string[] = [];
    const calls: string[][] = [];
    const resources = new Map<string, Resource>();
    const state = { allowRemoval: true, metadataFailure: false, late: Option.none<Resource>() };
    function makeDirectory(path: string) {
      const workflow = Effect.sync(() => {
        directories.add(path);
      });
      return workflow;
    }
    function remove(path: string) {
      const workflow = Effect.sync(() => {
        directories.delete(path);
      });
      return workflow;
    }
    const fs = FileSystem.makeNoop({
      realPath: (path) => Effect.sync(() => path),
      makeDirectory,
      remove,
      readDirectory: () => Effect.succeed([]),
      chmod: () => Effect.void,
      writeFileString: (path) =>
        Effect.sync(() => {
          writes.push(path);
        }),
    });
    function lstat(_path: string) {
      const info: Effect.Success<ReturnType<ReturnType<typeof makeCacheMetadata>['lstat']>> = {
        type: 'Directory',
        mode: 0o700,
        uid: 501,
        gid: 20,
        dev: 1n,
        ino: 1n,
        nlink: 2n,
        size: 0n,
      };
      const workflow = Effect.sync(() => info);
      const refusing = Effect.fail(new CacheError({ code: 'InputChanged' }));
      const refused = Effect.sync(() => state.metadataFailure);
      return refusing.pipe(Effect.when(refused), Effect.andThen(workflow));
    }
    function list(kind: Resource['kind']) {
      return [...resources.values()]
        .filter((entry) => entry.kind === kind)
        .map(({ name }) => name)
        .join('\n');
    }
    function create(kind: Resource['kind'], name: string, blocked: boolean): Answer {
      const resource = { kind, name };
      const change = Match.value(blocked).pipe(
        Match.when(true, () => () => {
          state.late = Option.some(resource);
        }),
        Match.orElse(() => () => {
          resources.set(name, resource);
        }),
      );
      change();
      return { stdout: name, code: 0, pending: blocked };
    }
    function deletion(name: string): Answer {
      const remove = Match.value(state.allowRemoval).pipe(
        Match.when(true, () => () => resources.delete(name)),
        Match.orElse(() => () => false),
      );
      remove();
      return { stdout: '', code: Number(!state.allowRemoval), pending: false };
    }
    function volume(args: readonly string[]): Answer {
      const isBlocked = Schema.is(Schema.Literal('volume'));
      const blocked = isBlocked(blockedKind);
      const name = args.at(-1)!;
      return Match.value(args[1]).pipe(
        Match.when('ls', () => ({ stdout: list('volume'), code: 0, pending: false })),
        Match.when('create', () => create('volume', name, blocked)),
        Match.when('inspect', () => ({
          stdout: encode([{ Labels: { 'ceirean.current': session.owner } }]),
          code: 0,
          pending: false,
        })),
        Match.when('rm', () => deletion(args.at(-1)!)),
        Match.orElse(() => ({ stdout: '', code: 0, pending: false })),
      );
    }
    function container(args: readonly string[]): Answer {
      const name = args[args.indexOf('--name') + 1]!;
      const isStager = Schema.is(Schema.Literal('stager'));
      const isConsumer = Schema.is(Schema.Literal('consumer'));
      const selected = Match.value(name).pipe(
        Match.when(names.stager, () => isStager(blockedKind)),
        Match.orElse(() => isConsumer(blockedKind)),
      );
      return create('container', name, selected);
    }
    function docker(args: readonly string[]): Answer {
      return Match.value(args[0]).pipe(
        Match.when('volume', () => volume(args)),
        Match.when('container', () => ({ stdout: list('container'), code: 0, pending: false })),
        Match.when('create', () => container(args)),
        Match.when('inspect', () => ({
          stdout: encode([{ Config: { Labels: { 'ceirean.current': session.owner } } }]),
          code: 0,
          pending: false,
        })),
        Match.when('rm', () => deletion(args.at(-1)!)),
        Match.orElse(() => ({ stdout: '', code: 0, pending: false })),
      );
    }
    function spawn(raw: ChildProcess.Command) {
      function* start() {
        const checked = Result.succeed(raw).pipe(
          Result.filterOrFail(
            ChildProcess.isStandardCommand,
            () => new Error('Unsupported fake command'),
          ),
        );
        const command = yield* Effect.fromResult(checked);
        calls.push([...command.args]);
        const response = Match.value(command.command).pipe(
          Match.when('/opt/ceirean-controller/bun', () => ({
            stdout: '',
            code: 1,
            pending: false,
          })),
          Match.orElse(() => docker(command.args)),
        );
        const isPending = Effect.sync(() => response.pending);
        yield* Deferred.succeed(entered, undefined).pipe(Effect.when(isPending));
        const boundedWait = Deferred.await(exited).pipe(Effect.timeout('5 seconds'));
        const waiting = boundedWait.pipe(
          Effect.map(() => ChildProcessSpawner.ExitCode(0)),
          Effect.mapError(() =>
            PlatformError.badArgument({
              module: 'Test',
              method: 'wait',
              description: 'Fake deadline',
            }),
          ),
        );
        const ready = Effect.succeed(ChildProcessSpawner.ExitCode(response.code));
        const exitCode = Match.value(response.pending).pipe(
          Match.when(true, () => waiting),
          Match.orElse(() => ready),
        );
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(7),
          exitCode,
          isRunning: Effect.succeed(true),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.make(new TextEncoder().encode(response.stdout)),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.sync(() => Effect.void),
        });
      }
      const workflow = Effect.gen(start);
      return workflow.pipe(
        Effect.mapError(() =>
          PlatformError.badArgument({
            module: 'Test',
            method: 'spawn',
            description: 'Fake failure',
          }),
        ),
      );
    }
    const spawner = ChildProcessSpawner.make(spawn);
    const provideFs = Effect.provideService(FileSystem.FileSystem, fs);
    const provideMetadata = Effect.provideService(CacheMetadata, { lstat });
    const provideProcess = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const ports = makeCurrentCiPorts(session.root);
    return {
      ports,
      entered,
      root,
      directories,
      writes,
      resources,
      state,
      calls,
      provideFs,
      provideMetadata,
      provideProcess,
    };
  }
  const workflow = Effect.gen(prepare);
  return workflow;
}

async function ambiguousCreation() {
  for (const kind of ['volume', 'stager', 'consumer'] as const) {
    const fake = await Effect.runPromise(fixture(kind));
    function* check() {
      expect(yield* fake.ports.prepare(session.owner).pipe(Effect.result)).toMatchObject({
        _tag: 'Failure',
      });
      const acquiring = Match.value(kind).pipe(
        Match.when('volume', () => fake.ports.createVolume(session.owner, 'inputs')),
        Match.when('stager', () => fake.ports.stage(session.owner)),
        Match.orElse(() => fake.ports.createConsumer(session.owner)),
      );
      const child = yield* acquiring.pipe(Effect.forkChild);
      yield* Deferred.await(fake.entered).pipe(Effect.timeout('2 seconds'));
      yield* Fiber.interrupt(child);
      const first = yield* fake.ports.cleanup(session.owner).pipe(Effect.result);
      expect(first._tag).toBe('Failure');
      expect(fake.directories.has(fake.root)).toBe(true);
      expect(fake.writes).toEqual([]);
      const resource = yield* Effect.fromOption(fake.state.late);
      fake.resources.set(resource.name, resource);
      const again = yield* fake.ports.cleanup(session.owner).pipe(Effect.result);
      expect(again._tag).toBe('Failure');
      expect(fake.resources.size).toBe(0);
      expect(fake.directories.has(fake.root)).toBe(true);
    }
    const workflow = Effect.gen(check);
    await Effect.runPromise(
      workflow.pipe(
        Effect.scoped,
        fake.provideFs,
        fake.provideMetadata,
        fake.provideProcess,
        withPlatform,
      ),
    );
  }
}
test(
  'late volume/stager/consumer creation remains unknown after client interruption and absent listings',
  ambiguousCreation,
);

async function ownershipSurvivesRemovalFailure() {
  const fake = await Effect.runPromise(fixture());
  function* check() {
    yield* fake.ports.prepare(session.owner).pipe(Effect.result);
    yield* fake.ports.createVolume(session.owner, 'work');
    fake.state.allowRemoval = false;
    expect(yield* fake.ports.cleanup(session.owner).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
    });
    expect(fake.directories.has(fake.root)).toBe(true);
    const count = fake.calls.length;
    expect(yield* fake.ports.cleanup(session.owner).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
    });
    expect(fake.calls.length).toBeGreaterThan(count);
    fake.state.allowRemoval = true;
    expect(yield* fake.ports.cleanup(session.owner).pipe(Effect.result)).toMatchObject({
      _tag: 'Success',
    });
    expect(fake.resources.size).toBe(0);
    expect(fake.directories.has(fake.root)).toBe(false);
  }
  const workflow = Effect.gen(check);
  await Effect.runPromise(
    workflow.pipe(
      Effect.scoped,
      fake.provideFs,
      fake.provideMetadata,
      fake.provideProcess,
      withPlatform,
    ),
  );
}
test(
  'failed removal retains root and resource authority for a subsequent cleanup',
  ownershipSurvivesRemovalFailure,
);

async function unresolvedDirectoryClaim() {
  const fake = await Effect.runPromise(fixture());
  fake.state.metadataFailure = true;
  function* check() {
    expect(yield* fake.ports.prepare(session.owner).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
    });
    expect(fake.directories.has(fake.root)).toBe(true);
    expect(yield* fake.ports.cleanup(session.owner).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
    });
    expect(fake.directories.has(fake.root)).toBe(true);
    expect(fake.calls).toEqual([]);
  }
  const workflow = Effect.gen(check);
  await Effect.runPromise(
    workflow.pipe(
      Effect.scoped,
      fake.provideFs,
      fake.provideMetadata,
      fake.provideProcess,
      withPlatform,
    ),
  );
}
test(
  'a directory created without captured identity cannot be declared cleaned or deleted',
  unresolvedDirectoryClaim,
);
