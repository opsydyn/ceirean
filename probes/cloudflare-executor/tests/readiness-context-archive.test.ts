import { expect, test } from 'bun:test';

import { Data, Effect, Match } from 'effect';

import { Header } from '../node_modules/npm/node_modules/tar/dist/esm/header.js';
import { makeSyntheticReadinessHandoff } from '../src/internal/readiness-context-archive.ts';

const names = ['Dockerfile', 'input/readiness-worker.mjs', 'input/strace', 'input/observer-canary'];
const encoder = new TextEncoder();
const entries = () =>
  names.map((path, index) => ({ path, bytes: encoder.encode(`content-${index}`) }));
async function run(
  handoff: ReturnType<typeof makeSyntheticReadinessHandoff>,
  sink: (bytes: Uint8Array) => Promise<void>,
) {
  const workflow = handoff(sink).pipe(Effect.result);
  const result = await Effect.runPromise(workflow);
  return result;
}
const digest = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

function inspect(bytes: Uint8Array) {
  let offset = 0;
  const members: Array<{ path: string; contents: string }> = [];
  while (offset < bytes.length - 1024) {
    const block = Buffer.from(bytes.subarray(offset, offset + 512));
    const header = new Header(block);
    const canonical = Buffer.alloc(512);
    expect(header.encode(canonical)).toBe(false);
    expect(canonical).toEqual(block);
    expect(header.type).toBe('File');
    expect(header.mode).toBe(0o644);
    expect(header.uid).toBe(0);
    expect(header.gid).toBe(0);
    expect(header.linkpath || '').toBe('');
    offset += 512;
    members.push({
      path: header.path,
      contents: new TextDecoder().decode(bytes.subarray(offset, offset + header.size)),
    });
    const padded = Math.ceil(header.size / 512) * 512;
    expect(
      bytes.subarray(offset + header.size, offset + padded).every((value) => value === 0),
    ).toBe(true);
    offset += padded;
  }
  expect(bytes.length - offset).toBe(1024);
  expect(bytes.subarray(offset).every((value) => value === 0)).toBe(true);
  return members;
}

async function deterministicArchive() {
  const archives: Uint8Array[] = [];
  const sink = async (bytes: Uint8Array) => {
    archives.push(bytes.slice());
  };
  const firstHandoff = makeSyntheticReadinessHandoff(entries());
  const reversed = entries().reverse();
  const secondHandoff = makeSyntheticReadinessHandoff(reversed);
  const first = await run(firstHandoff, sink);
  const second = await run(secondHandoff, sink);
  expect(first._tag).toBe('Success');
  expect(second).toEqual(first);
  expect(archives[0]).toEqual(archives[1]);
  expect(inspect(archives[0]!)).toEqual(
    names.map((path, index) => ({ path, contents: `content-${index}` })),
  );
  expect(first).toMatchObject({
    success: {
      _tag: 'SyntheticOnly',
      activation: 'Blocked',
      image: 'Unbuilt',
      sink: 'SinkResolved',
      sha256: await digest(archives[0]!),
      bytes: archives[0]!.length,
    },
  });
}
test(
  'emits deterministic canonical files and hashes exact bytes passed to a synthetic sink',
  deterministicArchive,
);

async function snapshotIsolation() {
  const input = entries();
  const handoff = makeSyntheticReadinessHandoff(input);
  input[0]!.bytes.fill(88);
  let release!: () => void;
  let called!: () => void;
  const started = new Promise<void>((resolve) => {
    called = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received = new Uint8Array();
  async function sink(bytes: Uint8Array) {
    received = bytes.slice();
    called();
    await gate;
  }
  const pending = run(handoff, sink);
  await started;
  input[1]!.bytes.fill(89);
  release();
  expect((await pending)._tag).toBe('Success');
  expect(inspect(received)).toEqual(
    names.map((path, index) => ({ path, contents: `content-${index}` })),
  );
}
test(
  'snapshots input before execution and isolates input mutations while the sink awaits',
  snapshotIsolation,
);

async function invalidEntries() {
  const valid = entries();
  const rest = valid.slice(1);
  const invalid: unknown[] = [
    valid.slice(1),
    [...valid, valid[0]],
    [...valid, { path: 'other', bytes: encoder.encode('x') }],
    [{ ...valid[0]!, type: 'SymbolicLink', linkpath: 'input/strace' }, ...rest],
    [{ ...valid[0]!, path: 'input/' }, ...rest],
    [{ ...valid[0]!, bytes: new Uint8Array() }, ...rest],
    [{ ...valid[0]!, bytes: new Uint8Array(1048577) }, ...rest],
    valid.map((entry) => ({ ...entry, bytes: new Uint8Array(800000) })),
    [{ ...valid[0]!, bytes: 'bad' }, ...rest],
    null,
  ];
  for (const candidate of invalid) {
    let calls = 0;
    const result = await run(makeSyntheticReadinessHandoff(candidate), async () => {
      calls++;
    });
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidInput' } });
    expect(calls).toBe(0);
  }
}
test(
  'rejects missing, duplicate, extra, non-file, zero and oversized entries without calling the sink',
  invalidEntries,
);

async function rejectsCandidate(input: unknown) {
  let calls = 0;
  const handoff = makeSyntheticReadinessHandoff(input);
  const result = await run(handoff, async () => {
    calls++;
  });
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidInput' } });
  expect(calls).toBe(0);
}

async function rejectsSwappingGetter() {
  const input = entries();
  let reads = 0;
  const large = new Uint8Array(1048577);
  const small = input[0]!.bytes;
  Object.defineProperty(input[0]!, 'bytes', {
    enumerable: true,
    get() {
      reads++;
      return [small, small, small, small, small, large][Math.min(reads - 1, 5)];
    },
  });
  await rejectsCandidate(input);
  expect(reads).toBe(0);
}
test('rejects a getter that swaps validated bytes for an oversized view', rejectsSwappingGetter);

async function rejectsOverriddenArrayEvery() {
  const input = entries();
  input[0]!.bytes = new Uint8Array(1048577);
  Object.defineProperty(input, 'every', { value: () => true });
  await rejectsCandidate(input);
}
test('does not trust caller array every for the entry size limit', rejectsOverriddenArrayEvery);

async function rejectsOverriddenArrayReduce() {
  const input = entries();
  for (const entry of input) entry.bytes = new Uint8Array(800000);
  Object.defineProperty(input, 'reduce', { value: () => 0 });
  await rejectsCandidate(input);
}
test(
  'does not trust caller array reduce for the aggregate size limit',
  rejectsOverriddenArrayReduce,
);

async function rejectsShadowLength() {
  const input = entries();
  const bytes = new Uint8Array(1048577);
  Object.defineProperty(bytes, 'byteLength', { value: 1 });
  input[0]!.bytes = bytes;
  await rejectsCandidate(input);
}
test('does not trust a shadowed typed-array byteLength', rejectsShadowLength);

async function rejectsShadowBuffer() {
  const input = entries();
  const bytes = new Uint8Array(new SharedArrayBuffer(8));
  Object.defineProperty(bytes, 'buffer', { value: new ArrayBuffer(8) });
  Object.defineProperty(input[0]!, 'bytes', { value: bytes, enumerable: true });
  await rejectsCandidate(input);
}
test('does not trust a shadowed typed-array buffer', rejectsShadowBuffer);

async function rejectsPrototypeSpoofedSharedBuffer() {
  const input = entries();
  const shared = new SharedArrayBuffer(8);
  const bytes = new Uint8Array(shared);
  Object.setPrototypeOf(shared, ArrayBuffer.prototype);
  Object.defineProperty(input[0]!, 'bytes', { value: bytes, enumerable: true });
  await rejectsCandidate(input);
}
test(
  'rejects shared storage with a spoofed ArrayBuffer prototype',
  rejectsPrototypeSpoofedSharedBuffer,
);

async function rejectsDuplicateWithinFour() {
  const input = entries();
  input[3] = input[0]!;
  await rejectsCandidate(input);
}
test('rejects duplicate names even when the entry count is four', rejectsDuplicateWithinFour);

async function boundarySizes() {
  const input = entries();
  input[0]!.bytes = new Uint8Array(1048576).fill(65);
  input[1]!.bytes = new Uint8Array(1047550).fill(66);
  input[2]!.bytes = new Uint8Array(513).fill(67);
  input[3]!.bytes = new Uint8Array(513).fill(68);
  const handoff = makeSyntheticReadinessHandoff(input);
  let captured = new Uint8Array();
  const result = await run(handoff, async (bytes) => {
    captured = bytes.slice();
  });
  expect(result._tag).toBe('Success');
  const decoded = inspect(captured);
  expect(decoded.map((entry) => entry.contents.length)).toEqual([1048576, 1047550, 513, 513]);
  expect(decoded[2]!.contents).toBe('C'.repeat(513));
  expect(decoded[3]!.contents).toBe('D'.repeat(513));
}
test('accepts the simulation limits and frames non-block-aligned files', boundarySizes);

async function artifactBudgetBoundary() {
  const input = entries();
  input[0]!.bytes = new Uint8Array(1048576).fill(65);
  input[1]!.bytes = new Uint8Array(1048576).fill(66);
  input[2]!.bytes = new Uint8Array(1048575).fill(67);
  input[3]!.bytes = new Uint8Array(1).fill(68);
  const handoff = makeSyntheticReadinessHandoff(input);
  let captured = new Uint8Array();
  const result = await run(handoff, async (bytes) => {
    captured = bytes.slice();
  });
  expect(result._tag).toBe('Success');
  expect(inspect(captured).map((entry) => entry.contents.length)).toEqual([
    1048576, 1048576, 1048575, 1,
  ]);
  const reversed = makeSyntheticReadinessHandoff(input.slice().reverse());
  expect((await run(reversed, async () => {}))._tag).toBe('Success');
  input[3]!.bytes = new Uint8Array(2);
  await rejectsCandidate(input);
  await rejectsCandidate(input.slice().reverse());
}
test('separately bounds the recipe and exact two MiB artifact aggregate', artifactBudgetBoundary);

async function detectsTampering() {
  const handoff = makeSyntheticReadinessHandoff(entries());
  const result = await run(handoff, async (bytes) => {
    bytes[512] ^= 1;
  });
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'SinkTampered' } });
}
test('detects sink tampering and never reports acceptance', detectsTampering);

async function detectsOverriddenSinkEvery() {
  const handoff = makeSyntheticReadinessHandoff(entries());
  async function sink(bytes: Uint8Array) {
    bytes[512] ^= 1;
    Object.defineProperty(bytes, 'every', { value: () => true });
  }
  const result = await run(handoff, sink);
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'SinkTampered' } });
}
test(
  'does not trust a sink override of the delivered array comparison',
  detectsOverriddenSinkEvery,
);

async function detectsPrototypeLengthOverride() {
  const handoff = makeSyntheticReadinessHandoff(entries());
  const prototype = Uint8Array.prototype;
  const previous = Object.getOwnPropertyDescriptor(prototype, 'length');
  const typedPrototype = Object.getPrototypeOf(prototype);
  const intrinsicLength = Object.getOwnPropertyDescriptor(typedPrototype, 'length')!.get!;
  let reads = 0;
  async function sink(bytes: Uint8Array) {
    bytes[512] ^= 1;
    Object.defineProperty(prototype, 'length', {
      configurable: true,
      get() {
        const lengths = [intrinsicLength.call(this), 0];
        return lengths[Math.min(reads++, 1)];
      },
    });
  }
  function restore() {
    return Match.value(previous).pipe(
      Match.when(undefined, () => Reflect.deleteProperty(prototype, 'length')),
      Match.orElse((descriptor) => Reflect.defineProperty(prototype, 'length', descriptor)),
    );
  }
  const result = await run(handoff, sink).finally(restore);
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'SinkTampered' } });
}
test(
  'detects tampering when the sink overrides the typed-array length prototype',
  detectsPrototypeLengthOverride,
);

async function reportsCapturedLength() {
  const handoff = makeSyntheticReadinessHandoff(entries());
  const prototype = Uint8Array.prototype;
  const previous = Object.getOwnPropertyDescriptor(prototype, 'length');
  async function sink() {
    Object.defineProperty(prototype, 'length', { configurable: true, get: () => 0 });
  }
  function restore() {
    return Match.value(previous).pipe(
      Match.when(undefined, () => Reflect.deleteProperty(prototype, 'length')),
      Match.orElse((descriptor) => Reflect.defineProperty(prototype, 'length', descriptor)),
    );
  }
  const result = await run(handoff, sink).finally(restore);
  expect(result).toMatchObject({ _tag: 'Success', success: { bytes: 5120 } });
}
test(
  'reports the captured archive length after a sink overrides the prototype',
  reportsCapturedLength,
);

async function detectsDetachedSinkBuffer() {
  const handoff = makeSyntheticReadinessHandoff(entries());
  async function sink(bytes: Uint8Array) {
    await Promise.resolve();
    structuredClone(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
  }
  const result = await run(handoff, sink);
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'SinkTampered' } });
}
test('rejects a sink that detaches its buffer after awaiting', detectsDetachedSinkBuffer);

class FakeSinkFailure extends Data.TaggedError('FakeSinkFailure')<{ readonly reason: string }> {}

async function oneAttempt() {
  const handoff = makeSyntheticReadinessHandoff(entries());
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sink = async () => {
    calls++;
    await gate;
    throw new FakeSinkFailure({ reason: 'synthetic failure' });
  };
  const first = run(handoff, sink);
  const second = run(handoff, sink);
  release();
  const results = await Promise.all([first, second]);
  expect(results).toMatchObject([
    { _tag: 'Failure', failure: { code: 'SinkFailure' } },
    { _tag: 'Failure', failure: { code: 'AlreadyAttempted' } },
  ]);
  expect(calls).toBe(1);
  expect(await run(handoff, sink)).toMatchObject({
    _tag: 'Failure',
    failure: { code: 'AlreadyAttempted' },
  });
}
test('a rejected sink or concurrent attempts cannot call the sink more than once', oneAttempt);
