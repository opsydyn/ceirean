import { Clock, Context, Effect, Match, Result, Schema } from 'effect';

import {
  QualificationRequest,
  QualificationReason,
  decodeRequest,
  strict,
  type CleanupObservation,
} from './contract.ts';
import { SupervisorError, requireSupervisor } from './docker-process.ts';
import { QualificationOutput } from './durable-output.ts';
import { admitEvidenceFiles } from './evidence-files.ts';
import { superviseOwnedWorker } from './owned-worker.ts';
import { prepareOwnedProducer } from './producer.ts';
import { makeReceipt, qualificationExitCode } from './receipt.ts';

// No approval document, environment, or public JSON can create these capabilities.
// A future reviewed adapter must supply their actual implementations in-process.
export function makeQualificationAuthority() {
  function reviewedRun() {
    const refused = Effect.fail(new SupervisorError({ code: 'BlockedRuntime' }));
    const decoded = Schema.decodeUnknownEffect(QualificationRequest, strict)(undefined);
    const workflow = refused.pipe(Effect.andThen(decoded));
    return workflow;
  }
  function preflight(_request: QualificationRequest) {
    const refused = Effect.fail(new SupervisorError({ code: 'BlockedChildObservation' }));
    const workflow = refused.pipe(Effect.asVoid);
    return workflow;
  }
  return { reviewedRun, preflight };
}
export class QualificationAuthority extends Context.Service<
  QualificationAuthority,
  ReturnType<typeof makeQualificationAuthority>
>()('ceirean/QualificationAuthority') {}
const sameRequest = Schema.toEquivalence(QualificationRequest);
const isCheck = Schema.is(Schema.Tuple([Schema.Literal('--check')]));
const isRun = Schema.is(Schema.Tuple([Schema.Literal('--run')]));
const decodeFailure = Schema.decodeUnknownResult(Schema.Struct({ code: QualificationReason }));
const incomplete = (reason: string) =>
  ({
    exitCode: 1,
    diagnostic: {
      _tag: 'QualificationIncomplete',
      activation: 'Blocked',
      reason,
      qualificationReceipt: 'NotProduced',
    },
  }) as const;
export function runQualification(request: QualificationRequest) {
  const state: { cleanup: CleanupObservation; resources: string[] } = {
    cleanup: { _tag: 'Unknown', evidence: [] },
    resources: [],
  };
  function* produce() {
    const authority = yield* QualificationAuthority;
    const decoded = yield* decodeRequest(request);
    const approved = yield* authority.reviewedRun();
    yield* requireSupervisor(sameRequest(decoded, approved), 'InputChanged');
    yield* authority.preflight(decoded);
    const producer = yield* prepareOwnedProducer(decoded);
    const inputs = producer.inputs;
    yield* requireSupervisor(sameRequest(inputs.admission.request, decoded), 'InputChanged');
    const worker = yield* superviseOwnedWorker(producer);
    state.cleanup = worker.cleanup;
    state.resources = worker.names;
    const complete = [worker.complete, worker.workerExit === 0].every(Boolean);
    yield* requireSupervisor(complete);
    const files = yield* admitEvidenceFiles(
      inputs,
      worker.evidenceRoot,
      worker.cleanup,
      worker.seal,
    );
    const receipt = yield* makeReceipt(
      decoded,
      files.observations,
      worker.cleanup,
      files.admission,
    );
    const exitCode = qualificationExitCode(receipt, files.admission);
    yield* requireSupervisor(exitCode === 0);
    return { decoded, worker, files, receipt, exitCode };
  }
  function* run() {
    const started = yield* Clock.currentTimeMillis;
    // 12 minutes for acquisition/supervision/admission; two for cleanup and
    // one for delivery. The worker/rehearsals retain their shared 9-minute cap.
    const producing = Effect.gen(produce);
    const produced = yield* producing.pipe(Effect.timeout(720000));
    const remaining = started + 900000 - (yield* Clock.currentTimeMillis);
    yield* requireSupervisor(remaining > 10000);
    const output = yield* QualificationOutput;
    const outputDirectory = yield* output
      .deliver(produced.worker.evidenceRoot, produced.receipt, produced.files)
      .pipe(Effect.timeout(Math.min(50000, remaining - 10000)));
    return {
      exitCode: produced.exitCode,
      receipt: produced.receipt,
      admission: produced.files.admission,
      outputDirectory,
    };
  }
  const workflow = Effect.gen(run);
  const attempted = workflow.pipe(Effect.scoped, Effect.timeout(900000), Effect.result);
  function failed(error: unknown) {
    const decoded = decodeFailure(error);
    const reason = Result.match(decoded, {
      onSuccess: (value) => value.code,
      onFailure: () => 'EvidenceIncomplete',
    });
    return { ...incomplete(reason), cleanup: state.cleanup, resources: state.resources };
  }
  const reported = attempted.pipe(
    Effect.map((result) =>
      Result.match(result, {
        onSuccess: (value) => value,
        onFailure: failed,
      }),
    ),
  );
  return reported;
}
export function invokeQualification(args: readonly string[]) {
  const check = Effect.succeed(incomplete('MissingReviewedWorksheetObserverControlsAndProvenance'));
  function* refuseRun() {
    // The executable has no admitted worksheet/provider yet. Refuse before
    // requiring host acquisition, Docker, or filesystem services.
    const result = yield* makeQualificationAuthority().reviewedRun().pipe(Effect.result);
    return Result.match(result, {
      onFailure: () => incomplete('MissingReviewedWorksheet'),
      onSuccess: () => incomplete('MissingReviewedCapabilityProvider'),
    });
  }
  const run = Effect.gen(refuseRun);
  return Match.value(args).pipe(
    Match.when(isCheck, () => check),
    Match.when(isRun, () => run),
    Match.orElse(() => Effect.succeed({ ...incomplete('UnsupportedInvocation'), exitCode: 64 })),
  );
}
