import {
  CandidateIdentity,
  NonNegativeSafeInteger,
  RunFact,
  RunId,
  UpgradeRun,
  VerificationContract,
} from '@ceirean/domain';
import { Schema } from 'effect';

export const RunSnapshot = Schema.Struct({
  revision: NonNegativeSafeInteger,
  state: UpgradeRun,
  contract: VerificationContract,
  history: Schema.Array(RunFact),
});
export type RunSnapshot = typeof RunSnapshot.Type;

export const RunChange = Schema.Struct({
  runId: RunId,
  expectedRevision: NonNegativeSafeInteger,
  state: UpgradeRun,
  facts: Schema.Array(RunFact),
});
export type RunChange = typeof RunChange.Type;

export const CommitResult = Schema.Union([
  Schema.TaggedStruct('Committed', { snapshot: RunSnapshot }),
  Schema.TaggedStruct('Conflict', { runId: RunId, expectedRevision: NonNegativeSafeInteger }),
]);
export type CommitResult = typeof CommitResult.Type;

export const VerificationRequest = Schema.Struct({
  identity: CandidateIdentity,
  contract: VerificationContract,
});
export type VerificationRequest = typeof VerificationRequest.Type;
