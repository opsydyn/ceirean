import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { prepareCurrentNpm } from '../src/current-npm-capture.ts';
import { encodeInventory } from '../src/frozen-dependencies.ts';

const Args = Schema.Tuple([
  Schema.String.check(Schema.isPattern(/^\//)),
  Schema.String.check(Schema.isPattern(/^\//)),
]);
const decode = Schema.decodeUnknownResult(Args);
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
const refused = Console.error(
  '{"_tag":"CurrentNpmPreparationRefused","activation":"Blocked"}',
).pipe(Effect.map(() => 1));
function main(args: readonly string[]) {
  const decoded = decode(args);
  function* prepare() {
    const [repository, node] = yield* Effect.fromResult(decoded);
    const report = yield* prepareCurrentNpm(repository, node, fetch);
    yield* Console.log(encodeInventory(report));
    return 2;
  }
  const workflow = Effect.gen(prepare);
  const running = workflow.pipe(Effect.catch(() => refused));
  return Match.value(Result.isSuccess(decoded)).pipe(
    Match.when(true, () => running),
    Match.orElse(() => usage),
  );
}
const workflow = main(Bun.argv.slice(2));
export const program = Effect.provide(workflow, BunServices.layer);
const exitCode = Schema.decodeUnknownResult(Schema.Literals([1, 2, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  Exit.match(exit, {
    onSuccess: (value) => {
      const decoded = exitCode(value);
      onExit(Result.getOrElse(decoded, () => 1));
    },
    onFailure: () => onExit(1),
  });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
