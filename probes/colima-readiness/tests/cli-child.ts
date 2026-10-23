import { Effect, FileSystem } from 'effect';

import type { CliDependencies } from '../src/cli.ts';
import { makeHostReader } from '../src/host-reader.ts';
import { launch } from '../src/main.ts';
import { inspectHost } from '../src/preflight.ts';

// Programmatic composition only: the public entrypoint has no fixture switch.
const homes: string[] = [];
const dependencies: CliDependencies = {
  collectHost: () =>
    Effect.succeed({
      architecture: 'arm64' as const,
      totalMemoryBytes: 17179869184,
      freeMemoryBytes: 8589934592,
      cpuCount: 8,
    }),
  makeReader: (root, home) => {
    homes.push(home);
    return makeHostReader({
      colimaRoot: root,
      home,
      parentDirectoriesTrusted: true,
      now: () => 1,
      executableCandidates: {
        Colima: { path: `${root}/client`, semantics: 'ClientOnlyVersion' },
        Docker: { path: `${root}/client`, semantics: 'ClientOnlyVersion' },
      },
    });
  },
  inspect: (reader, request) => {
    function* inspect() {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(`${request.colimaRoot}/home-proof`, homes[0]!);
      return yield* inspectHost(reader, request);
    }
    const program = Effect.gen(inspect);
    const guarded = program.pipe(Effect.catch(() => Effect.die({ _tag: 'FixtureWriteFailed' })));
    return guarded;
  },
};
launch(Bun.argv.slice(2), dependencies);
