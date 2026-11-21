/**
 * The run coordinator driving the sandbox capability, which is the join the
 * two halves of slice 4 were built for: `qualifyRun` loads a run, the
 * capability runs the contract's checks in a sandbox, and the domain decides.
 * No part of this knows about a container — the sandbox is scripted.
 */

import { expect, test } from 'bun:test';

import { CheckId, type VerificationContract } from '@ceirean/domain';
import { Effect, Layer, Result } from 'effect';
import { TestClock } from 'effect/testing';

import { MigrationSandbox } from '../src/migration-sandbox-port.ts';
import { CandidateVerifier, RunRepository } from '../src/ports.ts';
import { qualifyRun } from '../src/run-coordinator.ts';
import { candidateVerifierFromSandbox } from '../src/sandbox-verifier.ts';
import type { PlanStep, VerificationPlan } from '../src/verification-plan.ts';
import { makeFakeSandbox, type FakeSandboxScript } from './fake-sandbox.ts';
import { makeSnapshot } from './fixtures.ts';
import { makeMemoryRepository } from './memory-repository.ts';

const QUALIFYING_TIME_MS = 999;

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

const resolveIncomplete = (contract: VerificationContract) =>
  Result.succeed({ ...planFor(contract), steps: [step('lint')] });

/** Wiring only: repository, scripted sandbox and the verifier built over it. */
function coordinatorLayers(
  repository: typeof RunRepository.Service,
  sandbox: ReturnType<typeof makeFakeSandbox>['sandbox'],
  resolve: (contract: VerificationContract) => Result.Result<VerificationPlan, never>,
) {
  const sandboxLayer = Layer.succeed(MigrationSandbox, sandbox);
  const verifier = Layer.effect(CandidateVerifier, candidateVerifierFromSandbox(resolve));
  return Layer.mergeAll(
    Layer.succeed(RunRepository, repository),
    Layer.provide(verifier, sandboxLayer),
    TestClock.layer(),
  );
}

async function runCoordinator(
  script: Omit<FakeSandboxScript, 'runId'>,
  resolve: (contract: VerificationContract) => Result.Result<VerificationPlan, never>,
) {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  const fake = makeFakeSandbox({ ...script, runId: seed.state.runId });
  function* scenario() {
    yield* TestClock.setTime(QUALIFYING_TIME_MS);
    return yield* qualifyRun(seed.state.runId);
  }
  const layers = coordinatorLayers(memory.service, fake.sandbox, resolve);
  const program = Effect.gen(scenario);
  const provided = Effect.provide(program, layers);
  const outcome = await Effect.runPromise(provided);
  return { outcome, log: fake.log() };
}

async function qualifiesFromSandboxEvidence() {
  const { outcome, log } = await runCoordinator({ exitCodes: [0, 0, 0] }, resolveMatching);
  expect(outcome._tag).toBe('Qualified');
  expect(log.commands).toEqual(['bun run lint', 'bun run types', 'bun run tests']);
  expect(log).toMatchObject({ prepared: 1, released: 1 });
}
test('a run qualifies on evidence the sandbox produced', qualifiesFromSandboxEvidence);

async function failingCheckRefusesTheRun() {
  const { outcome, log } = await runCoordinator({ exitCodes: [0, 1] }, resolveMatching);
  // The domain refuses on the receipt, not on anything the capability decided.
  expect(outcome).toMatchObject({
    _tag: 'Refused',
    refusal: { _tag: 'IncompleteVerification', reason: 'NonPassingCheck' },
  });
  expect(log.commands).toEqual(['bun run lint', 'bun run types']);
}
test('a failing check refuses the run with the domain’s own reason', failingCheckRefusesTheRun);

async function planRefusalReachesTheOutcome() {
  const { outcome, log } = await runCoordinator({}, resolveIncomplete);
  // The reason survives the port's `unknown` instead of arriving as an
  // undecodable receipt, which is what the refusal envelope is for.
  expect(outcome).toMatchObject({
    _tag: 'Refused',
    refusal: { _tag: 'PlanCoverage', reason: 'MissingCheck', checkId: CheckId.make('types') },
  });
  expect(log).toMatchObject({ prepared: 0, commands: [] });
}
test('a plan refusal reaches the outcome with its own reason', planRefusalReachesTheOutcome);
