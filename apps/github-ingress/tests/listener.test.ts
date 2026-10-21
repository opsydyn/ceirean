import { expect, test } from 'bun:test';

import { Effect } from 'effect';

import { openLocalGitHubApp } from '../src/composition.ts';
import { CliError } from '../src/config.ts';
import { makeBoundedListener } from '../src/listener.ts';
import { api, argv, initialize, payload, webhook, withFixture, type Fixture } from './fixtures.ts';

function request(path = '/webhook', method = 'POST') {
  return new Request(`http://127.0.0.1${path}`, { method });
}
export function controlledTime() {
  let now = 0;
  const tasks = new Set<{ at: number; run: () => void }>();
  return {
    clock: () => now,
    schedule: (run: () => void, ms: number) => {
      const task = { at: now + ms, run };
      tasks.add(task);
      return () => {
        tasks.delete(task);
      };
    },
    advance: (ms: number) => {
      now += ms;
      const expired = [...tasks].filter((task) => task.at <= now);
      for (const task of expired) {
        tasks.delete(task);
        task.run();
      }
    },
  };
}

async function concurrentRequests() {
  const gate = Promise.withResolvers<Response>();
  let calls = 0;
  function work() {
    calls++;
    return gate.promise;
  }
  const listener = makeBoundedListener({ fetch: work });
  const pending = Array.from({ length: 4 }, () => listener.fetch(request()));
  expect((await listener.fetch(request())).status).toBe(429);
  expect(calls).toBe(4);
  let drained = false;
  const drain = listener.dispose().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  expect((await listener.fetch(request())).status).toBe(503);
  gate.resolve(new Response('finished'));
  await Promise.all(pending);
  await drain;
  expect(drained).toBe(true);
}
test(
  'fifth concurrent request refuses before handler; drain waits for owned cleanup',
  concurrentRequests,
);

async function rateWindow() {
  const time = controlledTime();
  const listener = makeBoundedListener({ ...time, fetch: async () => new Response('ok') });
  for (let count = 0; count < 60; count++)
    expect((await listener.fetch(request())).status).toBe(200);
  time.advance(59999);
  expect((await listener.fetch(request())).status).toBe(429);
  time.advance(1);
  expect((await listener.fetch(request())).status).toBe(200);
  await listener.dispose();
}
test('rolling minute excludes exactly expired starts, and never adds rejected starts', rateWindow);

async function deadline() {
  const time = controlledTime();
  const gate = Promise.withResolvers<Response>();
  let signal: AbortSignal | undefined;
  async function work(_request: Request, owned: AbortSignal) {
    signal = owned;
    return gate.promise;
  }
  const listener = makeBoundedListener({ ...time, fetch: work });
  const pending = listener.fetch(request());
  time.advance(7999);
  expect(signal?.aborted).toBe(false);
  time.advance(1);
  expect((await pending).status).toBe(503);
  expect(signal?.aborted).toBe(true);
  let drained = false;
  const drain = listener.dispose().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  gate.resolve(new Response());
  await drain;
}
test('eight-second outcome aborts work but disposal waits for real cleanup', deadline);

async function loopback() {
  let calls = 0;
  async function work() {
    calls++;
    return new Response('ok');
  }
  const listener = makeBoundedListener({ fetch: work });
  const server = listener.listen(0);
  async function exercise() {
    expect((await fetch(`http://127.0.0.1:${server.port}/status`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${server.port}/webhook`)).status).toBe(405);
    expect(
      (await fetch(`http://127.0.0.1:${server.port}/webhook`, { method: 'POST' })).status,
    ).toBe(200);
    expect(calls).toBe(1);
  }
  await exercise().finally(listener.dispose);
}
test('only POST /webhook is served; actual loopback has no admin endpoint', loopback);

async function throwingHandler() {
  function work(): Promise<Response> {
    throw new CliError({ code: 'OperationFailed' });
  }
  const listener = makeBoundedListener({ fetch: work });
  const response = await listener.fetch(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'OperationalFailure' });
  await listener.dispose();
}
test('synchronous handler failure is sanitized and retains no request or timer', throwingHandler);

async function concurrentHttp(fixture: Fixture) {
  await initialize(fixture);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  async function fakeFetch() {
    calls++;
    const allEntered = calls >= 4;
    const notify = allEntered && entered.resolve();
    void notify;
    await release.promise;
    return new Response(null, { status: 503 });
  }
  const app = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: fakeFetch,
  });
  const server = app.listen(0);
  async function send(delivery: string) {
    const request = await webhook(payload(), delivery);
    return fetch(`http://127.0.0.1:${server.port}/webhook`, {
      method: 'POST',
      headers: request.headers,
      body: await request.text(),
    });
  }
  async function exercise() {
    const pending = Array.from({ length: 4 }, (_value, index) => send(`concurrent-${index}`));
    await entered.promise;
    expect((await send('fifth')).status).toBe(429);
    expect(calls).toBe(4);
    release.resolve();
    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status)).toEqual([503, 503, 503, 503]);
  }
  await exercise().finally(async () => {
    release.resolve();
    await app.dispose();
  });
}
async function actualConcurrency() {
  const program = withFixture(concurrentHttp);
  await Effect.runPromise(program);
}
test(
  'real signed loopback refuses a fifth request before any additional fake API work',
  actualConcurrency,
);

async function rateHttp(fixture: Fixture) {
  await initialize(fixture);
  let now = 0;
  const github = api();
  const app = await openLocalGitHubApp(argv(fixture, 'start'), {
    host: fixture.host,
    fetch: github.fetch,
    requestClock: () => now,
  });
  const server = app.listen(0);
  const signed = await webhook(payload(), 'rate-ping', 'ping');
  const body = await signed.text();
  function send() {
    return fetch(`http://127.0.0.1:${server.port}/webhook`, {
      method: 'POST',
      headers: signed.headers,
      body,
    });
  }
  async function exercise() {
    for (let index = 0; index < 60; index++) {
      const response = await send();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ disposition: 'Ignored' });
    }
    expect((await send()).status).toBe(429);
    now = 60000;
    expect((await send()).status).toBe(200);
    expect(github.calls).toEqual([]);
  }
  await exercise().finally(app.dispose);
}
async function actualRate() {
  const program = withFixture(rateHttp);
  await Effect.runPromise(program);
}
test(
  'real verified loopback ping rate limit is rolling and performs no authority requests',
  actualRate,
);
