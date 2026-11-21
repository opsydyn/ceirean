/**
 * The missing middle of the migration capability.
 *
 * The domain already owns the acceptance contract: which checks a candidate
 * must pass (`VerificationContract`), what a receipt of those checks looks
 * like (`VerificationReceipt`), and whether a receipt qualifies a run
 * (`validateReceipt`, `decideQualification`). The `CandidateVerifier` port
 * already states that something must produce a receipt. Nothing said how.
 *
 * A plan is that how, and it is deliberately dumb: an ordered list of
 * commands, one per required check, bound to the contract it satisfies. It
 * holds no policy of its own — a plan that does not cover exactly the
 * contract's required checks is refused before anything runs, so a candidate
 * can never be qualified by a plan that quietly omitted a check.
 *
 * Everything here is pure. Running the commands is the sandbox's job; turning
 * what happened into a receipt is this module's.
 */

import {
  CandidateIdentity,
  CheckId,
  ContractId,
  Digest,
  NonNegativeSafeInteger,
  VerificationContract,
  VerificationReceipt,
} from '@ceirean/domain';
import { Array, HashSet, Match, Option, Result, Schema } from 'effect';

const printableCharacter = (character: string) => {
  const code = character.charCodeAt(0);
  return code >= 32 && code !== 127;
};

/**
 * A command line, run by the sandbox inside the checkout. Newlines are
 * excluded so one step is always one command: a step that could smuggle a
 * second command past the timeout bound would make the bound a lie.
 */
const CheckCommand = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter((value: string) => Array.fromIterable(value).every(printableCharacter)),
);

/** Matches the vendored sandbox's own ceiling for a single bounded command. */
export const MAX_STEP_TIMEOUT_SECONDS = 1_800;

const StepTimeoutSeconds = NonNegativeSafeInteger.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(MAX_STEP_TIMEOUT_SECONDS),
);

export const PlanStep = Schema.Struct({
  checkId: CheckId,
  command: CheckCommand,
  timeoutSeconds: StepTimeoutSeconds,
});
export type PlanStep = typeof PlanStep.Type;

export const VerificationPlan = Schema.Struct({
  contractId: ContractId,
  contractDigest: Digest,
  steps: Schema.Array(PlanStep).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});
export type VerificationPlan = typeof VerificationPlan.Type;

export const PlanRefusal = Schema.Union([
  Schema.TaggedStruct('InvalidPlan', {}),
  Schema.TaggedStruct('PlanContractMismatch', {
    field: Schema.Literals(['contractId', 'contractDigest']),
  }),
  Schema.TaggedStruct('PlanCoverage', {
    reason: Schema.Literals(['MissingCheck', 'UnknownCheck', 'DuplicateCheck']),
    checkId: CheckId,
  }),
  Schema.TaggedStruct('PlanResults', {
    reason: Schema.Literals([
      'MissingResult',
      'UnexpectedResult',
      'DuplicateResult',
      'OutOfOrderResult',
    ]),
    checkId: CheckId,
  }),
]);
export type PlanRefusal = typeof PlanRefusal.Type;

/**
 * What the sandbox observed for one step. `Skipped` is a real outcome, not an
 * error: when a step fails there is no point running the rest, and the receipt
 * must say so rather than imply the remaining checks passed.
 */
export const StepResult = Schema.Union([
  Schema.TaggedStruct('Completed', { checkId: CheckId, exitCode: NonNegativeSafeInteger }),
  Schema.TaggedStruct('TimedOut', { checkId: CheckId }),
  Schema.TaggedStruct('Skipped', { checkId: CheckId }),
]);
export type StepResult = typeof StepResult.Type;

export function decodePlan(input: unknown): Result.Result<VerificationPlan, PlanRefusal> {
  const decoded = Schema.decodeUnknownResult(VerificationPlan)(input);
  return Result.mapError(decoded, () => ({ _tag: 'InvalidPlan' as const }));
}

function coverageFailure(
  offending: Option.Option<CheckId>,
  reason: Extract<PlanRefusal, { readonly _tag: 'PlanCoverage' }>['reason'],
): Result.Result<void, PlanRefusal> {
  return Option.match(offending, {
    onNone: () => Result.succeed(undefined),
    onSome: (checkId) => Result.fail({ _tag: 'PlanCoverage' as const, reason, checkId }),
  });
}

function resultsFailure(
  offending: Option.Option<CheckId>,
  reason: Extract<PlanRefusal, { readonly _tag: 'PlanResults' }>['reason'],
): Result.Result<void, PlanRefusal> {
  return Option.match(offending, {
    onNone: () => Result.succeed(undefined),
    onSome: (checkId) => Result.fail({ _tag: 'PlanResults' as const, reason, checkId }),
  });
}

function matchField(
  expected: VerificationContract,
  plan: VerificationPlan,
  field: 'contractId' | 'contractDigest',
): Result.Result<void, PlanRefusal> {
  return Match.value(expected[field] === plan[field]).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () => Result.fail({ _tag: 'PlanContractMismatch' as const, field })),
    Match.exhaustive,
  );
}

/**
 * A plan is usable only against the contract it names, and only when its steps
 * are exactly the contract's required checks: no duplicates, no extras, none
 * missing. Refusal classes are checked in a fixed order so the reported reason
 * does not depend on the order of the plan's steps.
 */
export function validatePlan(
  contract: VerificationContract,
  plan: VerificationPlan,
): Result.Result<VerificationPlan, PlanRefusal> {
  function* validate() {
    yield* decodePlan(plan);
    yield* matchField(contract, plan, 'contractId');
    yield* matchField(contract, plan, 'contractDigest');

    const planned = Array.map(plan.steps, (step) => step.checkId);
    const duplicate = Array.findFirst(planned, (checkId, index) =>
      Array.contains(Array.take(planned, index), checkId),
    );
    yield* coverageFailure(duplicate, 'DuplicateCheck');

    const required = HashSet.fromIterable(contract.requiredChecks);
    const unknown = Array.findFirst(planned, (checkId) => !HashSet.has(required, checkId));
    yield* coverageFailure(unknown, 'UnknownCheck');

    const supplied = HashSet.fromIterable(planned);
    const missing = Array.findFirst(
      contract.requiredChecks,
      (checkId) => !HashSet.has(supplied, checkId),
    );
    yield* coverageFailure(missing, 'MissingCheck');

    return plan;
  }
  return Result.gen(validate);
}

const outcomeOfExit = Match.type<boolean>().pipe(
  Match.when(true, () => 'Passed' as const),
  Match.when(false, () => 'Failed' as const),
  Match.exhaustive,
);

const outcomeOfResult = Match.type<StepResult>().pipe(
  Match.tag('Completed', ({ exitCode }) => outcomeOfExit(exitCode === 0)),
  Match.tag('TimedOut', () => 'Failed' as const),
  Match.tag('Skipped', () => 'NotRun' as const),
  Match.exhaustive,
);

/** The outcome a single step's observation implies. Exported for tests. */
export function outcomeOf(result: StepResult): VerificationReceipt['checks'][number]['outcome'] {
  return outcomeOfResult(result);
}

/**
 * Project what the sandbox observed onto a receipt the domain can judge.
 *
 * The results must line up with the plan one for one and in order. That is
 * strictness for its own sake only until you consider the alternative: a
 * projection that tolerated a short or reordered result list would decide, on
 * its own, what happened to the steps it could not account for. Refusing is
 * the only honest answer, and the domain then never sees a receipt that was
 * partly invented here.
 */
export function projectReceipt(
  identity: CandidateIdentity,
  plan: VerificationPlan,
  results: readonly StepResult[],
): Result.Result<VerificationReceipt, PlanRefusal> {
  function* project() {
    const planned = Array.map(plan.steps, (step) => step.checkId);
    const reported = Array.map(results, (result) => result.checkId);

    const plannedSet = HashSet.fromIterable(planned);
    const unexpected = Array.findFirst(reported, (checkId) => !HashSet.has(plannedSet, checkId));
    yield* resultsFailure(unexpected, 'UnexpectedResult');

    // Without this a trailing repeat of a planned check slips past the set and
    // order tests below and reaches the domain, which refuses it as a
    // duplicate. Refusing here keeps the reason about what the sandbox
    // reported rather than about the receipt it produced.
    const repeated = Array.findFirst(reported, (checkId, index) =>
      Array.contains(Array.take(reported, index), checkId),
    );
    yield* resultsFailure(repeated, 'DuplicateResult');

    const reportedSet = HashSet.fromIterable(reported);
    const absent = Array.findFirst(planned, (checkId) => !HashSet.has(reportedSet, checkId));
    yield* resultsFailure(absent, 'MissingResult');

    const misordered = Array.findFirst(
      planned,
      (checkId, index) => Option.getOrUndefined(Array.get(reported, index)) !== checkId,
    );
    yield* resultsFailure(misordered, 'OutOfOrderResult');

    const checks = Array.map(results, (result) => ({
      checkId: result.checkId,
      outcome: outcomeOf(result),
    }));
    const receipt = Schema.decodeUnknownResult(VerificationReceipt)({ ...identity, checks });
    return yield* Result.mapError(receipt, () => ({ _tag: 'InvalidPlan' as const }));
  }
  return Result.gen(project);
}
