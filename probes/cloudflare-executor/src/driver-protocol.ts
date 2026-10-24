import { Data, Schema } from 'effect';

import { Identity, ProbeRequest, Timestamp } from './contract.ts';

export const OwnedIdentity = Schema.Struct({
  sessionId: Identity,
  operationId: Identity,
  resourceId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_:-]{0,191}$/)),
});
export type OwnedIdentity = typeof OwnedIdentity.Type;
export const OwnedOperation = Schema.Struct({
  identity: OwnedIdentity,
  request: ProbeRequest,
  deadlineMs: Timestamp,
});
export type OwnedOperation = typeof OwnedOperation.Type;
export const Observation = Schema.Struct({
  state: Schema.Union([
    Schema.TaggedStruct('Absent', {}),
    Schema.TaggedStruct('Running', {
      processIds: Schema.Array(Identity).check(Schema.isMaxLength(64)),
    }),
    Schema.TaggedStruct('Exited', { exitCode: Schema.Int }),
  ]),
  attempt: Schema.Literals(['NeverIssued', 'Issued', 'Unknown']),
  settlement: Schema.Literals(['Quiescent', 'Uncertain']),
});
export type Observation = typeof Observation.Type;
export const DriverQuery = Schema.Union([
  Schema.TaggedStruct('Authorize', { identity: OwnedIdentity }),
  Schema.TaggedStruct('Start', { operation: OwnedOperation }),
  Schema.TaggedStruct('Inspect', { identity: OwnedIdentity }),
  Schema.TaggedStruct('Terminate', { identity: OwnedIdentity }),
  Schema.TaggedStruct('Destroy', { identity: OwnedIdentity }),
]);
export type DriverQuery = typeof DriverQuery.Type;
export const DriverReply = Schema.Union([
  Schema.TaggedStruct('Authorized', { identity: OwnedIdentity }),
  Schema.TaggedStruct('Denied', { identity: OwnedIdentity }),
  Schema.TaggedStruct('Acknowledged', {
    identity: OwnedIdentity,
    action: Schema.Literals(['Start', 'Terminate', 'Destroy']),
  }),
  Schema.TaggedStruct('Observed', { identity: OwnedIdentity, observation: Observation }),
]);
export type DriverReply = typeof DriverReply.Type;
export class DriverFailure extends Data.TaggedError('DriverFailure')<{
  readonly code: 'Unavailable' | 'TransportLost' | 'InvalidReply' | 'OwnerAlreadyClaimed';
}> {}
