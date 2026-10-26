import { Effect, FileSystem, Schema } from 'effect';

import { CacheMetadata, makeCacheMetadata } from './cache.ts';
import {
  WorkerArchives,
  WorkerCatalog,
  WorkerProcess,
  makeWorkerArchives,
  makeWorkerCases,
  makeWorkerCatalog,
  makeWorkerProcess,
  writeWorkerEvidence,
} from './cases.ts';
import { requireSupervisor } from './docker-process.ts';
import {
  ProducerExecution,
  publishEvidenceAndAwaitCollection,
  type WorkerMode,
} from './live-handoff.ts';
import type { PreparedInputs } from './prepared-inputs.ts';
const isInputs = Schema.is(Schema.Literal('/inputs'));
const isEvidence = Schema.is(Schema.Literal('/work/evidence'));
const isQualification = Schema.is(Schema.Literal('Qualification'));

// Library composition, not an import of the executable runMain entrypoint.
// WorkerPlatform stays required: neither files nor environment can provide it.
export function runControllerWorker(inputs: PreparedInputs, mode: WorkerMode = 'Qualification') {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    yield* requireSupervisor(isInputs(inputs.root), 'InputChanged');
    const execution = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProducerExecution), {
      onExcessProperty: 'error',
    })(yield* fs.readFileString(`/inputs/producer-${mode}.json`));
    const sameRequest = Schema.toEquivalence(ProducerExecution.fields.request);
    yield* requireSupervisor(
      sameRequest(execution.request, inputs.admission.request) && execution.mode === mode,
      'InputChanged',
    );
    yield* fs.makeDirectory('/work/evidence', { mode: 0o700 });
    const target = yield* fs.realPath('/work/evidence');
    yield* requireSupervisor(isEvidence(target), 'BlockedControls');
    const running = makeWorkerCases().runWorkerCases(inputs);
    const result = yield* running.pipe(
      Effect.provideService(WorkerProcess, makeWorkerProcess(execution, inputs)),
    );
    yield* requireSupervisor(isQualification(mode));
    yield* writeWorkerEvidence(result, target);
    yield* publishEvidenceAndAwaitCollection(inputs, result, execution.producerId);
    return result;
  }
  const workflow = Effect.gen(run);
  const withArchives = Effect.provideService(WorkerArchives, makeWorkerArchives());
  const withCatalog = Effect.provideService(WorkerCatalog, makeWorkerCatalog());
  const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
  const provided = workflow.pipe(withArchives, withCatalog, withMetadata);
  return provided;
}
