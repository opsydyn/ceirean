import { Match, Schema } from 'effect';

import { runCli } from '../src/cli.ts';
import { main } from '../src/main.ts';
import { api, webhook } from './fixtures.ts';

const root = Bun.argv[2];
const host = {
  ownerUid: process.geteuid?.() ?? -1,
  homeDirectory: root,
  cwd: root,
  repositoryRoots: [],
  buildRoots: [],
  temporaryRoots: [],
  syncedRoots: [],
  ownedTemporaryRoot: root,
};
async function fakeFetch() {
  process.stdout.write('{"phase":"NativePending"}\n');
  return new Promise<Response>(() => {});
}
const isClean = Schema.is(Schema.Literal('clean'));
async function invoke(args: ReadonlyArray<string>) {
  const clean = isClean(Bun.argv[3]);
  const github = api();
  const fetch = Match.value(clean).pipe(
    Match.when(true, () => github.fetch),
    Match.orElse(() => fakeFetch),
  );
  const result = await runCli(args, { host, fetch, port: 0, silent: true });
  const request = await webhook();
  const pending = result.app.fetch(request);
  async function acknowledged() {
    await pending;
    process.stdout.write('{"phase":"CleanReady"}\n');
  }
  await Match.value(clean).pipe(
    Match.when(true, acknowledged),
    Match.orElse(() => undefined),
  );
  return result;
}
const code = await main(['start', '--config', `${root}/config.json`], invoke);
process.stdout.write('{"phase":"MainReturned"}\n');
process.exitCode = code;
