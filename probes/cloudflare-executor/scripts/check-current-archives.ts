import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { inspectCurrentOfflineArchives } from '../src/current-archive-preflight.ts';
import { encodeInventory } from '../src/frozen-dependencies.ts';

const Args = Schema.Tuple([
  Schema.Literal('--inspect'),
  Schema.String.check(Schema.isPattern(/^\//)),
]);
const decode = Schema.decodeUnknownResult(Args);
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
const refused = Console.error(
  '{"_tag":"ArchivePreflightInputRefused","activation":"Blocked"}',
).pipe(Effect.map(() => 1));
function main(args: readonly string[]) {
  const decoded = decode(args);
  function* inspect() {
    const [, root] = yield* Effect.fromResult(decoded);
    const report = yield* inspectCurrentOfflineArchives(root);
    yield* Console.log(encodeInventory(report));
    return Match.value(report.status).pipe(
      Match.when('Refused', () => 1),
      Match.orElse(() => 2),
    );
  }
  const workflow = Effect.gen(inspect);
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
