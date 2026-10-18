import { Schema } from 'effect';

const FixtureState = Schema.Struct({
  phase: Schema.Literals(['pending', 'frozen', 'verified', 'cancelled']),
  generation: Schema.Number,
  digest: Schema.NullOr(Schema.String),
  deadlineMs: Schema.Number,
  spentMicros: Schema.Number,
  repairs: Schema.Number,
});
const Receipt = Schema.Struct({ submissionId: Schema.String, uid: Schema.String });
const Reply = Schema.Struct({ text: Schema.String, submissionId: Schema.String });
const Decision = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), state: FixtureState }),
  Schema.Struct({
    ok: Schema.Literal(false),
    state: FixtureState,
    reason: Schema.Literals(['InvalidPhase', 'DigestMismatch', 'StaleGeneration']),
  }),
]);
const CheckpointJson = Schema.fromJsonString(
  Schema.Struct({ state: FixtureState, receipt: Receipt }),
);
const RestartJson = Schema.fromJsonString(
  Schema.Struct({
    state: FixtureState,
    receipt: Receipt,
    reply: Reply,
    providerCalls: Schema.Number,
  }),
);
const CancellationResult = Schema.Struct({
  readerOutcome: Schema.Literals(['read_cancelled', 'aborted']),
  submissionOutcome: Schema.Literals(['completed', 'aborted']),
  cleanup: Schema.Literal('confirmed'),
  lifecycle: Schema.Struct({ acquired: Schema.Number, released: Schema.Number }),
  reply: Schema.optionalKey(Reply),
  lateDecision: Schema.optionalKey(Decision),
  retainedStateIdentity: Schema.optionalKey(Schema.Boolean),
});
const CancellationJson = Schema.fromJsonString(CancellationResult);

export type CancellationOutcome = Omit<typeof CancellationResult.Type, 'cleanup' | 'lifecycle'>;
export const encodeCheckpoint = Schema.encodeSync(CheckpointJson);
export const decodeCheckpoint = Schema.decodeUnknownSync(CheckpointJson);
export const encodeRestartResult = Schema.encodeSync(RestartJson);
export const decodeRestartResult = Schema.decodeUnknownSync(RestartJson);
export const encodeCancellationResult = Schema.encodeSync(CancellationJson);
export const decodeCancellationResult = Schema.decodeUnknownSync(CancellationJson);
