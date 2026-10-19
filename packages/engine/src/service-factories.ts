import type { RunId } from '@leviathan/domain';
import { Effect, Option, Result } from 'effect';

import type { CommitResult, RunChange, RunSnapshot, VerificationRequest } from './contracts.ts';
import { CandidateVerifierError, RunRepositoryError } from './errors.ts';

export interface RunRepositoryDriver {
  readonly load: (runId: RunId) => Result.Result<Option.Option<RunSnapshot>, RunRepositoryError>;
  readonly commit: (change: RunChange) => Result.Result<CommitResult, RunRepositoryError>;
}

export type CandidateVerifierDriver = (
  request: VerificationRequest,
  signal: AbortSignal,
) => Promise<Result.Result<unknown, CandidateVerifierError>>;

export function makeRunRepository(driver: RunRepositoryDriver) {
  return {
    load: (runId: RunId) =>
      Effect.try({
        try: () => driver.load(runId),
        catch: () => new RunRepositoryError({ operation: 'load', runId, code: 'ReadFailed' }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.withSpan('RunRepository.load')),
    commit: (change: RunChange) =>
      Effect.try({
        try: () => driver.commit(change),
        catch: () =>
          new RunRepositoryError({
            operation: 'commit',
            runId: change.runId,
            code: 'CommitFailed',
          }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.withSpan('RunRepository.commit')),
  };
}

export function makeCandidateVerifier(driver: CandidateVerifierDriver) {
  return {
    verify: (request: VerificationRequest) =>
      Effect.tryPromise({
        try: (signal) => driver(request, signal),
        catch: () =>
          new CandidateVerifierError({ runId: request.identity.runId, code: 'VerificationFailed' }),
      }).pipe(Effect.flatMap(Effect.fromResult), Effect.withSpan('CandidateVerifier.verify')),
  };
}
