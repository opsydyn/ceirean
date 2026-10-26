import { Effect, Match, Result, Schema } from 'effect';

import {
  ControlReadbacks,
  QualificationReceipt,
  decodeRequest,
  requiredCases,
  strict,
  type CaseObservation,
  type CleanupObservation,
  type QualificationReason,
  type QualificationRequest,
} from './contract.ts';
import { inputPins } from './tool-pins.ts';

const expected = {
  RuntimeIsolationPreflight: { stage: 'Preflight', reason: 'Verified' },
  ArchiveAdmissionNegatives: { stage: 'Admission', reason: 'ArchiveRefused' },
  ScriptCanaries: { stage: 'Canaries', reason: 'ScriptsSuppressed' },
  Warmup: { stage: 'Warmup', reason: 'CacheMaterialized' },
  FreshPositive: { stage: 'Offline', reason: 'InstalledFromCache' },
  EmptyCache: { stage: 'Offline', reason: 'EmptyCacheRefused' },
  MissingRequiredArtifact: { stage: 'Offline', reason: 'MissingArtifactRefused' },
  CorruptCacheContent: { stage: 'Admission', reason: 'CacheIntegrityRefused' },
  CaseIsolation: { stage: 'Isolation', reason: 'CopiesIsolated' },
  CancellationDeadline: { stage: 'Cleanup', reason: 'CancellationConfirmed' },
} as const;
const isPassed = Schema.is(Schema.Literal('Passed'));
const isFailed = Schema.is(Schema.Literal('Failed'));
const isPreflight = Schema.is(Schema.Literal('RuntimeIsolationPreflight'));
const earlyCase = Schema.is(
  Schema.Literals(['RuntimeIsolationPreflight', 'ArchiveAdmissionNegatives', 'ScriptCanaries']),
);
const sameReadbacks = Schema.toEquivalence(ControlReadbacks);

function digestChecks(request: QualificationRequest, item: CaseObservation) {
  return Match.value(item.digests).pipe(
    Match.tagsExhaustive({
      Unknown: () => [{ invalid: !earlyCase(item.caseId), reason: 'EvidenceIncomplete' as const }],
      Recorded: (value) => [
        {
          invalid: [
            value.sourceBefore !== value.sourceAfter,
            value.lockBefore !== inputPins.lockSha256,
            value.lockAfter !== inputPins.lockSha256,
            value.seedBefore !== value.seedAfter,
            value.harnessSha256 !== request.harnessSha256,
            value.toolCapsuleSha256 !== request.toolCapsuleSha256,
          ].some(Boolean),
          reason: 'InputChanged' as const,
        },
      ],
    }),
  );
}

function observationChecks(request: QualificationRequest, item: CaseObservation) {
  const controlsMissing = Match.value(item.readbacks).pipe(
    Match.tagsExhaustive({ Unknown: () => true, Verified: () => false }),
  );
  return [
    { invalid: !isPassed(item.outcome), reason: item.reason },
    {
      invalid: isPassed(item.outcome) && item.reason !== expected[item.caseId].reason,
      reason: 'EvidenceIncomplete' as const,
    },
    {
      invalid: item.stage !== expected[item.caseId].stage || item.evidence.length === 0,
      reason: 'EvidenceIncomplete' as const,
    },
    { invalid: isPreflight(item.caseId) && controlsMissing, reason: 'BlockedControls' as const },
    ...digestChecks(request, item),
  ];
}

function summarize(
  request: QualificationRequest,
  observations: readonly CaseObservation[],
  cleanup: CleanupObservation,
) {
  const ids = observations.map((item) => item.caseId);
  const recorded = observations.flatMap((item) =>
    Match.value(item.digests).pipe(
      Match.tagsExhaustive({ Unknown: () => [], Recorded: (value) => [value] }),
    ),
  );
  const sourceDigests = new Set(recorded.map((value) => value.sourceBefore));
  const seedDigests = new Set(recorded.map((value) => value.seedBefore));
  const verified = observations.flatMap((item) =>
    Match.value(item.readbacks).pipe(
      Match.tagsExhaustive({ Unknown: () => [], Verified: (value) => [value] }),
    ),
  );
  const runtimeCoherent = verified.every((value) =>
    verified.every((other) => sameReadbacks(value, other)),
  );
  const cleanupMissing = Match.value(cleanup).pipe(
    Match.tagsExhaustive({
      ConfirmedRemoval: () => false,
      RemainingResources: () => true,
      Unknown: () => true,
    }),
  );
  const checks = [
    {
      invalid: new Set(ids).size !== ids.length || requiredCases.some((id) => !ids.includes(id)),
      reason: 'EvidenceIncomplete' as const,
    },
    { invalid: sourceDigests.size > 1 || seedDigests.size > 1, reason: 'InputChanged' as const },
    { invalid: !runtimeCoherent, reason: 'InputChanged' as const },
    { invalid: cleanupMissing, reason: 'CleanupUnknown' as const },
    ...observations.flatMap((item) => observationChecks(request, item)),
  ];
  const reasons: QualificationReason[] = [
    ...new Set(checks.filter((check) => check.invalid).map((check) => check.reason)),
  ].sort();
  const outcome = Match.value({
    failed: observations.some((item) => isFailed(item.outcome)),
    incomplete: reasons.length > 0,
  }).pipe(
    Match.when({ failed: true }, () => 'Failed' as const),
    Match.when({ incomplete: true }, () => 'Blocked' as const),
    Match.orElse(() => 'Passed' as const),
  );
  return { outcome, reasons };
}

export function makeReceipt(
  request: QualificationRequest,
  observations: readonly CaseObservation[],
  cleanup: CleanupObservation,
) {
  function* aggregate() {
    const decoded = yield* decodeRequest(request);
    const draft = yield* Schema.decodeUnknownEffect(
      QualificationReceipt,
      strict,
    )({
      authority: 'EvidenceOnly',
      activation: 'Blocked',
      request: decoded,
      observations,
      cleanup,
      outcome: 'Blocked',
      reasons: [],
    });
    return { ...draft, ...summarize(decoded, draft.observations, draft.cleanup) };
  }
  const workflow = Effect.gen(aggregate);
  return workflow;
}

function exitForReceipt(value: QualificationReceipt) {
  const actual = summarize(value.request, value.observations, value.cleanup);
  const coherent = [
    value.outcome === actual.outcome,
    value.reasons.length === actual.reasons.length,
    value.reasons.every((reason, index) => reason === actual.reasons[index]),
  ].every(Boolean);
  return Match.value({
    coherent,
    unsupported: actual.reasons.includes('UnsupportedInvocation'),
    passed: isPassed(actual.outcome),
  }).pipe(
    Match.when({ coherent: false }, () => 1),
    Match.when({ unsupported: true }, () => 64),
    Match.when({ passed: true }, () => 0),
    Match.orElse(() => 1),
  );
}

export function qualificationExitCode(receipt: QualificationReceipt) {
  const decoded = Schema.decodeUnknownResult(QualificationReceipt, strict)(receipt);
  return Result.match(decoded, { onFailure: () => 1, onSuccess: exitForReceipt });
}
