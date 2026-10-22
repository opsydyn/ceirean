import {
  FrozenRun,
  NonNegativeSafeInteger,
  RunId,
  VerificationContract,
  WorkerIntentId,
  WorkerOperationId,
} from '@ceirean/domain';
import { Data, Match, Result, Schema, flow } from 'effect';

import { CommitResult, RunChange, RunSnapshot } from './contracts.ts';
import {
  WorkerJournalEdit,
  WorkerJournalResult,
  WorkerJournalSnapshot,
} from './worker-contracts.ts';

export const migrationLedgerBounds = {
  maxRuns: 32,
  maxWorkers: 256,
  maxWorkersPerRun: 64,
  maxEvents: 4096,
  maxRecordBytes: 1048576,
  maxPayloadBytes: 67108864,
} as const;

export class MigrationLedgerPolicyError extends Data.TaggedError('MigrationLedgerPolicyError')<{
  readonly code: 'InvalidData' | 'RevisionExhausted' | 'CapacityExceeded';
}> {}

export const MigrationLedgerState = Schema.Struct({
  runs: Schema.Array(RunSnapshot),
  workers: Schema.Array(WorkerJournalSnapshot),
  sequence: NonNegativeSafeInteger,
});
export type MigrationLedgerState = typeof MigrationLedgerState.Type;

export const MigrationLedgerCommand = Schema.Union([
  Schema.TaggedStruct('RegisterRun', { state: FrozenRun, contract: VerificationContract }),
  Schema.TaggedStruct('ChangeRun', { change: RunChange }),
  Schema.TaggedStruct('EditWorker', { edit: WorkerJournalEdit }),
]);
export type MigrationLedgerCommand = typeof MigrationLedgerCommand.Type;

export const RunRegistration = Schema.Union([
  Schema.TaggedStruct('Registered', { snapshot: RunSnapshot }),
  Schema.TaggedStruct('RegistrationRefused', {
    reason: Schema.Literals([
      'InvalidInput',
      'RunAlreadyPresent',
      'RunActive',
      'CleanupUnresolved',
    ]),
  }),
]);
export type RunRegistration = typeof RunRegistration.Type;

export const MigrationLedgerReply = Schema.Union([
  RunRegistration,
  Schema.TaggedStruct('RunResult', { result: CommitResult }),
  Schema.TaggedStruct('WorkerResult', { result: WorkerJournalResult }),
]);
export type MigrationLedgerReply = typeof MigrationLedgerReply.Type;

const revisions = { before: Schema.Option(NonNegativeSafeInteger), after: NonNegativeSafeInteger };
export const MigrationLedgerEvent = Schema.Struct({
  sequence: NonNegativeSafeInteger,
  command: MigrationLedgerCommand,
  runRevisions: Schema.Array(Schema.Struct({ runId: RunId, ...revisions })),
  workerRevisions: Schema.Array(Schema.Struct({ operationId: WorkerOperationId, ...revisions })),
});
export type MigrationLedgerEvent = typeof MigrationLedgerEvent.Type;

export const MigrationRecovery = Schema.Struct({
  sequence: NonNegativeSafeInteger,
  runs: Schema.Array(RunSnapshot),
  workers: Schema.Array(
    Schema.Struct({
      snapshot: WorkerJournalSnapshot,
      unresolvedIntentIds: Schema.Array(WorkerIntentId),
    }),
  ),
});
export type MigrationRecovery = typeof MigrationRecovery.Type;

// Call the bounded encoding/decoding functions below at storage boundaries.
// Codecs alone retain Effect's default excess-property parsing behavior.
export const migrationLedgerCodecs = {
  run: Schema.fromJsonString(Schema.toCodecJson(RunSnapshot)),
  worker: Schema.fromJsonString(Schema.toCodecJson(WorkerJournalSnapshot)),
  state: Schema.fromJsonString(Schema.toCodecJson(MigrationLedgerState)),
  command: Schema.fromJsonString(Schema.toCodecJson(MigrationLedgerCommand)),
  event: Schema.fromJsonString(Schema.toCodecJson(MigrationLedgerEvent)),
  recovery: Schema.fromJsonString(Schema.toCodecJson(MigrationRecovery)),
};

export function migrationPayloadBytes(encoded: string) {
  return new TextEncoder().encode(encoded).byteLength;
}

function boundedPayload(encoded: string) {
  return Match.value(migrationPayloadBytes(encoded) <= migrationLedgerBounds.maxRecordBytes).pipe(
    Match.when(true, () => Result.succeed(encoded)),
    Match.when(false, () =>
      Result.fail(new MigrationLedgerPolicyError({ code: 'CapacityExceeded' })),
    ),
    Match.exhaustive,
  );
}

// Shared with the storage transaction: canonical, strict, bounded record encodings.
export const migrationLedgerEncoding = {
  run: (value: RunSnapshot) =>
    Schema.encodeUnknownResult(migrationLedgerCodecs.run, { onExcessProperty: 'error' })(
      value,
    ).pipe(
      Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })),
      Result.flatMap(boundedPayload),
    ),
  worker: (value: WorkerJournalSnapshot) =>
    Schema.encodeUnknownResult(migrationLedgerCodecs.worker, { onExcessProperty: 'error' })(
      value,
    ).pipe(
      Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })),
      Result.flatMap(boundedPayload),
    ),
  command: (value: MigrationLedgerCommand) =>
    Schema.encodeUnknownResult(migrationLedgerCodecs.command, { onExcessProperty: 'error' })(
      value,
    ).pipe(
      Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })),
      Result.flatMap(boundedPayload),
    ),
  event: (value: MigrationLedgerEvent) =>
    Schema.encodeUnknownResult(migrationLedgerCodecs.event, { onExcessProperty: 'error' })(
      value,
    ).pipe(
      Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })),
      Result.flatMap(boundedPayload),
    ),
};

const invalidPayload = () => new MigrationLedgerPolicyError({ code: 'InvalidData' });
const decodeRun = flow(
  Schema.decodeUnknownResult(migrationLedgerCodecs.run, { onExcessProperty: 'error' }),
  Result.mapError(invalidPayload),
);
const decodeWorker = flow(
  Schema.decodeUnknownResult(migrationLedgerCodecs.worker, { onExcessProperty: 'error' }),
  Result.mapError(invalidPayload),
);
const decodeCommand = flow(
  Schema.decodeUnknownResult(migrationLedgerCodecs.command, { onExcessProperty: 'error' }),
  Result.mapError(invalidPayload),
);
const decodeEvent = flow(
  Schema.decodeUnknownResult(migrationLedgerCodecs.event, { onExcessProperty: 'error' }),
  Result.mapError(invalidPayload),
);

export const migrationLedgerDecoding = {
  run: (encoded: string) => boundedPayload(encoded).pipe(Result.flatMap(decodeRun)),
  worker: (encoded: string) => boundedPayload(encoded).pipe(Result.flatMap(decodeWorker)),
  command: (encoded: string) => boundedPayload(encoded).pipe(Result.flatMap(decodeCommand)),
  event: (encoded: string) => boundedPayload(encoded).pipe(Result.flatMap(decodeEvent)),
};
