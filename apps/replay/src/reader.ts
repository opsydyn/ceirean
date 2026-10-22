import { Digest, decodeDraftProfile } from '@ceirean/domain';
import { Data, Effect, FileSystem, Match, Option, Result, Schema } from 'effect';

class ProfileReadError extends Data.TaggedError('ProfileReadError')<{
  readonly code:
    | 'ReadFailed'
    | 'NotRegular'
    | 'ProfileTooLarge'
    | 'InvalidEncoding'
    | 'InvalidProfile';
}> {}
const acceptedBytes = 262144;
const maximumRead = acceptedBytes + 1;
const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

function readBytes(file: FileSystem.File) {
  function* read() {
    const buffer = new Uint8Array(maximumRead);
    let used = 0;
    let ended = false;
    while (used < maximumRead && !ended) {
      const part = yield* file
        .readAlloc(maximumRead - used)
        .pipe(Effect.mapError(() => new ProfileReadError({ code: 'ReadFailed' })));
      const bytes = Option.getOrElse(part, () => new Uint8Array());
      buffer.set(bytes, used);
      used += bytes.length;
      ended = bytes.length === 0;
    }
    return buffer.subarray(0, used);
  }
  const program = Effect.gen(read);
  return program;
}

function regularFile(type: FileSystem.File.Type) {
  return Match.value(type).pipe(
    Match.when('File', () => Result.succeed(type)),
    Match.orElse(() => Result.fail(new ProfileReadError({ code: 'NotRegular' }))),
  );
}
function boundedBytes(bytes: Uint8Array) {
  return Match.value(bytes.byteLength <= acceptedBytes).pipe(
    Match.when(true, () => Result.succeed(bytes)),
    Match.orElse(() => Result.fail(new ProfileReadError({ code: 'ProfileTooLarge' }))),
  );
}

export function readDraftProfile(path: string) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs
      .open(path, { flag: 'r', noFollow: true })
      .pipe(Effect.mapError(() => new ProfileReadError({ code: 'ReadFailed' })));
    const info = yield* file.stat.pipe(
      Effect.mapError(() => new ProfileReadError({ code: 'ReadFailed' })),
    );
    yield* Effect.fromResult(regularFile(info.type));
    const raw = yield* readBytes(file);
    const bytes = yield* Effect.fromResult(boundedBytes(raw));
    const text = yield* Effect.try({
      try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      catch: () => new ProfileReadError({ code: 'InvalidEncoding' }),
    });
    const json = yield* Effect.fromResult(
      decodeJson(text).pipe(
        Result.mapError(() => new ProfileReadError({ code: 'InvalidProfile' })),
      ),
    );
    const profile = yield* Effect.fromResult(
      decodeDraftProfile(json).pipe(
        Result.mapError(() => new ProfileReadError({ code: 'InvalidProfile' })),
      ),
    );
    const sourceDigest = yield* Effect.try({
      try: () => Digest.make(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')),
      catch: () => new ProfileReadError({ code: 'ReadFailed' }),
    });
    return { profile, sourceDigest };
  }
  const program = Effect.gen(read);
  const scoped = Effect.scoped(program);
  return scoped;
}
