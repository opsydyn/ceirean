import { Data, Effect, Result, Schema } from 'effect';

import { digestBytes } from '../payload.ts';

const paths = ['input/readiness-worker.mjs', 'input/strace', 'input/observer-canary'] as const;
const fileLimit = 1048576;
const totalLimit = 2097152;
// Intrinsic getters ignore attacker-controlled properties on typed-array instances.
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const typedArrayTag = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)!.get!;
const arrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)!.get!;
const isObject = Schema.is(Schema.ObjectKeyword);
const isString = Schema.is(Schema.String);
const isInt = Schema.is(Schema.Int);
const isUint8ArrayTag = Schema.is(Schema.Literal('Uint8Array'));

type Snapshot = {
  readonly entries: ReadonlyArray<{ readonly path: string; readonly bytes: Uint8Array }>;
  readonly expected: ReadonlyArray<{
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
  }>;
};

export class ReadinessArtifactSnapshotError extends Data.TaggedError(
  'ReadinessArtifactSnapshotError',
)<{ readonly code: 'InvalidArtifacts' }> {}

function condition(valid: boolean) {
  return Result.succeed(valid).pipe(
    Result.filterOrFail(
      Boolean,
      () => new ReadinessArtifactSnapshotError({ code: 'InvalidArtifacts' }),
    ),
  );
}

function takeSnapshot(input: unknown) {
  function* capture() {
    yield* condition(isObject(input));
    const fields = Object(input);
    const entriesInput: unknown = Reflect.get(fields, 'entries');
    const expectedInput: unknown = Reflect.get(fields, 'expected');
    yield* condition(Array.isArray(entriesInput) && Array.isArray(expectedInput));
    const inputEntries = Object(entriesInput);
    const inputExpected = Object(expectedInput);
    yield* condition(
      Reflect.get(inputEntries, 'length') === paths.length &&
        Reflect.get(inputExpected, 'length') === paths.length,
    );

    const entries: Array<{ path: string; bytes: Uint8Array }> = [];
    const expected: Array<{ path: string; size: number; sha256: string }> = [];
    let total = 0;
    for (let index = 0; index < paths.length; index += 1) {
      const entry: unknown = Reflect.get(inputEntries, String(index));
      yield* condition(isObject(entry));
      const entryFields = Object(entry);
      const path: unknown = Reflect.get(entryFields, 'path');
      const bytes: unknown = Reflect.get(entryFields, 'bytes');
      yield* condition(isString(path) && ArrayBuffer.isView(bytes));
      const tag: unknown = Reflect.apply(typedArrayTag, bytes, []);
      yield* condition(isUint8ArrayTag(tag));
      const backing: unknown = Reflect.apply(buffer, bytes, []);
      const backingLength: number = Reflect.apply(arrayBufferLength, backing, []);
      const length: number = Reflect.apply(byteLength, bytes, []);
      const offset: number = Reflect.apply(byteOffset, bytes, []);
      const bounded = [
        length > 0,
        length <= fileLimit,
        total + length <= totalLimit,
        offset + length <= backingLength,
      ].every(Boolean);
      yield* condition(bounded);
      total += length;
      entries.push({
        path: path as string,
        bytes: new Uint8Array(new Uint8Array(backing as ArrayBuffer, offset, length)),
      });

      const identity: unknown = Reflect.get(inputExpected, String(index));
      yield* condition(isObject(identity));
      const identityFields = Object(identity);
      const expectedPath: unknown = Reflect.get(identityFields, 'path');
      const size: unknown = Reflect.get(identityFields, 'size');
      const sha256: unknown = Reflect.get(identityFields, 'sha256');
      yield* condition(
        isString(expectedPath) && isInt(size) && Number.isSafeInteger(size) && isString(sha256),
      );
      expected.push({
        path: expectedPath as string,
        size: size as number,
        sha256: sha256 as string,
      });
    }
    return { entries, expected } satisfies Snapshot;
  }
  const result = Result.gen(capture);
  return result;
}

function snapshot(input: unknown) {
  const attempt = Result.try(() => takeSnapshot(input));
  return Result.getOrElse(attempt, () =>
    Result.fail(new ReadinessArtifactSnapshotError({ code: 'InvalidArtifacts' })),
  );
}

export function inspectReadinessArtifactSnapshots(input: unknown) {
  const copied = snapshot(input);
  function* inspect() {
    const { entries, expected } = yield* Effect.fromResult(copied);
    const validMembership = paths.every(
      (path) =>
        entries.filter((entry) => entry.path === path).length === 1 &&
        expected.filter((identity) => identity.path === path).length === 1,
    );
    const validIdentities = expected.every(
      (identity) =>
        identity.size > 0 && identity.size <= fileLimit && /^[0-9a-f]{64}$/.test(identity.sha256),
    );
    yield* Effect.fromResult(condition(validMembership && validIdentities));
    for (const entry of entries) {
      const identity = expected.find((item) => item.path === entry.path);
      yield* Effect.fromResult(condition(identity?.size === entry.bytes.length));
      yield* Effect.fromResult(condition((yield* digestBytes(entry.bytes)) === identity?.sha256));
    }
    return {
      _tag: 'InspectionOnly' as const,
      activation: 'Blocked' as const,
      image: 'Unbuilt' as const,
      entries: entries.map(({ path, bytes }) => ({ path, bytes: new Uint8Array(bytes) })),
    };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
