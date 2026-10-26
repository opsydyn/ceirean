import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import {
  Console,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Match,
  Result,
  Schema,
  type Runtime,
} from 'effect';

import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';
import {
  makeWorkerArchives,
  makeWorkerCases,
  makeWorkerCatalog,
  makeWorkerPlatform,
  makeWorkerProcess,
  WorkerArchives,
  WorkerCatalog,
  WorkerPlatform,
  WorkerProcess,
  WorkerError,
  writeWorkerEvidence,
} from '../src/linux-qualification/cases.ts';
import { PreparedInputs } from '../src/linux-qualification/prepared-inputs.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeInputs = Schema.decodeUnknownEffect(Schema.fromJsonString(PreparedInputs), {
  onExcessProperty: 'error',
});
const baseLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const processLayer = BunChildProcessSpawner.layer.pipe(Layer.provide(baseLayer));
const platformLayer = Layer.mergeAll(baseLayer, processLayer);
const withArchives = Effect.provideService(WorkerArchives, makeWorkerArchives());
const withCatalog = Effect.provideService(WorkerCatalog, makeWorkerCatalog());
const withProcesses = Effect.provideService(WorkerProcess, makeWorkerProcess());
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
const isCheck = Schema.is(Schema.Tuple([Schema.Literal('--check')]));
const isWorker = Schema.is(Schema.Tuple([Schema.Literal('--worker')]));

// Task 6 supplies WorkerPlatform in-process. No JSON/env field can supply it.
// This is worker evidence only, not a QualificationReceipt or cleanup admission.
export function workerEffect(inputs: PreparedInputs) {
  const workflow = makeWorkerCases().runWorkerCases(inputs);
  const provided = workflow.pipe(withArchives, withCatalog, withProcesses, withMetadata);
  return provided;
}
export function invokeWorker(args: readonly string[]) {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat('/inputs/prepared.json');
    yield* Effect.fromResult(
      Result.succeed(info.size).pipe(
        Result.filterOrFail(
          (size) => size > 0n && size <= 4194304n,
          () => new WorkerError({ code: 'EvidenceIncomplete' }),
        ),
      ),
    );
    const inputs = yield* decodeInputs(yield* fs.readFileString('/inputs/prepared.json'));
    const result = yield* workerEffect(inputs);
    yield* writeWorkerEvidence(result, '/evidence');
    yield* Console.log(
      encode({ _tag: result._tag, activation: 'Blocked', exitCode: result.exitCode }),
    );
    return result.exitCode;
  }
  const workflow = Effect.gen(run);
  const running = Effect.scoped(workflow);
  const refused = Console.error(
    '{"_tag":"WorkerIncomplete","activation":"Blocked","reason":"EvidenceIncomplete"}',
  ).pipe(Effect.map(() => 1));
  const execution = running.pipe(Effect.catch(() => refused));
  const checking = Console.log(
    '{"_tag":"WorkerIncomplete","activation":"Blocked","reason":"BlockedChildObservation","qualificationReceipt":"NotProduced"}',
  ).pipe(Effect.map(() => 1));
  const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
  return Match.value(args).pipe(
    Match.when(isCheck, () => checking),
    Match.when(isWorker, () => execution),
    Match.orElse(() => usage),
  );
}
const withUnavailablePlatform = Effect.provideService(WorkerPlatform, makeWorkerPlatform());
const withNativePlatform = Effect.provide(platformLayer);
const workflow = invokeWorker(process.argv.slice(2));
export const program = workflow.pipe(withUnavailablePlatform, withNativePlatform);
const teardown: Runtime.Teardown = (exit, onExit) => {
  Exit.match(exit, { onSuccess: (value) => onExit(Number(value)), onFailure: () => onExit(1) });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
