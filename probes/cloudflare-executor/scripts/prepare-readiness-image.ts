import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { validateReadinessImagePreparation } from '../src/readiness-image.ts';
import { readBounded } from '../src/runner-input.ts';

const directory = new URL('../', import.meta.url);
const manifestPath = decodeURIComponent(
  new URL('fixtures/readiness-image.json', directory).pathname,
);
const recipePath = decodeURIComponent(new URL('readiness-image/Dockerfile', directory).pathname);
const reportSchema = Schema.TaggedStruct('PreparationOnly', {
  activation: Schema.Literal('Blocked'),
  image: Schema.Literal('Unbuilt'),
  recipeSha256: Schema.String,
  blockers: Schema.Array(Schema.String),
});
const encodeReport = Schema.encodeSync(Schema.fromJsonString(reportSchema));
const decodeInput = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const isCheck = Schema.is(Schema.Tuple([Schema.Literal('--check')]));

function* checkRecipe() {
  const text = yield* readBounded(manifestPath, 65536);
  const recipe = yield* readBounded(recipePath, 65536);
  const input = yield* decodeInput(text);
  const report = yield* validateReadinessImagePreparation(input, recipe);
  yield* Console.log(encodeReport(report));
  return 2;
}

function* usageError() {
  yield* Console.error('{"_tag":"UsageError"}');
  return 64;
}
const checkingRecipe = Effect.gen(checkRecipe);
const checkWorkflow = Effect.scoped(checkingRecipe);
const usageWorkflow = Effect.gen(usageError);
const failureWorkflow = Console.error('{"_tag":"PreparationCheckFailed"}').pipe(
  Effect.map(() => 1),
);

export function prepareReadinessImage(argv: ReadonlyArray<string>) {
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

const checking = prepareReadinessImage(Bun.argv.slice(2));
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
