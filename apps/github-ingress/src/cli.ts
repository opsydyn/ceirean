import { Match } from 'effect';

import { openLocalGitHubApp, type ApplicationOptions } from './composition.ts';

export async function runCli(argv: ReadonlyArray<string>, options: ApplicationOptions = {}) {
  const app = await openLocalGitHubApp(argv, options);
  async function print(output: unknown) {
    await Match.value(options.silent).pipe(
      Match.when(true, () => undefined),
      Match.orElse(() => app.write(output)),
    );
  }
  async function complete(output: unknown) {
    await print(output).finally(app.dispose);
    return { kind: 'Completed' as const, output, app };
  }
  async function start() {
    async function bind() {
      const server = app.listen(options.port ?? 8787);
      const output = { _tag: 'Listening', host: '127.0.0.1', port: server.port };
      await print(output);
      return { kind: 'Listening' as const, output, app };
    }
    return bind().catch(async (error: unknown) => {
      await app.dispose();
      throw error;
    });
  }
  return Match.value(app.session).pipe(
    Match.tag('Completed', ({ output }) => complete(output)),
    Match.tag('Start', start),
    Match.exhaustive,
  );
}
