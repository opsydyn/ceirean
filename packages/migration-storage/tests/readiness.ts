import { Effect, Match, Option, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { childInput, ChildFixtureFailure, type ChildInput } from './fixtures.ts';
type Child = ReturnType<typeof Bun.spawn<'ignore', 'pipe', 'ignore'>>;
const codec = Schema.fromJsonString(childInput);

export function ownChild(input: ChildInput) {
  function spawn() {
    const validated = Schema.decodeUnknownSync(childInput, { onExcessProperty: 'error' })(input);
    return Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '--no-install',
        new URL('./restart-child.ts', import.meta.url).pathname,
        Schema.encodeSync(codec)(validated),
      ],
      { env: {}, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
    );
  }
  const spawning = Effect.try({
    try: spawn,
    catch: () => new ChildFixtureFailure({ phase: 'Spawn' }),
  });
  function stop(child: Effect.Success<typeof spawning>) {
    child.kill('SIGKILL');
    const stopping = awaitChild(child);
    return stopping.pipe(
      Effect.catchCause(() => Effect.die(new ChildFixtureFailure({ phase: 'Exit' }))),
    );
  }
  const owning = Effect.acquireRelease(spawning, stop);
  return owning;
}

export function awaitChild(child: Child) {
  const register: Parameters<typeof Effect.callback<number>>[0] = function register(
    resume,
    signal,
  ) {
    signal.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
    void child.exited.then((code) => resume(Effect.sync(() => code)));
  };
  const waiting = Effect.callback(register);
  return waiting.pipe(Effect.timeout('3 seconds'), TestClock.withLive);
}

export function waitReady(child: Effect.Success<ReturnType<typeof ownChild>>, expected: string) {
  function* readBoundedLine() {
    const reader = child.stdout.getReader();
    function releaseReader() {
      reader.releaseLock();
    }
    const release = Effect.sync(releaseReader);
    const cancelling = Effect.promise(() => reader.cancel());
    const closing = cancelling.pipe(Effect.ensuring(release));
    yield* Effect.addFinalizer(() => closing);
    const bytes = new Uint8Array(64);
    let used = 0;
    let line = Option.none<string>();
    while (Option.isNone(line)) {
      const chunk = yield* Effect.promise(() => reader.read());
      const available = Match.value(chunk).pipe(
        Match.when({ done: false }, ({ value }) => Result.succeed(value)),
        Match.orElse(() => Result.fail(new ChildFixtureFailure({ phase: 'Readiness' }))),
      );
      const value = yield* Effect.fromResult(available);
      const capacity = Match.value(used + value.byteLength <= bytes.byteLength).pipe(
        Match.when(true, () => Result.succeed(undefined)),
        Match.orElse(() => Result.fail(new ChildFixtureFailure({ phase: 'Readiness' }))),
      );
      yield* Effect.fromResult(capacity);
      bytes.set(value, used);
      used += value.byteLength;
      const current = bytes.subarray(0, used);
      function completedLine() {
        const decoded = new TextDecoder().decode(current);
        return Option.some(decoded);
      }
      line = Match.value(current.includes(10)).pipe(
        Match.when(true, completedLine),
        Match.orElse(() => Option.none()),
      );
    }
    const received = Option.getOrThrow(line);
    const correct = Match.value(received === `${expected}\n`).pipe(
      Match.when(true, () => Result.succeed(undefined)),
      Match.orElse(() => Result.fail(new ChildFixtureFailure({ phase: 'Readiness' }))),
    );
    yield* Effect.fromResult(correct);
  }
  const reading = Effect.gen(readBoundedLine);
  return reading.pipe(Effect.scoped, Effect.timeout('3 seconds'), TestClock.withLive);
}
