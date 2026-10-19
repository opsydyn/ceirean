import {
  AttemptId,
  CandidateIdentity,
  CheckId,
  ContractId,
  Digest,
  RunId,
  VerificationContract,
  VerificationReceipt,
} from '../src/index.ts';

export const makeEvidenceCase = () => {
  const identity = CandidateIdentity.make({
    runId: RunId.make('run-1'),
    attemptId: AttemptId.make('attempt-1'),
    generation: 3,
    candidateDigest: Digest.make('a'.repeat(64)),
    contractId: ContractId.make('contract-1'),
    contractDigest: Digest.make('c'.repeat(64)),
  });
  const contract = VerificationContract.make({
    contractId: identity.contractId,
    contractDigest: identity.contractDigest,
    requiredChecks: [CheckId.make('lint'), CheckId.make('types'), CheckId.make('tests')],
  });
  const receipt = VerificationReceipt.make({
    ...identity,
    checks: [
      { checkId: CheckId.make('lint'), outcome: 'Passed' },
      { checkId: CheckId.make('types'), outcome: 'Passed' },
      { checkId: CheckId.make('tests'), outcome: 'Passed' },
    ],
  });
  return { identity, contract, receipt };
};
import { Arbitrary, Schema } from 'effect';

const generatedChecks = VerificationContract.fields.requiredChecks.check(Schema.isMaxLength(8));

export const evidenceCaseArbitrary = Arbitrary.map(
  Arbitrary.all({
    identity: Arbitrary.schema(CandidateIdentity),
    requiredChecks: Arbitrary.schema(generatedChecks),
  }),
  ({ identity, requiredChecks }) => ({
    identity,
    contract: VerificationContract.make({
      contractId: identity.contractId,
      contractDigest: identity.contractDigest,
      requiredChecks,
    }),
    receipt: VerificationReceipt.make({
      ...identity,
      checks: requiredChecks.map((checkId) => ({ checkId, outcome: 'Passed' as const })),
    }),
  }),
);
