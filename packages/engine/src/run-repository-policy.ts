import { Match, Option, Result, Schema } from 'effect';

import { RunChange, RunSnapshot, type CommitResult } from './contracts.ts';
import { RunRepositoryError } from './errors.ts';

function commitError(change: RunChange, code: RunRepositoryError['code']) {
  return new RunRepositoryError({ operation: 'commit', runId: change.runId, code });
}

function validateChange(change: RunChange) {
  function* validation() {
    const decoded = Schema.decodeUnknownResult(RunChange)(change);
    yield* Result.mapError(decoded, () => commitError(change, 'InvalidData'));
    const validIdentity =
      change.state.runId === change.runId &&
      change.facts.every((fact) => fact.runId === change.runId);
    yield* Match.value(validIdentity).pipe(
      Match.when(true, () => Result.succeed(undefined)),
      Match.when(false, () => Result.fail(commitError(change, 'InvalidData'))),
      Match.exhaustive,
    );
    return change;
  }
  return Result.gen(validation);
}

function conflict(change: RunChange): CommitResult {
  return { _tag: 'Conflict', runId: change.runId, expectedRevision: change.expectedRevision };
}

function replacement(snapshot: RunSnapshot, change: RunChange) {
  const next = RunSnapshot.make({
    revision: snapshot.revision + 1,
    state: change.state,
    contract: snapshot.contract,
    history: [...snapshot.history, ...change.facts],
  });
  return structuredClone(next);
}

function checkRevision(
  snapshot: RunSnapshot,
  change: RunChange,
): Result.Result<Option.Option<RunSnapshot>, RunRepositoryError> {
  function ready() {
    const next = replacement(snapshot, change);
    return Result.succeed(Option.some(next));
  }
  return Match.value(snapshot.revision).pipe(
    Match.when(
      (revision) => revision !== change.expectedRevision,
      () => Result.succeed(Option.none()),
    ),
    Match.when(Number.MAX_SAFE_INTEGER, () =>
      Result.fail(commitError(change, 'RevisionExhausted')),
    ),
    Match.orElse(ready),
  );
}

export function evaluateRunChange(
  current: Option.Option<RunSnapshot>,
  change: RunChange,
): Result.Result<CommitResult, RunRepositoryError> {
  return validateChange(change).pipe(
    Result.flatMap(() =>
      Option.match(current, {
        onNone: () => Result.succeed(Option.none<RunSnapshot>()),
        onSome: (snapshot) => checkRevision(snapshot, change),
      }),
    ),
    Result.map((found) =>
      Option.match(found, {
        onNone: () => conflict(change),
        onSome: (snapshot): CommitResult => ({ _tag: 'Committed', snapshot }),
      }),
    ),
  );
}
