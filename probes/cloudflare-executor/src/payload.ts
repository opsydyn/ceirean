import { Data, Effect, Result, Schema } from 'effect';

import { validateSourceInventory } from './preparation.ts';

export class PayloadError extends Data.TaggedError('PayloadError')<{
  readonly code: 'SourceRefused' | 'ProcessRefused' | 'ArchiveRefused';
}> {}
const strict = { onExcessProperty: 'error' } as const;
const SourceFile = Schema.Struct({
  path: Schema.String,
  mode: Schema.Literals(['100644', '100755']),
  objectId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1048576 })),
  bytes: Schema.Uint8Array,
});
const SourceFiles = Schema.Array(SourceFile).check(Schema.isMinLength(1), Schema.isMaxLength(4096));
export function requirePayload(valid: boolean, code: PayloadError['code'] = 'SourceRefused') {
  return Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new PayloadError({ code }),
    ),
    Effect.fromResult,
  );
}
export function digestBytes(bytes: Uint8Array, algorithm: 'SHA-1' | 'SHA-256' = 'SHA-256') {
  const snapshot = new Uint8Array(bytes);
  const hashing = Effect.promise(() => crypto.subtle.digest(algorithm, snapshot));
  return hashing.pipe(
    Effect.map((buffer) =>
      Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    ),
  );
}
export function inspectSourceFiles(input: unknown) {
  function* inspect() {
    const decoded = yield* Schema.decodeUnknownEffect(SourceFiles, strict)(input);
    yield* requirePayload(decoded.every((file) => file.bytes.length <= 1048576));
    yield* requirePayload(decoded.reduce((sum, file) => sum + file.bytes.length, 0) <= 33554432);
    const files = structuredClone(decoded);
    yield* requirePayload(files.reduce((sum, file) => sum + file.bytes.length, 0) <= 33554432);
    yield* validateSourceInventory(
      files.map((file) => ({
        path: file.path,
        kind: 'File',
        content: new TextDecoder().decode(file.bytes),
      })),
    );
    const inspected = [];
    for (const file of files) {
      yield* requirePayload(file.bytes.length === file.size);
      const header = new TextEncoder().encode(`blob ${file.size}\0`);
      const gitBytes = new Uint8Array(header.length + file.bytes.length);
      gitBytes.set(header);
      gitBytes.set(file.bytes, header.length);
      yield* requirePayload((yield* digestBytes(gitBytes, 'SHA-1')) === file.objectId);
      inspected.push({ ...file, sha256: yield* digestBytes(file.bytes) });
    }
    return { activation: 'Blocked' as const, files: inspected };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
