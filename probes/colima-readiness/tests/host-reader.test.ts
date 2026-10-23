import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Match,
  Option,
  Result,
  Schema,
  Stream,
} from 'effect';
import { ChildProcessSpawner } from 'effect/process';

import { makeHostReader } from '../src/host-reader.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function* fixture() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ directory: '/private/tmp' });
  yield* fs.makeDirectory(`${root}/ceirean`);
  yield* fs.makeDirectory(`${root}/home`);
  const path = `${root}/ceirean/colima.yaml`;
  yield* fs.writeFileString(path, 'mounts: []\n');
  const config = {
    colimaRoot: root,
    home: `${root}/home`,
    parentDirectoriesTrusted: true,
    executableCandidates: {
      Colima: { path: `${root}/missing`, semantics: 'ClientOnlyVersion' as const },
      Docker: { path: `${root}/missing`, semantics: 'Unsupported' as const },
    },
    now: () => 123,
  };
  function* executable(mode: string) {
    const dir = `${root}/${mode}`;
    yield* fs.makeDirectory(dir);
    yield* fs.copyFile(`${import.meta.dir}/child.ts`, `${dir}/client`);
    yield* fs.chmod(`${dir}/client`, 0o700);
    return makeHostReader({
      ...config,
      executableCandidates: {
        ...config.executableCandidates,
        Colima: { path: `${dir}/client`, semantics: 'ClientOnlyVersion' as const },
      },
    });
  }
  return {
    fs,
    root,
    path,
    config,
    executable: (mode: string) => Effect.gen(() => executable(mode)),
  };
}

async function regularBounds() {
  function* scenario() {
    const { fs, path, config } = yield* Effect.gen(fixture);
    const reader = makeHostReader(config);
    for (const [size, expected] of [
      [262144, 262144],
      [262145, 'FileTooLarge'],
    ] as const) {
      yield* fs.writeFile(path, new Uint8Array(size).fill(32));
      const result = yield* reader.readRegular('ColimaConfig').pipe(Effect.result);
      const projected = Result.match(result, {
        onFailure: (error) => error.code,
        onSuccess: (value) => value.bytes.length,
      });
      expect(projected).toBe(expected);
    }
    yield* fs.writeFile(path, new Uint8Array([0xff]));
    const invalid = yield* reader.readRegular('ColimaConfig').pipe(Effect.result);
    expect(invalid).toMatchObject({ failure: { code: 'InvalidEncoding', truncated: false } });
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'regular reads accept exactly 256 KiB, reject overflow and invalid UTF-8 with finite codes',
  regularBounds,
);

async function specialFiles() {
  function* scenario() {
    const { fs, root, path, config } = yield* Effect.gen(fixture);
    const reader = makeHostReader(config);
    yield* fs.remove(path, { recursive: true });
    yield* fs.makeDirectory(path);
    expect(yield* reader.readRegular('ColimaConfig').pipe(Effect.result)).toMatchObject({
      failure: { code: 'NotRegular' },
    });
    yield* fs.remove(path, { recursive: true });
    yield* fs.writeFileString(`${root}/target`, 'synthetic');
    yield* fs.symlink(`${root}/target`, path);
    expect(yield* reader.readRegular('ColimaConfig').pipe(Effect.result)).toMatchObject({
      failure: { code: 'ReadFailed' },
    });
    const info = yield* fs.stat(root);
    let opens = 0;
    function open(...args: Parameters<typeof fs.open>) {
      opens += 1;
      const program = fs.open(...args);
      return program;
    }
    const observed = {
      ...fs,
      stat: () => Effect.succeed({ ...info, type: 'FIFO' as const }),
      open,
    };
    const reading = reader.readRegular('ColimaConfig').pipe(Effect.result);
    const result = yield* Effect.provideService(reading, FileSystem.FileSystem, observed);
    expect(result).toMatchObject({ failure: { code: 'NotRegular' } });
    expect(opens).toBe(0);
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test('directories, symlinks and FIFO metadata are rejected before opening', specialFiles);

async function replacementChecks() {
  function* scenario() {
    const { fs, path, config } = yield* Effect.gen(fixture);
    const reader = makeHostReader(config);
    const cases = [
      { replace: true, changeInode: false, nonregular: false, code: 'FileChanged' },
      { replace: false, changeInode: true, nonregular: false, code: 'FileChanged' },
      { replace: false, changeInode: false, nonregular: true, code: 'NotRegular' },
    ];
    for (const c of cases) {
      let reads = 0;
      function* open(...args: Parameters<typeof fs.open>) {
        expect(args[1]?.noFollow).toBe(true);
        function* replace() {
          yield* fs.writeFileString(`${path}.new`, 'different');
          yield* fs.rename(`${path}.new`, path);
        }
        const replacement = Effect.gen(replace);
        const shouldReplace = Effect.sync(() => c.replace);
        yield* replacement.pipe(Effect.when(shouldReplace));
        const file = yield* fs.open(...args);
        function changeInfo(info: FileSystem.File.Info): FileSystem.File.Info {
          return Match.value(c).pipe(
            Match.when({ nonregular: true }, () => ({ ...info, type: 'FIFO' as const })),
            Match.when({ changeInode: true }, () => ({ ...info, ino: Option.some(0n) })),
            Match.orElse(() => info),
          );
        }
        const stat = file.stat.pipe(Effect.map(changeInfo));
        function readAlloc(size: number) {
          reads += 1;
          const program = file.readAlloc(size);
          return program;
        }
        return { ...file, stat, readAlloc };
      }
      const observed = {
        ...fs,
        open: (...args: Parameters<typeof fs.open>) => Effect.gen(() => open(...args)),
      };
      const reading = reader.readRegular('ColimaConfig').pipe(Effect.result);
      const result = yield* Effect.provideService(reading, FileSystem.FileSystem, observed);
      expect(result).toMatchObject({ failure: { code: c.code } });
      expect(reads).toBe(0);
    }
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'replacement before open and changed/nonregular descriptor metadata fail closed',
  replacementChecks,
);

async function boundedGrowth() {
  function* scenario() {
    const { fs, path, config } = yield* Effect.gen(fixture);
    const reader = makeHostReader(config);
    const requests: number[] = [];
    function* open(...args: Parameters<typeof fs.open>) {
      const file = yield* fs.open(...args);
      const stat = file.stat.pipe(Effect.tap(() => fs.writeFile(path, new Uint8Array(300000))));
      function readAlloc(size: number) {
        requests.push(size);
        const program = file.readAlloc(Math.min(size, 8192));
        return program;
      }
      return { ...file, stat, readAlloc };
    }
    const reading = reader.readRegular('ColimaConfig').pipe(Effect.result);
    const result = yield* Effect.provideService(reading, FileSystem.FileSystem, {
      ...fs,
      open: (...args) => Effect.gen(() => open(...args)),
    });
    expect(result).toMatchObject({ failure: { code: 'FileTooLarge' } });
    expect(Math.max(...requests)).toBeLessThanOrEqual(262145);
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test('short reads and growth are bounded during collection, not after buffering', boundedGrowth);

async function blockedInputs() {
  function* scenario() {
    const { config } = yield* Effect.gen(fixture);
    const untrusted = makeHostReader({ ...config, parentDirectoriesTrusted: false });
    expect(yield* untrusted.readRegular('ColimaConfig').pipe(Effect.result)).toMatchObject({
      failure: { code: 'UntrustedParents' },
    });
    const reader = makeHostReader(config);
    expect(yield* reader.runVersion('Docker').pipe(Effect.result)).toMatchObject({
      failure: { code: 'UnsupportedSemantics' },
    });
    expect(yield* reader.runVersion('Colima').pipe(Effect.result)).toMatchObject({
      failure: { code: 'Unavailable' },
    });
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'untrusted parents, unsupported semantics and missing candidates block without fallback',
  blockedInputs,
);

async function versionEnvironment() {
  function* scenario() {
    const sentinel = Effect.sync(() => {
      process.env.CEIREAN_SYNTHETIC_SENTINEL = 'synthetic-only';
    });
    const removeSentinel = Effect.sync(() => {
      delete process.env.CEIREAN_SYNTHETIC_SENTINEL;
    });
    yield* Effect.acquireRelease(sentinel, () => removeSentinel);
    const f = yield* Effect.gen(fixture);
    const reader = yield* f.executable('success');
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const commands: unknown[] = [];
    function spawn(command: Parameters<typeof spawner.spawn>[0]) {
      commands.push(command);
      const program = spawner.spawn(command);
      return program;
    }
    const observed = { ...spawner, spawn };
    const reading = reader.runVersion('Colima');
    const result = yield* Effect.provideService(
      reading,
      ChildProcessSpawner.ChildProcessSpawner,
      observed,
    );
    expect(result).toMatchObject({
      text: 'colima version 0.9.1\n',
      truncated: false,
      observedAtMs: 123,
    });
    expect(commands).toMatchObject([
      {
        args: ['--version'],
        options: {
          env: { HOME: f.config.home },
          extendEnv: false,
          shell: false,
          cwd: f.config.home,
          stdin: 'ignore',
        },
      },
    ]);
    const docker = makeHostReader({
      ...f.config,
      executableCandidates: {
        ...f.config.executableCandidates,
        Docker: { path: `${f.root}/success/client`, semantics: 'ClientOnlyVersion' },
      },
    });
    expect((yield* docker.runVersion('Docker')).text).toContain('0.9.1');
    const environment = yield* f.executable('environment');
    const envResult = yield* environment.runVersion('Colima');
    expect(envResult.text).toBe('HOME');
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'version commands use fixed argv, no shell/search and only isolated HOME; both tool IDs',
  versionEnvironment,
);

async function commandFailures() {
  function* scenario() {
    const f = yield* Effect.gen(fixture);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handles: ChildProcessSpawner.ChildProcessHandle[] = [];
    function observe(handle: ChildProcessSpawner.ChildProcessHandle) {
      handles.push(handle);
      return handle;
    }
    function spawn(command: Parameters<typeof spawner.spawn>[0]) {
      const program = spawner.spawn(command).pipe(Effect.map(observe));
      return program;
    }
    const observed = { ...spawner, spawn };
    for (const [mode, code, truncated] of [
      ['nonzero', 'NonzeroExit', false],
      ['invalid', 'InvalidEncoding', false],
      ['flood', 'OutputTooLarge', true],
    ] as const) {
      const reader = yield* f.executable(mode);
      const reading = reader.runVersion('Colima').pipe(Effect.result);
      const result = yield* Effect.provideService(
        reading,
        ChildProcessSpawner.ChildProcessSpawner,
        observed,
      );
      expect(result).toMatchObject({ failure: { code, truncated } });
      expect(encode(result)).not.toContain('SYNTHETIC_PRIVATE_DIAGNOSTIC');
      expect(encode(result)).not.toContain(f.root);
    }
    for (const handle of handles) expect(yield* handle.isRunning).toBe(false);
    expect(handles.length).toBe(3);
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'nonzero/invalid output is sanitized; overflow stops collection and reaps the owned child',
  commandFailures,
);

async function timeoutAndCancellation() {
  function* scenario() {
    const f = yield* Effect.gen(fixture);
    const reader = yield* f.executable('stall');
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    function* checkChild(cancel: boolean) {
      const started = yield* Deferred.make<ChildProcessSpawner.ChildProcessHandle>();
      const observed = {
        ...spawner,
        spawn: (command: Parameters<typeof spawner.spawn>[0]) =>
          spawner.spawn(command).pipe(Effect.tap((handle) => Deferred.succeed(started, handle))),
      };
      const reading = Effect.provideService(
        reader.runVersion('Colima'),
        ChildProcessSpawner.ChildProcessSpawner,
        observed,
      );
      const before = Date.now();
      const fiber = yield* Effect.forkChild(reading.pipe(Effect.result));
      const handle = yield* Deferred.await(started).pipe(Effect.timeout('2 seconds'));
      const interrupt = Fiber.interrupt(fiber);
      const shouldCancel = Effect.sync(() => cancel);
      yield* interrupt.pipe(Effect.when(shouldCancel));
      const result = yield* Fiber.await(fiber);
      expect(Exit.isFailure(result)).toBe(cancel);
      function project(value: Result.Result<unknown, { readonly code: string }>) {
        return Result.match(value, {
          onFailure: (error) => error.code,
          onSuccess: () => 'UnexpectedSuccess',
        });
      }
      const outcome = Exit.match(result, {
        onFailure: () => 'Cancelled',
        onSuccess: project,
      });
      const expected = Match.value(cancel).pipe(
        Match.when(false, () => 'TimedOut'),
        Match.orElse(() => 'Cancelled'),
      );
      expect(outcome).toBe(expected);
      expect(yield* handle.isRunning).toBe(false);
      yield* handle.exitCode.pipe(Effect.result);
      expect(Date.now() - before).toBeLessThan(7000);
    }
    yield* Effect.forEach([false, true], (cancel) => Effect.gen(() => checkChild(cancel)), {
      concurrency: 1,
    });
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  '5-second ceiling and caller cancellation both wait for owned child exit',
  timeoutAndCancellation,
  15000,
);

async function outputCollectionBound() {
  function* scenario() {
    const f = yield* Effect.gen(fixture);
    const reader = yield* f.executable('success');
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    for (const count of [8, 10]) {
      let pulls = 0;
      function* chunks() {
        for (let index = 0; index < count; index += 1) {
          pulls += 1;
          yield new Uint8Array(8192).fill(32);
        }
      }
      function observe(handle: ChildProcessSpawner.ChildProcessHandle) {
        return { ...handle, all: Stream.fromIterable(chunks(), { chunkSize: 1 }) };
      }
      function spawn(command: Parameters<typeof spawner.spawn>[0]) {
        const program = spawner.spawn(command).pipe(Effect.map(observe));
        return program;
      }
      const reading = reader.runVersion('Colima').pipe(Effect.result);
      const result = yield* Effect.provideService(
        reading,
        ChildProcessSpawner.ChildProcessSpawner,
        { ...spawner, spawn },
      );
      const projection = Result.match(result, {
        onFailure: (error) => error.code,
        onSuccess: (value) => value.bytes.length,
      });
      const expected = Match.value(count).pipe(
        Match.when(8, () => 65536),
        Match.orElse(() => 'OutputTooLarge' as const),
      );
      expect(projection).toBe(expected);
      expect(pulls).toBeLessThanOrEqual(9);
    }
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'combined output accepts exactly 64 KiB and stops pulling at the first excess chunk',
  outputCollectionBound,
);

async function metadataChanges() {
  function* scenario() {
    const f = yield* Effect.gen(fixture);
    const reader = makeHostReader(f.config);
    function changed(info: FileSystem.File.Info): FileSystem.File.Info {
      return { ...info, mtime: Option.some(new Date(1)) };
    }
    const original = yield* f.fs.stat(f.path);
    function* open(...args: Parameters<typeof f.fs.open>) {
      const file = yield* f.fs.open(...args);
      return {
        ...file,
        stat: Effect.succeed(changed(original)),
        readAlloc: (size: number) => file.readAlloc(size),
      };
    }
    const reading = reader.readRegular('ColimaConfig').pipe(Effect.result);
    const observed = {
      ...f.fs,
      open: (...args: Parameters<typeof f.fs.open>) => Effect.gen(() => open(...args)),
    };
    const result = yield* Effect.provideService(reading, FileSystem.FileSystem, observed);
    expect(result).toMatchObject({ failure: { code: 'FileChanged' } });
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'same-inode metadata changes between path stat and descriptor stat are refused',
  metadataChanges,
);
