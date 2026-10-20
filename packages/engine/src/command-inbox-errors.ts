import { Data, Schema } from 'effect';

export const CommandInboxOperation = Schema.Literals(['load', 'commit', 'open', 'close']);
export const CommandInboxErrorCode = Schema.Literals([
  'ReadFailed',
  'CommitFailed',
  'OpenFailed',
  'CloseFailed',
  'InvalidData',
  'Busy',
]);

export class CommandInboxError extends Data.TaggedError('CommandInboxError')<{
  readonly operation: typeof CommandInboxOperation.Type;
  readonly code: typeof CommandInboxErrorCode.Type;
}> {}
