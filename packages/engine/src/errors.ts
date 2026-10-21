import type { RunId } from '@ceirean/domain';
import { Data } from 'effect';

export class RunRepositoryError extends Data.TaggedError('RunRepositoryError')<{
  readonly operation: 'load' | 'commit';
  readonly runId: RunId;
  readonly code: 'ReadFailed' | 'CommitFailed' | 'InvalidData' | 'RevisionExhausted';
}> {}

export class CandidateVerifierError extends Data.TaggedError('CandidateVerifierError')<{
  readonly runId: RunId;
  readonly code: 'VerificationFailed';
}> {}
