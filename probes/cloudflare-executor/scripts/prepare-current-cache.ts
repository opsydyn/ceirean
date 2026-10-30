import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import {
  prepareCurrentOfflineCaches,
  verifyRetainedRegistryInputs,
} from '../src/current-cache-preparer.ts';
import { currentOfflineCachePlan } from '../src/current-cache.ts';
import { encodeInventory } from '../src/frozen-dependencies.ts';

const absolute = Schema.String.check(Schema.isPattern(/^\//));
const Args = Schema.Tuple([
  Schema.Literals(['--inspect', '--prepare']),
  absolute,
  absolute,
  absolute,
]);
const decode = Schema.decodeUnknownResult(Args);
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
const refused = Console.error(
  '{"_tag":"CurrentCachePreparationRefused","activation":"Blocked"}',
).pipe(Effect.map(() => 1));
function main(args: readonly string[]) {
  const decoded = decode(args);
  function* prepare() {
    const [mode, repository, retained, node] = yield* Effect.fromResult(decoded);
    function* inspect() {
      const plan = yield* currentOfflineCachePlan(repository);
      yield* verifyRetainedRegistryInputs(retained, plan.base);
      return {
        _tag: 'CurrentOfflineCachePlan',
        activation: plan.activation,
        artifacts: plan.artifacts.length,
        reused: plan.reused,
        missing: plan.missing,
        npmSnapshotSha256: plan.npmSnapshotSha256,
        linuxInstall: 'Unqualified',
      };
    }
    const operation = Match.value(mode).pipe(
      Match.when('--inspect', () => Effect.gen(inspect)),
      Match.orElse(() => prepareCurrentOfflineCaches(repository, retained, node, fetch)),
    );
    const report = yield* operation;
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
