import type { ContainerClient, ContainerProcess } from 'alchemy/Cloudflare/Containers';
import { Data, Effect, Option, Result, Schema, Stream } from 'effect';

export class SmokeError extends Data.TaggedError('SmokeError')<{
  readonly code: 'ContainerFailed' | 'InvalidOutput';
}> {}
const smokeArgv = Object.freeze(['/usr/local/bin/node', '--version']);
const runtime = Schema.String.check(Schema.isPattern(/^v\d+\.\d+\.\d+$/));

function append(previous: Uint8Array, chunk: Uint8Array) {
  const bounded = Result.succeed(chunk).pipe(
    Result.filterOrFail(
      () => previous.length + chunk.length <= 128,
      () => new SmokeError({ code: 'InvalidOutput' }),
    ),
  );
  function join(value: Uint8Array) {
    const next = new Uint8Array(previous.length + value.length);
    next.set(previous);
    next.set(value, previous.length);
    return next;
  }
  return bounded.pipe(Result.map(join));
}
function collect(process: ContainerProcess) {
  function* readOutput() {
    const stdout = yield* Effect.fromOption(Option.fromUndefinedOr(process.stdout));
    const bytes = yield* Stream.runFoldEffect(
      stdout,
      () => new Uint8Array(),
      (previous, chunk) => Effect.fromResult(append(previous, chunk)),
    );
    const exitCode = yield* process.exitCode;
    const checked = Result.succeed(exitCode).pipe(
      Result.filterOrFail(
        (code) => code === 0,
        () => new SmokeError({ code: 'InvalidOutput' }),
      ),
    );
    yield* Effect.fromResult(checked);
    return yield* Schema.decodeUnknownEffect(runtime)(new TextDecoder().decode(bytes).trim());
  }
  const reading = Effect.gen(readOutput);
  return reading.pipe(Effect.mapError(() => new SmokeError({ code: 'InvalidOutput' })));
}

export function makeSmokeContainer(
  container: Pick<
    ContainerClient,
    'start' | 'setInactivityTimeout' | 'exec' | 'destroy' | 'running'
  >,
) {
  const failed = () => new SmokeError({ code: 'ContainerFailed' });
  function start() {
    function* startFresh() {
      const running = yield* container.running;
      const stopped = Result.succeed(running).pipe(Result.filterOrFail((value) => !value, failed));
      yield* Effect.fromResult(stopped);
      yield* container.start({
        enableInternet: false,
        entrypoint: ['/bin/sleep', 'infinity'],
        instance: 'lite',
        env: {},
      });
      yield* container.setInactivityTimeout(60000);
    }
    const starting = Effect.gen(startFresh);
    return starting.pipe(Effect.mapError(failed));
  }
  const execute = () =>
    container
      .exec([...smokeArgv], {
        stdout: 'pipe',
        stderr: 'ignore',
      })
      .pipe(Effect.flatMap(collect), Effect.scoped, Effect.mapError(failed));
  const destroy = () => container.destroy().pipe(Effect.mapError(failed));
  const stopped = container.running.pipe(
    Effect.map((running) => !running),
    Effect.mapError(failed),
  );
  return { start, execute, destroy, stopped };
}
