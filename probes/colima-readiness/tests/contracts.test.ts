import { expect, test } from 'bun:test';

import { Result, Schema } from 'effect';

import {
  ActivationManifest,
  CheckId,
  DiagnosticReport,
  PreflightReport,
} from '../src/contracts.ts';
import { decodeManifest, summarizeDiagnostics } from '../src/policy.ts';
import { checkIds, diagnosticFixture, manifestFixture, preflightFixture } from './fixtures.ts';

const strict = { onExcessProperty: 'error' } as const;
function rejectsManifest(input: unknown) {
  const result = decodeManifest(input);
  expect(Result.isFailure(result)).toBe(true);
}

function exactChecks() {
  const isCheck = Schema.is(CheckId);
  for (const id of checkIds) expect(isCheck(id)).toBe(true);
  expect(isCheck('WorkerReadyReceipt')).toBe(false);
}
test('the exact check set excludes operational readiness receipts', exactChecks);

function strictManifest() {
  const m = manifestFixture();
  const decoded = decodeManifest(m);
  expect(Result.isSuccess(decoded)).toBe(true);
  const invalid = [
    { ...m, activate: true },
    { ...m, identity: { ...m.identity, token: 'sentinel' } },
    { ...m, checks: [...m.checks, m.checks[0]] },
    { ...m, checks: m.checks.map(() => m.checks[0]) },
    { ...m, commands: [...m.commands, m.commands[0]] },
    { ...m, commands: [{ ...m.commands[0], executable: 'relative' }] },
    { ...m, cleanupReserveMs: undefined },
    { ...m, durationMs: 1200001 },
  ];
  for (const input of invalid) rejectsManifest(input);
}
test(
  'strict manifest decoding rejects unknown fields recursively and duplicate IDs',
  strictManifest,
);

function numericCeilings() {
  const m = manifestFixture();
  const ceilings = {
    cpuCores: 2,
    memoryBytes: 8589934592,
    pidLimit: 256,
    writableBytes: 21474836480,
    commandOutputBytes: 10485760,
    retainedEvidenceBytes: 134217728,
  };
  for (const [key, cap] of Object.entries(ceilings)) {
    for (const value of [cap + 1, -1, NaN, Infinity, 0.5]) {
      rejectsManifest({ ...m, limits: { ...m.limits, [key]: value } });
    }
  }
  for (const value of [-1, NaN, Infinity, 0, 1200001]) {
    rejectsManifest({ ...m, cleanupReserveMs: value });
    rejectsManifest({ ...m, commands: [{ ...m.commands[0], timeoutMs: value }] });
  }
  rejectsManifest({ ...m, storage: { ...m.storage, quotaBytes: 21474836481 } });
  rejectsManifest({ ...m, commands: m.commands.map((c) => ({ ...c, timeoutMs: 200000 })) });
}
test('all numeric ceilings and finite nonnegative budgets are enforced', numericCeilings);

function unsafeManifest() {
  const m = manifestFixture();
  for (const key of [
    'forwardAgent',
    'dockerSocket',
    'privileged',
    'rootUser',
    'hostPid',
    'browserNoSandbox',
  ]) {
    rejectsManifest({ ...m, security: { ...m.security, [key]: true } });
  }
  rejectsManifest({ ...m, security: { ...m.security, hostBinds: ['/home'] } });
  rejectsManifest({ ...m, network: { ...m.network, mode: 'host' } });
  rejectsManifest({
    ...m,
    commands: m.commands.map((c) => ({ ...c, argv: [...c.argv, '--no-sandbox'] })),
  });
}
test('unsafe security and network settings cannot form an activation manifest', unsafeManifest);

function preflightBoundary() {
  const p = preflightFixture();
  const decode = Schema.decodeUnknownResult(PreflightReport, strict);
  const valid = decode(p);
  expect(Result.isSuccess(valid)).toBe(true);
  for (const mutation of [
    { canExecuteReplay: true },
    { nativeReadiness: 'Pass' },
    { daemonVerified: true },
    { activationDraft: manifestFixture() },
    { host: { ...p.host, cpuCount: { _tag: 'Known', value: -1 } } },
    { versions: [{ tool: 'Colima', status: 'Available', version: 'secret arbitrary output' }] },
    { config: { ...p.config, hostUser: 'arbitrary' } },
  ]) {
    const result = decode({ ...p, ...mutation });
    expect(Result.isFailure(result)).toBe(true);
  }
}
test(
  'preflight preserves unknown observations and cannot claim execution or native pass',
  preflightBoundary,
);

function diagnosticBoundary() {
  const f = diagnosticFixture();
  const report = summarizeDiagnostics(f.manifest, f.invocationId, f.evidence, f.cleanup).pipe(
    Result.getOrThrow,
  );
  const decode = Schema.decodeUnknownResult(DiagnosticReport, strict);
  const valid = decode(report);
  expect(Result.isSuccess(valid)).toBe(true);
  for (const mutation of [
    { canExecuteReplay: true },
    { evidence: report.evidence.slice(1) },
    { evidence: report.evidence.map((e) => ({ ...e, outcome: 'Fail', reasons: ['CheckFailed'] })) },
  ]) {
    const result = decode({ ...report, ...mutation });
    expect(Result.isFailure(result)).toBe(true);
  }
  const isManifest = Schema.is(ActivationManifest);
  const preflight = preflightFixture();
  expect(isManifest(preflight)).toBe(false);
}
test(
  'diagnostic schema rejects contradictory aggregate/check outcomes and unknown authority',
  diagnosticBoundary,
);
