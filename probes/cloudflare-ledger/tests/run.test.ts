import { dirname } from 'node:path';

import { BunFileSystem, BunRuntime } from '@effect/platform-bun';
import { Data, Effect, FileSystem, Match, Result, Schedule, Schema } from 'effect';

import { prepareInvocation } from './invocation-fixtures.ts';
import { decodeProcessIds, processIsAlive } from './process-tree.test.ts';
const invocationArguments = Schema.Tuple([Schema.Literal('--invocation-only')]);
const isInvocationOnly = Schema.is(invocationArguments);

class ProbeProcessError extends Data.TaggedError('ProbeProcessError')<{
  readonly code: 'SpawnFailed' | 'ExitFailed' | 'StopFailed' | 'ProcessLeak';
  readonly livePids?: ReadonlyArray<number>;
}> {}

function spawnChild(root: string, suite: string, phase: string, policy: string) {
  const executable = process.execPath;
  const output = Match.value(phase).pipe(
    Match.whenOr('FailStartup', 'FailAssertion', () => 'ignore' as const),
    Match.orElse(() => 'inherit' as const),
  );
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
        CEIREAN_DO_PHASE: phase,
        CEIREAN_INVOCATION_POLICY: policy,
      },
      stdin: 'ignore',
      stdout: output,
      stderr: output,
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
function awaitReaped(recorded: ReadonlyArray<number>) {
  function checkAbsence() {
    const alive = recorded.filter(processIsAlive);
    const result = Match.value(alive.length).pipe(
      Match.when(0, () => Result.succeed(recorded.length)),
      Match.orElse(() =>
        Result.fail(new ProbeProcessError({ code: 'ProcessLeak', livePids: alive })),
      ),
    );
    const checking = Effect.fromResult(result);
    return checking;
  }
  const absence = Effect.suspend(checkAbsence);
  return absence.pipe(Effect.retry({ times: 50, schedule: Schedule.spaced('100 millis') }));
}
function runSuite(root: string, file: string, phase: string, policy = '') {
  function* runGeneration() {
    const fs = yield* FileSystem.FileSystem;
    const evidence = `${root}/owned-processes.json`;
    yield* fs.remove(evidence, { force: true });
    const failureMarker = `${root}/expected-failure.txt`;
    yield* fs.remove(failureMarker, { force: true });
    const suite = new URL(file, import.meta.url).pathname;
    const spawning = Effect.try({
      try: () => spawnChild(root, suite, phase, policy),
      catch: () => new ProbeProcessError({ code: 'SpawnFailed' }),
    });
    const child = yield* Effect.acquireRelease(spawning, stopChild);
    const finished = waitExit(child).pipe(Effect.timeout('2 minutes'));
    const code = yield* finished;
    const expected = Match.value(phase).pipe(
      Match.whenOr('FailStartup', 'FailAssertion', () => 1),
      Match.orElse(() => 0),
    );
    const result = Match.value(code === expected).pipe(
      Match.when(true, () => Result.succeed(code)),
      Match.orElse(() => Result.fail(new ProbeProcessError({ code: 'ExitFailed' }))),
    );
    const observed = yield* Effect.fromResult(result);
    function* checkIntentionalFailure() {
      const marker = yield* fs.readFileString(failureMarker);
      const reached = Match.value(marker === phase).pipe(
        Match.when(true, () => Result.succeed(marker)),
        Match.orElse(() => Result.fail(new ProbeProcessError({ code: 'ExitFailed' }))),
      );
      yield* Effect.fromResult(reached);
    }
    const checkingMarker = Effect.gen(checkIntentionalFailure);
    const expectsFailure = Effect.sync(() => expected === 1);
    const verifiedFailure = checkingMarker.pipe(Effect.when(expectsFailure));
    yield* verifiedFailure;
    yield* Effect.logInfo('Probe child completed', { phase, exitCode: observed });
    const recorded = decodeProcessIds(yield* fs.readFileString(evidence));
    const count = yield* awaitReaped(recorded);
    yield* Effect.logInfo('Owned local runtime processes reaped', { phase, count });
  }
  const running = Effect.gen(runGeneration);
  return running.pipe(Effect.scoped);
}
function* runProbe() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({
    directory: '/private/tmp',
    prefix: 'ceirean-do-',
  });
  yield* fs.chmod(root, 0o700);
  yield* runSuite(root, './invocation-guard.test.ts', 'InvocationGuard');
  const first = yield* prepareInvocation(root, 'invocation-main');
  yield* runSuite(root, './invocation.test.ts', 'Invocation', first);
  const restarted = yield* prepareInvocation(root, 'invocation-restart');
  yield* runSuite(root, './invocation.test.ts', 'InvocationSeed', restarted);
  yield* runSuite(root, './invocation.test.ts', 'InvocationVerify', restarted);
  const onlyInvocation = isInvocationOnly(Bun.argv.slice(2));
  const continueLedger = Effect.gen(runLedger);
  const shouldContinue = Effect.sync(() => !onlyInvocation);
  yield* continueLedger.pipe(Effect.when(shouldContinue));
  function* runLedger() {
    yield* runSuite(root, './ledger.test.ts', 'Ledger');
    yield* runSuite(root, './local-only.test.ts', 'Guard');
    yield* runSuite(root, './properties.test.ts', 'Properties');
    yield* runSuite(root, './restart.test.ts', 'Seed');
    yield* runSuite(root, './restart.test.ts', 'Verify');
    yield* runSuite(root, './failure.test.ts', 'FailStartup');
    yield* runSuite(root, './failure.test.ts', 'FailAssertion');
  }
}
export function main() {
  const program = Effect.gen(runProbe);
  const scoped = Effect.scoped(program);
  const configured = Effect.provide(scoped, BunFileSystem.layer);
  return configured;
}
BunRuntime.runMain(main());
