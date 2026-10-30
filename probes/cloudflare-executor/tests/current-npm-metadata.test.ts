import { expect, test } from 'bun:test';

import { Deferred, Effect, Fiber, Match, Ref } from 'effect';

import { fetchCurrentVersion, packCurrentMetadata } from '../src/current-npm-metadata.ts';
import { encodeInventory } from '../src/frozen-dependencies.ts';

const artifact = {
  identity: 'tool@1.2.3',
  url: 'https://registry.npmjs.org/tool/-/tool-1.2.3.tgz',
  integrity: 'sha512-' + 'A'.repeat(86) + '==',
};
const version = {
  name: 'tool',
  version: '1.2.3',
  dependencies: { child: '^1.0.0' },
  bin: { tool: 'cli.js' },
  scripts: { install: 'do-not-run' },
  dist: { tarball: artifact.url, integrity: artifact.integrity },
};
async function exactMetadata() {
  const requests: unknown[] = [];
  function request(url: string, init: RequestInit) {
    requests.push({
      url,
      method: init.method,
      redirect: init.redirect,
      credentials: init.credentials,
    });
    return Promise.resolve(Response.json(version));
  }
  function* run() {
    const spent = yield* Ref.make(0);
    return yield* fetchCurrentVersion(artifact, request, spent);
  }
  const workflow = Effect.gen(run);
  const result = await Effect.runPromise(workflow);
  expect(requests).toEqual([
    {
      url: 'https://registry.npmjs.org/tool/1.2.3',
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
    },
  ]);
  expect(result).toMatchObject({
    name: 'tool',
    version: '1.2.3',
    bin: { tool: 'cli.js' },
    hasInstallScript: true,
  });
  expect(encodeInventory(result)).not.toContain('do-not-run');
  const metadata = await Effect.runPromise(packCurrentMetadata([result, result]));
  expect(metadata).toHaveLength(1);
  expect(metadata[0]?.sha256).toHaveLength(64);
}
test(
  'exact metadata acquisition strips executable scripts but retains resolver fields',
  exactMetadata,
);

async function interruptedAcquisition() {
  const started = Deferred.makeUnsafe<void>();
  let observed: AbortSignal | null | undefined;
  function request(_url: string, init: RequestInit) {
    observed = init.signal;
    Deferred.doneUnsafe(started, Effect.void);
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject('aborted'), { once: true });
    });
  }
  function* run() {
    const spent = yield* Ref.make(0);
    const acquiring = fetchCurrentVersion(artifact, request, spent);
    const fiber = yield* Effect.forkScoped(acquiring);
    yield* Deferred.await(started).pipe(Effect.timeout('1 second'));
    yield* Fiber.interrupt(fiber);
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  await Effect.runPromise(scoped);
  expect(observed?.aborted).toBe(true);
}
test(
  'cancellation aborts an in-flight exact metadata request before scope cleanup',
  interruptedAcquisition,
);

async function rejectedBodyCancelled() {
  let cancelled = false;
  function request() {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    return Promise.resolve(new Response(body, { status: 302 }));
  }
  const spent = Ref.makeUnsafe(0);
  const checking = fetchCurrentVersion(artifact, request, spent).pipe(Effect.result);
  const result = await Effect.runPromise(checking);
  expect(result._tag).toBe('Failure');
  expect(cancelled).toBe(true);
}
test('rejected metadata response ownership cancels the body', rejectedBodyCancelled);

async function pendingCancellationBounded() {
  const cancelling = Deferred.makeUnsafe<void>();
  let finish = () => {};
  function request() {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        Deferred.doneUnsafe(cancelling, Effect.void);
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    });
    return Promise.resolve(new Response(body, { status: 302 }));
  }
  function* run() {
    const spent = yield* Ref.make(0);
    const checking = fetchCurrentVersion(artifact, request, spent).pipe(Effect.result);
    const fiber = yield* Effect.forkScoped(checking);
    yield* Deferred.await(cancelling).pipe(Effect.timeout('1 second'));
    yield* Effect.sleep('1200 millis');
    const completedBeforeRelease = yield* Effect.sync(() => fiber.pollUnsafe() !== undefined);
    yield* Effect.sync(finish);
    const result = yield* Fiber.join(fiber);
    return { completedBeforeRelease, result };
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  const result = await Effect.runPromise(scoped);
  expect(result.completedBeforeRelease).toBe(true);
  expect(result.result._tag).toBe('Failure');
}
test(
  'pending response cancellation cannot hold the preparation scope indefinitely',
  pendingCancellationBounded,
  5000,
);

for (const kind of ['redirect', 'identity', 'integrity', 'tarball', 'oversized', 'budget']) {
  async function refusedMetadata() {
    const variants = {
      redirect: new Response('', { status: 302, headers: { location: 'https://example.com' } }),
      identity: Response.json({ ...version, name: 'outside' }),
      integrity: Response.json({
        ...version,
        dist: { ...version.dist, integrity: 'sha512-' + 'B'.repeat(85) + 'A==' },
      }),
      tarball: Response.json({
        ...version,
        dist: { ...version.dist, tarball: 'https://example.com/tool.tgz' },
      }),
      oversized: new Response('x'.repeat(2097153)),
      budget: Response.json(version),
    };
    function* run() {
      const initial = Match.value(kind).pipe(
        Match.when('budget', () => 16777216),
        Match.orElse(() => 0),
      );
      const spent = yield* Ref.make(initial);
      return yield* fetchCurrentVersion(
        artifact,
        () => Promise.resolve(variants[kind as keyof typeof variants]),
        spent,
      );
    }
    const workflow = Effect.gen(run);
    const checking = workflow.pipe(Effect.result);
    const result = await Effect.runPromise(checking);
    expect(result._tag).toBe('Failure');
  }
  test(`metadata capture refuses ${kind}`, refusedMetadata);
}
