import {
  LiveAuthorityErrorCode,
  LiveAuthorityPhase,
  LiveInboxErrorCode,
  LiveInboxOperation,
} from '@ceirean/engine';
import { Cause, Match, Option, Result, Schema } from 'effect';

const KnownFailure = Schema.Union([
  Schema.TaggedStruct('LiveAuthorityError', {
    phase: LiveAuthorityPhase,
    code: LiveAuthorityErrorCode,
  }),
  Schema.TaggedStruct('LiveInboxError', {
    operation: LiveInboxOperation,
    code: LiveInboxErrorCode,
  }),
]);

// Project only finite fields. Never serialize a Cause, native error or its extras.
export function operationalDiagnostic(cause: Cause.Cause<unknown>, correlationId: string) {
  const base = { _tag: 'IngressOperationalFailure' as const, correlationId };
  const failure = Option.getOrUndefined(Cause.findErrorOption(cause));
  const decoded = Schema.decodeUnknownResult(KnownFailure)(failure);
  function known(error: typeof KnownFailure.Type) {
    return Match.value(error).pipe(
      Match.tag('LiveAuthorityError', ({ phase, code }) => ({
        ...base,
        source: 'Authority' as const,
        phase,
        code,
      })),
      Match.tag('LiveInboxError', ({ operation, code }) => ({
        ...base,
        source: 'Inbox' as const,
        operation,
        code,
      })),
      Match.exhaustive,
    );
  }
  return Result.match(decoded, {
    onFailure: () => ({ ...base, source: 'Unknown' as const, code: 'UnexpectedFailure' as const }),
    onSuccess: known,
  });
}
