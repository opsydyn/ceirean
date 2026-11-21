import { expect, test } from 'bun:test';

import {
  CheckId,
  ContractId,
  type CandidateIdentity,
  type VerificationContract,
} from '@ceirean/domain';
import { Effect, Layer, Result, Schedule, Schema } from 'effect';

import { makeEvidenceCase } from '../../domain/tests/fixtures.ts';
import { MigrationSandbox, TIMEOUT_EXIT_CODE } from '../src/migration-sandbox-port.ts';
import { makeSandboxVerifier } from '../src/sandbox-verifier.ts';
import type { PlanStep, VerificationPlan } from '../src/verification-plan.ts';
import { makeFakeSandbox, type FakeSandboxScript } from './fake-sandbox.ts';

function step(name: string): PlanStep {
  return { checkId: CheckId.make(name), command: `bun run ${name}`, timeoutSeconds: 60 };
}

function planFor(contract: VerificationContract): VerificationPlan {
  return {
    contractId: contract.contractId,
    contractDigest: contract.contractDigest,
    steps: [step('lint'), step('types'), step('tests')],
  };
}

const resolveMatching = (contract: VerificationContract) => Result.succeed(planFor(contract));

/** Workflow only: the capability as an Effect that still needs a sandbox. */
/** Same shape as the default policy, without the five-second waits. */
const FAST_RETRIES = { times: 2, schedule: Schedule.spaced('1 millis') };

function verificationProgram(
  resolve: (contract: VerificationContract) => Result.Result<VerificationPlan, never>,
  identity: CandidateIdentity,
  contract: VerificationContract,
) {
  function* program() {
    const verifier = yield* makeSandboxVerifier(resolve, FAST_RETRIES);
    return yield* verifier.verify({ identity, contract });
  }
  const effect = Effect.gen(program);
  return effect;
}

/**
 * Run the capability against a scripted sandbox and capture the failure
 * channel, so a test can assert on an outcome or an operational failure and on
 * the sandbox log together. The plan resolver is the caller's, so a test can
 * hand in a plan that disagrees with the contract.
 */
async function runVerifier(
  script: Omit<FakeSandboxScript, 'runId'>,
  resolve: (contract: VerificationContract) => Result.Result<VerificationPlan, never>,
) {
  const { identity, contract } = makeEvidenceCase();
  const fake = makeFakeSandbox({ ...script, runId: identity.runId });
  const program = verificationProgram(resolve, identity, contract);
  const layer = Layer.succeed(MigrationSandbox, fake.sandbox);
  const provided = Effect.provide(program, layer);
  const captured = Effect.result(provided);
  const exit = await Effect.runPromise(captured);
  return { exit, identity, log: fake.log() };
}

const isProjected = Schema.is(Schema.Struct({ _tag: Schema.Literal('Projected') }));
const isRefused = Schema.is(Schema.Struct({ _tag: Schema.Literal('PlanRefused') }));

async function everyCheckPassing() {
  const { exit, log } = await runVerifier({ exitCodes: [0, 0, 0] }, resolveMatching);
  const verification = Result.getOrThrow(exit);
  expect(isProjected(verification)).toBe(true);
  expect(log.commands).toEqual(['bun run lint', 'bun run types', 'bun run tests']);
  expect(log).toMatchObject({ prepared: 1, released: 1 });
}
test('every check passing runs the plan in order and releases the sandbox', everyCheckPassing);

async function receiptOfPassingRun() {
  const { exit } = await runVerifier({ exitCodes: [0, 0, 0] }, resolveMatching);
  const verification = Result.getOrThrow(exit);
  expect(verification).toMatchObject({
    _tag: 'Projected',
    receipt: {
      checks: [
        { checkId: CheckId.make('lint'), outcome: 'Passed' },
        { checkId: CheckId.make('types'), outcome: 'Passed' },
        { checkId: CheckId.make('tests'), outcome: 'Passed' },
      ],
    },
  });
}
test('a passing run produces a receipt the domain can judge', receiptOfPassingRun);

async function haltsAtFirstFailure() {
  const { exit, log } = await runVerifier({ exitCodes: [0, 1] }, resolveMatching);
  const verification = Result.getOrThrow(exit);
  // The third command must never run: that is the whole point of halting.
  expect(log.commands).toEqual(['bun run lint', 'bun run types']);
  expect(verification).toMatchObject({
    _tag: 'Projected',
    receipt: {
      checks: [
        { checkId: CheckId.make('lint'), outcome: 'Passed' },
        { checkId: CheckId.make('types'), outcome: 'Failed' },
        { checkId: CheckId.make('tests'), outcome: 'NotRun' },
      ],
    },
  });
  expect(log.released).toBe(1);
}
test('a failing check stops the run and the rest are never executed', haltsAtFirstFailure);

async function killedCommandFails() {
  const { exit, log } = await runVerifier({ exitCodes: [TIMEOUT_EXIT_CODE] }, resolveMatching);
  const verification = Result.getOrThrow(exit);
  expect(log.commands).toEqual(['bun run lint']);
  expect(verification).toMatchObject({
    _tag: 'Projected',
    receipt: {
      checks: [
        { checkId: CheckId.make('lint'), outcome: 'Failed' },
        { checkId: CheckId.make('types'), outcome: 'NotRun' },
        { checkId: CheckId.make('tests'), outcome: 'NotRun' },
      ],
    },
  });
}
test('a command the sandbox killed counts as a failed check', killedCommandFails);

async function foreignPlanNeverTouchesSandbox() {
  const resolveForeign = (contract: VerificationContract) =>
    Result.succeed({ ...planFor(contract), contractId: ContractId.make('another-contract') });
  const { exit, log } = await runVerifier({}, resolveForeign);
  const verification = Result.getOrThrow(exit);
  expect(isRefused(verification)).toBe(true);
  expect(log).toMatchObject({ prepared: 0, released: 0, commands: [] });
}
test(
  'a plan naming another contract is refused before the sandbox is touched',
  foreignPlanNeverTouchesSandbox,
);

async function incompletePlanNeverTouchesSandbox() {
  const resolveShort = (contract: VerificationContract) =>
    Result.succeed({ ...planFor(contract), steps: [step('lint')] });
  const { exit, log } = await runVerifier({}, resolveShort);
  const verification = Result.getOrThrow(exit);
  expect(verification).toMatchObject({
    _tag: 'PlanRefused',
    refusal: { _tag: 'PlanCoverage', reason: 'MissingCheck' },
  });
  expect(log.prepared).toBe(0);
}
test('a plan missing a required check cannot run at all', incompletePlanNeverTouchesSandbox);

async function failureToPrepare() {
  const { exit, identity, log } = await runVerifier({ failPrepare: true }, resolveMatching);
  expect(exit).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'CandidateVerifierError', runId: identity.runId, code: 'VerificationFailed' },
  });
  expect(log.commands).toEqual([]);
}
test(
  'a sandbox that cannot be prepared is an operational failure, not a refusal',
  failureToPrepare,
);

async function releaseAfterExecFailure() {
  const { exit, log } = await runVerifier({ failExec: true }, resolveMatching);
  expect(exit).toMatchObject({ _tag: 'Failure' });
  // The sandbox was acquired, so it must have been released despite the failure.
  expect(log).toMatchObject({ prepared: 1, released: 1 });
}
test('a sandbox is released even when a command fails outright', releaseAfterExecFailure);

async function recoversFromAContainerSwap() {
  // The container is replaced after the first command, so the second step
  // finds no checkout and the capability has to re-provision before running.
  const { exit, log } = await runVerifier(
    { exitCodes: [0, 0, 0], swapContainerAfter: [0] },
    resolveMatching,
  );
  const verification = Result.getOrThrow(exit);
  expect(isProjected(verification)).toBe(true);
  expect(log.commands).toEqual(['bun run lint', 'bun run types', 'bun run tests']);
  // Once to start, once to recover.
  expect(log.prepared).toBe(2);
  expect(log.readinessChecks).toBe(3);
}
test('a replaced container is re-provisioned mid-plan', recoversFromAContainerSwap);

async function retriesATransientSandboxFailure() {
  const { exit, log } = await runVerifier(
    { exitCodes: [0, 0, 0], failExecAttempts: 1 },
    resolveMatching,
  );
  const verification = Result.getOrThrow(exit);
  expect(isProjected(verification)).toBe(true);
  // Four attempts for three commands: the first threw and was retried.
  expect(log.execAttempts).toBe(4);
  expect(log.commands).toEqual(['bun run lint', 'bun run types', 'bun run tests']);
}
test('a transient sandbox failure is retried', retriesATransientSandboxFailure);

async function neverRetriesAFailingCheck() {
  const { exit, log } = await runVerifier({ exitCodes: [0, 1] }, resolveMatching);
  const verification = Result.getOrThrow(exit);
  expect(isProjected(verification)).toBe(true);
  // Two commands, two attempts. A non-zero exit is a result, so the retry
  // policy cannot see it; a third entry here would mean the suite was re-run.
  expect(log.commands).toEqual(['bun run lint', 'bun run types']);
  expect(log.execAttempts).toBe(2);
}
test('a check that fails is never retried', neverRetriesAFailingCheck);
