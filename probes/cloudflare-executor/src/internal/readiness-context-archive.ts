import { Data, Effect, Match, Result, Schema } from 'effect';

import { Header } from '../../node_modules/npm/node_modules/tar/dist/esm/header.js';

const paths = [
  'Dockerfile',
  'input/readiness-worker.mjs',
  'input/strace',
  'input/observer-canary',
] as const;
const entryLimit = 1048576;
const artifactTotalLimit = 2097152;
const blockSize = 512;
const isString = Schema.is(Schema.String);
const isUint8Tag = Schema.is(Schema.Literal('Uint8Array'));
const isRecipe = Schema.is(Schema.Literal('Dockerfile'));
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const typedArrayTag = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)!.get!;
const arrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)!.get!;

class SyntheticArchiveError extends Data.TaggedError('SyntheticArchiveError')<{
  readonly code:
    | 'InvalidInput'
    | 'AlreadyAttempted'
    | 'SinkFailure'
    | 'SinkTampered'
    | 'DigestFailure';
}> {}

function encodeEntries(
  files: Map<string, Uint8Array<ArrayBuffer>>,
): Uint8Array<ArrayBuffer> | undefined {
  const length = paths.reduce(
    (sum, path) => sum + blockSize + Math.ceil(files.get(path)!.length / blockSize) * blockSize,
    2 * blockSize,
  );
  const archive = new Uint8Array(length);
  let offset = 0;
  function encode(path: string) {
    const file = files.get(path)!;
    const header = new Header({
      path,
      type: 'File',
      size: file.length,
      mode: 0o644,
      uid: 0,
      gid: 0,
      uname: '',
      gname: '',
      linkpath: '',
    });
    const block = Buffer.alloc(blockSize);
    const needsExtension = header.encode(block);
    archive.set(block, offset);
    offset += blockSize;
    archive.set(file, offset);
    offset += Math.ceil(file.length / blockSize) * blockSize;
    return needsExtension;
  }
  const extended = paths.map(encode);
  return Match.value(extended.some(Boolean)).pipe(
    Match.when(true, () => undefined),
    Match.orElse(() => archive),
  );
}

function snapshot(input: unknown) {
  function* capture() {
    yield* requireCondition(Array.isArray(input), 'InvalidInput');
    const length = Object.getOwnPropertyDescriptor(input, 'length');
    yield* requireCondition(length?.value === paths.length, 'InvalidInput');
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    let artifactTotal = 0;
    for (let index = 0; index < paths.length; index++) {
      const item = Object.getOwnPropertyDescriptor(input, String(index));
      yield* requireCondition(item !== undefined && Object.hasOwn(item, 'value'), 'InvalidInput');
      const entry: object = item!.value;
      const keys = Reflect.ownKeys(entry);
      const pathProperty = Object.getOwnPropertyDescriptor(entry, 'path');
      const bytesProperty = Object.getOwnPropertyDescriptor(entry, 'bytes');
      const fieldsValid = [
        keys.length === 2,
        keys.every((key) => ['path', 'bytes'].includes(key as string)),
        pathProperty !== undefined && Object.hasOwn(pathProperty, 'value'),
        bytesProperty !== undefined && Object.hasOwn(bytesProperty, 'value'),
      ].every(Boolean);
      yield* requireCondition(fieldsValid, 'InvalidInput');
      const path: string = pathProperty!.value;
      const bytes: Uint8Array = bytesProperty!.value;
      yield* requireCondition(isString(path), 'InvalidInput');
      const name = path;
      const size: number = typedArrayLength.call(bytes);
      const backing: object = typedArrayBuffer.call(bytes);
      const ordinaryBuffer = Result.try(() => arrayBufferLength.call(backing));
      const artifactSize = Match.value(isRecipe(name)).pipe(
        Match.when(true, () => 0),
        Match.orElse(() => size),
      );
      const allowed = [
        paths.some((candidate) => candidate === name),
        !files.has(name),
        isUint8Tag(typedArrayTag.call(bytes)),
        Result.isSuccess(ordinaryBuffer),
        size > 0,
        size <= entryLimit,
        artifactSize <= artifactTotalLimit - artifactTotal,
      ].every(Boolean);
      yield* requireCondition(allowed, 'InvalidInput');
      files.set(name, new Uint8Array(bytes));
      artifactTotal += artifactSize;
    }
    return encodeEntries(files);
  }
  const attempt = Result.try(() => Result.gen(capture));
  const captured = Result.getOrElse(attempt, () => Result.succeed(undefined));
  return Result.getOrElse(captured, () => undefined);
}

function requireCondition(condition: boolean, code: SyntheticArchiveError['code']) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(true)),
    Match.orElse(() => Result.fail(new SyntheticArchiveError({ code }))),
  );
}

// Simulation only: a resolved callback does not prove consumption. Cancellation cannot
// guarantee that an asynchronous sink stops or cleans up.
export function makeSyntheticReadinessHandoff(input: unknown) {
  const archive = snapshot(input);
  let attempted = false;
  return (sink: (bytes: Uint8Array) => Promise<void>) => {
    function* handoff() {
      yield* Effect.fromResult(requireCondition(!attempted, 'AlreadyAttempted'));
      attempted = true;
      yield* Effect.fromResult(requireCondition(archive !== undefined, 'InvalidInput'));
      const bytes = archive!;
      const archiveLength: number = typedArrayLength.call(bytes);
      const hash = yield* Effect.tryPromise({
        try: () => crypto.subtle.digest('SHA-256', bytes),
        catch: () => new SyntheticArchiveError({ code: 'DigestFailure' }),
      });
      const sha256 = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const delivered = new Uint8Array(bytes);
      yield* Effect.tryPromise({
        try: () => sink(delivered),
        catch: () => new SyntheticArchiveError({ code: 'SinkFailure' }),
      });
      function matchesDelivered() {
        let equal = typedArrayLength.call(delivered) === archiveLength;
        for (let index = 0; index < archiveLength; index++) {
          equal = equal && delivered[index] === bytes[index];
        }
        return equal;
      }
      const comparison = Result.try(matchesDelivered);
      const unchanged = Result.getOrElse(comparison, () => false);
      yield* Effect.fromResult(requireCondition(unchanged, 'SinkTampered'));
      return {
        _tag: 'SyntheticOnly' as const,
        activation: 'Blocked' as const,
        image: 'Unbuilt' as const,
        sink: 'SinkResolved' as const,
        sha256,
        bytes: archiveLength,
      };
    }
    return Effect.gen(handoff);
  };
}
