import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { runCli, type CliDependencies } from './cli.ts';
import { collectHostObservations } from './host-observations.ts';
import { makeHostReader } from './host-reader.ts';
import { inspectHost } from './preflight.ts';

export const productionDependencies: CliDependencies = {
  collectHost: collectHostObservations,
  makeReader: (colimaRoot, home) =>
    makeHostReader({
      colimaRoot,
      home,
      parentDirectoriesTrusted: true,
      now: Date.now,
      // No installed executable identity has a reviewed client-only contract yet.
      // In particular, semver-looking output cannot confer execution authority.
      executableCandidates: {
        Colima: { path: '/opt/homebrew/bin/colima', semantics: 'Unsupported' },
        Docker: { path: '/opt/homebrew/bin/docker', semantics: 'Unsupported' },
      },
    }),
  inspect: inspectHost,
};

export function main(argv: ReadonlyArray<string>, dependencies = productionDependencies) {
  function emit(result: Effect.Success<ReturnType<typeof runCli>>) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }
  const program = runCli(argv, dependencies).pipe(Effect.map(emit));
  const provided = Effect.provide(program, BunServices.layer);
  return provided;
}

const decodeExitCode = Schema.decodeUnknownResult(Schema.Literals([1, 2, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  function completed(value: unknown) {
    const code = decodeExitCode(value).pipe(Result.getOrElse(() => 1));
    onExit(code);
  }
  Exit.match(exit, { onSuccess: completed, onFailure: () => onExit(1) });
};

/** Trusted fixture composition may replace dependencies, never public argv/env. */
export function launch(argv: ReadonlyArray<string>, dependencies = productionDependencies) {
  const program = main(argv, dependencies);
  BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
}

const entrypoint = Match.value(import.meta.main).pipe(
  Match.when(true, () => launch(Bun.argv.slice(2))),
  Match.orElse(() => undefined),
);
await entrypoint;
