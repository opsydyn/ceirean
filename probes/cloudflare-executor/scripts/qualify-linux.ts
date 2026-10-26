import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Console, Effect, Exit, Schema, type Runtime } from 'effect';

import { invokeQualification } from '../src/linux-qualification/controller.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function* invoke() {
  const result = yield* invokeQualification(process.argv.slice(2));
  yield* Console.log(encode(result.diagnostic));
  return result.exitCode;
}
const program = Effect.gen(invoke);
const teardown: Runtime.Teardown = (exit, onExit) =>
  Exit.match(exit, { onSuccess: (code) => onExit(Number(code)), onFailure: () => onExit(1) });
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
