import { Effect, FileSystem, Option, Schema } from 'effect';

import { CacheMetadata } from './cache.ts';
import { QualificationRequest, strict } from './contract.ts';
import { requireSupervisor } from './docker-process.ts';
import { hashEvidence } from './evidence-files.ts';
import { prepareLinuxInputs } from './inputs.ts';
import { PreparedInputs, trustedToolsFit } from './prepared-inputs.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const sameInputs = Schema.toEquivalence(PreparedInputs);
const sameRequest = Schema.toEquivalence(QualificationRequest);
const isFile = Schema.is(Schema.Literal('File'));
const isDirectory = Schema.is(Schema.Literal('Directory'));
const isNode = Schema.is(Schema.Literal('node'));
const isWorker = Schema.is(Schema.Literal('worker.mjs'));
const isExecutable = Schema.is(Schema.Literal('100755'));
const isRegular = Schema.is(Schema.Literal('100644'));
const owned = new WeakMap<object, { inputs: PreparedInputs; claimed: boolean }>();

export function readProducerFile(path: string, maximum: number) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    yield* requireSupervisor((yield* fs.realPath(path)) === path, 'InputChanged');
    const before = yield* metadata.lstat(path);
    const regular = [
      isFile(before.type),
      before.nlink === 1n,
      before.size >= 0n,
      before.size <= BigInt(maximum),
    ].every(Boolean);
    yield* requireSupervisor(regular, 'InputChanged');
    const handle = yield* fs.open(path, { flag: 'r', noFollow: true });
    const opened = yield* handle.stat;
    yield* requireSupervisor(
      opened.dev === before.dev && Option.contains(before.ino)(opened.ino),
      'InputChanged',
    );
    const chunks: Uint8Array[] = [];
    let size = 0;
    let part = yield* handle.readAlloc(Math.min(maximum + 1, 65536));
    while (Option.isSome(part)) {
      const chunk = part.value;
      yield* requireSupervisor(chunk.length <= maximum - size, 'InputChanged');
      size += chunk.length;
      chunks.push(new Uint8Array(chunk));
      part = yield* handle.readAlloc(Math.min(maximum - size + 1, 65536));
    }
    const after = yield* metadata.lstat(path);
    const unchanged = [
      before.dev === after.dev,
      before.ino === after.ino,
      before.mode === after.mode,
      before.size === after.size,
      isFile(after.type),
      after.nlink === 1n,
      BigInt(size) === after.size,
    ].every(Boolean);
    yield* requireSupervisor(unchanged, 'InputChanged');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      bytes,
      mode: before.mode & 0o777,
      sha256: yield* hashEvidence(bytes),
      identity: { dev: before.dev, ino: before.ino, mode: before.mode },
    };
  }
  const workflow = Effect.gen(read);
  const scoped = workflow.pipe(Effect.scoped);
  return scoped;
}

export function verifyProducerFiles(inputs: PreparedInputs) {
  function* verify() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const request = inputs.admission.request;
    yield* requireSupervisor((yield* fs.realPath(inputs.root)) === inputs.root, 'InputChanged');
    const tools = [...inputs.tools.files].sort((a, b) => a.path.localeCompare(b.path));
    const coherent = [
      tools.length === 2,
      isNode(tools[0]?.path),
      isExecutable(tools[0]?.mode),
      isWorker(tools[1]?.path),
      isRegular(tools[1]?.mode),
      trustedToolsFit(tools.map((file) => file.size)),
      inputs.tools.lockBlob === request.lockBlob,
      inputs.tools.sha256 === request.toolCapsuleSha256,
      tools[1]?.sha256 === request.harnessSha256,
      inputs.source.sha256 === inputs.admission.source.sha256,
      inputs.source.files.length > 0,
    ].every(Boolean);
    yield* requireSupervisor(coherent, 'InputChanged');
    function hashJson(value: unknown) {
      const text = encode(value);
      const bytes = new TextEncoder().encode(text);
      const hashing = hashEvidence(bytes);
      return hashing;
    }
    yield* requireSupervisor(
      (yield* hashJson(tools)) === request.toolCapsuleSha256,
      'InputChanged',
    );
    yield* requireSupervisor(
      (yield* hashJson(inputs.source.files)) === inputs.source.sha256,
      'InputChanged',
    );
    for (const [directory, files] of [
      ['source', inputs.source.files],
      ['tools', tools],
    ] as const) {
      const expected = new Set(files.map((file) => file.path));
      yield* requireSupervisor(expected.size === files.length, 'InputChanged');
      const pending = [''];
      const actual: string[] = [];
      while (pending.length > 0) {
        const relative = pending.pop()!;
        const root = `${inputs.root}/${directory}${relative}`;
        yield* requireSupervisor((yield* fs.realPath(root)) === root, 'InputChanged');
        for (const name of yield* fs.readDirectory(root)) {
          const path = `${relative}/${name}`;
          const info = yield* metadata.lstat(`${inputs.root}/${directory}${path}`);
          yield* requireSupervisor(isDirectory(info.type) || isFile(info.type), 'InputChanged');
          pending.push(...[path].filter(() => isDirectory(info.type)));
          actual.push(...[path.slice(1)].filter(() => isFile(info.type)));
        }
      }
      yield* requireSupervisor(
        actual.length === expected.size && actual.every((path) => expected.has(path)),
        'InputChanged',
      );
      for (const file of files) {
        const measured = yield* readProducerFile(
          `${inputs.root}/${directory}/${file.path}`,
          file.size,
        );
        const matches = [
          measured.bytes.length === file.size,
          measured.sha256 === file.sha256,
          measured.mode === Number.parseInt(file.mode, 8) % 0o1000,
        ].every(Boolean);
        yield* requireSupervisor(matches, 'InputChanged');
      }
    }
  }
  const workflow = Effect.gen(verify);
  return workflow;
}

// Only the actual input service invocation issues this process-local capability.
// File hashes revalidate its material; they cannot mint or replay the capability.
export function prepareOwnedProducer(request: QualificationRequest) {
  function* prepare() {
    const inputs = yield* prepareLinuxInputs(request);
    yield* requireSupervisor(sameRequest(inputs.admission.request, request), 'InputChanged');
    yield* Schema.decodeUnknownEffect(PreparedInputs, strict)(inputs);
    yield* verifyProducerFiles(inputs);
    const producer = { inputs };
    owned.set(producer, { inputs: structuredClone(inputs), claimed: false });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        owned.delete(producer);
      }),
    );
    return producer;
  }
  const workflow = Effect.gen(prepare);
  return workflow;
}

export function claimOwnedProducer(producer: object, inputs: PreparedInputs) {
  function* claim() {
    const record = owned.get(producer);
    const matches = [
      record !== undefined,
      record?.claimed === false,
      record !== undefined && sameInputs(record.inputs, inputs),
    ].every(Boolean);
    yield* requireSupervisor(matches, 'InputChanged');
    record!.claimed = true;
    yield* verifyProducerFiles(record!.inputs);
    return structuredClone(record!.inputs);
  }
  const workflow = Effect.gen(claim);
  return workflow;
}
