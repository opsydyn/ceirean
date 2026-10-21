import { afterEach, expect, jest, test } from 'bun:test';

import { Effect } from 'effect';
import { Match, Schema } from 'effect';

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
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain('NativePending');
    const started = performance.now();
    child.kill('SIGTERM');
    expect(await child.exited).toBe(1);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(9900);
    expect(elapsed).toBeLessThan(13000);
    const stderr = await new Response(child.stderr).text();
    expect(stderr.trim()).toBe('{"_tag":"FailedShutdown"}');
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
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('CleanReady');
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
  const modules = ['@leviathan/github-ingress', './src/cli.ts', './src/main.ts'];
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
