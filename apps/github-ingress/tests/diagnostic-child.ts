import { Match, Schema } from 'effect';

import { openLocalGitHubApp } from '../src/composition.ts';
import { api, webhook } from './fixtures.ts';

const root = Bun.argv[2];
const failedCall = Number(Bun.argv[3]);
const isStalled = Schema.is(Schema.Literal('true'));
const stalled = isStalled(Bun.argv[4]);
const originalWrite = process.stderr.write;
const captured: string[] = [];
function blockedWrite(chunk: unknown) {
  captured.push(String(chunk));
  return false;
}
function stallSink() {
  process.stderr.write = blockedWrite as typeof process.stderr.write;
  return setTimeout(() => process.stderr.emit('drain'), 1500);
}
const safety = Match.value(stalled).pipe(
  Match.when(true, stallSink),
  Match.orElse(() => undefined),
);
const github = api();
let calls = 0;
async function fetch(url: string, init: RequestInit) {
  calls++;
  return Match.value(calls === failedCall).pipe(
    Match.when(true, () => new Response('sensitive-response-must-not-leak', { status: 403 })),
    Match.orElse(() => github.fetch(url, init)),
  );
}
const app = await openLocalGitHubApp(['start', '--config', `${root}/config.json`], {
  host: {
    ownerUid: process.geteuid?.() ?? -1,
    homeDirectory: root,
    cwd: root,
    repositoryRoots: [],
    buildRoots: [],
    temporaryRoots: [],
    syncedRoots: [],
    ownedTemporaryRoot: root,
  },
  fetch,
});
async function exercise() {
  const started = performance.now();
  const response = await app.fetch(await webhook());
  await app.dispose();
  const elapsedMs = performance.now() - started;
  const json = Schema.fromJsonString(Schema.Unknown);
  const encode = Schema.encodeSync(json);
  const output = encode({ status: response.status, body: await response.json(), calls, elapsedMs });
  process.stdout.write(`${output}\n`);
}
async function cleanup() {
  process.stderr.write = originalWrite;
  process.stderr.emit('drain');
  clearTimeout(safety);
  const emit = stalled && originalWrite.call(process.stderr, captured.join(''));
  void emit;
  await app.dispose();
}
await exercise().finally(cleanup);
