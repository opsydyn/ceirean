/**
 * The migration capability: run an acceptance contract's checks in a sandbox
 * and return a receipt the domain can judge.
 *
 * Three properties are the point of this module, and each is a decision that
 * could have gone the other way:
 *
 * 1. The plan is validated against the contract before the sandbox is touched.
 *    A plan that does not cover exactly the required checks cannot run at all,
 *    so no candidate is ever qualified by a plan that quietly skipped one.
 * 2. Steps stop at the first failure, and the rest are reported `Skipped`,
 *    which the domain reads as `NotRun` and refuses. Continuing would burn
 *    time producing a receipt that cannot qualify; reporting the remainder as
 *    passed would be a lie.
 * 3. The sandbox is released on every path — success, refusal, failure or
 *    interruption — because `Effect.acquireRelease` owns it rather than the
 *    happy path.
 *
 * It decides nothing about acceptance. It produces evidence;
 * `decideQualification` judges it.
 */

import type { VerificationContract } from '@ceirean/domain';
import { Array, Context, Effect, Match, Option, Result, Schema } from 'effect';

import type { VerificationRequest } from './contracts.ts';
import { CandidateVerifierError } from './errors.ts';
import {
  MigrationSandbox,
  TIMEOUT_EXIT_CODE,
  type SandboxCommand,
  type SandboxExecution,
} from './migration-sandbox-port.ts';
import {
  PlanRefusal,
  projectReceipt,
  validatePlan,
  type PlanStep,
  type StepResult,
  type VerificationPlan,
} from './verification-plan.ts';

/**
 * Where a plan comes from. A pure function, so the capability stays testable
 * and plan selection cannot do I/O behind the contract's back: resolving a
 * plan from maintainer-controlled repository content happens before this and
 * hands the result in.
 */
export type PlanResolver = (
  contract: VerificationContract,
) => Result.Result<VerificationPlan, PlanRefusal>;

export const SandboxVerification = Schema.Union([
  Schema.TaggedStruct('Projected', { receipt: Schema.Unknown }),
  Schema.TaggedStruct('PlanRefused', { refusal: PlanRefusal }),
]);
export type SandboxVerification = typeof SandboxVerification.Type;

interface PlanProgress {
  readonly results: readonly StepResult[];
  readonly halted: boolean;
}

function startProgress(): PlanProgress {
  return { results: Array.empty<StepResult>(), halted: false };
}

/**
 * The command to run for this step, as a list of none or one.
 *
 * A list rather than an `Option` so the caller runs it with `Effect.forEach`
 * and needs no branch of its own: an empty list performs no command, which is
 * exactly what "an earlier step already failed" should mean.
 */
function commandsFor(progress: PlanProgress, step: PlanStep): readonly SandboxCommand[] {
  const command: SandboxCommand = { command: step.command, timeoutSeconds: step.timeoutSeconds };
  return Match.value(progress.halted).pipe(
    Match.when(true, () => Array.empty<SandboxCommand>()),
    Match.when(false, () => [command]),
    Match.exhaustive,
  );
}

function observed(step: PlanStep, exitCode: number): StepResult {
  return Match.value(exitCode === TIMEOUT_EXIT_CODE).pipe(
    Match.when(true, (): StepResult => ({ _tag: 'TimedOut', checkId: step.checkId })),
    Match.when(false, (): StepResult => ({ _tag: 'Completed', checkId: step.checkId, exitCode })),
    Match.exhaustive,
  );
}

function executed(progress: PlanProgress, step: PlanStep, exitCode: number): PlanProgress {
  return { results: [...progress.results, observed(step, exitCode)], halted: exitCode !== 0 };
}

/** A step the run never reached: not run, rather than passed. */
function notReached(progress: PlanProgress, step: PlanStep): PlanProgress {
  return {
    results: [...progress.results, { _tag: 'Skipped', checkId: step.checkId }],
    halted: true,
  };
}

/** Fold one step's executions, of which there are none or one, into progress. */
function applied(
  progress: PlanProgress,
  step: PlanStep,
  executions: readonly SandboxExecution[],
): PlanProgress {
  const execution = Array.head(executions);
  return Option.match(execution, {
    onNone: () => notReached(progress, step),
    onSome: ({ exitCode }) => executed(progress, step, exitCode),
  });
}

function refusedVerification(refusal: PlanRefusal): SandboxVerification {
  return { _tag: 'PlanRefused', refusal };
}

function projectedVerification(receipt: unknown): SandboxVerification {
  return { _tag: 'Projected', receipt };
}

export function makeSandboxVerifier(resolvePlan: PlanResolver) {
  function* acquire() {
    const sandbox = yield* MigrationSandbox;

    /**
     * A plan refusal is returned, not raised: it is a decision about evidence
     * and the caller records it. Only a sandbox that could not be used at all
     * becomes a `CandidateVerifierError`.
     */
    function verify(request: VerificationRequest) {
      function* verification() {
        const resolved = resolvePlan(request.contract);
        const planned = Result.flatMap(resolved, (plan) => validatePlan(request.contract, plan));

        function runPlan(plan: VerificationPlan) {
          function fold(progress: PlanProgress, step: PlanStep) {
            function* foldOne() {
              const runnable = commandsFor(progress, step);
              const executions = yield* Effect.forEach(runnable, sandbox.exec);
              return applied(progress, step, executions);
            }
            const program = Effect.gen(foldOne);
            return program;
          }
          function* execute() {
            yield* Effect.acquireRelease(sandbox.prepare, () => sandbox.release);
            const finished = yield* Effect.reduce(plan.steps, startProgress, fold);
            const projected = projectReceipt(request.identity, plan, finished.results);
            return Result.match(projected, {
              onFailure: refusedVerification,
              onSuccess: projectedVerification,
            });
          }
          const program = Effect.gen(execute);
          const scoped = Effect.scoped(program);
          return scoped;
        }

        const outcome = Result.match(planned, {
          onFailure: (refusal) => Effect.succeed(refusedVerification(refusal)),
          onSuccess: runPlan,
        });
        return yield* outcome;
      }
      const program = Effect.gen(verification);
      return program.pipe(
        Effect.catchTag('MigrationSandboxError', (error) =>
          Effect.fail(
            new CandidateVerifierError({ runId: error.runId, code: 'VerificationFailed' }),
          ),
        ),
        Effect.withSpan('SandboxVerifier.verify'),
      );
    }

    return { verify };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}

export class SandboxVerifier extends Context.Service<
  SandboxVerifier,
  Effect.Success<ReturnType<typeof makeSandboxVerifier>>
>()('@ceirean/engine/SandboxVerifier') {}
