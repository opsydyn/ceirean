import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunStdio from '@effect/platform-bun/BunStdio';
import { Effect, Exit, Layer, Stdio, Stream, type Runtime } from 'effect';

import { invokeReadinessWorker } from '../src/linux-qualification/readiness-worker.ts';

function* run() {
  const frame = yield* invokeReadinessWorker(process.argv.slice(2));
  const stdio = yield* Stdio.Stdio;
  yield* Stream.run(Stream.fromIterable([new TextEncoder().encode(frame)]), stdio.stdout());
}
const platform = Layer.mergeAll(BunFileSystem.layer, BunStdio.layer);
const withPlatform = Effect.provide(platform);
const workflow = Effect.gen(run);
export const program = workflow.pipe(withPlatform);
const teardown: Runtime.Teardown = (exit, onExit) => {
  Exit.match(exit, { onSuccess: () => onExit(0), onFailure: () => onExit(1) });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
