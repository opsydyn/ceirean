import { Effect, FileSystem, Match, Result, Schema } from 'effect';

import {
  ControlReadbacks,
  CaseObservation,
  CleanupObservation,
  QualificationAdmission,
  QualificationReceipt,
  QualificationRequest,
  decodeRequest,
  decodeReceipt,
  cleanupEvidenceRequirement,
  evidenceRequirements,
  requiredCases,
  strict,
  type QualificationReason,
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
const unrecordedDigestCase = Schema.is(
  Schema.Literals([
    'RuntimeIsolationPreflight',
    'ArchiveAdmissionNegatives',
    'ScriptCanaries',
    'CancellationDeadline',
  ]),
);
const sameReadbacks = Schema.toEquivalence(ControlReadbacks);
const sameRequest = Schema.toEquivalence(QualificationRequest);
const sameObservation = Schema.toEquivalence(CaseObservation);
const sameCleanup = Schema.toEquivalence(CleanupObservation);
const sameAdmission = Schema.toEquivalence(QualificationAdmission);
const verifiedIntegrity = Schema.is(Schema.Literal('Verified'));
const ExitInput = Schema.Struct({
  receipt: QualificationReceipt,
  admission: QualificationAdmission,
});

function digestChecks(
  request: QualificationRequest,
  item: CaseObservation,
  admission: QualificationAdmission,
) {
  return Match.value(item.digests).pipe(
    Match.tagsExhaustive({
      // Host lifecycle evidence follows removal; its required facts and cleanup
      // are checked separately, without claiming a new hash of destroyed cache.
      Unknown: () => [
        { invalid: !unrecordedDigestCase(item.caseId), reason: 'EvidenceIncomplete' as const },
      ],
      Recorded: (value) => [
        {
          invalid: [
            value.sourceBefore !== value.sourceAfter,
            value.sourceBefore !== admission.source.sha256,
            value.lockBefore !== inputPins.lockSha256,
            value.lockAfter !== inputPins.lockSha256,
            value.seedBefore !== value.seedAfter,
            value.seedBefore !== admission.seed.sha256,
            value.harnessSha256 !== request.harnessSha256,
            value.toolCapsuleSha256 !== request.toolCapsuleSha256,
          ].some(Boolean),
          reason: 'InputChanged' as const,
        },
      ],
    }),
  );
}

function caseEvidenceComplete(item: CaseObservation, admission: QualificationAdmission) {
  const required = evidenceRequirements[item.caseId];
  const files = admission.evidence.cases.filter((file) => file.caseId === item.caseId);
  return (
    files.length === 1 &&
    files.every((file) =>
      Match.value(file).pipe(
        Match.tagsExhaustive({
          Missing: () => false,
          Admitted: (value) =>
            [
              value.name === required.name,
              !value.truncated,
              verifiedIntegrity(value.integrity),
              value.checks.length === required.checks.length,
              new Set(value.checks).size === value.checks.length,
              required.checks.every((check) =>
                value.checks.some((confirmed) => confirmed === check),
              ),
              sameObservation(value.observation, item),
              item.evidence.length === 1 && item.evidence[0] === value.name,
            ].every(Boolean),
        }),
      ),
    )
  );
}

function cleanupEvidenceComplete(cleanup: CleanupObservation, admission: QualificationAdmission) {
  return Match.value(admission.evidence.cleanup).pipe(
    Match.tagsExhaustive({
      Missing: () => false,
      Admitted: (file) =>
        [
          file.name === cleanupEvidenceRequirement.name,
          !file.truncated,
          verifiedIntegrity(file.integrity),
          cleanup.evidence.length === 1 && cleanup.evidence[0] === file.name,
          sameCleanup(file.observation, cleanup),
        ].every(Boolean),
    }),
  );
}

function admittedFileBytes(admission: QualificationAdmission) {
  const sizes = [...admission.evidence.cases, admission.evidence.cleanup].map((file) =>
    Match.value(file).pipe(
      Match.tagsExhaustive({ Missing: () => 0, Admitted: (value) => value.byteLength }),
    ),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

function observationChecks(
  request: QualificationRequest,
  item: CaseObservation,
  admission: QualificationAdmission,
) {
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
    { invalid: !caseEvidenceComplete(item, admission), reason: 'EvidenceIncomplete' as const },
    ...digestChecks(request, item, admission),
  ];
}

function summarize(
  request: QualificationRequest,
  observations: readonly CaseObservation[],
  cleanup: CleanupObservation,
  admission: QualificationAdmission,
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
    {
      invalid:
        !sameRequest(request, admission.request) ||
        admission.seed.sourceSha256 !== admission.source.sha256,
      reason: 'InputChanged' as const,
    },
    {
      invalid: !cleanupEvidenceComplete(cleanup, admission),
      reason: 'EvidenceIncomplete' as const,
    },
    {
      invalid: admittedFileBytes(admission) > request.limits.evidenceBytes,
      reason: 'EvidenceIncomplete' as const,
    },
    {
      invalid: admission.evidence.cases.length !== requiredCases.length,
      reason: 'EvidenceIncomplete' as const,
    },
    ...observations.flatMap((item) => observationChecks(request, item, admission)),
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
  // Only trusted boundary output belongs here; receipt JSON is not admission.
  admission?: QualificationAdmission,
) {
  function* aggregate() {
    const decoded = yield* decodeRequest(request);
    const trusted = yield* Schema.decodeUnknownEffect(QualificationAdmission, strict)(admission);
    const draft = yield* Schema.decodeUnknownEffect(
      QualificationReceipt,
      strict,
    )({
      authority: 'EvidenceOnly',
      activation: 'Blocked',
      request: decoded,
      observations,
      cleanup,
      admission: trusted,
      outcome: 'Blocked',
      reasons: [],
    });
    return { ...draft, ...summarize(decoded, draft.observations, draft.cleanup, trusted) };
  }
  const workflow = Effect.gen(aggregate);
  return workflow;
}

function exitForReceipt(value: QualificationReceipt, admission: QualificationAdmission) {
  const actual = summarize(value.request, value.observations, value.cleanup, admission);
  const coherent = [
    sameAdmission(value.admission, admission),
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

export function qualificationExitCode(
  receipt: QualificationReceipt,
  admission?: QualificationAdmission,
) {
  const decoded = Schema.decodeUnknownResult(ExitInput, strict)({ receipt, admission });
  return Result.match(decoded, {
    onFailure: () => 1,
    onSuccess: (value) => exitForReceipt(value.receipt, value.admission),
  });
}

// This export is fixed-path and schema-sanitized. Prior admitted files and this
// receipt share one budget; a receipt never gets an additional 16 MiB allowance.
export function exportReceipt(root: string, receipt: QualificationReceipt, usedBytes: number) {
  function* write() {
    const fs = yield* FileSystem.FileSystem;
    const decoded = yield* decodeReceipt(receipt);
    const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(QualificationReceipt));
    const bytes = new TextEncoder().encode(encodeReceipt(decoded));
    const fits = [
      Number.isSafeInteger(usedBytes),
      usedBytes >= 0,
      bytes.length <= 16777216 - usedBytes,
    ].every(Boolean);
    const checked = Result.succeed(fits).pipe(
      Result.filterOrFail(Boolean, () => new Error('EvidenceIncomplete')),
      Effect.fromResult,
    );
    yield* checked;
    yield* fs.writeFile(`${root}/qualification-receipt.json`, bytes, { flag: 'wx', mode: 0o600 });
  }
  const workflow = Effect.gen(write);
  return workflow;
}
