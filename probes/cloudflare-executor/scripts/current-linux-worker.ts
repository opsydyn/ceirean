import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Console, Effect, Exit, Layer, Result, Ref, Schema, Stdio, type Runtime } from 'effect';

import { inspectCurrentOfflineArchives } from '../src/current-archive-preflight.ts';
import {
  attemptCurrentLinuxCacheOnly,
  runCurrentLinuxCacheOnly,
  type CurrentLinuxWorkspace,
} from '../src/current-linux-worker.ts';
import { getInertArchiveOwnership } from '../src/inert-archive-ownership.ts';
import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function run(progress: Ref.Ref<string>, workspace: CurrentLinuxWorkspace) {
  function* execute() {
    const ownership = yield* getInertArchiveOwnership();
    const inspected = yield* inspectCurrentOfflineArchives('/inputs', ownership);
    yield* Console.error(encode(inspected));
    const Admission = Schema.Struct({
      status: Schema.Literal('Inspected'),
      admitted: Schema.Number,
      total: Schema.Number,
    });
    yield* Schema.decodeUnknownEffect(Admission)(inspected);
    const complete = Result.succeed(inspected).pipe(
      Result.filterOrFail(
        (value) => value.total > 0 && value.admitted === value.total,
        () => ({ _tag: 'ArchiveAdmissionIncomplete' as const }),
      ),
    );
    yield* Effect.fromResult(complete);
    return yield* runCurrentLinuxCacheOnly(progress, workspace);
  }
  const workflow = Effect.gen(execute);
  return workflow;
}
function* invoke() {
  const stdio = yield* Stdio.Stdio;
  const args = yield* stdio.args;
  return yield* attemptCurrentLinuxCacheOnly(args, run);
}
const workflow = Effect.gen(invoke);
const cacheMetadata = Layer.succeed(CacheMetadata, makeCacheMetadata());
const services = Layer.merge(NodeServices.layer, cacheMetadata);
export const program = Effect.provide(workflow, services);
const exitCode = Schema.decodeUnknownResult(Schema.Literals([0, 1, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  Exit.match(exit, {
    onSuccess: (value) => {
      const decoded = exitCode(value);
      onExit(Result.getOrElse(decoded, () => 1));
    },
    onFailure: () => onExit(1),
  });
};
NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
