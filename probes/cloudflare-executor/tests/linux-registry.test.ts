import { expect, test } from 'bun:test';
import { request, type IncomingMessage } from 'node:http';
import { connect } from 'node:net';

import { BunFileSystem } from '@effect/platform-bun';
import { Deferred, Effect, Fiber, FileSystem, Schema } from 'effect';

import { makeLoopbackListener, ReplayPlatformError } from '../scripts/linux-replay-platform.ts';
import { admitArchives } from '../src/linux-qualification/archives.ts';
import { startReplay, startReplayOn } from '../src/linux-qualification/registry.ts';
import { goodTar, gzip, stage } from './linux-archive-fixtures.ts';

const withTestPlatform = Effect.provide(BunFileSystem.layer);
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function get(port: number, path: string, method = 'GET') {
  function requestResponse() {
    function collectResponse(
      resolve: (value: { status: number; body: Uint8Array }) => void,
      reject: (error: Error) => void,
    ) {
      function received(response: IncomingMessage) {
        const chunks: Buffer[] = [];
        response.on('data', (data: Buffer) => chunks.push(data));
        response.on('end', () =>
          resolve({ status: response.statusCode!, body: Buffer.concat(chunks) }),
        );
      }
      const req = request({ host: '127.0.0.1', port, path, method, agent: false }, received);
      req.on('error', reject);
      req.end();
    }
    return new Promise(collectResponse);
  }
  const requesting = Effect.tryPromise(requestResponse);
  return requesting;
}
function setupReplay() {
  function* setup() {
    const bytes = yield* Effect.promise(() => gzip(goodTar()));
    const inputs = yield* stage([bytes]);
    const admitted = yield* admitArchives(inputs);
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(`${inputs.root}/${inputs.artifacts[0]!.path}`);
    const handle = yield* startReplayOn(admitted, makeLoopbackListener(0));
    return { handle, bytes };
  }
  const workflow = Effect.gen(setup);
  return workflow;
}
async function verifiedBytes() {
  function* verify() {
    const { handle, bytes } = yield* setupReplay();
    expect(handle.host).toBe('127.0.0.1');
    const response = yield* get(handle.port, '/fixture-0/-/fixture-0-1.0.0.tgz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(bytes);
    expect(yield* handle.snapshotRequests()).toMatchObject({
      blocked: false,
      truncated: false,
      requests: [{ method: 'GET', path: '/fixture-0/-/fixture-0-1.0.0.tgz', outcome: 'Verified' }],
    });
  }
  const workflow = Effect.gen(verify);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
}
test('actual loopback HTTP replays exact verified bytes after staged blob removal', verifiedBytes);
for (const [method, path] of [
  ['HEAD', '/fixture-0/-/fixture-0-1.0.0.tgz'],
  ['POST', '/fixture-0/-/fixture-0-1.0.0.tgz'],
  ['GET', '/fixture-0'],
  ['GET', '/@scope%2fname'],
  ['GET', '/unknown.tgz'],
  ['GET', '/fixture-0/-/fixture-0-1.0.0.tgz?x'],
  ['GET', '/fixture-0/-/%66ixture-0-1.0.0.tgz'],
  ['GET', '//fixture-0/-/fixture-0-1.0.0.tgz'],
  ['GET', 'http://example.invalid/fixture-0/-/fixture-0-1.0.0.tgz'],
]) {
  async function refusedRequest() {
    function* verify() {
      const { handle } = yield* setupReplay();
      const response = yield* get(handle.port, path!, method!);
      expect(response.status).toBe(409);
      expect(yield* handle.snapshotRequests()).toMatchObject({
        blocked: true,
        requests: [{ outcome: 'BlockedMissingBunMetadata' }],
      });
      expect((yield* get(handle.port, '/fixture-0/-/fixture-0-1.0.0.tgz')).status).toBe(409);
    }
    const workflow = Effect.gen(verify);
    await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
  }
  test(`fails closed for ${method} ${path}`, refusedRequest);
}
async function boundedLogs() {
  function* verify() {
    const { handle } = yield* setupReplay();
    yield* get(handle.port, '/' + 'x'.repeat(3000));
    for (let index = 0; index < 140; index++) yield* get(handle.port, '/missing');
    const log = yield* handle.snapshotRequests();
    expect(log.truncated).toBe(true);
    expect(log.requests.length).toBeLessThanOrEqual(128);
    expect(encode(log).length).toBeLessThanOrEqual(262144);
    expect(encode(log)).not.toContain('x'.repeat(3000));
  }
  const workflow = Effect.gen(verify);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
}
test('bounds request logs and never stores oversized raw targets', boundedLogs);
async function awaitedStop() {
  function* verify() {
    const { handle } = yield* setupReplay();
    const port = handle.port;
    const socket = connect({ host: '127.0.0.1', port });
    const connected = Effect.tryPromise(
      () =>
        new Promise<void>(function awaitConnection(resolve, reject) {
          socket.once('connect', resolve);
          socket.once('error', reject);
        }),
    );
    yield* connected;
    yield* handle.stop();
    yield* handle.stop();
    expect((yield* Effect.result(get(port, '/missing')))._tag).toBe('Failure');
    socket.destroy();
  }
  const workflow = Effect.gen(verify);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
}
test('stop waits for native listener termination including idle sockets', awaitedStop);
async function scopedStop() {
  function* verify() {
    const { handle } = yield* setupReplay();
    return handle.port;
  }
  const workflow = Effect.gen(verify);
  const port = await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
  const requesting = get(port, '/missing').pipe(Effect.result);
  const result = await Effect.runPromise(requesting);
  expect(result._tag).toBe('Failure');
}
test('scope release waits for native listener termination', scopedStop);
async function productionBinding() {
  function* verify() {
    const bytes = yield* Effect.promise(() => gzip(goodTar()));
    const inputs = yield* stage([bytes]);
    const admitted = yield* admitArchives(inputs);
    const handle = yield* startReplay(admitted);
    expect(handle.host).toBe('127.0.0.1');
    expect(handle.port).toBe(4873);
    expect((yield* get(4873, '/fixture-0/-/fixture-0-1.0.0.tgz')).status).toBe(200);
  }
  const workflow = Effect.gen(verify);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
}
test('production listener binds only fixed origin', productionBinding);

async function cancelledStartup() {
  function* verify() {
    const bytes = yield* Effect.promise(() => gzip(goodTar()));
    const inputs = yield* stage([bytes]);
    const admitted = yield* admitArchives(inputs);
    const listening = yield* Deferred.make<{ port: number }>();
    function gatedListener(respond: Parameters<ReturnType<typeof makeLoopbackListener>>[0]) {
      function* waitForAcceptance() {
        const native = yield* makeLoopbackListener(0)(respond);
        yield* Deferred.succeed(listening, native).pipe(
          Effect.timeout('1 second'),
          Effect.mapError(() => new ReplayPlatformError({ code: 'ListenFailed' })),
        );
        yield* Effect.sleep('1 second');
        return native;
      }
      const holding = Effect.gen(waitForAcceptance);
      return holding;
    }
    const starting = startReplayOn(admitted, gatedListener);
    const fiber = yield* Effect.forkChild(starting, { startImmediately: true });
    const bound = yield* Deferred.await(listening).pipe(Effect.timeout('2 seconds'));
    yield* Fiber.interrupt(fiber);
    expect((yield* Effect.result(get(bound.port, '/missing')))._tag).toBe('Failure');
  }
  const workflow = Effect.gen(verify);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
}
test('interrupted pending replay acquisition closes its native listener', cancelledStartup);
