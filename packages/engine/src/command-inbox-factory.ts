import {
  AdmissionDraft,
  AdmissionRecord,
  AuthorityObservation,
  CommandCandidate,
  CommitReply,
  commandKey,
  type IngressScopeId,
} from '@ceirean/domain';
import { Effect, Match, Result, Schema } from 'effect';

import {
  CommandInboxError,
  CommandInboxErrorCode,
  CommandInboxOperation,
} from './command-inbox-errors.ts';

const sameCandidate = Schema.toEquivalence(CommandCandidate);
const sameDecision = Schema.toEquivalence(AdmissionDraft.fields.decision);
export function sameCommandFacts(left: CommandCandidate, right: CommandCandidate) {
  return sameCandidate(
    { ...left, ownerLogin: right.ownerLogin, repositoryName: right.repositoryName },
    right,
  );
}

function validRecord(record: AdmissionRecord, draft: AdmissionDraft, fresh: boolean) {
  const candidate = record.candidate;
  const internal =
    record.commandKey === commandKey(candidate) && record.evaluatedAtMs <= record.committedAtMs;
  const bound = sameCommandFacts(candidate, draft.verified.candidate);
  const decisionBound = Match.value(record.decision).pipe(
    Match.tag(
      'AdmittedPreview',
      (decision) =>
        decision.commandKey === record.commandKey &&
        decision.evidenceRevision === record.authorityRevision,
    ),
    Match.tag('Rejected', () => true),
    Match.exhaustive,
  );
  const current =
    !fresh ||
    (sameCandidate(candidate, draft.verified.candidate) &&
      sameDecision(record.decision, draft.decision) &&
      record.authorityRevision === draft.expectedAuthorityRevision &&
      record.evaluatedAtMs === draft.evaluatedAtMs);
  return internal && bound && decisionBound && current;
}

const errorFields = Schema.Struct({
  _tag: Schema.Literal('CommandInboxError'),
  operation: CommandInboxOperation,
  code: CommandInboxErrorCode,
});
function safeFailure(error: unknown, operation: CommandInboxError['operation']) {
  const decoded = Schema.decodeUnknownResult(errorFields)(error);
  return Result.match(decoded, {
    onSuccess: (fields) => new CommandInboxError(fields),
    onFailure: () => new CommandInboxError({ operation, code: 'InvalidData' }),
  });
}

export function makeCommandInbox(driver: {
  readonly loadAuthority: (
    scopeId: IngressScopeId,
  ) => Result.Result<AuthorityObservation, CommandInboxError>;
  readonly commit: (draft: AdmissionDraft) => Result.Result<CommitReply, CommandInboxError>;
}) {
  function loadAuthority(scopeId: IngressScopeId) {
    function decodeObservation(value: AuthorityObservation) {
      return Schema.decodeUnknownResult(AuthorityObservation)(structuredClone(value)).pipe(
        Result.mapError(() => new CommandInboxError({ operation: 'load', code: 'InvalidData' })),
      );
    }
    function callDriver() {
      return Result.match(driver.loadAuthority(scopeId), {
        onFailure: (error) => Result.fail(safeFailure(error, 'load')),
        onSuccess: decodeObservation,
      });
    }
    const called = Effect.try({
      try: callDriver,
      catch: () => new CommandInboxError({ operation: 'load', code: 'ReadFailed' }),
    });
    return called.pipe(Effect.flatMap(Effect.fromResult));
  }
  function commit(input: AdmissionDraft) {
    function decodeDraft() {
      return Schema.decodeUnknownResult(AdmissionDraft)(structuredClone(input));
    }
    function* commitValidated() {
      const draft = yield* Effect.try({
        try: decodeDraft,
        catch: () => new CommandInboxError({ operation: 'commit', code: 'InvalidData' }),
      }).pipe(
        Effect.flatMap(Effect.fromResult),
        Effect.mapError(() => new CommandInboxError({ operation: 'commit', code: 'InvalidData' })),
      );
      function decodeReply(value: CommitReply) {
        return Schema.decodeUnknownResult(CommitReply)(structuredClone(value)).pipe(
          Result.mapError(
            () => new CommandInboxError({ operation: 'commit', code: 'InvalidData' }),
          ),
        );
      }
      function callDriver() {
        const raw = driver.commit(structuredClone(draft));
        return Result.match(raw, {
          onFailure: (error) => Result.fail(safeFailure(error, 'commit')),
          onSuccess: decodeReply,
        });
      }
      const called = Effect.try({
        try: callDriver,
        catch: () => new CommandInboxError({ operation: 'commit', code: 'CommitFailed' }),
      });
      const reply = yield* called.pipe(Effect.flatMap(Effect.fromResult));
      const valid = Match.value(reply).pipe(
        Match.tag('Unrecorded', () => true),
        Match.tag('Recorded', ({ record }) => validRecord(record, draft, true)),
        Match.tag('Duplicate', ({ record }) => validRecord(record, draft, false)),
        Match.exhaustive,
      );
      const checked = Match.value(valid).pipe(
        Match.when(true, () => Result.succeed(reply)),
        Match.orElse(() =>
          Result.fail(new CommandInboxError({ operation: 'commit', code: 'InvalidData' })),
        ),
      );
      return yield* Effect.fromResult(checked);
    }
    const program = Effect.gen(commitValidated);
    return program;
  }
  return { loadAuthority, commit };
}
