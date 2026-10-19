import { Schema } from 'effect';

const Identifier = Schema.String.check(Schema.isPattern(/\S/));
export const RunId = Identifier.pipe(Schema.brand('RunId'));
export type RunId = typeof RunId.Type;
export const AttemptId = Identifier.pipe(Schema.brand('AttemptId'));
export type AttemptId = typeof AttemptId.Type;
export const ContractId = Identifier.pipe(Schema.brand('ContractId'));
export type ContractId = typeof ContractId.Type;
export const CheckId = Identifier.pipe(Schema.brand('CheckId'));
export type CheckId = typeof CheckId.Type;
export const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(
  Schema.brand('Digest'),
);
export type Digest = typeof Digest.Type;
export const NonNegativeSafeInteger = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export type NonNegativeSafeInteger = typeof NonNegativeSafeInteger.Type;

export const CandidateIdentity = Schema.Struct({
  runId: RunId,
  attemptId: AttemptId,
  generation: NonNegativeSafeInteger,
  candidateDigest: Digest,
  contractId: ContractId,
  contractDigest: Digest,
});
export type CandidateIdentity = typeof CandidateIdentity.Type;
