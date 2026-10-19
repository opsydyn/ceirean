import { Match, Result, Schema } from 'effect';

import { CandidateIdentity, NonNegativeSafeInteger } from './identities.ts';
import {
  QualificationRefusal,
  VerificationContract,
  VerificationReceipt,
  validateReceipt,
} from './verification.ts';

export const RunLimits = Schema.Struct({
  deadlineMs: NonNegativeSafeInteger,
  spentMicros: NonNegativeSafeInteger,
  repairs: NonNegativeSafeInteger,
});
export type RunLimits = typeof RunLimits.Type;

const frozenFields = { ...CandidateIdentity.fields, ...RunLimits.fields };
export const FrozenRun = Schema.TaggedStruct('Frozen', frozenFields);
export type FrozenRun = typeof FrozenRun.Type;
export const QualifiedRun = Schema.TaggedStruct('Qualified', {
  ...frozenFields,
  receipt: VerificationReceipt,
  qualifiedAtMs: NonNegativeSafeInteger,
});
export type QualifiedRun = typeof QualifiedRun.Type;
export const CancelledRun = Schema.TaggedStruct('Cancelled', {
  ...frozenFields,
  cancelledAtMs: NonNegativeSafeInteger,
});
export type CancelledRun = typeof CancelledRun.Type;
export const UpgradeRun = Schema.Union([FrozenRun, QualifiedRun, CancelledRun]);
export type UpgradeRun = typeof UpgradeRun.Type;

export const RunQualified = Schema.TaggedStruct('RunQualified', {
  ...CandidateIdentity.fields,
  receipt: VerificationReceipt,
  atMs: NonNegativeSafeInteger,
});
export type RunQualified = typeof RunQualified.Type;
export const RunCancelled = Schema.TaggedStruct('RunCancelled', {
  runId: CandidateIdentity.fields.runId,
  attemptId: CandidateIdentity.fields.attemptId,
  generation: NonNegativeSafeInteger,
  atMs: NonNegativeSafeInteger,
});
export type RunCancelled = typeof RunCancelled.Type;
export const RunFact = Schema.Union([RunQualified, RunCancelled]);
export type RunFact = typeof RunFact.Type;

const Refused = Schema.TaggedStruct('Refused', {
  state: UpgradeRun,
  facts: Schema.Tuple([]),
  refusal: QualificationRefusal,
});
const QualificationDecision = Schema.Union([
  Schema.TaggedStruct('Accepted', { state: QualifiedRun, facts: Schema.Tuple([RunQualified]) }),
  Refused,
]);
const CancellationDecision = Schema.Union([
  Schema.TaggedStruct('Accepted', { state: CancelledRun, facts: Schema.Tuple([RunCancelled]) }),
  Refused,
]);

function checkFrozen(run: UpgradeRun): Result.Result<FrozenRun, QualificationRefusal> {
  return Match.value(run).pipe(
    Match.tag('Frozen', (state) => Result.succeed(state)),
    Match.tag('Cancelled', () =>
      Result.fail({ _tag: 'InvalidPhase' as const, phase: 'Cancelled' }),
    ),
    Match.tag('Qualified', () =>
      Result.fail({ _tag: 'InvalidPhase' as const, phase: 'Qualified' }),
    ),
    Match.exhaustive,
  );
}

function checkTime(nowMs: number): Result.Result<number, QualificationRefusal> {
  const decoded = Schema.decodeUnknownResult(NonNegativeSafeInteger)(nowMs);
  return Result.mapError(decoded, () => ({
    _tag: 'InvalidTime' as const,
  }));
}

export function checkEligibility(
  run: UpgradeRun,
  nowMs: number,
): Result.Result<FrozenRun, QualificationRefusal> {
  function* eligibility() {
    const frozen = yield* checkFrozen(run);
    yield* checkTime(nowMs);
    return yield* Match.value(nowMs >= frozen.deadlineMs).pipe(
      Match.when(true, () => Result.fail({ _tag: 'DeadlineExpired' as const })),
      Match.when(false, () => Result.succeed(frozen)),
      Match.exhaustive,
    );
  }
  return Result.gen(eligibility);
}

function refuse(state: UpgradeRun, refusal: QualificationRefusal): typeof Refused.Type {
  return { _tag: 'Refused', state, facts: [], refusal };
}

export function decideQualification(
  run: UpgradeRun,
  contract: VerificationContract,
  receipt: VerificationReceipt,
  nowMs: number,
): typeof QualificationDecision.Type {
  function* qualification() {
    const frozen = yield* checkEligibility(run, nowMs);
    const evidence = yield* validateReceipt(frozen, contract, receipt);
    return { frozen, evidence };
  }
  const validated = Result.gen(qualification);
  return Result.match(validated, {
    onFailure: (refusal) => refuse(run, refusal),
    onSuccess: ({ frozen, evidence }) => ({
      _tag: 'Accepted',
      state: { ...frozen, _tag: 'Qualified', receipt: evidence, qualifiedAtMs: nowMs },
      facts: [
        {
          _tag: 'RunQualified',
          runId: frozen.runId,
          attemptId: frozen.attemptId,
          generation: frozen.generation,
          candidateDigest: frozen.candidateDigest,
          contractId: frozen.contractId,
          contractDigest: frozen.contractDigest,
          receipt: evidence,
          atMs: nowMs,
        },
      ],
    }),
  });
}

export function decideCancellation(
  run: UpgradeRun,
  nowMs: number,
): typeof CancellationDecision.Type {
  function* cancellation() {
    const frozen = yield* checkFrozen(run);
    yield* checkTime(nowMs);
    return frozen;
  }
  const validated = Result.gen(cancellation);
  return Result.match(validated, {
    onFailure: (refusal) => refuse(run, refusal),
    onSuccess: (frozen) => ({
      _tag: 'Accepted',
      state: { ...frozen, _tag: 'Cancelled', cancelledAtMs: nowMs },
      facts: [
        {
          _tag: 'RunCancelled',
          runId: frozen.runId,
          attemptId: frozen.attemptId,
          generation: frozen.generation,
          atMs: nowMs,
        },
      ],
    }),
  });
}
