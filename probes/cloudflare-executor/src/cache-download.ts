import { Console, Effect, Ref, Schema, Stream } from 'effect';

import { InventoryError, requireInventory } from './dependency-inventory.ts';
import { digestBytes } from './payload.ts';
import { validateRegistryRequest } from './preparation.ts';

export const cacheLimits = {
  blobBytes: 67108864,
  totalBytes: 536870912,
  requestMs: 30000,
} as const;
export function fetchArtifact(
  request: (url: string, init: RequestInit) => Promise<Response>,
  artifact: { identity: string; url: string; integrity: string },
  approved: readonly string[],
  spent: Ref.Ref<number>,
  limits: { blobBytes: number; totalBytes: number; requestMs: number } = cacheLimits,
) {
  function* fetch() {
    yield* requireInventory(
      Object.entries(limits).every(
        ([key, value]) =>
          Number.isSafeInteger(value) &&
          value > 0 &&
          value <= cacheLimits[key as keyof typeof cacheLimits],
      ),
    );
    yield* validateRegistryRequest(artifact.url, 'GET', approved);
    const requesting = Effect.tryPromise({
      try: (signal) =>
        request(artifact.url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal }),
      catch: () => new InventoryError({ code: 'ResolutionRefused' }),
    });
    const acquiring = Effect.interruptible(requesting);
    const response = yield* Effect.acquireRelease(acquiring, (response) =>
      Effect.tryPromise(() => response.body?.cancel() ?? Promise.resolve()).pipe(
        Effect.catch(() => Console.warn('{"_tag":"CacheBodyCancellationFailed"}')),
      ),
    );
    const noResponseUrl = Schema.is(Schema.Literal(''));
    const validResponse =
      response.status === 200 &&
      !response.redirected &&
      (noResponseUrl(response.url) || response.url === artifact.url);
    yield* requireInventory(validResponse, 'ResolutionRefused');
    const length = response.headers.get('content-length');
    yield* requireInventory(
      length === null ||
        (/^\d+$/.test(length) &&
          Number.isSafeInteger(Number(length)) &&
          Number(length) <= limits.blobBytes),
      'ResolutionRefused',
    );
    const body = yield* Effect.fromNullishOr(response.body);
    const stream = Stream.fromReadableStream({
      evaluate: () => body,
      onError: () => new InventoryError({ code: 'ResolutionRefused' }),
      releaseLockOnEnd: true,
    });
    const chunks: Uint8Array[] = [];
    let used = 0;
    function* append(chunk: Uint8Array) {
      yield* requireInventory(chunk.length <= limits.blobBytes - used, 'ResolutionRefused');
      function reserve(total: number): readonly [boolean, number] {
        const allowed = chunk.length <= limits.totalBytes - total;
        return [allowed, total + Number(allowed) * chunk.length];
      }
      yield* requireInventory(yield* Ref.modify(spent, reserve), 'ResolutionRefused');
      used += chunk.length;
      chunks.push(new Uint8Array(chunk));
    }
    yield* Stream.runForEach(stream, (chunk) => Effect.gen(() => append(chunk)));
    const lengthMatches = length === null || Number(length) === used;
    const complete = used > 0 && lengthMatches;
    yield* requireInventory(complete, 'ResolutionRefused');
    const bytes = new Uint8Array(used);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const actual = 'sha512-' + new Bun.CryptoHasher('sha512').update(bytes).digest('base64');
    yield* requireInventory(actual === artifact.integrity, 'InputChanged');
    return { bytes, sha256: yield* digestBytes(bytes) };
  }
  const workflow = Effect.gen(fetch);
  const bounded = workflow.pipe(Effect.timeout(limits.requestMs));
  const scoped = Effect.scoped(bounded);
  return scoped;
}
