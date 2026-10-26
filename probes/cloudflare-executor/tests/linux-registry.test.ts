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
const isVerified = Schema.is(Schema.Literal('Verified'));
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
    for (let index = 0; index < 1040; index++) yield* get(handle.port, '/missing');
    const log = yield* handle.snapshotRequests();
    expect(log.truncated).toBe(true);
    expect(log.requests.length).toBe(1024);
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

function serializedBytes(value: unknown) {
  return new TextEncoder().encode(encode(value)).length;
}
function snapshotBoundaryFixture(
  target: number,
  method: string,
  rawPrefix: string,
  loggedPrefix: string,
) {
  const emptySnapshot = { blocked: true, truncated: false, requests: [] };
  const emptyRecord = { method, path: loggedPrefix, outcome: 'BlockedMissingBunMetadata' };
  const recordCount = 128;
  const separators = recordCount - 1;
  const padding =
    target -
    serializedBytes(emptySnapshot) -
    separators -
    recordCount * serializedBytes(emptyRecord);
  const perRecord = Math.floor(padding / recordCount);
  const extra = padding % recordCount;
  function requestAt(index: number) {
    const suffix = 'x'.repeat(perRecord + Number(index < extra));
    return { method, path: rawPrefix + suffix, loggedPath: loggedPrefix + suffix };
  }
  return Array.from({ length: recordCount }, (_, index) => requestAt(index));
}
for (const [label, method, rawPrefix, loggedPrefix] of [
  ['ascii', 'GET', '/', '/'],
  ['multibyte', 'é中🙂', '/é中🙂', '/???'],
  ['escaped', '"\n中', '/é中🙂', '/???'],
]) {
  for (const offset of [-1, 0, 1, 31]) {
    async function exactSnapshotBoundary() {
      function* verify() {
        const target = 262144 + offset;
        const fixture = snapshotBoundaryFixture(target, method!, rawPrefix!, loggedPrefix!);
        const expectedRecords = fixture.map((entry) => ({
          method: entry.method,
          path: entry.loggedPath,
          outcome: 'BlockedMissingBunMetadata',
        }));
        expect(
          serializedBytes({ blocked: true, truncated: false, requests: expectedRecords }),
        ).toBe(target);
        const bytes = yield* Effect.promise(() => gzip(goodTar()));
        const inputs = yield* stage([bytes]);
        const admitted = yield* admitArchives(inputs);
        let dispatch: Parameters<ReturnType<typeof makeLoopbackListener>>[0];
        function captureListener(respond: Parameters<ReturnType<typeof makeLoopbackListener>>[0]) {
          dispatch = respond;
          const bound = Effect.succeed({ host: '127.0.0.1' as const, port: 0 });
          return bound;
        }
        const handle = yield* startReplayOn(admitted, captureListener);
        const empty = yield* handle.snapshotRequests();
        expect(empty).toMatchObject({ blocked: false, truncated: false, requests: [] });
        expect(serializedBytes(empty)).toBeLessThanOrEqual(262144);
        for (const entry of fixture) {
          expect(entry.path.length).toBeLessThanOrEqual(2048);
          expect(dispatch!(entry).status).toBe(409);
          const snapshot = yield* handle.snapshotRequests();
          expect(serializedBytes(snapshot)).toBeLessThanOrEqual(262144);
          const json = yield* Effect.promise(() => Response.json(snapshot).text());
          expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(262144);
          expect(json).toBe(encode(snapshot));
        }
        const snapshot = yield* handle.snapshotRequests();
        expect(snapshot.blocked).toBe(true);
        expect(snapshot.truncated).toBe(offset > 0);
        expect(snapshot.requests.length).toBe(128 - Number(offset > 0));
        const expectedSnapshot = {
          blocked: true,
          truncated: offset > 0,
          requests: expectedRecords.slice(0, 128 - Number(offset > 0)),
        };
        expect(serializedBytes(snapshot)).toBe(serializedBytes(expectedSnapshot));
        yield* handle.stop();
      }
      const workflow = Effect.gen(verify);
      await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
    }
    test(`serialized UTF-8 snapshot boundary ${offset} for ${label}`, exactSnapshotBoundary);
  }
}

async function warmupRecordCount() {
  function* verify() {
    const bytes = yield* Effect.promise(() => gzip(goodTar()));
    const inputs = yield* stage(Array.from({ length: 661 }, () => bytes));
    const admitted = yield* admitArchives(inputs);
    let dispatch: Parameters<ReturnType<typeof makeLoopbackListener>>[0];
    function captureListener(respond: Parameters<ReturnType<typeof makeLoopbackListener>>[0]) {
      dispatch = respond;
      const bound = Effect.succeed({ host: '127.0.0.1' as const, port: 0 });
      return bound;
    }
    const handle = yield* startReplayOn(admitted, captureListener);
    for (let index = 0; index < 661; index++) {
      const path = `/fixture-${index}/-/fixture-${index}-1.0.0.tgz`;
      expect(dispatch!({ method: 'GET', path }).status).toBe(200);
    }
    const warmup = yield* handle.snapshotRequests();
    expect(warmup).toMatchObject({ blocked: false, truncated: false });
    expect(warmup.requests.length).toBe(661);
    expect(warmup.requests.every((entry) => isVerified(entry.outcome))).toBe(true);
    expect(serializedBytes(warmup)).toBeLessThan(262144);
    for (let index = 661; index < 1024; index++) {
      expect(dispatch!({ method: 'GET', path: '/fixture-0/-/fixture-0-1.0.0.tgz' }).status).toBe(
        200,
      );
    }
    const atCount = yield* handle.snapshotRequests();
    expect(atCount).toMatchObject({ blocked: false, truncated: false });
    expect(atCount.requests.length).toBe(1024);
    expect(serializedBytes(atCount)).toBeLessThan(262144);
    expect(dispatch!({ method: 'GET', path: '/fixture-0/-/fixture-0-1.0.0.tgz' }).status).toBe(409);
    const overflow = yield* handle.snapshotRequests();
    expect(overflow).toMatchObject({ blocked: true, truncated: true });
    expect(overflow.requests.length).toBe(1024);
    expect(serializedBytes(overflow)).toBeLessThan(262144);
    expect(new TextEncoder().encode(encode(overflow)).length).toBeLessThan(262144);
    yield* handle.stop();
  }
  const workflow = Effect.gen(verify);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestPlatform));
}
test(
  '661 allowlisted warmup GETs fit; count limit independently refuses request 1025',
  warmupRecordCount,
);
