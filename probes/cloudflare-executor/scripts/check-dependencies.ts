import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { requireInventory } from '../src/dependency-inventory.ts';
import {
  encodeInventory,
  frozenDependencyInventory,
  inventoryDirectory,
} from '../src/frozen-dependencies.ts';
import { sha256 } from '../src/preparation.ts';
import { readBounded } from '../src/runner-input.ts';

const isCheck = Schema.is(Schema.Tuple([Schema.Literal('--check')]));
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
const refused = Console.error('{"_tag":"InventoryCheckRefused","activation":"Blocked"}').pipe(
  Effect.map(() => 1),
);
function* check() {
  const report = yield* frozenDependencyInventory();
  const expected = encodeInventory(report) + '\n';
  const file = decodeURIComponent(new URL('inventory.lock', inventoryDirectory).pathname);
  const actual = yield* readBounded(file, 2097152);
  yield* requireInventory(actual === expected, 'InputChanged');
  yield* Console.log(
    encodeInventory({
      _tag: report._tag,
      activation: report.activation,
      sourceRevision: report.source.revision,
      bun: {
        selected: report.bun.selected.length,
        excluded: report.bun.excluded.length,
        workspaces: report.bun.workspaces.length,
      },
      npm: report.npm.map((profile) => ({
        profile: profile.profile,
        selected: profile.selected.length,
        excluded: profile.excluded.length,
      })),
      browser: report.browser.packages.selected.length,
      artifacts: report.artifacts.length,
      inventorySha256: yield* sha256(actual),
      blockers: report.blockers,
    }),
  );
  return 2;
}
function main(argv: readonly string[]) {
  const checkingInputs = Effect.gen(check);
  const running = Effect.scoped(checkingInputs);
  const checking = running.pipe(Effect.catch(() => refused));
  const workflow = Match.value(isCheck(argv)).pipe(
    Match.when(true, () => checking),
    Match.orElse(() => usage),
  );
  return workflow;
}
const workflow = main(Bun.argv.slice(2));
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
