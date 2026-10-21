import type { RunId } from '@ceirean/domain';
import { Effect, HashMap, Match, Option, Ref, Result, Schema } from 'effect';

import { RunChange, RunSnapshot, type CommitResult } from '../src/contracts.ts';
import { RunRepositoryError } from '../src/errors.ts';
import { RunRepository } from '../src/ports.ts';

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

// Validation, compare-and-swap and history append all execute in this synchronous transition.
function commitTransition(
  current: HashMap.HashMap<RunId, RunSnapshot>,
  change: RunChange,
): readonly [Result.Result<CommitResult, RunRepositoryError>, HashMap.HashMap<RunId, RunSnapshot>] {
  const next = validateChange(change).pipe(
    Result.flatMap(() =>
      Option.match(HashMap.get(current, change.runId), {
        onNone: () => Result.succeed(Option.none<RunSnapshot>()),
        onSome: (snapshot) => checkRevision(snapshot, change),
      }),
    ),
  );
  function changed(
    found: Option.Option<RunSnapshot>,
  ): readonly [
    Result.Result<CommitResult, RunRepositoryError>,
    HashMap.HashMap<RunId, RunSnapshot>,
  ] {
    return Option.match(found, {
      onNone: () => [Result.succeed(conflict(change)), current],
      onSome: (snapshot) => [
        Result.succeed({ _tag: 'Committed', snapshot: structuredClone(snapshot) }),
        HashMap.set(current, change.runId, snapshot),
      ],
    });
  }
  return Result.match(next, {
    onFailure: (error) => [Result.fail(error), current],
    onSuccess: changed,
  });
}

export function makeMemoryRepository(initial: readonly RunSnapshot[]) {
  function* acquireRepository() {
    const entries = initial.map(
      (snapshot) => [snapshot.state.runId, structuredClone(snapshot)] as const,
    );
    const store = yield* Ref.make(HashMap.fromIterable(entries));
    const load = (runId: RunId) =>
      Ref.get(store).pipe(
        Effect.map((current) =>
          Option.map(HashMap.get(current, runId), (snapshot) => structuredClone(snapshot)),
        ),
      );
    const service = RunRepository.of({
      load,
      commit: (change) =>
        Ref.modify(store, (current) => commitTransition(current, change)).pipe(
          Effect.flatMap(Effect.fromResult),
        ),
    });
    return { service, inspect: load };
  }
  const acquisition = Effect.gen(acquireRepository);
  return acquisition;
}
