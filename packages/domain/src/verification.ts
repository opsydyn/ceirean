import { Array, HashSet, Match, Option, Result, Schema } from 'effect';

import { CandidateIdentity, CheckId, ContractId, Digest } from './identities.ts';

const identityFields = [
  'runId',
  'attemptId',
  'generation',
  'candidateDigest',
  'contractId',
  'contractDigest',
] as const;

export const QualificationRefusal = Schema.Union([
  Schema.TaggedStruct('InvalidContract', {}),
  Schema.TaggedStruct('InvalidReceipt', {}),
  Schema.TaggedStruct('IdentityMismatch', { field: Schema.Literals(identityFields) }),
  Schema.TaggedStruct('IncompleteVerification', {
    reason: Schema.Literals(['MissingCheck', 'DuplicateCheck', 'UnknownCheck', 'NonPassingCheck']),
    checkId: CheckId,
  }),
  Schema.TaggedStruct('InvalidPhase', { phase: Schema.String }),
  Schema.TaggedStruct('DeadlineExpired', {}),
  Schema.TaggedStruct('InvalidTime', {}),
]);
export type QualificationRefusal = typeof QualificationRefusal.Type;

export const VerificationContract = Schema.Struct({
  contractId: ContractId,
  contractDigest: Digest,
  requiredChecks: Schema.Array(CheckId).check(Schema.isMinLength(1), Schema.isUnique()),
});
export type VerificationContract = typeof VerificationContract.Type;
export const VerificationReceipt = Schema.Struct({
  ...CandidateIdentity.fields,
  checks: Schema.Array(
    Schema.Struct({ checkId: CheckId, outcome: Schema.Literals(['Passed', 'Failed', 'NotRun']) }),
  ),
});
export type VerificationReceipt = typeof VerificationReceipt.Type;

export function decodeContract(
  input: unknown,
): Result.Result<VerificationContract, QualificationRefusal> {
  const result = Schema.decodeUnknownResult(VerificationContract)(input);
  return Result.mapError(result, () => ({ _tag: 'InvalidContract' as const }));
}

export function decodeReceipt(
  input: unknown,
): Result.Result<VerificationReceipt, QualificationRefusal> {
  const result = Schema.decodeUnknownResult(VerificationReceipt)(input);
  return Result.mapError(result, () => ({ _tag: 'InvalidReceipt' as const }));
}

function checkIdentity<K extends keyof CandidateIdentity>(
  expected: CandidateIdentity,
  actual: Pick<CandidateIdentity, K>,
  fields: readonly K[],
): Result.Result<void, QualificationRefusal> {
  const mismatch = Array.findFirst(fields, (field) => expected[field] !== actual[field]);
  return Option.match(mismatch, {
    onNone: () => Result.succeed(undefined),
    onSome: (field) => Result.fail({ _tag: 'IdentityMismatch' as const, field }),
  });
}

function checkCompleteness(
  offending: Option.Option<CheckId>,
  reason: Extract<QualificationRefusal, { readonly _tag: 'IncompleteVerification' }>['reason'],
): Result.Result<void, QualificationRefusal> {
  return Option.match(offending, {
    onNone: () => Result.succeed(undefined),
    onSome: (checkId) => Result.fail({ _tag: 'IncompleteVerification' as const, reason, checkId }),
  });
}

const isNonPassing = Match.type<VerificationReceipt['checks'][number]['outcome']>().pipe(
  Match.when('Passed', () => false),
  Match.when('Failed', () => true),
  Match.when('NotRun', () => true),
  Match.exhaustive,
);

export function validateReceipt(
  identity: CandidateIdentity,
  contract: VerificationContract,
  receipt: VerificationReceipt,
): Result.Result<VerificationReceipt, QualificationRefusal> {
  function* validateEvidence() {
    yield* decodeContract(contract);
    yield* checkIdentity(identity, contract, ['contractId', 'contractDigest']);
    yield* checkIdentity(identity, receipt, identityFields);

    // Separate passes preserve refusal-class precedence regardless of evidence order.
    const checkIds = Array.map(receipt.checks, (check) => check.checkId);
    const duplicate = Array.findFirst(checkIds, (checkId, index) =>
      Array.contains(Array.take(checkIds, index), checkId),
    );
    yield* checkCompleteness(duplicate, 'DuplicateCheck');
    const required = HashSet.fromIterable(contract.requiredChecks);
    const unknown = Array.findFirst(checkIds, (checkId) => !HashSet.has(required, checkId));
    yield* checkCompleteness(unknown, 'UnknownCheck');
    const supplied = HashSet.fromIterable(checkIds);
    const missing = Array.findFirst(
      contract.requiredChecks,
      (checkId) => !HashSet.has(supplied, checkId),
    );
    yield* checkCompleteness(missing, 'MissingCheck');
    const nonPassing = Array.findFirst(receipt.checks, (check) => isNonPassing(check.outcome));
    yield* checkCompleteness(
      Option.map(nonPassing, (check) => check.checkId),
      'NonPassingCheck',
    );
    return receipt;
  }
  return Result.gen(validateEvidence);
}
