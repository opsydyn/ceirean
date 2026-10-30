import { expect, test } from 'bun:test';

import { Arbitrary, Deferred, Effect, Fiber, Ref, Result, Schema } from 'effect';

import { cacheLimits, fetchArtifact } from '../src/cache-download.ts';

const bytes = new TextEncoder().encode('inert compressed artifact fixture');
const artifact = {
  identity: 'fixture@1.0.0',
  url: 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz',
  integrity: 'sha512-' + new Bun.CryptoHasher('sha512').update(bytes).digest('base64'),
};
function requestBody() {
  return Promise.resolve(new Response(bytes));
}
async function retrievesVerifiedBytes() {
  const spent = Ref.makeUnsafe(0);
  const result = await Effect.runPromise(
    fetchArtifact(requestBody, artifact, [artifact.url], spent),
  );
  expect(result.bytes).toEqual(bytes);
  expect(result.sha256).toBe(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));
  expect(Ref.getUnsafe(spent)).toBe(bytes.length);
}
test('exact registry GET verifies both digests before returning bytes', retrievesVerifiedBytes);
for (const status of [201, 301, 302, 307, 308, 404, 500]) {
  async function rejectsStatus() {
    let cancelled = false;
    function request() {
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      });
      return Promise.resolve(new Response(body, { status }));
    }
    const result = await Effect.runPromise(
      fetchArtifact(request, artifact, [artifact.url], Ref.makeUnsafe(0)).pipe(Effect.result),
    );
    expect(result._tag).toBe('Failure');
    expect(cancelled).toBe(true);
  }
  test(`registry status ${status} refuses without following redirects`, rejectsStatus);
}
async function refusesUnknownBeforeRequest() {
  let calls = 0;
  function request() {
    calls++;
    return requestBody();
  }
  const result = await Effect.runPromise(
    fetchArtifact(request, artifact, [], Ref.makeUnsafe(0)).pipe(Effect.result),
  );
  expect(result._tag).toBe('Failure');
  expect(calls).toBe(0);
}
test('unapproved URL is rejected before any request', refusesUnknownBeforeRequest);
async function refusesChangedBytes() {
  function request() {
    return Promise.resolve(new Response('changed'));
  }
  const result = await Effect.runPromise(
    fetchArtifact(request, artifact, [artifact.url], Ref.makeUnsafe(0)).pipe(Effect.result),
  );
  expect(result._tag).toBe('Failure');
}
test('changed bytes cannot become a cache artifact', refusesChangedBytes);
for (const contentLength of ['1000', '-1', 'not-a-size']) {
  async function refusesHeader() {
    function request() {
      return Promise.resolve(new Response(bytes, { headers: { 'content-length': contentLength } }));
    }
    const limits = { ...cacheLimits, blobBytes: 64 };
    const result = await Effect.runPromise(
      fetchArtifact(request, artifact, [artifact.url], Ref.makeUnsafe(0), limits).pipe(
        Effect.result,
      ),
    );
    expect(result._tag).toBe('Failure');
  }
  test(`invalid or excessive content-length ${contentLength} fails closed`, refusesHeader);
}
async function refusesAggregate() {
  const limits = { ...cacheLimits, totalBytes: bytes.length - 1 };
  const result = await Effect.runPromise(
    fetchArtifact(requestBody, artifact, [artifact.url], Ref.makeUnsafe(0), limits).pipe(
      Effect.result,
    ),
  );
  expect(result._tag).toBe('Failure');
}
test('aggregate budget is enforced before accepting the next chunk', refusesAggregate);
async function requestOptionsAndDeadline() {
  let observed: RequestInit | undefined;
  function request(_url: string, init: RequestInit) {
    observed = init;
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject('aborted'), { once: true });
    });
  }
  const result = await Effect.runPromise(
    fetchArtifact(request, artifact, [artifact.url], Ref.makeUnsafe(0), {
      ...cacheLimits,
      requestMs: 25,
    }).pipe(Effect.result),
  );
  expect(result._tag).toBe('Failure');
  expect(observed).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
  expect(observed?.signal?.aborted).toBe(true);
}
test('fetch has fixed safe options and its deadline aborts the request', requestOptionsAndDeadline);

async function boundedResponseCleanup() {
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
    const checking = fetchArtifact(request, artifact, [artifact.url], Ref.makeUnsafe(0)).pipe(
      Effect.result,
    );
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
  'archive response cancellation has a fixed bound instead of holding scope forever',
  boundedResponseCleanup,
  5000,
);
function boundedLaw(seed: number) {
  async function run() {
    const Size = Schema.Number.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: 256 }),
    );
    const sizes = Arbitrary.schema(Size);
    function refusesOverflow(size: number) {
      const content = new Uint8Array(size + 1);
      function request() {
        return Promise.resolve(new Response(content));
      }
      const isLimitRefusal = Schema.is(
        Schema.Struct({
          _tag: Schema.Literal('InventoryError'),
          code: Schema.Literal('ResolutionRefused'),
        }),
      );
      function refusedForBudget(result: Result.Result<unknown, unknown>) {
        return Result.isFailure(result) && isLimitRefusal(result.failure);
      }
      return fetchArtifact(request, artifact, [artifact.url], Ref.makeUnsafe(0), {
        ...cacheLimits,
        blobBytes: size,
      }).pipe(Effect.result, Effect.map(refusedForBudget));
    }
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(sizes, refusesOverflow, { seed, runs: 100, maxShrinks: 100 }),
    );
    expect(result).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  return run;
}
for (const seed of [0, 1, 163]) test(`streamed overflow refusal; seed ${seed}`, boundedLaw(seed));
