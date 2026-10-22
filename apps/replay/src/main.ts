import { BunRuntime } from '@effect/platform-bun';
import { Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { runCli } from './cli.ts';

export function main(argv: ReadonlyArray<string>) {
  function emit(result: Effect.Success<ReturnType<typeof runCli>>) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }
  const program = runCli(argv);
  return program.pipe(Effect.map(emit));
}
const decodeExitCode = Schema.decodeUnknownResult(Schema.Literals([1, 2, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  function completed(value: unknown) {
    const code = decodeExitCode(value).pipe(Result.getOrElse(() => 1));
    onExit(code);
  }
  Exit.match(exit, { onSuccess: completed, onFailure: () => onExit(1) });
};
function launch() {
  const args = Bun.argv.slice(2);
  const program = main(args);
  BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
}
const entrypoint = Match.value(import.meta.main).pipe(
  Match.when(true, launch),
  Match.orElse(() => undefined),
);
await entrypoint;
