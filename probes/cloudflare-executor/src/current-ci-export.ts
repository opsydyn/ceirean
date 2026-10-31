import { Effect, FileSystem, Option, Schema, Stream } from 'effect';

import { create } from '../node_modules/npm/node_modules/tar/dist/esm/create.js';
import { archiveReadback } from './current-ci-archive.ts';
import { requireInventory } from './dependency-inventory.ts';
import {
  admitPortableCache,
  readPortableCacheDescriptor,
  verifySealedCache,
} from './linux-qualification/cache.ts';
import { sha256 } from './preparation.ts';

export const currentCiExportLimits = { seedBytes: 1073741824, evidenceBytes: 4194304 } as const;
export type CurrentCiSeedIdentity = {
  readonly seedSha256: string;
  readonly portableSeedSha256: string;
  readonly descriptorSha256: string;
  readonly descriptorBytes: number;
};
export function exportCurrentCiSeed(root: string, output: string, identity: CurrentCiSeedIdentity) {
  function* exportSeed() {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* readPortableCacheDescriptor(`${root}/bun-seed-descriptor.json`);
    const Binding = Schema.fromJsonString(
      Schema.Struct({
        sourceSha256: Schema.Literal(identity.seedSha256),
        sha256: Schema.Literal(identity.portableSeedSha256),
      }),
    );
    yield* Schema.decodeUnknownEffect(Binding)(text);
    yield* requireInventory(
      new TextEncoder().encode(text).length === identity.descriptorBytes,
      'InputChanged',
    );
    const seed = yield* admitPortableCache(
      `${root}/portable-bun-seed`,
      text,
      identity.descriptorSha256,
    );
    const packing = Effect.try(() =>
      create(
        { cwd: root, gzip: true, portable: false, follow: false, noMtime: true, strict: true },
        ['portable-bun-seed', 'bun-seed-descriptor.json'],
      ),
    );
    const pack = yield* Effect.acquireRelease(packing, (pack) =>
      Effect.sync(() => {
        pack.destroy();
      }),
    );
    const file = yield* fs.open(output, { flag: 'wx', noFollow: true, mode: 0o600 });
    let bytes = 0;
    function* append(chunk: Uint8Array) {
      bytes += chunk.length;
      yield* requireInventory(bytes <= currentCiExportLimits.seedBytes, 'InputChanged');
      yield* file.writeAll(chunk);
    }
    const chunks = Stream.fromAsyncIterable(pack, () => new Error('SeedExportRefused'));
    yield* Stream.runForEach(chunks, (chunk) => Effect.gen(() => append(chunk)));
    yield* verifySealedCache(seed);
    const readback = yield* fs.open(output, { flag: 'r', noFollow: true });
    const info = yield* readback.stat;
    yield* requireInventory(
      info.size === BigInt(bytes) && bytes > 0 && Option.contains(1n)(info.nlink),
      'InputChanged',
    );
    function acquireInspector() {
      return archiveReadback(seed.inventory, {
        sha256: identity.descriptorSha256,
        bytes: identity.descriptorBytes,
      });
    }
    function closeInspector(reader: ReturnType<typeof archiveReadback>) {
      function close() {
        reader.close();
      }
      const closing = Effect.sync(close);
      return closing;
    }
    const acquiring = Effect.sync(acquireInspector);
    const inspector = yield* Effect.acquireRelease(acquiring, closeInspector);
    const hash = new Bun.CryptoHasher('sha256');
    let remaining = bytes;
    while (remaining > 0) {
      const chunk = yield* readback.readAlloc(Math.min(65536, remaining));
      const data = yield* Effect.fromOption(chunk);
      yield* requireInventory(data.length > 0 && data.length <= remaining, 'InputChanged');
      remaining -= data.length;
      hash.update(data);
      yield* requireInventory(inspector.write(data), 'InputChanged');
    }
    yield* requireInventory(
      Option.isNone(yield* readback.readAlloc(1)) && inspector.finish(),
      'InputChanged',
    );
    const descriptorReadback = yield* readPortableCacheDescriptor(
      `${root}/bun-seed-descriptor.json`,
    );
    yield* requireInventory(
      (yield* sha256(descriptorReadback)) === identity.descriptorSha256,
      'InputChanged',
    );
    return {
      path: output,
      bytes,
      sha256: hash.digest('hex'),
      descriptorSha256: identity.descriptorSha256,
      seedSha256: seed.sha256,
    };
  }
  const workflow = Effect.gen(exportSeed);
  return workflow.pipe(Effect.scoped);
}
