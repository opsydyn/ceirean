import { Effect, FileSystem, Match, Schema } from 'effect';

import { inspectCacheStorage, persistCache, verifyCache } from './cache-candidate.ts';
import { currentArchivePins } from './current-archive-preflight.ts';
import { currentOfflineCachePlan } from './current-cache.ts';
import { currentSourcePins, readCurrentSource } from './current-inputs.ts';
import { currentLinuxWorkerPins } from './current-linux-worker.ts';
import { requireInventory } from './dependency-inventory.ts';
import { CacheMetadata } from './linux-qualification/cache.ts';
import { digestBytes } from './payload.ts';
import { sha256 } from './preparation.ts';
import { readBounded } from './runner-input.ts';

// Covers inputs/tools, three bounded cache cohorts, npm scratch, export and reserve.
export const currentCiInputLimits = { requiredFreeBytes: 17179869184 } as const;
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const Hex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Artifact = Schema.Struct({
  identity: Schema.String,
  url: Schema.String,
  integrity: Schema.String,
  path: Schema.String,
  bytes: Schema.Int,
  sha256: Hex,
});
const Inventory = Schema.fromJsonString(
  Schema.Struct({
    _tag: Schema.Literal('CurrentOfflineCacheInventory'),
    activation: Schema.Literal('Blocked'),
    source: Schema.Struct({
      revision: Schema.Literal(currentSourcePins.revision),
      tree: Schema.Literal(currentSourcePins.tree),
    }),
    target: Schema.Struct({
      os: Schema.Literal('linux'),
      cpu: Schema.Literal('x64'),
      libc: Schema.Literal('glibc'),
    }),
    base: Schema.Struct({ inventory: Hex, receipt: Hex }),
    npmSnapshotSha256: Hex,
    artifacts: Schema.Array(Artifact).check(Schema.isMinLength(909), Schema.isMaxLength(909)),
    metadata: Schema.Array(
      Schema.Struct({ name: Schema.String, url: Schema.String, bytes: Schema.Int, sha256: Hex }),
    ),
  }),
);
export function readCurrentCiInventory() {
  function* read() {
    const text = yield* readBounded(
      new URL('../fixtures/current-cache-inventory.json', import.meta.url).pathname,
      2097152,
    );
    return yield* validateCurrentCiInventory(text);
  }
  const workflow = Effect.gen(read);
  return workflow.pipe(Effect.scoped);
}
export function validateCurrentCiInventory(text: string) {
  function* validate() {
    yield* requireInventory(new TextEncoder().encode(text).length <= 2097152, 'InputChanged');
    yield* requireInventory(
      (yield* sha256(text)) === currentArchivePins.inventorySha256,
      'InputChanged',
    );
    return yield* Schema.decodeUnknownEffect(Inventory)(text);
  }
  const workflow = Effect.gen(validate);
  return workflow;
}
export function stageCurrentCiSource(repository: string, destination: string) {
  function* stage() {
    const files = [...(yield* readCurrentSource(repository))].sort((a, b) =>
      a.path.localeCompare(b.path, 'en'),
    );
    const inventory = [];
    for (const file of files)
      inventory.push({
        path: file.path,
        mode: file.mode,
        objectId: file.objectId,
        size: file.size,
        sha256: yield* digestBytes(file.bytes),
      });
    const text = encode({ source: currentSourcePins, files: inventory });
    yield* requireInventory(
      (yield* sha256(text)) === currentLinuxWorkerPins.sourceInventorySha256,
      'InputChanged',
    );
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(destination, { mode: 0o700 });
    for (const file of files) {
      const parent = file.path.split('/').slice(0, -1).join('/');
      yield* fs.makeDirectory(`${destination}/${parent}`, { recursive: true, mode: 0o755 });
      const mode = Match.value(file.mode).pipe(
        Match.when('100755', () => 0o755),
        Match.orElse(() => 0o644),
      );
      yield* fs.writeFile(`${destination}/${file.path}`, file.bytes, { flag: 'wx', mode });
      yield* fs.chmod(`${destination}/${file.path}`, mode);
    }
    return { text, files: files.length };
  }
  const workflow = Effect.gen(stage);
  return workflow;
}
function readableInputs(root: string) {
  function* normalize() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const pending = [root];
    const directory = Schema.is(Schema.Literal('Directory'));
    const regular = Schema.is(Schema.Literal('File'));
    let entries = 0;
    while (pending.length > 0) {
      const path = pending.pop()!;
      const info = yield* metadata.lstat(path);
      entries++;
      const valid = [
        entries <= 30000,
        (yield* fs.realPath(path)) === path,
        directory(info.type) || regular(info.type),
        (info.mode & 0o7000) === 0,
        directory(info.type) || info.nlink === 1n,
      ].every(Boolean);
      yield* requireInventory(valid, 'InputChanged');
      const mode = Match.value(directory(info.type)).pipe(
        Match.when(true, () => 0o755),
        Match.orElse(() => 0o644 | (info.mode & 0o111)),
      );
      yield* fs.chmod(path, mode);
      function* descend() {
        for (const name of yield* fs.readDirectory(path)) pending.push(`${path}/${name}`);
      }
      const walking = Effect.gen(descend);
      const isDirectory = Effect.succeed(directory(info.type));
      yield* walking.pipe(Effect.when(isDirectory));
    }
  }
  const workflow = Effect.gen(normalize);
  return workflow;
}
export function prepareCurrentCiInputs(
  repository: string,
  destination: string,
  request: (url: string, init: RequestInit) => Promise<Response>,
  availableBytes: number,
) {
  function* prepare() {
    yield* requireInventory(
      Number.isSafeInteger(availableBytes) &&
        availableBytes >= currentCiInputLimits.requiredFreeBytes,
      'InputChanged',
    );
    const inventory = yield* readCurrentCiInventory();
    const plan = yield* currentOfflineCachePlan(repository);
    const expectedArtifacts = inventory.artifacts.map(({ identity, url, integrity }) => ({
      identity,
      url,
      integrity,
    }));
    const metadata = plan.metadata.map(({ name, url, bytes, sha256 }) => ({
      name,
      url,
      bytes,
      sha256,
    }));
    yield* requireInventory(
      encode(expectedArtifacts) === encode(plan.artifacts) &&
        encode(metadata) === encode(inventory.metadata),
      'InputChanged',
    );
    const fs = yield* FileSystem.FileSystem;
    const parent = destination.slice(0, destination.lastIndexOf('/'));
    yield* requireInventory(
      destination.startsWith('/') && (yield* fs.realPath(parent)) === parent,
      'InputChanged',
    );
    yield* fs.makeDirectory(destination, { mode: 0o700 });
    const source = yield* stageCurrentCiSource(repository, `${destination}/consumer`);
    yield* fs.makeDirectory(`${destination}/cache`, { mode: 0o700 });
    const cache = `${destination}/cache/offline`;
    yield* fs.makeDirectory(cache, { mode: 0o700 });
    const acquired = yield* persistCache(cache, plan.artifacts, plan.metadata, request);
    yield* requireInventory(encode(acquired) === encode(inventory.artifacts), 'InputChanged');
    const verified = yield* verifyCache(cache, plan.artifacts, plan.metadata);
    yield* requireInventory(
      encode(verified.entries) === encode(inventory.artifacts),
      'InputChanged',
    );
    const inventoryText = yield* readBounded(
      new URL('../fixtures/current-cache-inventory.json', import.meta.url).pathname,
      2097152,
    );
    const receipt = {
      _tag: 'CurrentCiInputsPrepared' as const,
      activation: 'Blocked' as const,
      source: currentSourcePins,
      sourceInventorySha256: currentLinuxWorkerPins.sourceInventorySha256,
      inventorySha256: currentArchivePins.inventorySha256,
      npmSnapshotSha256: inventory.npmSnapshotSha256,
      downloaded: acquired.length,
      reused: 0,
      downloadedBytes: verified.registryBytes,
      metadata: metadata.length,
      sourceFiles: source.files,
    };
    for (const [name, text] of [
      ['inventory.json', inventoryText],
      ['source-inventory.json', source.text],
      ['preparation.json', encode(receipt)],
    ] as const) {
      yield* fs.writeFileString(`${destination}/${name}`, text, { flag: 'wx', mode: 0o600 });
    }
    yield* inspectCacheStorage(destination);
    yield* readableInputs(destination);
    return receipt;
  }
  const workflow = Effect.gen(prepare);
  return workflow.pipe(Effect.timeout('8 minutes'), Effect.scoped);
}
