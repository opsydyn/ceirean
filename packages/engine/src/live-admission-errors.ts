import { Data, Schema } from 'effect';

export const LiveInboxOperation = Schema.Literals([
  'open',
  'load',
  'replay',
  'commit',
  'configure',
  'close',
]);
export const LiveInboxErrorCode = Schema.Literals([
  'ReadFailed',
  'CommitFailed',
  'OpenFailed',
  'CloseFailed',
  'InvalidData',
  'Busy',
  'IncompatibleSchema',
  'OwnershipBusy',
  'UnsafePath',
]);
export class LiveInboxError extends Data.TaggedError('LiveInboxError')<{
  readonly operation: typeof LiveInboxOperation.Type;
  readonly code: typeof LiveInboxErrorCode.Type;
}> {}

export const LiveAuthorityPhase = Schema.Literals([
  'installation',
  'token',
  'repository',
  'user',
  'permission',
  'body',
  'signing',
]);
export const LiveAuthorityErrorCode = Schema.Literals([
  'Unavailable',
  'Denied',
  'RateLimited',
  'Timeout',
  'Aborted',
  'InvalidResponse',
  'TooLarge',
  'IdentityMismatch',
  'InvalidKey',
]);
export class LiveAuthorityError extends Data.TaggedError('LiveAuthorityError')<{
  readonly phase: typeof LiveAuthorityPhase.Type;
  readonly code: typeof LiveAuthorityErrorCode.Type;
}> {}
