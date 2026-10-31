import { Effect, FileSystem, Path, Schema } from 'effect';

import { requireInventory } from './dependency-inventory.ts';
import {
  CacheMetadata,
  copyCaseCache,
  describePortableCache,
  readPortableCacheDescriptor,
  sealPortableCase,
  type SealedCache,
} from './linux-qualification/cache.ts';
import { digestBytes } from './payload.ts';

export function preparePortableBunSeed(
  source: SealedCache,
  paths: { readonly root: string; readonly descriptorPath: string },
) {
  function* prepare() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const parent = path.dirname(paths.root);
    const validPaths = [
      path.normalize(paths.descriptorPath) === paths.descriptorPath,
      path.dirname(paths.descriptorPath) === parent,
      (yield* fs.realPath(parent)) === parent,
      paths.descriptorPath !== paths.root,
      !paths.descriptorPath.startsWith(`${source.root}/`),
      paths.descriptorPath !== source.root,
    ].every(Boolean);
    yield* requireInventory(validPaths, 'InputChanged');
    const copy = yield* copyCaseCache(source, paths.root);
    const seed = yield* sealPortableCase(source, copy);
    const descriptor = yield* describePortableCache(seed, source);
    const bytes = new TextEncoder().encode(descriptor.text);
    function* persist() {
      const file = yield* fs.open(paths.descriptorPath, {
        flag: 'wx',
        mode: 0o600,
        noFollow: true,
      });
      yield* file.writeAll(bytes);
    }
    const writing = Effect.gen(persist);
    yield* writing.pipe(Effect.scoped);
    const metadata = yield* CacheMetadata;
    const info = yield* metadata.lstat(paths.descriptorPath);
    const isFile = Schema.is(Schema.Literal('File'));
    yield* requireInventory(
      isFile(info.type) && info.nlink === 1n && info.mode === 0o600,
      'InputChanged',
    );
    const readback = yield* readPortableCacheDescriptor(paths.descriptorPath);
    yield* requireInventory(
      (yield* digestBytes(new TextEncoder().encode(readback))) === descriptor.sha256,
      'InputChanged',
    );
    return {
      seed,
      sourceSha256: source.sha256,
      descriptor: { path: paths.descriptorPath, sha256: descriptor.sha256, bytes: bytes.length },
    };
  }
  const workflow = Effect.gen(prepare);
  return workflow;
}
