import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunStdio from '@effect/platform-bun/BunStdio';
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

import { WorkerPlatform, WorkerError } from '../src/linux-qualification/cases.ts';
import { runControllerWorker } from '../src/linux-qualification/controller-worker.ts';
import {
  ControlNegatives,
  ControlProbeIO,
  makeControlNegatives,
  makeControlProbeIO,
} from '../src/linux-qualification/controls.ts';
import type { WorkerMode } from '../src/linux-qualification/live-handoff.ts';
import { PreparedInputs } from '../src/linux-qualification/prepared-inputs.ts';
import { makeProductionWorkerPlatform } from '../src/linux-qualification/worker-platform.ts';

const decodeInputs = Schema.decodeUnknownEffect(Schema.fromJsonString(PreparedInputs), {
  onExcessProperty: 'error',
});
const baseLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, BunStdio.layer);
const processLayer = BunChildProcessSpawner.layer.pipe(Layer.provide(baseLayer));
const platformLayer = Layer.mergeAll(baseLayer, processLayer);
const isCheck = Schema.is(Schema.Tuple([Schema.Literal('--check')]));
const isWorker = Schema.is(Schema.Tuple([Schema.Literal('--worker')]));
const isWarmupRehearsal = Schema.is(Schema.Tuple([Schema.Literal('--rehearse-interrupt-warmup')]));
const isDeadlineRehearsal = Schema.is(Schema.Tuple([Schema.Literal('--rehearse-deadline')]));

// Task 6 supplies WorkerPlatform in-process. No JSON/env field can supply it.
// This is worker evidence only, not a QualificationReceipt or cleanup admission.
export function workerEffect(inputs: PreparedInputs, mode: WorkerMode = 'Qualification') {
  const workflow = runControllerWorker(inputs, mode);
  return workflow;
}
export function invokeWorker(args: readonly string[]) {
  function run(mode: WorkerMode) {
    function* execute() {
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
      const result = yield* workerEffect(inputs, mode);
      return result.exitCode;
    }
    const execution = Effect.gen(execute);
    return execution;
  }
  const mode = Match.value(args).pipe(
    Match.when(isWarmupRehearsal, () => 'InterruptWarmup' as const),
    Match.when(isDeadlineRehearsal, () => 'Deadline' as const),
    Match.orElse(() => 'Qualification' as const),
  );
  const workflow = run(mode);
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
    Match.when(isWarmupRehearsal, () => execution),
    Match.when(isDeadlineRehearsal, () => execution),
    Match.orElse(() => usage),
  );
}
const negatives = makeControlNegatives();
const probeIO = makeControlProbeIO();
const controlLayer = Layer.mergeAll(
  Layer.succeed(ControlNegatives, negatives),
  Layer.succeed(ControlProbeIO, probeIO),
);
const productionPlatform = makeProductionWorkerPlatform();
const workerDependencies = Layer.mergeAll(platformLayer, controlLayer);
const unprovidedWorkerLayer = Layer.effect(WorkerPlatform, productionPlatform);
const workerLayer = unprovidedWorkerLayer.pipe(Layer.provide(workerDependencies));
const withProductionPlatform = Effect.provide(workerLayer);
const withNativePlatform = Effect.provide(platformLayer);
const workflow = invokeWorker(process.argv.slice(2));
export const program = workflow.pipe(withProductionPlatform, withNativePlatform);
const teardown: Runtime.Teardown = (exit, onExit) => {
  Exit.match(exit, { onSuccess: (value) => onExit(Number(value)), onFailure: () => onExit(1) });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
