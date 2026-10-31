import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Effect, Exit, Schema, Stdio, type Runtime } from 'effect';

import { currentCiCheck } from '../src/current-ci-controller.ts';

function* check() {
  const stdio = yield* Stdio.Stdio;
  const result = currentCiCheck(yield* stdio.args);
  const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
  yield* Console.log(encode(result));
  return result.code;
}
const workflow = Effect.gen(check);
export const program = Effect.provide(workflow, NodeServices.layer);
const teardown: Runtime.Teardown = (exit, onExit) => {
  Exit.match(exit, { onSuccess: (code) => onExit(Number(code)), onFailure: () => onExit(1) });
};
NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
