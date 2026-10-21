import { Match } from 'effect';

import { runCli } from './cli.ts';

export async function main(argv: ReadonlyArray<string>, invoke: typeof runCli = runCli) {
  const signalled = Promise.withResolvers<void>();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function forceExit() {
    process.stderr.write('{"_tag":"FailedShutdown"}\n');
    process.exit(1);
  }
  function signal() {
    deadline ??= setTimeout(forceExit, 10000);
    signalled.resolve();
  }
  process.on('SIGINT', signal);
  process.on('SIGTERM', signal);
  async function finish(result: Awaited<ReturnType<typeof runCli>>) {
    async function listening() {
      await signalled.promise;
      await result.app.dispose();
      return 0;
    }
    return Match.value(result.kind).pipe(
      Match.when('Listening', listening),
      Match.when('Completed', () => 0),
      Match.exhaustive,
    );
  }
  function failed() {
    process.stderr.write('{"_tag":"CliFailed"}\n');
    return 1;
  }
  function cleanup() {
    clearTimeout(deadline);
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
  }
  return invoke(argv).then(finish, failed).catch(failed).finally(cleanup);
}

const entrypoint = Match.value(import.meta.main).pipe(
  Match.when(true, async () => {
    process.exitCode = await main(Bun.argv.slice(2));
  }),
  Match.orElse(() => undefined),
);
await entrypoint;
