import { Arbitrary, Array, Option, Schema } from 'effect';

import {
  AttemptId,
  CandidateIdentity,
  CheckId,
  ContractId,
  Digest,
  FrozenRun,
  RunId,
  VerificationContract,
  VerificationReceipt,
} from '../src/index.ts';

export const makeFrozenRun = () =>
  FrozenRun.make({
    _tag: 'Frozen',
    ...makeEvidenceCase().identity,
    deadlineMs: 1000,
    spentMicros: 17,
    repairs: 1,
  });

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

export const runCaseArbitrary = Arbitrary.map(
  Arbitrary.all({
    evidence: evidenceCaseArbitrary,
    limits: Arbitrary.schema(
      Schema.Struct({
        deadlineMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
        spentMicros: Schema.Int.check(
          Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        ),
        repairs: Schema.Int.check(
          Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      }),
    ),
  }),
  ({ evidence, limits }) => ({
    ...evidence,
    run: FrozenRun.make({ _tag: 'Frozen', ...evidence.identity, ...limits }),
    nowMs: limits.deadlineMs - 1,
  }),
);

// Replacement is fixture seeding only: a new validated identity, never a retry command.
function replaceFrozenRun(before: FrozenRun, increment: number) {
  const generation = before.generation + increment;
  return FrozenRun.make({
    ...before,
    attemptId: AttemptId.make(`${before.attemptId}-replacement-${generation}`),
    generation,
  });
}

export type RunCase = typeof runCaseArbitrary extends Arbitrary.Arbitrary<infer A> ? A : never;

const incrementSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }));
const indexSchema = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 23 }));
const incrementArbitrary = Arbitrary.schema(incrementSchema);
const indexArbitrary = Arbitrary.schema(indexSchema);
const booleanArbitrary = Arbitrary.schema(Schema.Boolean);
const observationArbitrary = Arbitrary.all({ old: booleanArbitrary, index: indexArbitrary });
const sequenceInputArbitrary = Arbitrary.all({
  evidence: runCaseArbitrary,
  increments: Arbitrary.array(incrementArbitrary, { maxLength: 24 }),
  cancel: booleanArbitrary,
  observations: Arbitrary.array(observationArbitrary, { minLength: 1, maxLength: 25 }),
});

type SequenceInput = typeof sequenceInputArbitrary extends Arbitrary.Arbitrary<infer A> ? A : never;
function seedSequence(input: SequenceInput) {
  const initial = FrozenRun.make({
    ...input.evidence.run,
    generation: Math.min(input.evidence.run.generation, Number.MAX_SAFE_INTEGER - 768),
  });
  const history = Array.scan(input.increments, initial, replaceFrozenRun);
  const current = Option.getOrThrow(Array.last(history));
  return { ...input, initial, history, current };
}

// At most 24 replacements + one cancellation + 25 observations = 50 entries.
export const sequenceCaseArbitrary = Arbitrary.map(sequenceInputArbitrary, seedSequence);
export type SequenceCase = ReturnType<typeof seedSequence>;
