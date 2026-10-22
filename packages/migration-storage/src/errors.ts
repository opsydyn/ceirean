import { Data, Match, Result, Schema } from 'effect';

export class MigrationStorageError extends Data.TaggedError('MigrationStorageError')<{
  readonly operation: 'initialize' | 'open' | 'status' | 'close' | 'register' | 'read' | 'commit';
  readonly code:
    | 'InvalidConfig'
    | 'UnsafePath'
    | 'AlreadyExists'
    | 'OpenFailed'
    | 'OwnershipBusy'
    | 'IncompatibleSchema'
    | 'InvalidData'
    | 'CloseFailed'
    | 'Busy'
    | 'CapacityExceeded'
    | 'Closed'
    | 'RevisionExhausted'
    | 'CommitFailed';
}> {}

const native = Schema.Struct({ code: Schema.String });
export function sanitized(
  error: unknown,
  operation: MigrationStorageError['operation'],
  fallback: MigrationStorageError['code'],
) {
  const decode = Schema.decodeUnknownResult(native);
  const decoded = decode(error);
  const busy = Result.match(decoded, {
    onFailure: () => false,
    onSuccess: ({ code }) => ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(code),
  });
  const isKnown = Match.instanceOf(MigrationStorageError);
  const code = Match.value(error).pipe(
    Match.when(isKnown, (known) => known.code),
    Match.when(
      () => busy,
      () => 'OwnershipBusy' as const,
    ),
    Match.orElse(() => fallback),
  );
  return new MigrationStorageError({ operation, code });
}
export function requireStorage(valid: boolean, code: MigrationStorageError['code']) {
  return Match.value(valid).pipe(
    Match.when(false, () => {
      throw new MigrationStorageError({ operation: 'open', code });
    }),
    Match.orElse(() => undefined),
  );
}
