import { Data, Effect, FileSystem, Option, Result, Schema } from 'effect';

export class RunnerInputError extends Data.TaggedError('RunnerInputError')<{
  readonly code: 'NotRegularFile' | 'InvalidBytes' | 'InvalidEncoding';
}> {}
const isFile = Schema.is(Schema.Struct({ type: Schema.Literal('File') }));
export function readBounded(path: string) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const before = yield* fs.stat(path);
    const validFile = [isFile(before), before.size > 0n, before.size <= 65536n].every(Boolean);
    yield* Effect.fromResult(
      Result.succeed(before).pipe(
        Result.filterOrFail(
          () => validFile,
          () => new RunnerInputError({ code: 'NotRegularFile' }),
        ),
      ),
    );
    const file = yield* fs.open(path, { flag: 'r', noFollow: true });
    const info = yield* file.stat;
    const chunk = yield* file.readAlloc(65537);
    const bytes = Option.getOrElse(chunk, () => new Uint8Array());
    const tail = yield* file.readAlloc(1);
    const complete = [
      isFile(info),
      info.size === BigInt(bytes.byteLength),
      bytes.byteLength <= 65536,
      Option.isNone(tail),
    ].every(Boolean);
    yield* Effect.fromResult(
      Result.succeed(bytes).pipe(
        Result.filterOrFail(
          () => complete,
          () => new RunnerInputError({ code: 'InvalidBytes' }),
        ),
      ),
    );
    return yield* Effect.try({
      // Preserve a BOM rather than silently changing the signed file bytes.
      try: () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      catch: () => new RunnerInputError({ code: 'InvalidEncoding' }),
    });
  }
  const operation = Effect.gen(read);
  return operation;
}
