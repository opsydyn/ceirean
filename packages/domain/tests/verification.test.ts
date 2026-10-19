import { expect, test } from 'bun:test';

import { Result, Schema } from 'effect';

import type { CandidateIdentity, QualificationRefusal } from '../src/index.ts';
import {
  CheckId,
  NonNegativeSafeInteger,
  decodeContract,
  decodeReceipt,
  validateReceipt,
} from '../src/index.ts';
import { makeEvidenceCase } from './fixtures.ts';

function canonicalEvidence() {
  const c = makeEvidenceCase();
  const result = validateReceipt(c.identity, c.contract, c.receipt);
  expect(Result.isSuccess(result)).toBe(true);
  expect(Result.getOrThrow(result)).toBe(c.receipt);
  expect(decodeContract(c.contract)._tag).toBe('Success');
  expect(decodeReceipt(c.receipt)._tag).toBe('Success');
}
test('accepts canonical complete evidence and returns the supplied receipt', canonicalEvidence);

function freshFixtures() {
  const a = makeEvidenceCase();
  const b = makeEvidenceCase();
  expect(a.receipt).not.toBe(b.receipt);
  expect(a.receipt.checks).not.toBe(b.receipt.checks);
  expect(a.receipt.checks[0]).not.toBe(b.receipt.checks[0]);
  expect(a.contract.requiredChecks).not.toBe(b.contract.requiredChecks);
}
test('fixtures do not share receipt arrays or check objects', freshFixtures);

const malformedInputs = [null, {}, { arbitrary: 'object' }, [], 'receipt'].map((input) => ({
  input,
}));
test.each(malformedInputs)('refuses malformed input %j', function malformed({ input }) {
  expect(decodeContract(input)).toEqual(Result.fail({ _tag: 'InvalidContract' }));
  expect(decodeReceipt(input)).toEqual(Result.fail({ _tag: 'InvalidReceipt' }));
});

function invalidIdentifiers(id: string) {
  const c = makeEvidenceCase();
  for (const field of ['runId', 'attemptId', 'contractId'] as const) {
    expect(decodeReceipt({ ...c.receipt, [field]: id })).toEqual(
      Result.fail({ _tag: 'InvalidReceipt' }),
    );
  }
  expect(decodeContract({ ...c.contract, contractId: id })).toEqual(
    Result.fail({ _tag: 'InvalidContract' }),
  );
  expect(decodeContract({ ...c.contract, requiredChecks: [id] })).toEqual(
    Result.fail({ _tag: 'InvalidContract' }),
  );
  expect(decodeReceipt({ ...c.receipt, checks: [{ checkId: id, outcome: 'Passed' }] })).toEqual(
    Result.fail({ _tag: 'InvalidReceipt' }),
  );
}
test.each(['', ' ', '\t\n'])('rejects empty or whitespace IDs %j', invalidIdentifiers);

function invalidDigests(digest: string) {
  const c = makeEvidenceCase();
  for (const field of ['candidateDigest', 'contractDigest'] as const) {
    expect(decodeReceipt({ ...c.receipt, [field]: digest })).toEqual(
      Result.fail({ _tag: 'InvalidReceipt' }),
    );
  }
  expect(decodeContract({ ...c.contract, contractDigest: digest })).toEqual(
    Result.fail({ _tag: 'InvalidContract' }),
  );
}
test.each([
  'A'.repeat(64),
  'a'.repeat(63),
  'a'.repeat(65),
  'g'.repeat(64),
  `${'a'.repeat(64)}\n`,
  `${'a'.repeat(64)}\r`,
])('rejects malformed digests %s', invalidDigests);

function invalidNumbers(generation: number) {
  const c = makeEvidenceCase();
  const receipt = decodeReceipt({ ...c.receipt, generation });
  const numeric = Schema.decodeUnknownResult(NonNegativeSafeInteger)(generation);
  expect(Result.isFailure(receipt)).toBe(true);
  expect(Result.isFailure(numeric)).toBe(true);
}
test.each([NaN, Infinity, -Infinity, 1.5, -1, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid numeric boundary %s',
  invalidNumbers,
);

function numericEndpoints(generation: number) {
  const c = makeEvidenceCase();
  const result = decodeReceipt({ ...c.receipt, generation });
  expect(Result.isSuccess(result)).toBe(true);
}
test.each([0, Number.MAX_SAFE_INTEGER])('accepts numeric endpoint %s', numericEndpoints);

function checkStructure() {
  const c = makeEvidenceCase();
  const emptyContract = decodeContract({ ...c.contract, requiredChecks: [] });
  expect(Result.isFailure(emptyContract)).toBe(true);
  expect(decodeContract({ ...c.contract, requiredChecks: ['lint', 'lint'] })).toEqual(
    Result.fail({ _tag: 'InvalidContract' }),
  );
  const emptyReceipt = decodeReceipt({ ...c.receipt, checks: [] });
  const duplicateReceipt = decodeReceipt({
    ...c.receipt,
    checks: [c.receipt.checks[0], c.receipt.checks[0]],
  });
  expect(Result.isSuccess(emptyReceipt)).toBe(true);
  expect(Result.isSuccess(duplicateReceipt)).toBe(true);
  expect(
    decodeReceipt({ ...c.receipt, checks: [{ checkId: 'lint', outcome: 'Unknown' }] }),
  ).toEqual(Result.fail({ _tag: 'InvalidReceipt' }));
}
test(
  'rejects empty and duplicate required checks but decodes empty or duplicate supplied checks',
  checkStructure,
);

function identityMismatch(field: keyof CandidateIdentity, value: unknown) {
  const c = makeEvidenceCase();
  const receipt = Result.getOrThrow(decodeReceipt({ ...c.receipt, [field]: value }));
  expect(validateReceipt(c.identity, c.contract, receipt)).toEqual(
    Result.fail({ _tag: 'IdentityMismatch', field }),
  );
}
test.each([
  ['runId', 'run-other'],
  ['attemptId', 'attempt-other'],
  ['generation', 4],
  ['candidateDigest', 'b'.repeat(64)],
  ['contractId', 'contract-other'],
  ['contractDigest', 'd'.repeat(64)],
] as const)('refuses distinct receipt %s', identityMismatch);

function bindingPrecedence() {
  const c = makeEvidenceCase();
  const receipt = Result.getOrThrow(
    decodeReceipt({
      ...c.receipt,
      runId: 'other',
      attemptId: 'other',
      generation: 4,
      candidateDigest: 'b'.repeat(64),
      contractId: 'other',
      contractDigest: 'd'.repeat(64),
    }),
  );
  expect(validateReceipt(c.identity, { ...c.contract, requiredChecks: [] }, receipt)).toEqual(
    Result.fail({ _tag: 'InvalidContract' }),
  );
  expect(
    validateReceipt(c.identity, { ...c.contract, contractId: receipt.contractId }, receipt),
  ).toEqual(Result.fail({ _tag: 'IdentityMismatch', field: 'contractId' }));
  expect(
    validateReceipt(c.identity, { ...c.contract, contractDigest: receipt.contractDigest }, receipt),
  ).toEqual(Result.fail({ _tag: 'IdentityMismatch', field: 'contractDigest' }));
  expect(validateReceipt(c.identity, c.contract, receipt)).toEqual(
    Result.fail({ _tag: 'IdentityMismatch', field: 'runId' }),
  );
}
test(
  'checks contract binding before receipt identity and identity in field order',
  bindingPrecedence,
);

function incompleteEvidence(
  checks: unknown,
  reason: Extract<QualificationRefusal, { _tag: 'IncompleteVerification' }>['reason'],
  checkId: string,
) {
  const c = makeEvidenceCase();
  const receipt = Result.getOrThrow(decodeReceipt({ ...c.receipt, checks }));
  const expectedCheckId = CheckId.make(checkId);
  expect(validateReceipt(c.identity, c.contract, receipt)).toEqual(
    Result.fail({ _tag: 'IncompleteVerification', reason, checkId: expectedCheckId }),
  );
}
test.each([
  [[], 'MissingCheck', 'lint'],
  [[{ checkId: 'types', outcome: 'Failed' }], 'MissingCheck', 'lint'],
  [
    [
      { checkId: 'z', outcome: 'Passed' },
      { checkId: 'x', outcome: 'Passed' },
      { checkId: 'x', outcome: 'Passed' },
    ],
    'DuplicateCheck',
    'x',
  ],
  [
    [
      { checkId: 'z', outcome: 'Passed' },
      { checkId: 'x', outcome: 'Failed' },
    ],
    'UnknownCheck',
    'z',
  ],
  [
    [
      { checkId: 'lint', outcome: 'Failed' },
      { checkId: 'types', outcome: 'Passed' },
      { checkId: 'tests', outcome: 'Passed' },
    ],
    'NonPassingCheck',
    'lint',
  ],
  [
    [
      { checkId: 'tests', outcome: 'NotRun' },
      { checkId: 'types', outcome: 'Failed' },
      { checkId: 'lint', outcome: 'Passed' },
    ],
    'NonPassingCheck',
    'tests',
  ],
] as const)('refuses incomplete evidence with precedence %j', incompleteEvidence);

function permutedEvidence() {
  const c = makeEvidenceCase();
  const result = validateReceipt(
    c.identity,
    {
      ...c.contract,
      requiredChecks: [CheckId.make('tests'), CheckId.make('lint'), CheckId.make('types')],
    },
    { ...c.receipt, checks: [...c.receipt.checks].reverse() },
  );
  expect(Result.isSuccess(result)).toBe(true);
}
test('permutations of complete evidence and required checks still pass', permutedEvidence);
