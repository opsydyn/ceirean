import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { Data, Effect } from 'effect';

import { Header } from '../node_modules/npm/node_modules/tar/dist/esm/header.js';
import { makeSyntheticReadinessPipeline } from '../src/internal/synthetic-readiness-pipeline.ts';

const paths = ['input/readiness-worker.mjs', 'input/strace', 'input/observer-canary'];
const encoder = new TextEncoder();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const recipe = async () =>
  new Uint8Array(
    await Bun.file(new URL('../readiness-image/Dockerfile', import.meta.url)).arrayBuffer(),
  );
const artifacts = () => {
  const entries = paths.map((path, index) => ({ path, bytes: encoder.encode(`fixture-${index}`) }));
  const expected = entries.map(({ path, bytes }) => ({
    path,
    size: bytes.length,
    sha256: hash(bytes),
  }));
  return { entries, expected };
};
async function run(
  pipeline: ReturnType<typeof makeSyntheticReadinessPipeline>,
  sink: (bytes: Uint8Array) => Promise<void>,
) {
  const workflow = pipeline(sink).pipe(Effect.result);
  const result = await Effect.runPromise(workflow);
  return result;
}

function members(bytes: Uint8Array) {
  let offset = 0;
  const result: Array<{ path: string; bytes: Uint8Array }> = [];
  while (offset < bytes.length - 1024) {
    const header = new Header(Buffer.from(bytes.subarray(offset, offset + 512)));
    offset += 512;
    result.push({ path: header.path, bytes: bytes.slice(offset, offset + header.size) });
    offset += Math.ceil(header.size / 512) * 512;
  }
  return result;
}

async function success() {
  const dockerfile = await recipe();
  const input = artifacts();
  let archive = new Uint8Array();
  const result = await run(makeSyntheticReadinessPipeline(dockerfile, input), async (bytes) => {
    archive = bytes.slice();
  });
  expect(result).toMatchObject({
    success: {
      _tag: 'SyntheticOnly',
      activation: 'Blocked',
      image: 'Unbuilt',
      sink: 'SinkResolved',
      sha256: hash(archive),
      bytes: archive.length,
    },
  });
  expect(members(archive)).toEqual([{ path: 'Dockerfile', bytes: dockerfile }, ...input.entries]);
}
test(
  'archives the source-pinned recipe and synthetic fixture artifacts without granting authority',
  success,
);

async function rejectsRecipeDrift() {
  const dockerfile = await recipe();
  dockerfile[0] ^= 1;
  let calls = 0;
  const pipeline = makeSyntheticReadinessPipeline(dockerfile, artifacts());
  const result = await run(pipeline, async () => {
    calls++;
  });
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'RecipeMismatch' } });
  expect(calls).toBe(0);
}
test('rejects recipe drift before calling the sink', rejectsRecipeDrift);

async function sourceRecipePin() {
  const dockerfile = await recipe();
  expect(hash(dockerfile)).toBe('7c6334babb30c753f51ed9d27f12a8c77deb6aa9c316209d9080719399073e5a');
  dockerfile[0] ^= 1;
  const input = { ...artifacts(), recipeSha256: hash(dockerfile) };
  const pipeline = makeSyntheticReadinessPipeline(dockerfile, input);
  let calls = 0;
  const result = await run(pipeline, async () => {
    calls++;
  });
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'RecipeMismatch' } });
  expect(calls).toBe(0);
}
test(
  'only the fixed source recipe pin accepts recipe bytes, not a caller matching digest',
  sourceRecipePin,
);

async function rejectsSpoofedRecipe() {
  const shared = new Uint8Array(new SharedArrayBuffer(1));
  Object.defineProperty(shared, 'buffer', { get: () => new ArrayBuffer(1) });
  const oversized = new Uint8Array(1048577);
  Object.defineProperty(oversized, 'byteLength', { get: () => 1 });
  for (const bytes of [shared, oversized]) {
    const pipeline = makeSyntheticReadinessPipeline(bytes, artifacts());
    let calls = 0;
    const result = await run(pipeline, async () => {
      calls++;
    });
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidRecipe' } });
    expect(calls).toBe(0);
  }
}
test(
  'rejects shared or oversized recipe bytes even when properties are spoofed',
  rejectsSpoofedRecipe,
);

async function ignoresRecipeAccessors() {
  const dockerfile = await recipe();
  Object.defineProperty(dockerfile, 'byteLength', { get: () => 0 });
  Object.defineProperty(dockerfile, 'buffer', { get: () => new SharedArrayBuffer(1) });
  const pipeline = makeSyntheticReadinessPipeline(dockerfile, artifacts());
  const result = await run(pipeline, async () => {});
  expect(result._tag).toBe('Success');
}
test(
  'snapshots actual recipe bytes without consulting overridden accessors',
  ignoresRecipeAccessors,
);

async function rejectsInvalidRecipe() {
  for (const bytes of [new Uint8Array(), new Uint8Array(new SharedArrayBuffer(1))]) {
    const pipeline = makeSyntheticReadinessPipeline(bytes, artifacts());
    let calls = 0;
    const sink = async () => {
      calls++;
    };
    expect(await run(pipeline, sink)).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'InvalidRecipe' },
    });
    expect(await run(pipeline, sink)).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'AlreadyAttempted' },
    });
    expect(calls).toBe(0);
  }
}
test('invalid recipes consume the attempt without invoking the sink', rejectsInvalidRecipe);

async function rejectsPrototypeSpoofedSharedRecipe() {
  const backing = new SharedArrayBuffer(1);
  const bytes = new Uint8Array(backing);
  Object.setPrototypeOf(backing, ArrayBuffer.prototype);
  const pipeline = makeSyntheticReadinessPipeline(bytes, artifacts());
  let calls = 0;
  const result = await run(pipeline, async () => {
    calls++;
  });
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidRecipe' } });
  expect(calls).toBe(0);
}
test(
  'rejects a shared recipe buffer spoofing the ArrayBuffer prototype',
  rejectsPrototypeSpoofedSharedRecipe,
);

async function rejectsPrototypeSpoofedView() {
  const bytes = new Uint16Array(1);
  Object.setPrototypeOf(bytes, Uint8Array.prototype);
  const pipeline = makeSyntheticReadinessPipeline(bytes as unknown as Uint8Array, artifacts());
  const result = await run(pipeline, async () => {});
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidRecipe' } });
}
test(
  'rejects a non-byte recipe view spoofing the Uint8Array prototype',
  rejectsPrototypeSpoofedView,
);

async function rejectsBadArtifacts() {
  const dockerfile = await recipe();
  for (const badHash of ['0'.repeat(64), 'not-a-hash']) {
    const input = artifacts();
    input.expected[0]!.sha256 = badHash;
    let calls = 0;
    const result = await run(makeSyntheticReadinessPipeline(dockerfile, input), async () => {
      calls++;
    });
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidArtifacts' } });
    expect(calls).toBe(0);
  }
}
test(
  'rejects mismatched and malformed artifact hashes before calling the sink',
  rejectsBadArtifacts,
);

async function isolatesMutations() {
  const dockerfile = await recipe();
  const originalRecipe = dockerfile.slice();
  const input = artifacts();
  const originalEntries = input.entries.map(({ path, bytes }) => ({ path, bytes: bytes.slice() }));
  const pipeline = makeSyntheticReadinessPipeline(dockerfile, input);
  dockerfile.fill(0);
  input.entries[0]!.bytes.fill(0);
  input.entries[1]!.path = 'changed';
  input.expected[2]!.sha256 = '0'.repeat(64);
  input.expected[0]!.size = 0;
  let archive = new Uint8Array();
  const result = await run(pipeline, async (bytes) => {
    archive = bytes.slice();
  });
  expect(result._tag).toBe('Success');
  expect(members(archive)).toEqual([
    { path: 'Dockerfile', bytes: originalRecipe },
    ...originalEntries,
  ]);
}
test('snapshots recipe bytes, artifact bytes, paths and pins before execution', isolatesMutations);

class FixtureSinkError extends Data.TaggedError('FixtureSinkError')<{ readonly reason: string }> {}

async function oneAttempt() {
  const pipeline = makeSyntheticReadinessPipeline(await recipe(), artifacts());
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const sink = async () => {
    calls++;
    started();
    await gate;
    throw new FixtureSinkError({ reason: 'synthetic failure' });
  };
  const first = run(pipeline, sink);
  await entered;
  const second = await run(pipeline, sink);
  release();
  expect(await first).toMatchObject({ _tag: 'Failure', failure: { code: 'SinkFailure' } });
  expect(second).toMatchObject({ _tag: 'Failure', failure: { code: 'AlreadyAttempted' } });
  expect(await run(pipeline, sink)).toMatchObject({
    _tag: 'Failure',
    failure: { code: 'AlreadyAttempted' },
  });
  expect(calls).toBe(1);
}
test('sink failure and concurrent or repeated runs allow only one attempt', oneAttempt);

async function concurrentValidation() {
  const pipeline = makeSyntheticReadinessPipeline(await recipe(), artifacts());
  let calls = 0;
  const sink = async () => {
    calls++;
  };
  const workflow = pipeline(sink).pipe(Effect.result);
  const results = await Promise.all([Effect.runPromise(workflow), Effect.runPromise(workflow)]);
  expect(results[0]).toMatchObject({ _tag: 'Success' });
  expect(results[1]).toMatchObject({
    _tag: 'Failure',
    failure: { code: 'AlreadyAttempted' },
  });
  expect(calls).toBe(1);
}
test(
  'concurrent runs of the same effect cannot both validate or invoke the sink',
  concurrentValidation,
);

async function rejectsSinkTampering() {
  const pipeline = makeSyntheticReadinessPipeline(await recipe(), artifacts());
  const result = await run(pipeline, async (bytes) => {
    bytes[512] ^= 1;
  });
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'SinkTampered' } });
}
test('propagates synthetic sink tampering instead of reporting success', rejectsSinkTampering);

async function rejectsSpoofedSinkComparison() {
  const pipeline = makeSyntheticReadinessPipeline(await recipe(), artifacts());
  const result = await run(pipeline, async (bytes) => {
    bytes[512] ^= 1;
    Object.defineProperty(bytes, 'every', { value: () => true });
  });
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'SinkTampered' } });
}
test(
  'rejects sink tampering even when the sink spoofs its byte comparison',
  rejectsSpoofedSinkComparison,
);

async function rejectsDetachedSinkBuffer() {
  const pipeline = makeSyntheticReadinessPipeline(await recipe(), artifacts());
  const result = await run(pipeline, async (bytes) => {
    structuredClone(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
  });
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'SinkTampered' } });
}
test('rejects a sink that detaches its copy', rejectsDetachedSinkBuffer);
