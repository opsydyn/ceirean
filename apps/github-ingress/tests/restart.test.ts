import { Database } from 'bun:sqlite';
import { afterEach, expect, jest, test } from 'bun:test';

import { LiveAdmissionRecord, LivePermissionEvidence } from '@ceirean/domain';
import { Effect } from 'effect';
import { Match, Schema } from 'effect';

import { readBoundedLine } from '../../../packages/github-adapter/tests/readiness.ts';
import { runCli } from '../src/cli.ts';
import { openLocalGitHubApp } from '../src/composition.ts';
import { CliError } from '../src/config.ts';
import { api, argv, initialize, payload, webhook, withFixture, type Fixture } from './fixtures.ts';

async function qualify(run: (fixture: Fixture) => Promise<void>) {
  const program = withFixture(run);
  await Effect.runPromise(program);
}
afterEach(() => jest.useRealTimers());

async function admissionAndReplay(fixture: Fixture) {
  await initialize(fixture);
  const github = api();
  const app = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: github.fetch,
  });
  async function exercise() {
    const fresh = await app.fetch(await webhook());
    expect(fresh.status).toBe(200);
    const body = await fresh.json();
    expect(Object.keys(body).sort()).toEqual(['correlationId', 'disposition']);
    expect(body.disposition).toBe('Recorded');
    expect(body.correlationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(github.calls).toEqual([
      '/app/installations/11',
      '/app/installations/11/access_tokens',
      '/repositories/22',
      '/user/66',
      '/repos/renamed-owner/renamed-repo/collaborators/renamed-human/permission',
    ]);
    const ping = await app.fetch(await webhook(payload(), 'ping-1', 'ping'));
    expect(await ping.json()).toMatchObject({ disposition: 'Ignored' });
    expect(github.calls.length).toBe(5);
    const busy = await runCli([...argv(fixture, 'configure'), '--expected-revision', 'local-1'], {
      host: fixture.host,
      silent: true,
    }).then(
      () => false,
      () => true,
    );
    expect(busy).toBe(true);
    const bad = await webhook();
    bad.headers.set('x-hub-signature-256', `sha256=${'0'.repeat(64)}`);
    expect((await app.fetch(bad)).status).toBe(401);
    const media = await webhook();
    media.headers.set('content-type', 'text/plain');
    expect((await app.fetch(media)).status).toBe(415);
    const malformed = await webhook({ ...payload(), installation: { id: 0 } }, 'malformed');
    expect((await app.fetch(malformed)).status).toBe(400);
    const oversized = new Request('http://127.0.0.1/webhook', {
      method: 'POST',
      headers: (await webhook()).headers,
      body: 'a'.repeat(65537),
    });
    expect((await app.fetch(oversized)).status).toBe(413);
    const edited = await webhook({ ...payload(), action: 'edited' }, 'edited');
    expect(await (await app.fetch(edited)).json()).toMatchObject({ disposition: 'Ignored' });
    expect(github.calls.length).toBe(5);
  }
  await exercise().finally(app.dispose);
  const reopened = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: async () => {
      throw new CliError({ code: 'OperationFailed' });
    },
  });
  async function replay() {
    const duplicate = await reopened.fetch(await webhook());
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ disposition: 'Duplicate' });
    const changed = payload(55, 67);
    expect((await reopened.fetch(await webhook(changed))).status).toBe(409);
    expect((await reopened.fetch(await webhook(changed, 'other-delivery'))).status).toBe(409);
  }
  await replay().finally(reopened.dispose);
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 1, receipts: 1, evidence: 1 });
}
test('signed admission projects only disposition/correlation; restart replay and conflicts do not need API', () =>
  qualify(admissionAndReplay));

async function credentials(fixture: Fixture) {
  await initialize(fixture);
  const changeMode = fixture.fs.chmod(fixture.config.privateKeyFile, 0o644);
  await Effect.runPromise(changeMode);
  const github = api();
  const opening = openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: github.fetch,
  });
  await expect(opening).rejects.toBeDefined();
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0 });
}
test('start rejects non-owner-only credentials before listener and leaves ledger unmodified', () =>
  qualify(credentials));

async function localRefusal(fixture: Fixture) {
  await initialize(fixture);
  const github = api();
  const app = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: github.fetch,
  });
  async function exercise() {
    const response = await app.fetch(await webhook(payload(56, 67), 'delivery-56'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ disposition: 'Rejected' });
    expect(github.calls).toEqual([]);
  }
  await exercise().finally(app.dispose);
}
test('a durably recorded local refusal is not projected as accepted', () => qualify(localRefusal));

async function forcedShutdown(fixture: Fixture) {
  await initialize(fixture);
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--no-install',
      `${import.meta.dir}/restart-child.ts`,
      fixture.root,
    ],
    {
      env: {},
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  async function exercise() {
    const reader = child.stdout.getReader();
    const text = await readBoundedLine(reader, () => child.kill('SIGKILL'));
    expect(text).toBe('{"phase":"NativePending"}');
    const started = performance.now();
    child.kill('SIGTERM');
    expect(await child.exited).toBe(1);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(9900);
    expect(elapsed).toBeLessThan(13000);
    const stderr = await new Response(child.stderr).text();
    const lines = stderr.trim().split('\n');
    expect(lines).toHaveLength(2);
    const json = Schema.fromJsonString(Schema.Unknown);
    const decode = Schema.decodeUnknownSync(json);
    expect(decode(lines[0])).toEqual({
      _tag: 'IngressOperationalFailure',
      source: 'Unknown',
      code: 'UnexpectedFailure',
      correlationId: expect.any(String),
    });
    expect(lines[1]).toBe('{"_tag":"FailedShutdown"}');
    reader.releaseLock();
    const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
    expect(status.output).toMatchObject({ decisions: 0, receipts: 0, evidence: 0 });
    const app = await openLocalGitHubApp(argv(fixture, 'start'), {
      host: fixture.host,
      fetch: api().fetch,
    });
    const response = await app.fetch(await webhook());
    expect(await response.json()).toMatchObject({ disposition: 'Recorded' });
    await app.dispose();
  }
  await exercise().finally(async () => {
    child.kill();
    await child.exited;
  });
}
test('main forces nonzero exit after ten seconds of genuinely stuck native disposal; ledger reopens separately', () =>
  qualify(forcedShutdown));

async function bodyDeadline(fixture: Fixture) {
  await initialize(fixture);
  const github = api();
  const app = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: github.fetch,
  });
  const entered = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull: () => {
        entered.resolve();
      },
      cancel: () => {
        cancelled.resolve();
        return cleanup.promise;
      },
    },
    { highWaterMark: 0 },
  );
  const signed = await webhook();
  const request = new Request(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: stream,
  });
  jest.useFakeTimers();
  const response = app.fetch(request);
  await entered.promise;
  jest.advanceTimersByTime(8000);
  expect((await response).status).toBe(503);
  await cancelled.promise;
  let disposed = false;
  const drain = app.dispose().then(() => {
    disposed = true;
  });
  await Promise.resolve();
  expect(disposed).toBe(false);
  cleanup.resolve();
  await drain;
  expect(stream.locked).toBe(false);
  expect(github.calls).toEqual([]);
  jest.useRealTimers();
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0 });
}
test('slow body reaches eight-second request outcome; disposal awaits real reader cleanup', () =>
  qualify(bodyDeadline));

async function attemptDeadline(fixture: Fixture) {
  await initialize(fixture);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  async function fetch(_url: string, init: RequestInit) {
    calls++;
    signal = init.signal;
    entered.resolve();
    return release.promise;
  }
  const app = await openLocalGitHubApp(argv(fixture, 'start'), { host: fixture.host, fetch });
  const request = await webhook();
  jest.useFakeTimers();
  const response = app.fetch(request);
  await entered.promise;
  jest.advanceTimersByTime(1999);
  expect(signal?.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  expect((await response).status).toBe(503);
  expect(signal?.aborted).toBe(true);
  let disposed = false;
  const disposal = app.dispose().then(() => {
    disposed = true;
  });
  await Promise.resolve();
  expect(disposed).toBe(false);
  release.resolve(Response.json({ id: 11, app_id: 77, account: { id: 33 }, suspended_at: null }));
  await disposal;
  expect(calls).toBe(1);
  jest.useRealTimers();
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0 });
}
test('two-second HTTP attempt has finite outcome and no detached commit or retries after raw fetch settles', () =>
  qualify(attemptDeadline));

async function totalDeadline(fixture: Fixture) {
  await initialize(fixture);
  const github = api();
  let entered = Promise.withResolvers<void>();
  let gate = Promise.withResolvers<void>();
  let calls = 0;
  async function fetch(url: string, init: RequestInit) {
    calls++;
    const current = gate;
    entered.resolve();
    await current.promise;
    return github.fetch(url, init);
  }
  const app = await openLocalGitHubApp(argv(fixture, 'start'), { host: fixture.host, fetch });
  const request = await webhook();
  jest.useFakeTimers();
  const response = app.fetch(request);
  for (let phase = 0; phase < 3; phase++) {
    await entered.promise;
    const previous = gate;
    entered = Promise.withResolvers<void>();
    gate = Promise.withResolvers<void>();
    jest.advanceTimersByTime(1500);
    previous.resolve();
  }
  await entered.promise;
  jest.advanceTimersByTime(1499);
  expect(calls).toBe(4);
  jest.advanceTimersByTime(1);
  expect((await response).status).toBe(503);
  gate.resolve();
  await app.dispose();
  expect(calls).toBe(4);
  jest.useRealTimers();
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0 });
}
test('six-second total authority budget refuses before a fifth HTTP call despite individually short attempts', () =>
  qualify(totalDeadline));

async function readerAbort(fixture: Fixture) {
  await initialize(fixture);
  const github = api();
  const entered = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull: () => {
        entered.resolve();
      },
      cancel: () => {
        cancelled.resolve();
        return release.promise;
      },
    },
    { highWaterMark: 0 },
  );
  async function fetch(url: string, init: RequestInit) {
    calls++;
    const normal = await github.fetch(url, init);
    return Match.value(calls).pipe(
      Match.when(5, () => new Response(stream, { status: 200 })),
      Match.orElse(() => normal),
    );
  }
  const app = await openLocalGitHubApp(argv(fixture, 'start'), { host: fixture.host, fetch });
  const controller = new AbortController();
  const request = await webhook(payload(), 'delivery-55', 'issue_comment', controller.signal);
  const response = app.fetch(request);
  await entered.promise;
  controller.abort();
  expect((await response).status).toBe(503);
  await cancelled.promise;
  let disposed = false;
  const drain = app.dispose().then(() => {
    disposed = true;
  });
  await Promise.resolve();
  expect(disposed).toBe(false);
  const busy = await runCli([...argv(fixture, 'configure'), '--expected-revision', 'local-1'], {
    host: fixture.host,
    silent: true,
  }).then(
    () => false,
    () => true,
  );
  expect(busy).toBe(true);
  release.resolve();
  await drain;
  expect(stream.locked).toBe(false);
  expect(calls).toBe(5);
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0, evidence: 0 });
}
test('caller abort during final permission body owns cancellation before storage close; no late evidence or commit', () =>
  qualify(readerAbort));

async function evidenceAbort(fixture: Fixture) {
  await initialize(fixture);
  const github = api();
  const controller = new AbortController();
  function clock() {
    controller.abort();
    return { wallMs: 1000, monotonicMs: 200 };
  }
  // Abort at the final observation, after all five real adapter HTTP phases.
  function finalObservation() {
    return Match.value(github.calls.length).pipe(
      Match.when(5, clock),
      Match.orElse(() => ({ wallMs: 1000, monotonicMs: 200 })),
    );
  }
  const app = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: github.fetch,
    clock: finalObservation,
  });
  const request = await webhook(payload(), 'delivery-55', 'issue_comment', controller.signal);
  expect((await app.fetch(request)).status).toBe(503);
  await app.dispose();
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0 });
}
test('abort at final evidence observation cannot dispatch a late commit', () =>
  qualify(evidenceAbort));

async function commitDeadline(fixture: Fixture) {
  await initialize(fixture);
  let elapsed = 0;
  function fault(point: string) {
    return Match.value(point).pipe(
      Match.when('BeforeCommit', expire),
      Match.orElse(() => undefined),
    );
  }
  function expire() {
    elapsed = 8000;
    jest.advanceTimersByTime(8000);
  }
  const github = api();
  const app = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: github.fetch,
    clock: () => ({ wallMs: 1000 + elapsed, monotonicMs: 200 + elapsed }),
    testFault: fault,
  });
  const request = await webhook();
  jest.useFakeTimers();
  expect((await app.fetch(request)).status).toBe(503);
  await app.dispose();
  jest.useRealTimers();
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0, evidence: 0 });
}
test('expiry at the final commit barrier rolls back staged evidence/decision/receipt and never ACKs preview', () =>
  qualify(commitDeadline));

async function cleanShutdown(fixture: Fixture) {
  await initialize(fixture);
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--no-install',
      `${import.meta.dir}/restart-child.ts`,
      fixture.root,
      'clean',
    ],
    {
      env: {},
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  async function exercise() {
    const reader = child.stdout.getReader();
    const first = await readBoundedLine(reader, () => child.kill('SIGKILL'));
    expect(first).toBe('{"phase":"CleanReady"}');
    child.kill('SIGTERM');
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe('');
    reader.releaseLock();
    const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
    expect(status.output).toMatchObject({ decisions: 1, receipts: 1, evidence: 1 });
  }
  await exercise().finally(async () => {
    child.kill();
    await child.exited;
  });
}
test('normal signal shutdown drains an acknowledged decision and exits cleanly', () =>
  qualify(cleanShutdown));

async function importSafety() {
  const modules = ['@ceirean/github-ingress', './src/cli.ts', './src/main.ts'];
  const jsonString = Schema.fromJsonString(Schema.String);
  const encodeModule = Schema.encodeSync(jsonString);
  const script = modules.map((module) => `await import(${encodeModule(module)});`).join('\n');
  const child = Bun.spawn([process.execPath, '--no-env-file', '--no-install', '-e', script], {
    cwd: `${import.meta.dir}/..`,
    env: {},
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toBe('');
  expect(await new Response(child.stderr).text()).toBe('');
}
test('public source imports do not acquire config, credentials, runtime or server', importSafety);

async function killedAt(fixture: Fixture, phase: string, expected: number) {
  await initialize(fixture);
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--no-install',
      `${import.meta.dir}/restart-child.ts`,
      fixture.root,
      phase,
    ],
    { env: {}, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  );
  const reader = child.stdout.getReader();
  let watchdogFired = false;
  const watchdog = setTimeout(() => {
    watchdogFired = true;
    child.kill('SIGKILL');
  }, 5000);
  async function exercise() {
    const first = await readBoundedLine(reader, () => child.kill('SIGKILL'));
    const phaseJson = Schema.fromJsonString(Schema.Struct({ phase: Schema.String }));
    const observed = Schema.decodeUnknownSync(phaseJson)(first);
    expect(observed).toEqual({
      phase,
    });
    child.kill('SIGKILL');
    await child.exited;
    expect(child.signalCode).toBe('SIGKILL');
    expect(watchdogFired).toBe(false);
    expect(await new Response(child.stderr).text()).toBe('');
    const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
    expect(status.output).toMatchObject({
      decisions: expected,
      receipts: expected,
      evidence: expected,
      authorityRevisions: 1,
    });
    const db = new Database(`${fixture.root}/github-admission.sqlite`, { readonly: true });
    const records = db.query<{ record: string }, []>('SELECT record FROM decisions').all();
    const evidence = db.query<{ evidence: string }, []>('SELECT evidence FROM evidence').all();
    db.close();
    expect(records).toHaveLength(expected);
    expect(evidence).toHaveLength(expected);
    const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(LiveAdmissionRecord));
    const decodeEvidence = Schema.decodeUnknownSync(Schema.fromJsonString(LivePermissionEvidence));
    const historical = records.map((row) => decodeRecord(row.record));
    const bound = historical.map((record) =>
      Match.value(record.provenance).pipe(
        Match.tag('LiveChecked', (live) => live.evidence),
        Match.orElse(() => undefined),
      ),
    );
    expect(bound).toEqual(evidence.map((row) => decodeEvidence(row.evidence)));
    const github = api();
    const app = await openLocalGitHubApp(argv(fixture, 'start'), {
      host: fixture.host,
      fetch: github.fetch,
    });
    async function replay() {
      const response = await app.fetch(await webhook());
      const outcome = Match.value(expected).pipe(
        Match.when(1, () => ({ disposition: 'Duplicate', calls: 0 })),
        Match.orElse(() => ({ disposition: 'Recorded', calls: 5 })),
      );
      expect(await response.json()).toMatchObject({
        disposition: outcome.disposition,
      });
      expect(github.calls).toHaveLength(outcome.calls);
    }
    await replay().finally(app.dispose);
    const reopened = new Database(`${fixture.root}/github-admission.sqlite`, { readonly: true });
    const final = reopened.query<{ record: string }, []>('SELECT record FROM decisions').all();
    reopened.close();
    expect(final).toHaveLength(1);
    const unchanged = Match.value(expected).pipe(
      Match.when(1, () => expect(final).toEqual(records)),
      Match.orElse(() => undefined),
    );
    void unchanged;
  }
  async function cleanup() {
    clearTimeout(watchdog);
    child.kill('SIGKILL');
    await child.exited;
    reader.releaseLock();
  }
  await exercise().finally(cleanup);
}
for (const [phase, expected] of [
  ['BeforeTransaction', 0],
  ['AfterDecision', 0],
  ['AfterEvidence', 0],
  ['AfterCommit', 1],
  ['ApiPending', 0],
] as const) {
  test(`SIGKILL ${phase}: atomic recovery, released owner and source-bound replay`, () =>
    qualify((fixture) => killedAt(fixture, phase, expected)));
}

async function lateFailures(fixture: Fixture) {
  await initialize(fixture);
  const key = await Effect.runPromise(fixture.fs.readFileString(fixture.config.privateKeyFile));
  await Effect.runPromise(
    fixture.fs.writeFileString(fixture.config.privateKeyFile, 'not a PKCS8 key'),
  );
  const opening = openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: api().fetch,
  });
  await expect(opening).rejects.toBeDefined();
  await Effect.runPromise(fixture.fs.writeFileString(fixture.config.privateKeyFile, key));
  const occupied = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  async function bindFailure() {
    const binding = runCli(argv(fixture, 'start'), {
      host: fixture.host,
      fetch: api().fetch,
      port: occupied.port,
      silent: true,
    });
    await expect(binding).rejects.toBeDefined();
  }
  await bindFailure().finally(() => occupied.stop(true));
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0, evidence: 0 });
  const started = await runCli(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: api().fetch,
    port: occupied.port,
    silent: true,
  });
  await started.app.dispose();
}
test('late malformed key and bind failure unwind storage ownership and leave no residual listener', () =>
  qualify(lateFailures));

async function olderSnapshot(fixture: Fixture) {
  await initialize(fixture);
  const file = `${fixture.root}/github-admission.sqlite`;
  const snapshot = await Effect.runPromise(fixture.fs.readFile(file));
  const first = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: api().fetch,
  });
  await first.fetch(await webhook()).finally(first.dispose);
  expect(
    (await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true })).output,
  ).toMatchObject({ decisions: 1 });
  await Effect.runPromise(fixture.fs.writeFile(file, snapshot));
  // A valid old snapshot has lost replay history; it cannot reconstruct later admissions.
  expect(
    (await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true })).output,
  ).toMatchObject({ decisions: 0, receipts: 0, evidence: 0 });
  const github = api();
  const restored = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: github.fetch,
  });
  async function redeliver() {
    expect(await (await restored.fetch(await webhook())).json()).toMatchObject({
      disposition: 'Recorded',
    });
    expect(github.calls).toHaveLength(5);
  }
  await redeliver().finally(restored.dispose);
}
test('older snapshot restoration is replay-history loss, not reconciliation or exactly-once proof', () =>
  qualify(olderSnapshot));
