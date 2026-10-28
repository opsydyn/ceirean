import { Data, Effect, Match, Result, Schema } from 'effect';

import { digestBytes } from '../payload.ts';
import { readinessImageRecipeSha256 } from '../readiness-image.ts';
import { inspectReadinessArtifactSnapshots } from './readiness-artifact-snapshots.ts';
import { makeSyntheticReadinessHandoff } from './readiness-context-archive.ts';

class SyntheticPipelineError extends Data.TaggedError('SyntheticPipelineError')<{
  readonly code:
    | 'InvalidRecipe'
    | 'RecipeMismatch'
    | 'InvalidArtifacts'
    | 'AlreadyAttempted'
    | 'SinkTampered';
}> {}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const typedArrayKind = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)!.get!;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)!.get!;
const everyByte = Uint8Array.prototype.every;
const isByteArrayKind = Schema.is(Schema.Literal('Uint8Array'));

function condition(valid: boolean, code: SyntheticPipelineError['code']) {
  return Result.succeed(valid).pipe(
    Result.filterOrFail(Boolean, () => new SyntheticPipelineError({ code })),
  );
}

export function makeSyntheticReadinessPipeline(recipe: Uint8Array, artifacts: unknown) {
  function copyRecipe() {
    const backing: unknown = Reflect.apply(buffer, recipe, []);
    const length: number = Reflect.apply(byteLength, recipe, []);
    const offset: number = Reflect.apply(byteOffset, recipe, []);
    const backingLength: number = Reflect.apply(arrayBufferByteLength, backing, []);
    const valid = [
      Schema.is(Schema.Uint8Array)(recipe),
      ArrayBuffer.isView(recipe),
      isByteArrayKind(Reflect.apply(typedArrayKind, recipe, [])),
      length > 0,
      length <= 1048576,
      offset + length <= backingLength,
    ].every(Boolean);
    return Match.value(valid).pipe(
      Match.when(
        true,
        () => new Uint8Array(new Uint8Array(backing as ArrayBuffer, offset, length)),
      ),
      Match.orElse(() => undefined),
    );
  }
  const recipeSnapshot = Result.try(copyRecipe).pipe(
    Result.mapError(() => new SyntheticPipelineError({ code: 'InvalidRecipe' })),
  );
  const inspection = Result.try(() => inspectReadinessArtifactSnapshots(artifacts)).pipe(
    Result.mapError(() => new SyntheticPipelineError({ code: 'InvalidArtifacts' })),
  );
  let attempted = false;
  return (sink: (bytes: Uint8Array) => Promise<void>) => {
    function* pipeline() {
      yield* Effect.fromResult(condition(!attempted, 'AlreadyAttempted'));
      attempted = true;
      const copiedRecipe = yield* Effect.fromResult(recipeSnapshot);
      yield* Effect.fromResult(condition(copiedRecipe !== undefined, 'InvalidRecipe'));
      const artifactInspection = yield* Effect.fromResult(inspection);
      yield* Effect.fromResult(
        condition(
          (yield* digestBytes(copiedRecipe!)) === readinessImageRecipeSha256(),
          'RecipeMismatch',
        ),
      );
      const inspected = yield* artifactInspection;
      const handoff = makeSyntheticReadinessHandoff([
        { path: 'Dockerfile', bytes: copiedRecipe! },
        ...inspected.entries,
      ]);
      let unchanged = false;
      async function isolatedSink(bytes: Uint8Array) {
        const delivered = new Uint8Array(bytes);
        await sink(delivered);
        const comparison = Result.try(() =>
          Reflect.apply(everyByte, delivered, [
            (byte: number, index: number) => byte === bytes[index],
          ]),
        );
        unchanged = Result.getOrElse(comparison, () => false);
      }
      const result = yield* handoff(isolatedSink);
      yield* Effect.fromResult(condition(unchanged, 'SinkTampered'));
      return result;
    }
    return Effect.gen(pipeline);
  };
}
