import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, FileSystem, Match, Result, Schema, type Runtime } from 'effect';

import { requireInventory } from '../src/dependency-inventory.ts';
import { dependencyPins } from '../src/dependency-pins.ts';
import {
  encodeInventory,
  frozenDependencyInventory,
  inventoryDirectory,
} from '../src/frozen-dependencies.ts';
import { sha256 } from '../src/preparation.ts';
import { readBounded } from '../src/runner-input.ts';

const Args = Schema.Tuple([
  Schema.Literal('--capture-directory'),
  Schema.String.check(Schema.isPattern(/^\//)),
]);
const decode = Schema.decodeUnknownResult(Args);
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
const refused = Console.error('{"_tag":"InventorySealRefused","activation":"Blocked"}').pipe(
  Effect.map(() => 1),
);
function seal(argv: readonly string[]) {
  const args = decode(argv);
  function* write() {
    const [, directory] = yield* Effect.fromResult(args);
    const fs = yield* FileSystem.FileSystem;
    const target = decodeURIComponent(inventoryDirectory.pathname);
    yield* fs.makeDirectory(target, { recursive: true });
    for (const [name, expected] of Object.entries(dependencyPins.inputs)) {
      const text = yield* readBounded(`${directory}/${name}`, 2097152);
      const actual = yield* sha256(text);
      yield* requireInventory(actual === expected, 'InputChanged');
      yield* fs.writeFileString(`${target}/${name}`, text);
    }
    const report = yield* frozenDependencyInventory();
    const encoded = encodeInventory(report);
    yield* fs.writeFileString(`${target}/inventory.lock`, encoded + '\n');
    yield* Console.log(
      encodeInventory({
        _tag: report._tag,
        activation: report.activation,
        artifactCount: report.artifacts.length,
        inventorySha256: yield* sha256(encoded + '\n'),
      }),
    );
    return 2;
  }
  const sealing = Effect.gen(write);
  const running = Effect.scoped(sealing);
  const writing = running.pipe(Effect.catch(() => refused));
  const workflow = Match.value(Result.isSuccess(args)).pipe(
    Match.when(true, () => writing),
    Match.orElse(() => usage),
  );
  return workflow;
}
const workflow = seal(Bun.argv.slice(2));
export const program = Effect.provide(workflow, BunServices.layer);
const exitCode = Schema.decodeUnknownResult(Schema.Literals([1, 2, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  function completed(value: unknown) {
    const decoded = exitCode(value);
    const code = decoded.pipe(Result.getOrElse(() => 1));
    onExit(code);
  }
  Exit.match(exit, { onSuccess: completed, onFailure: () => onExit(1) });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
