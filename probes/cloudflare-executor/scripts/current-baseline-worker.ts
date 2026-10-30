import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { currentBaseline } from '../src/current-baseline.ts';
import {
  CurrentBaselinePlatform,
  makeCurrentBaselinePlatform,
  runCurrentBaseline,
} from '../src/current-worker.ts';
import { encodeInventory } from '../src/frozen-dependencies.ts';

const isCheck = Schema.is(Schema.Tuple([Schema.Literal('--check')]));
const isWorker = Schema.is(Schema.Tuple([Schema.Literal('--worker')]));
const native = makeCurrentBaselinePlatform();
const withWorker = Effect.provideService(CurrentBaselinePlatform, native);
const refused = Console.error(
  '{"_tag":"CurrentBaselineIncomplete","activation":"Blocked","reason":"AdmissionUnavailable"}',
).pipe(Effect.map(() => 1));
function invoke(args: readonly string[]) {
  const contract = currentBaseline();
  const checking = Console.log(
    encodeInventory({
      _tag: 'CurrentWorkerPrepared',
      activation: 'Blocked',
      execution: 'Disabled',
      sourceSha: contract.source.sha,
      requiredChecks: contract.checks.length,
      browserCases: contract.browserCases.length,
    }),
  ).pipe(Effect.map(() => 2));
  const workflow = runCurrentBaseline();
  const provided = workflow.pipe(withWorker);
  const running = provided.pipe(
    Effect.map(() => 2),
    Effect.catch(() => refused),
  );
  const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
  return Match.value(args).pipe(
    Match.when(isCheck, () => checking),
    Match.when(isWorker, () => running),
    Match.orElse(() => usage),
  );
}
const workflow = invoke(Bun.argv.slice(2));
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
