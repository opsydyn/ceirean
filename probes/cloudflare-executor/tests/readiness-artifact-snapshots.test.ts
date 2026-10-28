import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { Effect } from 'effect';

import { inspectReadinessArtifactSnapshots } from '../src/internal/readiness-artifact-snapshots.ts';

const paths = ['input/readiness-worker.mjs', 'input/strace', 'input/observer-canary'];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const input = () => {
  const entries = paths.map((path, index) => ({ path, bytes: new Uint8Array([index + 1, 42]) }));
  const expected = entries.map(({ path, bytes }) => ({
    path,
    size: bytes.length,
    sha256: hash(bytes),
  }));
  return { entries, expected };
};
const inspect = (value: unknown) => {
  const result = inspectReadinessArtifactSnapshots(value).pipe(Effect.result);
  return Effect.runPromise(result);
};

async function acceptsSyntheticIdentities() {
  const value = input();
  value.expected.reverse();
  const result = await Effect.runPromise(inspectReadinessArtifactSnapshots(value));
  expect(result).toMatchObject({ _tag: 'InspectionOnly', activation: 'Blocked', image: 'Unbuilt' });
  expect(result.entries).toEqual(value.entries);
}
test(
  'accepts synthetic identities in any order without granting authority',
  acceptsSyntheticIdentities,
);

async function snapshotsInputs() {
  const value = input();
  const inspection = inspectReadinessArtifactSnapshots(value);
  value.entries.forEach((entry) => entry.bytes.fill(0));
  value.entries[1]!.path = 'changed';
  value.expected[2]!.sha256 = '0'.repeat(64);
  value.expected[0]!.size = 99;
  const first = await Effect.runPromise(inspection);
  expect(first.entries.map((entry) => [...entry.bytes])).toEqual([
    [1, 42],
    [2, 42],
    [3, 42],
  ]);
  first.entries[0]!.bytes.fill(9);
  const second = await Effect.runPromise(inspection);
  expect([...second.entries[0]!.bytes]).toEqual([1, 42]);
}
test(
  'copies every input and identity synchronously and never exposes retained bytes',
  snapshotsInputs,
);

async function rejectsInvalidPaths() {
  const base = input();
  const invalid = [
    null,
    {},
    { ...base, entries: base.entries.slice(1) },
    { ...base, expected: base.expected.slice(1) },
    { ...base, entries: [...base.entries, base.entries[0]] },
    { ...base, expected: [...base.expected, base.expected[0]] },
    { ...base, entries: [base.entries[0], base.entries[0], base.entries[2]] },
    { ...base, expected: [base.expected[0], base.expected[0], base.expected[2]] },
    { ...base, entries: [{ ...base.entries[0], path: '../strace' }, ...base.entries.slice(1)] },
    {
      ...base,
      expected: [{ ...base.expected[0], path: 'input/extra' }, ...base.expected.slice(1)],
    },
    { ...base, entries: [{ ...base.entries[0], bytes: 'not bytes' }, ...base.entries.slice(1)] },
  ];
  for (const value of invalid) expect((await inspect(value))._tag).toBe('Failure');
}
test(
  'rejects malformed, missing, duplicate and extra paths in either collection',
  rejectsInvalidPaths,
);

async function rejectsInvalidContent() {
  const base = input();
  const invalid = [
    {
      ...base,
      expected: [{ ...base.expected[0], sha256: 'A'.repeat(64) }, ...base.expected.slice(1)],
    },
    {
      ...base,
      expected: [{ ...base.expected[0], sha256: '0'.repeat(64) }, ...base.expected.slice(1)],
    },
    { ...base, expected: [{ ...base.expected[0], size: 1 }, ...base.expected.slice(1)] },
    { ...base, expected: [{ ...base.expected[0], size: 2.5 }, ...base.expected.slice(1)] },
    {
      ...base,
      entries: [{ ...base.entries[0], bytes: new Uint8Array() }, ...base.entries.slice(1)],
    },
    {
      ...base,
      entries: [{ ...base.entries[0], bytes: new Uint8Array(1048577) }, ...base.entries.slice(1)],
    },
    {
      ...base,
      entries: base.entries.map((entry) => ({ ...entry, bytes: new Uint8Array(800000) })),
    },
  ];
  for (const value of invalid) expect((await inspect(value))._tag).toBe('Failure');
}
test(
  'rejects invalid hashes, exact sizes, empty and oversized bytes and aggregate data',
  rejectsInvalidContent,
);

async function checksMutationsAndPermutations() {
  for (let seed = 0; seed < 24; seed += 1) {
    const value = input();
    value.entries.forEach((entry, index) => {
      entry.bytes = new Uint8Array([seed, index, seed ^ index]);
    });
    value.expected = value.entries.map(({ path, bytes }) => ({
      path,
      size: bytes.length,
      sha256: hash(bytes),
    }));
    value.expected = [
      value.expected[seed % 3]!,
      value.expected[(seed + 1) % 3]!,
      value.expected[(seed + 2) % 3]!,
    ];
    expect((await inspect(value))._tag).toBe('Success');
    value.entries[seed % 3]!.bytes[0] ^= 255;
    expect((await inspect(value))._tag).toBe('Failure');
  }
}
test(
  'synthetic byte mutations and identity permutations are checked against the matching path',
  checksMutationsAndPermutations,
);

async function checksBounds() {
  for (const { sizes, tag } of [
    { sizes: [1048576, 1048575, 1], tag: 'Success' },
    { sizes: [1048577, 1, 1], tag: 'Failure' },
    { sizes: [1048576, 1048576, 1], tag: 'Failure' },
    { sizes: [0, 1, 1], tag: 'Failure' },
  ] as const) {
    const entries = paths.map((path, index) => ({ path, bytes: new Uint8Array(sizes[index]!) }));
    const expected = entries.map(({ path, bytes }) => ({
      path,
      size: bytes.length,
      sha256: hash(bytes),
    }));
    const result = await inspect({ entries, expected });
    expect(result._tag).toBe(tag);
  }
}
test('enforces per-file and aggregate limits even when hashes and sizes match', checksBounds);

async function capturesBytesOnce() {
  const value = input();
  const small = value.entries[0]!.bytes;
  const oversized = new Uint8Array(64 * 1024 * 1024);
  let reads = 0;
  Object.defineProperty(value.entries[0]!, 'bytes', {
    get() {
      reads += 1;
      return [small, small, small, oversized][reads - 1]!;
    },
  });
  const result = await inspect(value);
  expect(reads).toBe(1);
  expect(result._tag).toBe('Success');
}
test(
  'captures an attacker-controlled byte field once before checking and copying',
  capturesBytesOnce,
);

async function rejectsLongArraysBeforeTraversal() {
  for (const key of ['entries', 'expected'] as const) {
    const value = input();
    const original = value[key];
    const oversized = Array.from({ length: 10000 }, () => original[0]);
    let reads = 0;
    Object.defineProperty(oversized, 0, {
      get() {
        reads += 1;
        return original[0];
      },
    });
    const result = await inspect({ ...value, [key]: oversized });
    expect(result._tag).toBe('Failure');
    expect(reads).toBe(0);
  }
}
test(
  'rejects oversized collections before visiting their elements',
  rejectsLongArraysBeforeTraversal,
);

async function rejectsThrowingGetters() {
  const value = input();
  const throwing = Object.defineProperty(value.entries[0]!, 'bytes', {
    get() {
      return new Uint8Array(-1);
    },
  });
  const result = await inspect({ ...value, entries: [throwing, ...value.entries.slice(1)] });
  expect(result).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'ReadinessArtifactSnapshotError', code: 'InvalidArtifacts' },
  });
}
test('converts synchronous getter exceptions into typed failures', rejectsThrowingGetters);

async function rejectsSharedBytes() {
  const value = input();
  const bytes = new Uint8Array(new SharedArrayBuffer(2));
  bytes.set(value.entries[0]!.bytes);
  const entries = [{ ...value.entries[0]!, bytes }, ...value.entries.slice(1)];
  expect((await inspect({ ...value, entries }))._tag).toBe('Failure');
}
test('rejects concurrently mutable shared byte buffers', rejectsSharedBytes);

async function rejectsSpoofedSharedBuffer() {
  const value = input();
  const backing = new SharedArrayBuffer(2);
  const bytes = new Uint8Array(backing);
  bytes.set(value.entries[0]!.bytes);
  Object.setPrototypeOf(backing, ArrayBuffer.prototype);
  const entries = [{ ...value.entries[0]!, bytes }, ...value.entries.slice(1)];
  expect(await inspect({ ...value, entries })).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'ReadinessArtifactSnapshotError', code: 'InvalidArtifacts' },
  });
}
test('rejects a shared buffer with a spoofed ArrayBuffer prototype', rejectsSpoofedSharedBuffer);

async function rejectsSpoofedTypedArray() {
  const value = input();
  const backing = new ArrayBuffer(2);
  new Uint8Array(backing).set(value.entries[0]!.bytes);
  const bytes = new Uint16Array(backing);
  Object.setPrototypeOf(bytes, Uint8Array.prototype);
  Object.defineProperty(bytes, Symbol.toStringTag, { value: 'Uint8Array' });
  const entries = [{ ...value.entries[0]!, bytes }, ...value.entries.slice(1)];
  expect((await inspect({ ...value, entries }))._tag).toBe('Failure');
}
test(
  'rejects a non-byte typed array with a spoofed Uint8Array prototype',
  rejectsSpoofedTypedArray,
);

async function capturesFieldsOnce() {
  const value = input();
  const entry = value.entries[0]!;
  const identity = value.expected[0]!;
  const reads = new Map<string, number>();
  function watch(target: object, key: string) {
    const original: unknown = Reflect.get(target, key);
    Object.defineProperty(target, key, {
      get() {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return original;
      },
    });
  }
  watch(value, 'entries');
  watch(value, 'expected');
  watch(entry, 'path');
  watch(entry, 'bytes');
  watch(identity, 'size');
  watch(identity, 'sha256');
  expect((await inspect(value))._tag).toBe('Success');
  for (const count of reads.values()) expect(count).toBe(1);
}
test('captures each root, entry and identity field once', capturesFieldsOnce);

async function copiesActualViewWithoutUserOverrides() {
  const value = input();
  const bytes = new Uint8Array([7, 1, 42, 8]).subarray(1, 3);
  Object.defineProperty(bytes, 'byteLength', { value: 64 * 1024 * 1024 });
  Object.defineProperty(bytes, 'buffer', { value: new SharedArrayBuffer(2) });
  value.entries[0]!.bytes = bytes;
  const result = await Effect.runPromise(inspectReadinessArtifactSnapshots(value));
  expect([...result.entries[0]!.bytes]).toEqual([1, 42]);
}
test(
  'copies only the actual typed-array view despite shadowed metadata',
  copiesActualViewWithoutUserOverrides,
);
