import { Effect, Stream } from 'effect';

import { get, put } from '../node_modules/npm/node_modules/cacache/lib/index.js';
import { InventoryError, requireInventory } from './dependency-inventory.ts';

export function writeTarball(
  cache: string,
  url: string,
  bytes: Uint8Array,
  integrity: string,
  persist = put,
) {
  const writing = Effect.tryPromise({
    try: () => persist(`${cache}/_cacache`, `ceirean:tarball:${url}`, bytes, { integrity }),
    catch: () => new InventoryError({ code: 'InputChanged' }),
  });
  const settled = Effect.uninterruptible(writing);
  return settled;
}

export function seedReplayMetadata(
  cache: string,
  metadata: readonly { url: string; text: string }[],
  persist = put,
) {
  function* seed() {
    for (const entry of metadata) {
      const bytes = new TextEncoder().encode(entry.text);
      const writing = Effect.tryPromise({
        try: () =>
          persist(`${cache}/_cacache`, `make-fetch-happen:request-cache:${entry.url}`, bytes, {
            metadata: {
              time: 1792800000000,
              url: entry.url,
              reqHeaders: { accept: 'application/json' },
              resHeaders: {
                'content-type': 'application/json',
                'cache-control': 'public, max-age=31536000',
              },
              options: { compress: true },
            },
          }),
        catch: () => new InventoryError({ code: 'ResolutionRefused' }),
      });
      // Native filesystem writes cannot be aborted; drain them before directory cleanup.
      yield* Effect.uninterruptible(writing);
    }
  }
  const workflow = Effect.gen(seed);
  return workflow;
}
function collect(stream: AsyncIterable<Uint8Array>, maximum: number) {
  function* read() {
    const source = Stream.fromAsyncIterable(
      stream,
      () => new InventoryError({ code: 'InputChanged' }),
    );
    const chunks: Uint8Array[] = [];
    let used = 0;
    function* append(chunk: Uint8Array) {
      yield* requireInventory(chunk.length <= maximum - used, 'InputChanged');
      used += chunk.length;
      chunks.push(new Uint8Array(chunk));
    }
    yield* Stream.runForEach(source, (chunk) => Effect.gen(() => append(chunk)));
    const bytes = new Uint8Array(used);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }
  const workflow = Effect.gen(read);
  return workflow;
}
export function readCachedTarball(cache: string, integrity: string, maximum: number) {
  return collect(get.stream.byDigest(`${cache}/_cacache`, integrity), maximum);
}
export function readCachedMetadata(cache: string, url: string) {
  return collect(
    get.stream(`${cache}/_cacache`, `make-fetch-happen:request-cache:${url}`),
    2097152,
  );
}
