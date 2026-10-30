import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { prepareCurrentPayloadInputs } from '../src/current-inputs.ts';
import { preparePayloadInputs } from '../src/payload-preparer.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const Args = Schema.Tuple([
  Schema.Literals(['--source-repository', '--current-source-repository']),
  Schema.String.check(Schema.isPattern(/^\//)),
]);
const decodeArgs = Schema.decodeUnknownResult(Args);
function usage() {
  const workflow = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
  return workflow;
}
function failure() {
  const workflow = Console.error(
    '{"_tag":"PayloadPreparationRefused","activation":"Blocked"}',
  ).pipe(Effect.map(() => 1));
  return workflow;
}
function prepare(args: ReadonlyArray<string>) {
  const decoded = decodeArgs(args);
  function* run() {
    const [mode, repository] = yield* Effect.fromResult(decoded);
    const preparation = Match.value(mode).pipe(
      Match.when('--current-source-repository', () => prepareCurrentPayloadInputs(repository)),
      Match.orElse(() => preparePayloadInputs(repository)),
    );
    const report = yield* preparation;
    yield* Console.log(encode(report));
    return 2;
  }
  const running = Effect.gen(run);
  const preparation = running.pipe(Effect.catch(failure));
  const workflow = Match.value(Result.isSuccess(decoded)).pipe(
    Match.when(true, () => preparation),
    Match.orElse(usage),
  );
  return workflow;
}
const workflow = prepare(Bun.argv.slice(2));
export const program = Effect.provide(workflow, BunServices.layer);
const decodeExit = Schema.decodeUnknownResult(Schema.Literals([1, 2, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  function completed(value: unknown) {
    const result = decodeExit(value);
    const code = result.pipe(Result.getOrElse(() => 1));
    onExit(code);
  }
  Exit.match(exit, { onSuccess: completed, onFailure: () => onExit(1) });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
