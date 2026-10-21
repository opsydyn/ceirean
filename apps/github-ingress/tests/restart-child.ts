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
const isRecovery = Schema.is(
  Schema.Literals([
    'BeforeTransaction',
    'AfterDecision',
    'AfterEvidence',
    'AfterCommit',
    'ApiPending',
  ]),
);
const phaseJson = Schema.fromJsonString(Schema.Struct({ phase: Schema.String }));
const encodePhase = Schema.encodeSync(phaseJson);
function announce(phase: string) {
  process.stdout.write(`${encodePhase({ phase })}\n`);
}
function sentinel(phase: string) {
  announce(phase);
  // Parent owns the watchdog and SIGKILL; no child timer can advance this barrier.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
async function invoke(args: ReadonlyArray<string>) {
  const clean = isClean(Bun.argv[3]);
  const phase = Bun.argv[3];
  const recovery = isRecovery(phase);
  const github = api();
  async function pendingApi() {
    announce(phase);
    return new Promise<Response>(() => {});
  }
  async function observedFetch(url: string, init: RequestInit) {
    const response = await github.fetch(url, init);
    const stopped = Match.value({ phase, calls: github.calls.length }).pipe(
      Match.when({ phase: 'BeforeTransaction', calls: 5 }, () => sentinel(phase)),
      Match.orElse(() => undefined),
    );
    void stopped;
    return response;
  }
  async function recoveryFetch(url: string, init: RequestInit) {
    return Match.value(phase).pipe(
      Match.when('ApiPending', pendingApi),
      Match.orElse(() => observedFetch(url, init)),
    );
  }
  function testFault(point: string) {
    return Match.value(recovery && point === phase).pipe(
      Match.when(true, () => sentinel(phase)),
      Match.orElse(() => undefined),
    );
  }
  const fetch = Match.value(clean || recovery).pipe(
    Match.when(
      () => recovery,
      () => recoveryFetch,
    ),
    Match.when(true, () => github.fetch),
    Match.orElse(() => fakeFetch),
  );
  const result = await runCli(args, { host, fetch, port: 0, silent: true, testFault });
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
