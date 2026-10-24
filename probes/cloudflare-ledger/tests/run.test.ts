import { dirname } from 'node:path';

import { BunFileSystem, BunRuntime } from '@effect/platform-bun';
import { Data, Effect, FileSystem, Match } from 'effect';

class ProbeProcessError extends Data.TaggedError('ProbeProcessError')<{
  readonly code: 'SpawnFailed' | 'ExitFailed' | 'StopFailed';
}> {}

function spawnChild(root: string, suite: string) {
  const executable = process.execPath;
  return Bun.spawn(
    [executable, '--no-env-file', '--no-install', 'test', suite, '--timeout', '90000'],
    {
      cwd: root,
      env: {
        PATH: `${dirname(executable)}:/opt/homebrew/bin:/usr/bin:/bin`,
        HOME: root,
        TMPDIR: root,
        CI: '1',
        DO_NOT_TRACK: '1',
        ALCHEMY_TELEMETRY_DISABLED: '1',
        CEIREAN_LOCAL_DO: '1',
      },
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
}
function waitExit(child: ReturnType<typeof spawnChild>) {
  function wait(signal: AbortSignal) {
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    return child.exited.finally(() => signal.removeEventListener('abort', abort));
  }
  const waiting = Effect.tryPromise({
    try: wait,
    catch: () => new ProbeProcessError({ code: 'ExitFailed' }),
  });
  return waiting;
}
function stopChild(child: ReturnType<typeof spawnChild>) {
  const stopping = Effect.try({
    try: () => child.kill('SIGTERM'),
    catch: () => new ProbeProcessError({ code: 'StopFailed' }),
  });
  const isRunning = Effect.sync(() => child.exitCode === null);
  const stopped = waitExit(child).pipe(Effect.timeout('10 seconds'));
  return stopping.pipe(
    Effect.when(isRunning),
    Effect.andThen(stopped),
    Effect.asVoid,
    Effect.catch((error) => Effect.die(error)),
  );
}
function* runProbe() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({
    directory: '/private/tmp',
    prefix: 'ceirean-do-',
  });
  yield* fs.chmod(root, 0o700);
  const suite = new URL('./ledger.test.ts', import.meta.url).pathname;
  const spawning = Effect.try({
    try: () => spawnChild(root, suite),
    catch: () => new ProbeProcessError({ code: 'SpawnFailed' }),
  });
  const child = yield* Effect.acquireRelease(spawning, stopChild);
  const finished = waitExit(child).pipe(Effect.timeout('2 minutes'));
  const code = yield* finished;
  const result = Match.value(code).pipe(
    Match.when(0, () => Effect.void),
    Match.orElse(() => Effect.fail(new ProbeProcessError({ code: 'ExitFailed' }))),
  );
  yield* result;
}
export function main() {
  const program = Effect.gen(runProbe);
  const scoped = Effect.scoped(program);
  const configured = Effect.provide(scoped, BunFileSystem.layer);
  return configured;
}
BunRuntime.runMain(main());
