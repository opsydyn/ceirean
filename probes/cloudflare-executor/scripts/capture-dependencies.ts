import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { captureDependencyInputs } from '../src/dependency-capture.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const Args = Schema.Tuple([
  Schema.Literal('--source-repository'),
  Schema.String.check(Schema.isPattern(/^\//)),
]);
const decode = Schema.decodeUnknownResult(Args);
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
const refused = Console.error('{"_tag":"InventoryCaptureRefused","activation":"Blocked"}').pipe(
  Effect.map(() => 1),
);
function main(argv: readonly string[]) {
  const args = decode(argv);
  function* capture() {
    const [, source] = yield* Effect.fromResult(args);
    const result = yield* captureDependencyInputs(source);
    yield* Console.log(encode(result));
    return 2;
  }
  const running = Effect.gen(capture);
  const capturing = running.pipe(Effect.catch(() => refused));
  const workflow = Match.value(Result.isSuccess(args)).pipe(
    Match.when(true, () => capturing),
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
