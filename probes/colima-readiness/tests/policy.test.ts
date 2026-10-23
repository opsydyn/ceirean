import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Match, Result, Schema } from 'effect';

import type { CheckEvidence, DiagnosticReport } from '../src/contracts.ts';
import { decodeManifest, summarizeDiagnostics, validateActivation } from '../src/policy.ts';
import { diagnosticFixture, manifestFixture } from './fixtures.ts';

function activationRejected(manifest: unknown, approval: unknown, now: unknown) {
  const result = validateActivation(manifest, approval, now);
  expect(Result.isFailure(result)).toBe(true);
}
function approvalWindow() {
  const m = manifestFixture();
  const a = {
    _tag: 'ActivationApproval',
    manifestDigest: m.manifestDigest,
    startMs: 100,
    deadlineMs: 1200100,
  };
  const start = validateActivation(m, a, 100);
  const lastSafe = validateActivation(m, a, 1133100);
  expect(Result.isSuccess(start)).toBe(true);
  expect(Result.isSuccess(lastSafe)).toBe(true);
  activationRejected(m, a, 1133101);
  for (const approval of [
    undefined,
    {},
    { ...a, manifestDigest: '0'.repeat(64) },
    { ...a, deadlineMs: 1200101 },
    { ...a, extra: true },
  ]) {
    activationRejected(m, approval, 100);
  }
  for (const now of [99, 1200100, -1, NaN, Infinity, 0.5]) activationRejected(m, a, now);
  const short = { ...a, deadlineMs: 101 };
  activationRejected(m, short, 100);
}
test('manifest validity is not approval; exact approval has an exclusive deadline', approvalWindow);

function diagnosticPass(report: DiagnosticReport) {
  return Match.value(report.outcome).pipe(
    Match.when('Pass', () => true),
    Match.orElse(() => false),
  );
}
function passes(
  evidence: unknown,
  cleanup: unknown,
  manifest: unknown = manifestFixture(),
  invocationId: unknown = 'synthetic-invocation',
) {
  return summarizeDiagnostics(manifest, invocationId, evidence, cleanup).pipe(
    Result.match({
      onFailure: () => false,
      onSuccess: diagnosticPass,
    }),
  );
}

function completeEvidence() {
  const f = diagnosticFixture();
  expect(passes(f.evidence, f.cleanup)).toBe(true);
  const invalid = [
    [],
    f.evidence.slice(1),
    [...f.evidence, f.evidence[0]],
    f.evidence.map((e) => ({ ...e, reasons: ['OutputTruncated'] })),
    f.evidence.map((e) => ({ ...e, artifacts: [] })),
    f.evidence.map((e) => ({ ...e, artifacts: [{ ...e.artifacts[0], digest: '' }] })),
    f.evidence.map((e) => ({ ...e, identity: { ...e.identity, daemonId: 'other' } })),
  ];
  for (const evidence of invalid) expect(passes(evidence, f.cleanup)).toBe(false);
  for (const cleanup of [
    undefined,
    { ...f.cleanup, vmStopped: false },
    { ...f.cleanup, unresolvedResourceIds: ['owned'] },
    { ...f.cleanup, artifacts: [] },
    { ...f.cleanup, invocationId: 'other' },
  ]) {
    expect(passes(f.evidence, cleanup)).toBe(false);
  }
}
test(
  'only complete exact checks, identities, artifacts and cleanup produce diagnostic Pass',
  completeEvidence,
);

const generated = Arbitrary.schema(
  Schema.Struct({
    index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
    nonce: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000000 })),
  }),
);
type Case = typeof generated extends Arbitrary.Arbitrary<infer A> ? A : never;

function replaceCheck(
  evidence: ReadonlyArray<CheckEvidence>,
  index: number,
  change: (e: CheckEvidence) => unknown,
) {
  return evidence.map((e, i) =>
    Match.value(i === index).pipe(
      Match.when(true, () => change(e)),
      Match.orElse(() => e),
    ),
  );
}
function downgrade({ index }: Case) {
  const f = diagnosticFixture();
  return (
    passes(f.evidence, f.cleanup) &&
    ['Fail', 'Blocked'].every(
      (outcome) =>
        !passes(
          replaceCheck(f.evidence, index, (e) => ({ ...e, outcome, reasons: ['CheckFailed'] })),
          f.cleanup,
        ),
    ) &&
    !passes(
      f.evidence.filter((_, i) => i !== index),
      f.cleanup,
    )
  );
}
function cleanupLaw({ index }: Case) {
  const f = diagnosticFixture();
  const invalid = [
    undefined,
    { ...f.cleanup, _tag: 'Unresolved' },
    { ...f.cleanup, containersAbsent: false },
    { ...f.cleanup, volumesAbsent: false },
    { ...f.cleanup, vmStopped: false },
    { ...f.cleanup, unresolvedResourceIds: [`owned-${index}`] },
    { ...f.cleanup, artifacts: [] },
  ];
  return passes(f.evidence, f.cleanup) && invalid.every((c) => !passes(f.evidence, c));
}
function identityLaw({ index, nonce }: Case) {
  const f = diagnosticFixture();
  const changed = replaceCheck(f.evidence, index, (e) => ({
    ...e,
    invocationId: `other-${nonce}`,
  }));
  const digest = nonce.toString(16).padStart(64, '0');
  return (
    passes(f.evidence, f.cleanup) &&
    !passes(changed, f.cleanup) &&
    !passes(
      replaceCheck(f.evidence, index, (e) => ({ ...e, manifestDigest: digest })),
      f.cleanup,
    ) &&
    !passes(f.evidence, { ...f.cleanup, manifestDigest: digest })
  );
}
function truncationLaw({ index }: Case) {
  const f = diagnosticFixture();
  return (
    passes(f.evidence, f.cleanup) &&
    !passes(
      replaceCheck(f.evidence, index, (e) => ({
        ...e,
        artifacts: e.artifacts.map((a) => ({ ...a, complete: false })),
      })),
      f.cleanup,
    ) &&
    !passes(f.evidence, {
      ...f.cleanup,
      artifacts: f.cleanup.artifacts.map((a) => ({ ...a, complete: false })),
    })
  );
}
function boundsLaw({ nonce }: Case) {
  const f = diagnosticFixture();
  const caps = {
    cpuCores: 2,
    memoryBytes: 8589934592,
    pidLimit: 256,
    writableBytes: 21474836480,
    commandOutputBytes: 10485760,
    retainedEvidenceBytes: 134217728,
  };
  function exceeds([key, cap]: [string, number]) {
    const m = { ...f.manifest, limits: { ...f.manifest.limits, [key]: cap + nonce } };
    const decoded = decodeManifest(m);
    return Result.isFailure(decoded) && !passes(f.evidence, f.cleanup, m);
  }
  const otherBounds = [
    { ...f.manifest, durationMs: 1200000 + nonce },
    { ...f.manifest, cleanupReserveMs: 1200000 + nonce },
    { ...f.manifest, storage: { ...f.manifest.storage, quotaBytes: 21474836480 + nonce } },
    { ...f.manifest, storage: { ...f.manifest.storage, temporaryBytes: 21474836480 + nonce } },
    {
      ...f.manifest,
      commands: f.manifest.commands.map((c) => ({ ...c, outputBytes: 10485760 + nonce })),
    },
    {
      ...f.manifest,
      commands: f.manifest.commands.map((c) => ({ ...c, timeoutMs: 1200000 + nonce })),
    },
    {
      ...f.manifest,
      cleanupCommands: f.manifest.cleanupCommands.map((c) => ({ ...c, timeoutMs: 60000 + nonce })),
    },
  ];
  return (
    passes(f.evidence, f.cleanup) &&
    Object.entries(caps).every(exceeds) &&
    otherBounds.every((m) => !passes(f.evidence, f.cleanup, m)) &&
    !passes(
      f.evidence.map((e) => ({
        ...e,
        artifacts: e.artifacts.map((a) => ({ ...a, bytes: 134217729 })),
      })),
      f.cleanup,
    )
  );
}

function aggregateCap() {
  const f = diagnosticFixture();
  const retained = f.evidence.map((e) => ({
    ...e,
    artifacts: e.artifacts.map((a) => ({ ...a, bytes: 1024 })),
  }));
  const remaining = 134217728 - 7 * 1024;
  const cleanup = {
    ...f.cleanup,
    artifacts: f.cleanup.artifacts.map((a) => ({ ...a, bytes: remaining })),
  };
  expect(passes(retained, cleanup)).toBe(true);
  const over = {
    ...cleanup,
    artifacts: cleanup.artifacts.map((a) => ({ ...a, bytes: a.bytes + 1 })),
  };
  expect(passes(retained, over)).toBe(false);
  const missingArtifact = retained.map((e) => ({
    ...e,
    artifacts: e.artifacts.map((a) => ({ ...a, id: 'wrong-proof' })),
  }));
  expect(passes(missingArtifact, f.cleanup)).toBe(false);
  const failed = retained.map((e) => ({ ...e, outcome: 'Fail', reasons: ['CheckFailed'] }));
  const report = summarizeDiagnostics(f.manifest, f.invocationId, failed, f.cleanup).pipe(
    Result.getOrThrow,
  );
  expect(report.outcome).toBe('Fail');
  const blocked = retained.map((e) => ({ ...e, outcome: 'Blocked', reasons: ['CheckBlocked'] }));
  const blockedReport = summarizeDiagnostics(f.manifest, f.invocationId, blocked, f.cleanup).pipe(
    Result.getOrThrow,
  );
  expect(blockedReport.outcome).toBe('Blocked');
}
test(
  'aggregate retained cap is inclusive; missing artifacts and non-pass checks cannot pass',
  aggregateCap,
);
const laws = {
  'downgrade or remove any check': downgrade,
  'downgrade or remove cleanup': cleanupLaw,
  'substitute invocation or manifest digest': identityLaw,
  'truncate required evidence': truncationLaw,
  'exceed any bound': boundsLaw,
};

for (const [name, law] of Object.entries(laws)) {
  async function runLaw() {
    function* checkSeeds() {
      for (const seed of [0, 1, 163]) {
        const result = yield* Arbitrary.checkEffect(generated, law, {
          seed,
          runs: 1000,
          size: 50,
          maxShrinks: 1000,
          maxDiscards: 10000,
        });
        expect(result).toMatchObject({ _tag: 'Passed', runs: 1000 });
      }
    }
    const program = Effect.gen(checkSeeds);
    await Effect.runPromise(program);
  }
  test(`law: ${name} (seeds 0/1/163, 1000 runs each)`, runLaw);
}
