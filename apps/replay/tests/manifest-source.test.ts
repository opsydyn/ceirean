import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Match, Result, Schema, Sink, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import { foldkitManifestBaseline } from '../src/manifest-baseline.ts';
import { readPinnedManifests } from '../src/manifest-git-source.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encoder = new TextEncoder();
const withPlatform = Effect.provide(BunServices.layer);
function blobId(bytes: Uint8Array) {
  return new Bun.CryptoHasher('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
function scenario(
  options: {
    bytes?: Uint8Array;
    tree?: string;
    type?: string;
    size?: string;
    stderrBytes?: number;
    exitCode?: number;
    hold?: boolean;
    blob?: string;
    paths?: ReadonlyArray<string>;
  } = {},
) {
  const bytes = options.bytes ?? encoder.encode('{"name":"root"}');
  const blob = options.blob ?? blobId(bytes);
  const paths = options.paths ?? ['package.json'];
  const baseline = { repository: 'owner/repo', commit: 'a'.repeat(40), paths };
  const state = { active: 0, calls: [] as ChildProcess.StandardCommand[] };
  function acquire(command: ChildProcess.StandardCommand) {
    function* run() {
      state.calls.push(command);
      state.active += 1;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          state.active -= 1;
        }),
      );
      const path = command.args.at(-1) ?? 'package.json';
      const output = Match.value(command.args).pipe(
        Match.when(
          (a) => a.includes('-t'),
          () => encoder.encode(options.type ?? 'commit\n'),
        ),
        Match.when(
          (a) => a.includes('ls-tree'),
          () => encoder.encode(options.tree ?? `100644 blob ${blob}\t${path}\0`),
        ),
        Match.when(
          (a) => a.includes('-s'),
          () => encoder.encode(options.size ?? `${bytes.length}\n`),
        ),
        Match.orElse(() => bytes),
      );
      const delay = Match.value(options.hold ?? false).pipe(
        Match.when(true, () => 3600000),
        Match.orElse(() => 0),
      );
      function* waitForExit() {
        yield* Effect.sleep(delay);
        return ChildProcessSpawner.ExitCode(options.exitCode ?? 0);
      }
      const exitCode = Effect.gen(waitForExit);
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(7),
        exitCode,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.make(output),
        stderr: Stream.make(new Uint8Array(options.stderrBytes ?? 0)),
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.sync(() => Effect.void),
      });
    }
    const workflow = Effect.gen(run);
    return workflow;
  }
  function spawn(command: ChildProcess.Command) {
    return Match.value(command).pipe(
      Match.tag('StandardCommand', acquire),
      Match.orElse(() => Effect.die('UnexpectedPipeline')),
    );
  }
  const spawner = ChildProcessSpawner.make(spawn);
  const program = readPinnedManifests('/synthetic/repository', baseline).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );
  return { program, state, bytes, baseline };
}
async function boundedSource() {
  const fixture = scenario();
  const source = await Effect.runPromise(fixture.program);
  expect(source.manifests[0]).toEqual({
    path: 'package.json',
    blobId: blobId(fixture.bytes),
    sha256: new Bun.CryptoHasher('sha256').update(fixture.bytes).digest('hex'),
    document: { name: 'root' },
  });
  expect(fixture.state.active).toBe(0);
  expect(fixture.state.calls).toHaveLength(4);
  for (const command of fixture.state.calls) {
    expect(command.command).toBe('/usr/bin/git');
    expect(command.options).toMatchObject({
      shell: false,
      extendEnv: false,
      stdin: 'ignore',
      cwd: '/synthetic/repository',
      killSignal: 'SIGKILL',
    });
    expect(command.options.env).toMatchObject({
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_NO_LAZY_FETCH: '1',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
    });
  }
  expect(foldkitManifestBaseline.paths).toHaveLength(14);
  expect(foldkitManifestBaseline.commit).toBe('1183e3c067f873fdd29f14f06030515929c1b956');
}
test('bounded reader verifies bytes and uses only scoped hardened Git plumbing', boundedSource);

async function rejectsSource() {
  for (const options of [
    { type: 'blob\n' },
    { tree: '' },
    { tree: `120000 blob ${'b'.repeat(40)}\tpackage.json\0` },
    { tree: `160000 commit ${'b'.repeat(40)}\tpackage.json\0` },
    { tree: `100644 blob ${'b'.repeat(40)}\twrong.json\0` },
    { blob: 'b'.repeat(40) },
    { bytes: new Uint8Array([255]) },
    { bytes: encoder.encode('{bad') },
    { size: '999999\n' },
    { size: '1\n' },
    { exitCode: 1 },
    { stderrBytes: 4097 },
  ]) {
    const fixture = scenario(options);
    const result = await Effect.runPromise(fixture.program.pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
    expect(fixture.state.active).toBe(0);
    expect(encode(result)).not.toContain('/synthetic/repository');
  }
}
test(
  'missing, malformed, nonregular, mismatched and oversized sources refuse cleanly',
  rejectsSource,
);

async function byteLimits() {
  const maximum = 262144;
  const prefix = encode({ name: 'root', padding: '' }).slice(0, -2);
  const exact = encoder.encode(`${prefix}${'x'.repeat(maximum - prefix.length - 2)}"}`);
  expect(exact.length).toBe(maximum);
  expect((await Effect.runPromise(scenario({ bytes: exact }).program)).manifests).toHaveLength(1);
  expect(
    Result.isFailure(
      await Effect.runPromise(
        scenario({ bytes: new Uint8Array(maximum + 1) }).program.pipe(Effect.result),
      ),
    ),
  ).toBe(true);
  const paths = [
    'package.json',
    ...Array.from({ length: 7 }, (_, i) => `packages/p${i}/package.json`),
  ];
  expect(
    (await Effect.runPromise(scenario({ bytes: exact, paths }).program)).manifests,
  ).toHaveLength(8);
  expect(
    Result.isFailure(
      await Effect.runPromise(
        scenario({ bytes: exact, paths: [...paths, 'packages/extra/package.json'] }).program.pipe(
          Effect.result,
        ),
      ),
    ),
  ).toBe(true);
  const growing = scenario({ bytes: new Uint8Array(maximum + 1), size: '262144\n' });
  expect(Result.isFailure(await Effect.runPromise(growing.program.pipe(Effect.result)))).toBe(true);
}
test('accepts exact per-file/aggregate byte caps and refuses one extra byte or file', byteLimits);

async function cancellation() {
  const fixture = scenario({ hold: true });
  const result = await Effect.runPromise(
    fixture.program.pipe(Effect.timeout('20 millis'), Effect.result),
  );
  expect(Result.isFailure(result)).toBe(true);
  expect(fixture.state.calls).toHaveLength(1);
  expect(fixture.state.active).toBe(0);
}
test('cancellation joins acquired child finalizers', cancellation);

function git(cwd: string, args: ReadonlyArray<string>) {
  function* run() {
    const child = yield* ChildProcess.make('/usr/bin/git', args, {
      cwd,
      shell: false,
      extendEnv: false,
      env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      stdin: 'ignore',
    });
    const [out, code] = yield* Effect.all([Stream.runCollect(child.stdout), child.exitCode], {
      concurrency: 2,
    });
    expect(Number(code)).toBe(0);
    const size = out.reduce((n, b) => n + b.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of out) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(bytes).trim();
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
async function immutableGit() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-manifest-git-' });
    yield* git(root, ['init', '-q']);
    yield* fs.writeFileString(`${root}/package.json`, '{"name":"committed"}');
    yield* git(root, ['add', 'package.json']);
    yield* git(root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture',
    ]);
    const commit = yield* git(root, ['rev-parse', 'HEAD']);
    const baseline = { repository: 'owner/repo', commit, paths: ['package.json'] };
    const before = yield* readPinnedManifests(root, baseline);
    yield* fs.remove(`${root}/package.json`);
    yield* fs.writeFileString(`${root}/package.json`, '{"name":"replacement-must-not-appear"}');
    yield* git(root, ['add', 'package.json']);
    yield* git(root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'moved',
    ]);
    const replacement = yield* git(root, ['rev-parse', 'HEAD']);
    yield* git(root, ['replace', commit, replacement]);
    yield* fs.remove(`${root}/package.json`);
    const after = yield* readPinnedManifests(root, baseline);
    expect(after).toEqual(before);
    expect(after.commit).toBe(commit);
    expect(after.manifests[0]?.document).toEqual({ name: 'committed' });
  }
  const workflow = Effect.gen(run);
  const program = Effect.scoped(workflow);
  await Effect.runPromise(program.pipe(withPlatform));
}
test(
  'real Git reads immutable committed bytes despite deleted worktree, moved branch and replacement',
  immutableGit,
);
