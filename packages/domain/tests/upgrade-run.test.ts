import { expect, test } from 'bun:test';

import { Match, Result, Schema } from 'effect';

import {
  CancelledRun,
  CheckId,
  FrozenRun,
  QualifiedRun,
  RunFact,
  RunLimits,
  UpgradeRun,
  checkEligibility,
  decideCancellation,
  decideQualification,
  decodeContract,
  decodeReceipt,
} from '../src/index.ts';
import type { QualificationRefusal, UpgradeRun as Run } from '../src/index.ts';
import { makeEvidenceCase, makeFrozenRun } from './fixtures.ts';

function expectRefusal(
  decision: ReturnType<typeof decideQualification> | ReturnType<typeof decideCancellation>,
  before: Run,
  refusal: QualificationRefusal,
) {
  expect(decision._tag).toBe('Refused');
  expect(decision.state).toBe(before);
  expect(decision.facts).toEqual([]);
  const actual = Match.value(decision).pipe(
    Match.tag('Refused', ({ refusal: value }) => value),
    Match.tag('Accepted', () => undefined),
    Match.exhaustive,
  );
  expect(actual).toEqual(refusal);
}

function qualify() {
  const before = makeFrozenRun();
  const c = makeEvidenceCase();
  const accepted = decideQualification(before, c.contract, c.receipt, 999);
  expect(accepted._tag).toBe('Accepted');
  const qualifiedShape = Schema.is(QualifiedRun)(accepted.state);
  const unionShape = Schema.is(UpgradeRun)(accepted.state);
  const factShape = Schema.is(RunFact)(accepted.facts[0]);
  expect(qualifiedShape).toBe(true);
  expect(unionShape).toBe(true);
  expect(factShape).toBe(true);
  expect(checkEligibility(before, 999)).toEqual(Result.succeed(before));
  const eligible = Result.getOrThrow(checkEligibility(before, 999));
  expect(eligible).toBe(before);
  const identity = {
    runId: 'run-1',
    attemptId: 'attempt-1',
    generation: 3,
    candidateDigest: 'a'.repeat(64),
    contractId: 'contract-1',
    contractDigest: 'c'.repeat(64),
  };
  const receipt = {
    ...identity,
    checks: [
      { checkId: 'lint', outcome: 'Passed' },
      { checkId: 'types', outcome: 'Passed' },
      { checkId: 'tests', outcome: 'Passed' },
    ],
  };
  expect(accepted.state).toEqual<unknown>({
    _tag: 'Qualified',
    ...identity,
    deadlineMs: 1000,
    spentMicros: 17,
    repairs: 1,
    receipt,
    qualifiedAtMs: 999,
  });
  expect(accepted.facts).toEqual<unknown>([
    { _tag: 'RunQualified', ...identity, receipt, atMs: 999 },
  ]);
  expect(before).toEqual<unknown>({
    _tag: 'Frozen',
    ...identity,
    deadlineMs: 1000,
    spentMicros: 17,
    repairs: 1,
  });
}
test('qualifies at 999 with the exact frozen identity, limits and one complete fact', qualify);

function expired(nowMs: number) {
  const before = makeFrozenRun();
  const c = makeEvidenceCase();
  expectRefusal(decideQualification(before, c.contract, c.receipt, nowMs), before, {
    _tag: 'DeadlineExpired',
  });
  expect(checkEligibility(before, nowMs)).toEqual(Result.fail({ _tag: 'DeadlineExpired' }));
}
test.each([1000, 1001, Number.MAX_SAFE_INTEGER])(
  'refuses qualification at expired time %s',
  expired,
);

function invalidTime(nowMs: number) {
  const before = makeFrozenRun();
  const c = makeEvidenceCase();
  expectRefusal(decideQualification(before, c.contract, c.receipt, nowMs), before, {
    _tag: 'InvalidTime',
  });
  expectRefusal(decideCancellation(before, nowMs), before, { _tag: 'InvalidTime' });
  expect(checkEligibility(before, nowMs)).toEqual(Result.fail({ _tag: 'InvalidTime' }));
}
test.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'refuses invalid explicit time %s without changing either decision state',
  invalidTime,
);

function cancel() {
  const before = makeFrozenRun();
  const decision = decideCancellation(before, 1000);
  const stateShape = Schema.is(CancelledRun)(decision.state);
  const factShape = Schema.is(RunFact)(decision.facts[0]);
  expect(stateShape).toBe(true);
  expect(factShape).toBe(true);
  expect(decision).toEqual<unknown>({
    _tag: 'Accepted',
    state: { ...before, _tag: 'Cancelled', cancelledAtMs: 1000 },
    facts: [
      { _tag: 'RunCancelled', runId: 'run-1', attemptId: 'attempt-1', generation: 3, atMs: 1000 },
    ],
  });
  expect(before._tag).toBe('Frozen');
}
test('cancellation preserves frozen fields and emits only the cancellation identity', cancel);

function terminal(phase: 'Cancelled' | 'Qualified') {
  const c = makeEvidenceCase();
  const before = makeFrozenRun();
  const terminalRun = Match.value(phase).pipe(
    Match.when('Cancelled', () =>
      CancelledRun.make({ ...before, _tag: 'Cancelled', cancelledAtMs: 1 }),
    ),
    Match.when('Qualified', () =>
      QualifiedRun.make({ ...before, _tag: 'Qualified', receipt: c.receipt, qualifiedAtMs: 1 }),
    ),
    Match.exhaustive,
  );
  for (const nowMs of [999, NaN, 1000]) {
    const refusal = { _tag: 'InvalidPhase', phase } as const;
    expectRefusal(
      decideQualification(terminalRun, c.contract, c.receipt, nowMs),
      terminalRun,
      refusal,
    );
    expectRefusal(decideCancellation(terminalRun, nowMs), terminalRun, refusal);
    expect(checkEligibility(terminalRun, nowMs)).toEqual(Result.fail(refusal));
  }
}
test.each(['Cancelled', 'Qualified'] as const)(
  'terminal %s refuses both decisions before checking time',
  terminal,
);

function repeated() {
  const before = makeFrozenRun();
  const c = makeEvidenceCase();
  const first = decideQualification(before, c.contract, c.receipt, 999);
  expect(first._tag).toBe('Accepted');
  expectRefusal(decideQualification(first.state, c.contract, c.receipt, 999), first.state, {
    _tag: 'InvalidPhase',
    phase: 'Qualified',
  });
  expectRefusal(decideCancellation(first.state, 999), first.state, {
    _tag: 'InvalidPhase',
    phase: 'Qualified',
  });
}
test('an accepted qualification cannot qualify again or cancel', repeated);

function mismatch(
  field: 'runId' | 'attemptId' | 'generation' | 'candidateDigest' | 'contractId' | 'contractDigest',
  value: unknown,
) {
  const before = makeFrozenRun();
  const c = makeEvidenceCase();
  const receipt = Result.getOrThrow(decodeReceipt({ ...c.receipt, [field]: value }));
  expectRefusal(decideQualification(before, c.contract, receipt, 999), before, {
    _tag: 'IdentityMismatch',
    field,
  });
}
test.each([
  ['runId', 'other-run'],
  ['attemptId', 'other-attempt'],
  ['generation', 4],
  ['candidateDigest', 'b'.repeat(64)],
  ['contractId', 'other-contract'],
  ['contractDigest', 'd'.repeat(64)],
] as const)('refuses receipt identity mismatch %s without facts', mismatch);

function contractMismatch(field: 'contractId' | 'contractDigest') {
  const before = makeFrozenRun();
  const c = makeEvidenceCase();
  const value = Match.value(field).pipe(
    Match.when('contractId', () => 'other'),
    Match.when('contractDigest', () => 'd'.repeat(64)),
    Match.exhaustive,
  );
  const contract = Result.getOrThrow(decodeContract({ ...c.contract, [field]: value }));
  expectRefusal(decideQualification(before, contract, c.receipt, 999), before, {
    _tag: 'IdentityMismatch',
    field,
  });
}
test.each(['contractId', 'contractDigest'] as const)(
  'refuses trusted contract binding mismatch %s',
  contractMismatch,
);

function incomplete(
  kind: 'MissingCheck' | 'DuplicateCheck' | 'UnknownCheck' | 'Failed' | 'NotRun',
) {
  const before = makeFrozenRun();
  const c = makeEvidenceCase();
  const first = { checkId: 'lint', outcome: 'Passed' };
  const checks = Match.value(kind).pipe(
    Match.when('MissingCheck', () => c.receipt.checks.slice(1)),
    Match.when('DuplicateCheck', () => [...c.receipt.checks, first]),
    Match.when('UnknownCheck', () => [
      ...c.receipt.checks,
      { checkId: 'unknown', outcome: 'Passed' },
    ]),
    Match.orElse((outcome) => [{ checkId: 'lint', outcome }, ...c.receipt.checks.slice(1)]),
  );
  const reason = Match.value(kind).pipe(
    Match.when('Failed', () => 'NonPassingCheck' as const),
    Match.when('NotRun', () => 'NonPassingCheck' as const),
    Match.orElse((value) => value),
  );
  const checkId = Match.value(kind).pipe(
    Match.when('UnknownCheck', () => CheckId.make('unknown')),
    Match.orElse(() => CheckId.make('lint')),
  );
  const receipt = Result.getOrThrow(decodeReceipt({ ...c.receipt, checks }));
  expectRefusal(decideQualification(before, c.contract, receipt, 999), before, {
    _tag: 'IncompleteVerification',
    reason,
    checkId,
  });
}
test.each(['MissingCheck', 'DuplicateCheck', 'UnknownCheck', 'Failed', 'NotRun'] as const)(
  'refuses %s evidence with unchanged state',
  incomplete,
);

function precedence() {
  const before = makeFrozenRun();
  const c = makeEvidenceCase();
  const contract = { ...c.contract, requiredChecks: [] };
  expectRefusal(decideQualification(before, contract, c.receipt, 999), before, {
    _tag: 'InvalidContract',
  });
  expectRefusal(decideQualification(before, contract, c.receipt, 1000), before, {
    _tag: 'DeadlineExpired',
  });
  expectRefusal(decideQualification(before, contract, c.receipt, NaN), before, {
    _tag: 'InvalidTime',
  });
}
test('time eligibility precedes evidence validation', precedence);

function endpoints(value: number) {
  const c = makeEvidenceCase();
  const run = FrozenRun.make({
    ...makeFrozenRun(),
    generation: value,
    deadlineMs: Number.MAX_SAFE_INTEGER,
    spentMicros: value,
    repairs: value,
  });
  const receipt = { ...c.receipt, generation: value };
  const decision = decideQualification(run, c.contract, receipt, 0);
  expect(decision._tag).toBe('Accepted');
  expect(decision.state).toMatchObject({
    generation: value,
    spentMicros: value,
    repairs: value,
    deadlineMs: Number.MAX_SAFE_INTEGER,
  });
  const cancelled = decideCancellation(run, value);
  expect(cancelled._tag).toBe('Accepted');
  expect(cancelled.state).toMatchObject({ cancelledAtMs: value });
}
test.each([0, Number.MAX_SAFE_INTEGER])(
  'carries safe numeric endpoints %s without reset',
  endpoints,
);

function invalidFields(value: number) {
  const c = makeEvidenceCase();
  const before = makeFrozenRun();
  for (const field of ['deadlineMs', 'spentMicros', 'repairs'] as const) {
    const limitsShape = Schema.is(RunLimits)({
      deadlineMs: 1000,
      spentMicros: 17,
      repairs: 1,
      [field]: value,
    });
    const runShape = Schema.is(FrozenRun)({ ...before, [field]: value });
    expect(limitsShape).toBe(false);
    expect(runShape).toBe(false);
  }
  const qualifiedShape = Schema.is(QualifiedRun)({
    ...before,
    _tag: 'Qualified',
    receipt: c.receipt,
    qualifiedAtMs: value,
  });
  const cancelledShape = Schema.is(CancelledRun)({
    ...before,
    _tag: 'Cancelled',
    cancelledAtMs: value,
  });
  expect(qualifiedShape).toBe(false);
  expect(cancelledShape).toBe(false);
}
test.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'run schemas reject invalid numeric field %s',
  invalidFields,
);

function oldGeneration() {
  const c = makeEvidenceCase();
  const replacement = FrozenRun.make({ ...makeFrozenRun(), generation: 4 });
  expectRefusal(decideQualification(replacement, c.contract, c.receipt, 999), replacement, {
    _tag: 'IdentityMismatch',
    field: 'generation',
  });
}
test('regression: generation 3 receipt cannot qualify replacement generation 4', oldGeneration);

function lateReceipt() {
  const c = makeEvidenceCase();
  const cancelled = CancelledRun.make({ ...makeFrozenRun(), _tag: 'Cancelled', cancelledAtMs: 0 });
  expectRefusal(decideQualification(cancelled, c.contract, c.receipt, 0), cancelled, {
    _tag: 'InvalidPhase',
    phase: 'Cancelled',
  });
}
test('regression: matching receipt cannot qualify a cancelled generation 3 run', lateReceipt);

function shrunkCase() {
  const identity = {
    runId: '!',
    attemptId: '!',
    generation: 0,
    candidateDigest: '0'.repeat(64),
    contractId: '!',
    contractDigest: '0'.repeat(64),
  };
  const decoded = Schema.decodeUnknownResult(FrozenRun)({
    ...identity,
    _tag: 'Frozen',
    deadlineMs: 1,
    spentMicros: 0,
    repairs: 0,
  });
  const run = Result.getOrThrow(decoded);
  const contract = Result.getOrThrow(
    decodeContract({
      contractId: '!',
      contractDigest: '0'.repeat(64),
      requiredChecks: ['!'],
    }),
  );
  const receipt = Result.getOrThrow(
    decodeReceipt({
      ...identity,
      checks: [{ checkId: '!', outcome: 'Passed' }],
    }),
  );
  return { run, contract, receipt };
}

function shrunkGeneration() {
  const c = shrunkCase();
  const receipt = { ...c.receipt, generation: Number.MAX_SAFE_INTEGER };
  expectRefusal(decideQualification(c.run, c.contract, receipt, 0), c.run, {
    _tag: 'IdentityMismatch',
    field: 'generation',
  });
}
test(
  'shrunk identity regression: generation zero refuses a MAX_SAFE_INTEGER receipt',
  shrunkGeneration,
);

function shrunkCancellation() {
  const c = shrunkCase();
  const cancelled = CancelledRun.make({ ...c.run, _tag: 'Cancelled', cancelledAtMs: 0 });
  expectRefusal(decideQualification(cancelled, c.contract, c.receipt, 0), cancelled, {
    _tag: 'InvalidPhase',
    phase: 'Cancelled',
  });
  expectRefusal(decideCancellation(cancelled, 0), cancelled, {
    _tag: 'InvalidPhase',
    phase: 'Cancelled',
  });
}
test(
  'shrunk cancellation regression: matching complete evidence cannot revive cancellation at zero',
  shrunkCancellation,
);

function zeroDeadline() {
  const c = makeEvidenceCase();
  const before = FrozenRun.make({ ...makeFrozenRun(), deadlineMs: 0 });
  expectRefusal(decideQualification(before, c.contract, c.receipt, 0), before, {
    _tag: 'DeadlineExpired',
  });
  const cancelled = decideCancellation(before, 0);
  expect(cancelled._tag).toBe('Accepted');
}
test('zero deadline expires at zero but still permits cancellation', zeroDeadline);
