import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, FileSystem, Match, Result, Schema, type Runtime } from 'effect';

import {
  PreparationReport,
  preparationCondition,
  validatePreparation,
} from '../src/preparation.ts';

const directory = new URL('../', import.meta.url);
const encodeReport = Schema.encodeSync(Schema.fromJsonString(PreparationReport));
const decodeInput = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const isCheck = Schema.is(Schema.Tuple([Schema.Literal('--check')]));

function* checkRecipe() {
  const fs = yield* FileSystem.FileSystem;
  const inputPath = decodeURIComponent(new URL('fixtures/baseline.json', directory).pathname);
  const recipePath = decodeURIComponent(new URL('image/Dockerfile', directory).pathname);
  const inputInfo = yield* fs.stat(inputPath);
  const recipeInfo = yield* fs.stat(recipePath);
  yield* Effect.fromResult(preparationCondition(inputInfo.size <= 65536n, 'InvalidManifest'));
  yield* Effect.fromResult(preparationCondition(recipeInfo.size <= 65536n, 'RecipeMismatch'));
  const text = yield* fs.readFileString(inputPath);
  const recipe = yield* fs.readFileString(recipePath);
  const input = yield* decodeInput(text);
  const report = yield* validatePreparation(input, recipe);
  yield* Console.log(encodeReport(report));
  return 2;
}

function* usageError() {
  yield* Console.error('{"_tag":"UsageError"}');
  return 64;
}
const checkWorkflow = Effect.gen(checkRecipe);
const usageWorkflow = Effect.gen(usageError);
const failureWorkflow = Console.error('{"_tag":"PreparationCheckFailed"}').pipe(
  Effect.map(() => 1),
);

export function prepare(argv: ReadonlyArray<string>) {
  const workflow = Match.value(isCheck(argv)).pipe(
    Match.when(true, () => checkWorkflow),
    Match.orElse(() => usageWorkflow),
  );
  const result = workflow.pipe(Effect.result);
  const rendered = result.pipe(
    Effect.flatMap(
      Result.match({
        onSuccess: Effect.succeed,
        onFailure: () => failureWorkflow,
      }),
    ),
  );
  return rendered;
}

const checking = prepare(Bun.argv.slice(2));
export const program = Effect.provide(checking, BunServices.layer);
const decodeExit = Schema.decodeUnknownResult(Schema.Literals([1, 2, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  function completed(value: unknown) {
    const decoded = decodeExit(value);
    const code = decoded.pipe(Result.getOrElse(() => 1));
    onExit(code);
  }
  Exit.match(exit, { onSuccess: completed, onFailure: () => onExit(1) });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
