import { expect, test } from 'bun:test';

import { CheckId, ContractId, Digest, decideQualification } from '@ceirean/domain';
import { Arbitrary, Effect, Match, Result, Schema } from 'effect';

import { makeEvidenceCase, makeFrozenRun } from '../../domain/tests/fixtures.ts';
import { checkLaw } from '../../domain/tests/properties.ts';
import {
  MAX_STEP_TIMEOUT_SECONDS,
  outcomeOf,
  projectReceipt,
  validatePlan,
  type PlanStep,
  type StepResult,
  type VerificationPlan,
} from '../src/verification-plan.ts';

const QUALIFYING_TIME_MS = 999;

function step(name: string): PlanStep {
  return { checkId: CheckId.make(name), command: `bun run ${name}`, timeoutSeconds: 60 };
}

function makePlan(steps: readonly PlanStep[] = [step('lint'), step('types'), step('tests')]) {
  const { contract } = makeEvidenceCase();
  const plan: VerificationPlan = {
    contractId: contract.contractId,
    contractDigest: contract.contractDigest,
    steps,
  };
  return { contract, plan };
}

function coveringPlanIsAccepted() {
  const { contract, plan } = makePlan();
  const validated = validatePlan(contract, plan);
  expect(Result.isSuccess(validated)).toBe(true);
}
test('a plan covering exactly the required checks is accepted', coveringPlanIsAccepted);

test('the step timeout ceiling matches the sandbox that will run it', () => {
  expect(MAX_STEP_TIMEOUT_SECONDS).toBe(1_800);
});

const mismatches = [
  { field: 'contractId', mutate: () => ({ contractId: ContractId.make('other-contract') }) },
  { field: 'contractDigest', mutate: () => ({ contractDigest: Digest.make('b'.repeat(64)) }) },
];
function refusedForeignContract({
  field,
  mutate,
}: {
  field: string;
  mutate: () => Partial<VerificationPlan>;
}) {
  const { contract, plan } = makePlan();
  const refused = validatePlan(contract, { ...plan, ...mutate() });
  expect(refused).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'PlanContractMismatch', field },
  });
}
test.each(mismatches)('a plan naming another $field cannot run', refusedForeignContract);

const coverageCases = [
  { reason: 'DuplicateCheck', steps: [step('lint'), step('lint'), step('types'), step('tests')] },
  { reason: 'UnknownCheck', steps: [step('lint'), step('types'), step('tests'), step('audit')] },
  { reason: 'MissingCheck', steps: [step('lint'), step('types')] },
];
function refusedCoverage({ reason, steps }: { reason: string; steps: readonly PlanStep[] }) {
  const { contract, plan } = makePlan(steps);
  const refused = validatePlan(contract, plan);
  expect(refused).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'PlanCoverage', reason },
  });
}
test.each(coverageCases)('a plan with a $reason cannot run', refusedCoverage);

const completed = (name: string, exitCode: number): StepResult => ({
  _tag: 'Completed',
  checkId: CheckId.make(name),
  exitCode,
});
const timedOut = (name: string): StepResult => ({ _tag: 'TimedOut', checkId: CheckId.make(name) });
const skipped = (name: string): StepResult => ({ _tag: 'Skipped', checkId: CheckId.make(name) });

const outcomes: {
  label: string;
  result: StepResult;
  outcome: ReturnType<typeof outcomeOf>;
}[] = [
  { label: 'a zero exit', result: completed('lint', 0), outcome: 'Passed' },
  { label: 'a non-zero exit', result: completed('lint', 1), outcome: 'Failed' },
  { label: 'a killed command', result: timedOut('lint'), outcome: 'Failed' },
  { label: 'a step never reached', result: skipped('lint'), outcome: 'NotRun' },
];
test.each(outcomes)('$label becomes $outcome', ({ result, outcome }) => {
  expect(outcomeOf(result)).toBe(outcome);
});

function haltedRunReportsTheRestAsNotRun() {
  const { identity } = makeEvidenceCase();
  const { plan } = makePlan();
  const results = [completed('lint', 0), completed('types', 2), skipped('tests')];
  const projected = projectReceipt(identity, plan, results);
  const receipt = Result.getOrThrow(projected);
  expect(receipt.checks).toEqual([
    { checkId: CheckId.make('lint'), outcome: 'Passed' },
    { checkId: CheckId.make('types'), outcome: 'Failed' },
    { checkId: CheckId.make('tests'), outcome: 'NotRun' },
  ]);
}
test(
  'a run that stopped early reports the rest as not run, never as passed',
  haltedRunReportsTheRestAsNotRun,
);

const projectionRefusals = [
  {
    reason: 'UnexpectedResult',
    results: [completed('lint', 0), completed('types', 0), completed('audit', 0)],
  },
  { reason: 'MissingResult', results: [completed('lint', 0), completed('types', 0)] },
  {
    reason: 'DuplicateResult',
    results: [
      completed('lint', 0),
      completed('types', 0),
      completed('tests', 0),
      completed('lint', 0),
    ],
  },
  {
    reason: 'OutOfOrderResult',
    results: [completed('types', 0), completed('lint', 0), completed('tests', 0)],
  },
];
function refusedProjection({
  reason,
  results,
}: {
  reason: string;
  results: readonly StepResult[];
}) {
  const { identity } = makeEvidenceCase();
  const { plan } = makePlan();
  const projected = projectReceipt(identity, plan, results);
  expect(projected).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'PlanResults', reason },
  });
}
test.each(projectionRefusals)(
  'results the plan cannot account for are refused as $reason',
  refusedProjection,
);

const resultOfKind = Match.type<{ readonly kind: string; readonly name: string }>().pipe(
  Match.when({ kind: 'pass' }, ({ name }) => completed(name, 0)),
  Match.when({ kind: 'fail' }, ({ name }) => completed(name, 1)),
  Match.when({ kind: 'timeout' }, ({ name }) => timedOut(name)),
  Match.orElse(({ name }) => skipped(name)),
);

const Kind = Schema.Literals(['pass', 'fail', 'timeout', 'skip']);
const isPassing = Schema.is(Schema.Literal('pass'));
const isAccepted = Match.type<{ readonly _tag: string }>().pipe(
  Match.when({ _tag: 'Accepted' }, () => true),
  Match.orElse(() => false),
);
const kinds = Arbitrary.all({
  lint: Arbitrary.schema(Kind),
  types: Arbitrary.schema(Kind),
  tests: Arbitrary.schema(Kind),
});

/**
 * The law that ties this module to the domain: a candidate qualifies exactly
 * when every planned check completed with a zero exit. Nothing else — not a
 * timeout, not a step the run never reached — may produce an accepted run.
 */
function qualifiesOnlyWhenEverythingPassed(sample: { lint: string; types: string; tests: string }) {
  const { identity, contract } = makeEvidenceCase();
  const { plan } = makePlan();
  const results = [
    resultOfKind({ kind: sample.lint, name: 'lint' }),
    resultOfKind({ kind: sample.types, name: 'types' }),
    resultOfKind({ kind: sample.tests, name: 'tests' }),
  ];
  const everythingPassed = Object.values(sample).every(isPassing);
  const projected = projectReceipt(identity, plan, results);
  const decided = Result.map(projected, (receipt) =>
    decideQualification(makeFrozenRun(), contract, receipt, QUALIFYING_TIME_MS),
  );
  const accepted = Result.match(decided, {
    onFailure: () => false,
    onSuccess: isAccepted,
  });
  return accepted === everythingPassed;
}

test('law: a candidate qualifies exactly when every planned check passed', async () => {
  await Effect.runPromise(checkLaw('plan qualification', kinds, qualifiesOnlyWhenEverythingPassed));
}, 60000);
