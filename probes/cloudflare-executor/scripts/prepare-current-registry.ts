import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import {
  currentDependencyInventory,
  prepareCurrentRegistryCandidates,
} from '../src/current-dependencies.ts';
import { encodeInventory } from '../src/frozen-dependencies.ts';

const Args = Schema.Tuple([
  Schema.Literals(['--inspect', '--prepare']),
  Schema.String.check(Schema.isPattern(/^\//)),
]);
const decode = Schema.decodeUnknownResult(Args);
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
const refused = Console.error(
  '{"_tag":"CurrentRegistryPreparationRefused","activation":"Blocked"}',
).pipe(Effect.map(() => 1));
function main(args: readonly string[]) {
  const decoded = decode(args);
  function* prepare() {
    const [mode, repository] = yield* Effect.fromResult(decoded);
    function* inspect() {
      const inventory = yield* currentDependencyInventory(repository);
      return {
        _tag: inventory._tag,
        activation: inventory.activation,
        source: inventory.source,
        selected: inventory.consumer.selected,
        excluded: inventory.consumer.excluded,
        workspaces: inventory.consumer.workspaces.length,
        artifacts: inventory.artifacts.length,
        generatedNpmClosure: inventory.generatedNpmClosure,
        linuxInstall: inventory.linuxInstall,
      };
    }
    function* acquire() {
      const report = yield* prepareCurrentRegistryCandidates(repository, fetch);
      return {
        _tag: report._tag,
        activation: report.activation,
        image: report.image,
        directory: report.directory,
        source: report.source,
        artifacts: report.artifacts,
        registryBytes: report.registryBytes,
        storage: report.storage,
        inventorySha256: report.inventorySha256,
        blockers: report.blockers,
      };
    }
    const operation = Match.value(mode).pipe(
      Match.when('--inspect', () => Effect.gen(inspect)),
      Match.orElse(() => Effect.gen(acquire)),
    );
    const report = yield* operation;
    yield* Console.log(encodeInventory(report));
    return 2;
  }
  const preparation = Effect.gen(prepare);
  const scoped = Effect.scoped(preparation);
  const running = scoped.pipe(Effect.catch(() => refused));
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
