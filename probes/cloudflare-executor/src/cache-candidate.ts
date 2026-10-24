import { Effect, FileSystem, Match, Option, Ref, Schema } from 'effect';

import { cacheLimits, fetchArtifact } from './cache-download.ts';
import { requireInventory } from './dependency-inventory.ts';
import {
  readCachedMetadata,
  readCachedTarball,
  seedReplayMetadata,
  writeTarball,
} from './npm-cache-store.ts';
import { digestBytes } from './payload.ts';

type Artifact = { identity: string; url: string; integrity: string };
type Metadata = { url: string; text: string };
export const storageLimits = { bytes: 1153433600, entries: 20000, depth: 16 } as const;
const isFile = Schema.is(Schema.Literal('File'));
const isDirectory = Schema.is(Schema.Literal('Directory'));
function blobName(index: number) {
  return `artifacts/${String(index).padStart(4, '0')}.tgz`;
}
export function persistCache(
  output: string,
  artifacts: readonly Artifact[],
  metadata: readonly Metadata[],
  request: (url: string, init: RequestInit) => Promise<Response>,
) {
  function* persist() {
    yield* requireInventory(artifacts.length > 0 && artifacts.length <= 1024);
    const fs = yield* FileSystem.FileSystem;
    const artifactDirectory = fs.makeDirectory(`${output}/artifacts`, { mode: 0o700 });
    const npmDirectory = fs.makeDirectory(`${output}/npm-cache`, { mode: 0o700 });
    yield* Effect.uninterruptible(artifactDirectory);
    yield* Effect.uninterruptible(npmDirectory);
    const approved = artifacts.map((entry) => entry.url);
    yield* requireInventory(new Set(approved).size === artifacts.length);
    const spent = yield* Ref.make(0);
    const entries = [];
    for (const [index, artifact] of artifacts.entries()) {
      const fetched = yield* fetchArtifact(request, artifact, approved, spent);
      const path = blobName(index);
      const writing = fs.writeFile(`${output}/${path}`, fetched.bytes, { flag: 'wx', mode: 0o600 });
      yield* Effect.uninterruptible(writing);
      yield* writeTarball(`${output}/npm-cache`, artifact.url, fetched.bytes, artifact.integrity);
      entries.push({ ...artifact, path, bytes: fetched.bytes.length, sha256: fetched.sha256 });
    }
    yield* seedReplayMetadata(`${output}/npm-cache`, metadata);
    return entries;
  }
  const workflow = Effect.gen(persist);
  return workflow;
}
function readBlob(path: string) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(path, { flag: 'r', noFollow: true });
    const info = yield* file.stat;
    const valid = isFile(info.type) && info.size > 0n && info.size <= BigInt(cacheLimits.blobBytes);
    yield* requireInventory(valid, 'InputChanged');
    const data = yield* file.readAlloc(Number(info.size) + 1);
    const bytes = Option.getOrElse(data, () => new Uint8Array());
    const tail = yield* file.readAlloc(1);
    const complete = bytes.length === Number(info.size) && Option.isNone(tail);
    yield* requireInventory(complete, 'InputChanged');
    return bytes;
  }
  const workflow = Effect.gen(read);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
export function inspectCacheStorage(output: string) {
  function* inspect() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(output);
    const pending = [{ path: root, depth: 0 }];
    let bytes = 0;
    let entries = 0;
    while (pending.length > 0) {
      const directory = pending.pop()!;
      yield* requireInventory(directory.depth <= storageLimits.depth, 'InputChanged');
      for (const name of yield* fs.readDirectory(directory.path)) {
        const path = `${directory.path}/${name}`;
        yield* requireInventory((yield* fs.realPath(path)) === path, 'InputChanged');
        const info = yield* fs.stat(path);
        entries++;
        yield* requireInventory(entries <= storageLimits.entries, 'InputChanged');
        function* regular() {
          bytes += Number(info.size);
          const withinBudget =
            info.size <= BigInt(cacheLimits.blobBytes) && bytes <= storageLimits.bytes;
          yield* requireInventory(withinBudget, 'InputChanged');
        }
        function* nested() {
          pending.push({ path, depth: directory.depth + 1 });
          yield* Effect.void;
        }
        const action = Match.value(info.type).pipe(
          Match.when(isFile, () => Effect.gen(regular)),
          Match.when(isDirectory, () => Effect.gen(nested)),
          Match.orElse(() => requireInventory(false, 'InputChanged')),
        );
        yield* action;
      }
    }
    return { bytes, entries };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
export function verifyCache(
  output: string,
  artifacts: readonly Artifact[],
  metadata: readonly Metadata[],
) {
  function* verify() {
    const storage = yield* inspectCacheStorage(output);
    const entries = [];
    let registryBytes = 0;
    for (const [index, artifact] of artifacts.entries()) {
      const path = blobName(index);
      const bytes = yield* readBlob(`${output}/${path}`);
      const integrity = 'sha512-' + new Bun.CryptoHasher('sha512').update(bytes).digest('base64');
      yield* requireInventory(integrity === artifact.integrity, 'InputChanged');
      const sha256 = yield* digestBytes(bytes);
      const cached = yield* readCachedTarball(
        `${output}/npm-cache`,
        artifact.integrity,
        cacheLimits.blobBytes,
      );
      yield* requireInventory((yield* digestBytes(cached)) === sha256, 'InputChanged');
      registryBytes += bytes.length;
      yield* requireInventory(registryBytes <= cacheLimits.totalBytes, 'InputChanged');
      entries.push({ ...artifact, path, bytes: bytes.length, sha256 });
    }
    for (const entry of metadata) {
      const bytes = yield* readCachedMetadata(`${output}/npm-cache`, entry.url);
      const expected = yield* digestBytes(new TextEncoder().encode(entry.text));
      yield* requireInventory((yield* digestBytes(bytes)) === expected, 'InputChanged');
    }
    return {
      activation: 'Blocked' as const,
      artifacts: entries.length,
      registryBytes,
      storage,
      entries,
    };
  }
  const workflow = Effect.gen(verify);
  return workflow;
}
