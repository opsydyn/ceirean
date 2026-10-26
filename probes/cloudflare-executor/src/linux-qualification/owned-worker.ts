import { Effect, FileSystem, Match, Result, Schema } from 'effect';

import {
  CaseObservation,
  ControlReadbacks,
  QualificationAdmission,
  evidenceRequirements,
  requiredCases,
  strict,
  type CleanupObservation,
} from './contract.ts';
import { requireSupervisor } from './docker-process.ts';
import { WorkerEvidenceReady } from './live-handoff.ts';
import type { PreparedInputs } from './prepared-inputs.ts';
import {
  claimOwnedProducer,
  readProducerFile,
  verifyProducerFiles,
  type prepareOwnedProducer,
} from './producer.ts';
import { superviseFixedWorker } from './supervisor.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const Diagnostic = Schema.Struct({
  _tag: Schema.Literal('PendingHostFinalization'),
  activation: Schema.Literal('Blocked'),
  exitCode: Schema.Literal(0),
  observations: Schema.Array(CaseObservation),
  seedAdmission: QualificationAdmission.fields.seed,
  qualificationReceipt: Schema.Literal('NotProduced'),
});
const sameReadbacks = Schema.toEquivalence(ControlReadbacks);
const isRemoved = Schema.is(Schema.Literal('ConfirmedRemoval'));
const isPassed = Schema.is(Schema.Literal('Passed'));
const isNode = Schema.is(Schema.Literal('node'));
const decodeDiagnostic = Schema.decodeUnknownEffect(Schema.fromJsonString(Diagnostic), strict);
type Worker = Effect.Success<ReturnType<typeof superviseFixedWorker>>;

function admitProducerSeal(inputs: PreparedInputs, worker: Worker) {
  function* admit() {
    yield* requireSupervisor(
      worker.complete && worker.workerExit === 0 && isRemoved(worker.cleanup._tag),
    );
    const ready = yield* Schema.decodeUnknownEffect(
      WorkerEvidenceReady.members[0],
      strict,
    )(worker.ready);
    yield* requireSupervisor(ready.producerId === worker.producerId, 'InputChanged');
    const file = yield* readProducerFile(`${worker.evidenceRoot}/worker-diagnostic.json`, 16777216);
    const diagnosticText = yield* Effect.try(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(file.bytes),
    );
    const diagnostic = yield* decodeDiagnostic(diagnosticText);
    const observations = diagnostic.observations;
    const readbacks = yield* Schema.decodeUnknownEffect(
      ControlReadbacks.members[1],
      strict,
    )(observations[0]?.readbacks);
    const sameSeal = Schema.toEquivalence(QualificationAdmission.fields.seed);
    function boundDigests(item: CaseObservation) {
      const digests = item.digests;
      return Match.value(digests).pipe(
        Match.when({ _tag: 'Recorded' }, (value) =>
          [
            value.seedBefore === diagnostic.seedAdmission.sha256,
            value.seedAfter === diagnostic.seedAdmission.sha256,
            value.sourceBefore === inputs.admission.source.sha256,
            value.sourceAfter === inputs.admission.source.sha256,
            value.harnessSha256 === inputs.admission.request.harnessSha256,
            value.toolCapsuleSha256 === inputs.tools.sha256,
          ].every(Boolean),
        ),
        Match.orElse(() => false),
      );
    }
    const measured = [
      observations.length === 9,
      requiredCases.slice(0, 9).every((caseId, index) => observations[index]?.caseId === caseId),
      observations.every(
        (item) => isPassed(item.outcome) && sameReadbacks(item.readbacks, readbacks),
      ),
      sameSeal(ready.seedAdmission, diagnostic.seedAdmission),
      diagnostic.seedAdmission.sourceSha256 === inputs.admission.source.sha256,
      readbacks.nodeConfigSha256 === inputs.tools.nodeConfigSha256,
      readbacks.nodeExecutableSha256 ===
        inputs.tools.files.find((file) => isNode(file.path))?.sha256,
      readbacks.installerConfigSha256 === worker.installerConfigSha256,
      observations.slice(3).every(boundDigests),
    ].every(Boolean);
    yield* requireSupervisor(measured, 'InputChanged');
    yield* verifyProducerFiles(inputs);
    return { seal: diagnostic.seedAdmission, readbacks };
  }
  const workflow = Effect.gen(admit);
  return workflow;
}

function cleanupOf(workers: readonly Worker[]): CleanupObservation {
  const remaining = workers.flatMap((worker) =>
    Match.value(worker.cleanup).pipe(
      Match.when({ _tag: 'RemainingResources' }, (value) => value.resources),
      Match.orElse(() => [] as readonly string[]),
    ),
  );
  return Match.value({
    remaining: remaining.length > 0,
    confirmed: workers.every((worker) => isRemoved(worker.cleanup._tag)),
  }).pipe(
    Match.when({ remaining: true }, () => ({
      _tag: 'RemainingResources' as const,
      resources: remaining,
      evidence: ['cleanup.json'],
    })),
    Match.when({ confirmed: true }, () => ({
      _tag: 'ConfirmedRemoval' as const,
      evidence: ['cleanup.json'],
    })),
    Match.orElse(() => ({ _tag: 'Unknown' as const, evidence: ['cleanup.json'] })),
  );
}

// This composition owns the input capability, the sole active compartment and
// both fixed negative scenarios. No public booleans or case JSON finalize it.
export function superviseOwnedWorker(
  producer: Effect.Success<ReturnType<typeof prepareOwnedProducer>>,
) {
  function* supervise() {
    const inputs = yield* claimOwnedProducer(producer, producer.inputs);
    const fs = yield* FileSystem.FileSystem;
    const main = yield* superviseFixedWorker(inputs);
    const workers = [main];
    function* finalize() {
      const admitted = yield* admitProducerSeal(inputs, main);
      for (const mode of ['InterruptWarmup', 'Deadline'] as const) {
        yield* verifyProducerFiles(inputs);
        const rehearsal = yield* superviseFixedWorker(inputs, mode);
        workers.push(rehearsal);
        yield* requireSupervisor(rehearsal.rehearsal.confirmed, 'CleanupUnknown');
      }
      const cleanup = cleanupOf(workers);
      yield* requireSupervisor(isRemoved(cleanup._tag), 'CleanupUnknown');
      yield* verifyProducerFiles(inputs);
      const observation = CaseObservation.make({
        caseId: 'CancellationDeadline',
        stage: 'Cleanup',
        outcome: 'Passed',
        reason: 'CancellationConfirmed',
        evidence: ['cancellation-deadline.json'],
        readbacks: admitted.readbacks,
        digests: { _tag: 'Unknown' },
      });
      const details = workers.map((worker) => ({
        name: worker.name,
        containerId: worker.containerId,
        producerId: worker.producerId,
        mode: worker.rehearsal.mode,
        termination: worker.rehearsal.termination,
        cleanup: worker.cleanup,
        warmup: worker.rehearsal.warmup,
        pausedTop: worker.rehearsal.pausedTop,
      }));
      yield* fs.writeFileString(
        `${main.evidenceRoot}/cancellation-deadline.json`,
        encode({
          caseId: observation.caseId,
          checks: evidenceRequirements.CancellationDeadline.checks,
          observation,
          details,
        }),
        { flag: 'wx', mode: 0o600 },
      );
      return admitted.seal;
    }
    const attempted = yield* Effect.gen(finalize).pipe(Effect.result);
    const cleanup = cleanupOf(workers);
    yield* fs.writeFileString(
      `${main.evidenceRoot}/cleanup.json`,
      encode({ observation: cleanup }),
      { mode: 0o600 },
    );
    const seal = Result.getOrElse(attempted, () => undefined);
    return {
      ...main,
      complete: main.complete && Result.isSuccess(attempted),
      cleanup,
      names: workers.map((worker) => worker.name),
      seal,
    };
  }
  // One shared budget, not nine minutes per scenario. Scope finalizers still
  // perform the bounded stop/force-remove/readback if this deadline interrupts.
  const workflow = Effect.gen(supervise);
  const bounded = workflow.pipe(Effect.timeout(540000));
  return bounded;
}
