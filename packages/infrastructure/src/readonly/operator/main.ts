import { BunRuntime } from '@effect/platform-bun';
import { Effect, Exit, Match, Schema, Result, type Runtime } from 'effect';

import { runOperatorCommand } from './command.ts';

export function main(argv: ReadonlyArray<string>) {
  function emit(result: Effect.Success<ReturnType<typeof runOperatorCommand>>) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }
  return runOperatorCommand(argv).pipe(Effect.map(emit));
}
const decodeExitCode = Schema.decodeUnknownResult(Schema.Literals([0, 1, 2, 64]));
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
