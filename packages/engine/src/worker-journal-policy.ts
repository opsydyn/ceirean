import {
  WorkerOperation,
  validateWorkerCustody,
  type CandidateIdentity,
  type WorkerOperationId,
} from '@ceirean/domain';
import { Array, HashMap, Match, Option, Result, Schema } from 'effect';

import {
  WorkerJournalEdit,
  WorkerJournalSnapshot,
  type WorkerJournalResult,
} from './worker-contracts.ts';
import { WorkerJournalError } from './worker-errors.ts';
import { applyEdit, type ConditionalEdit } from './worker-journal-edits.ts';
import {
  detach,
  requireRecord,
  evidenceTime,
  custodyObservation,
  changedAuthority,
} from './worker-journal-record.ts';

export { evaluateRunChange } from './run-repository-policy.ts';

type Store = HashMap.HashMap<WorkerOperationId, WorkerJournalSnapshot>;
const sameOperation = Schema.toEquivalence(WorkerOperation);
function runSnapshots(current: Store, operation: WorkerOperation) {
  return Array.fromIterable(HashMap.values(current)).filter(
    (snapshot) => snapshot.operation.identity.runId === operation.identity.runId,
  );
}

function register(
  current: Store,
  edit: Extract<WorkerJournalEdit, { readonly _tag: 'Register' }>,
): Result.Result<WorkerJournalResult, WorkerJournalError> {
  const peers = runSnapshots(current, edit.operation);
  const sameRun = Array.head(peers);
  const authority = Option.match(sameRun, {
    onNone: () => ({ identity: edit.operation.identity, cancelledAtMs: Option.none<number>() }),
    onSome: (value) => value.authority,
  });
  const snapshot: WorkerJournalSnapshot = {
    revision: 0,
    operation: edit.operation,
    createdAtMs: edit.createdAtMs,
    editTimeFloorMs: Math.max(
      edit.createdAtMs,
      edit.atMs,
      ...peers.map((peer) => peer.editTimeFloorMs),
    ),
    outcomeEvidenceFloorMs: Math.max(
      edit.createdAtMs,
      ...peers.map((peer) => peer.outcomeEvidenceFloorMs),
    ),
    authority,
    intents: [],
    containerId: Option.none(),
    readiness: Option.none(),
    executionAuthorizedAtMs: Option.none(),
    cleanup: Option.none(),
  };
  function* validate() {
    yield* requireRecord(
      edit.operationId === edit.operation.operationId,
      snapshot,
      'IdentityMismatch',
    );
    yield* requireRecord(
      edit.createdAtMs <= edit.atMs && edit.createdAtMs < edit.operation.limits.deadlineMs,
      snapshot,
      'InvalidTime',
    );
    yield* validateWorkerCustody(edit.operation, custodyObservation(snapshot, edit.atMs));
    const runFloorMs = Math.max(edit.createdAtMs, ...peers.map(evidenceTime));
    yield* requireRecord(edit.atMs >= runFloorMs, snapshot, 'StaleObservation');
    return snapshot;
  }
  const validation = Result.gen(validate);
  const inserted = Result.match(validation, {
    onFailure: (refusal): WorkerJournalResult => ({ _tag: 'Refused', refusal }),
    onSuccess: (value): WorkerJournalResult => ({ _tag: 'Committed', snapshot: value }),
  });
  function existingResult(existing: WorkerJournalSnapshot) {
    const sameInput =
      sameOperation(existing.operation, edit.operation) &&
      existing.createdAtMs === edit.createdAtMs;
    return Match.value(sameInput).pipe(
      Match.when(true, (): WorkerJournalResult => ({
        _tag: 'Conflict',
        operationId: edit.operationId,
      })),
      Match.when(false, (): WorkerJournalResult => ({
        _tag: 'Refused',
        refusal: { _tag: 'ConflictingOperation', operationId: edit.operationId },
      })),
      Match.exhaustive,
    );
  }
  const result = Option.match(HashMap.get(current, edit.operationId), {
    onNone: () => inserted,
    onSome: existingResult,
  });
  return Result.succeed(result);
}

function updateExisting(
  current: Store,
  snapshot: WorkerJournalSnapshot,
  edit: ConditionalEdit,
): Result.Result<WorkerJournalResult, WorkerJournalError> {
  const sharedEditFloorMs = Match.value(edit).pipe(
    Match.tag('RequestCancellation', () =>
      Math.max(
        snapshot.createdAtMs,
        ...runSnapshots(current, snapshot.operation).map(evidenceTime),
      ),
    ),
    Match.orElse(() => 0),
  );
  function changed() {
    return applyEdit(snapshot, edit, sharedEditFloorMs).pipe(
      Result.match({
        onFailure: (refusal): WorkerJournalResult => ({ _tag: 'Refused', refusal }),
        onSuccess: (next): WorkerJournalResult => ({
          _tag: 'Committed',
          snapshot: {
            ...next,
            revision: snapshot.revision + 1,
            editTimeFloorMs: Math.max(next.editTimeFloorMs, edit.atMs),
          },
        }),
      }),
      Result.succeed,
    );
  }
  const result = Match.value(snapshot.revision).pipe(
    Match.when(
      (revision) => revision !== edit.expectedRevision,
      (): Result.Result<WorkerJournalResult, WorkerJournalError> =>
        Result.succeed({ _tag: 'Conflict', operationId: edit.operationId }),
    ),
    Match.when(Number.MAX_SAFE_INTEGER, () =>
      Result.fail(new WorkerJournalError({ operation: 'commit', code: 'RevisionExhausted' })),
    ),
    Match.orElse(changed),
  );
  return result;
}

function conditionalCommit(current: Store, edit: ConditionalEdit) {
  return Option.match(HashMap.get(current, edit.operationId), {
    onNone: (): Result.Result<WorkerJournalResult, WorkerJournalError> =>
      Result.succeed({ _tag: 'Conflict', operationId: edit.operationId }),
    onSome: (snapshot) => updateExisting(current, snapshot, edit),
  });
}

function evaluate(
  current: Store,
  input: WorkerJournalEdit,
): Result.Result<WorkerJournalResult, WorkerJournalError> {
  function* validate() {
    const edit = yield* Schema.decodeUnknownResult(WorkerJournalEdit)(input).pipe(
      Result.mapError(() => new WorkerJournalError({ operation: 'commit', code: 'InvalidData' })),
    );
    return yield* Match.value(edit).pipe(
      Match.tag('Register', (request) => register(current, request)),
      Match.orElse((request) => conditionalCommit(current, request)),
    );
  }
  return Result.gen(validate);
}

function spreadAuthority(
  current: Store,
  snapshot: WorkerJournalSnapshot,
  atMs: Option.Option<number>,
): Result.Result<Store, WorkerJournalError> {
  const peers = Array.fromIterable(HashMap.values(current)).filter(
    (peer) =>
      peer.operation.identity.runId === snapshot.operation.identity.runId &&
      peer.operation.operationId !== snapshot.operation.operationId,
  );
  const room = peers.every((peer) => peer.revision < Number.MAX_SAFE_INTEGER);
  function replacePeers() {
    const updated = peers.reduce(
      (store, peer) =>
        HashMap.set(
          store,
          peer.operation.operationId,
          detach({
            ...peer,
            revision: peer.revision + 1,
            authority: snapshot.authority,
            editTimeFloorMs: Math.max(
              peer.editTimeFloorMs,
              Option.getOrElse(atMs, () => peer.editTimeFloorMs),
            ),
          }),
        ),
      current,
    );
    return Result.succeed(HashMap.set(updated, snapshot.operation.operationId, snapshot));
  }
  return Match.value(room).pipe(
    Match.when(true, replacePeers),
    Match.when(false, () =>
      Result.fail(new WorkerJournalError({ operation: 'commit', code: 'RevisionExhausted' })),
    ),
    Match.exhaustive,
  );
}

// One synchronous decision owns decode, CAS, run authority/custody checks and append.
function transition(
  current: Store,
  edit: WorkerJournalEdit,
): readonly [Result.Result<WorkerJournalResult, WorkerJournalError>, Store] {
  function committed({
    snapshot: value,
  }: Extract<WorkerJournalResult, { readonly _tag: 'Committed' }>): readonly [
    Result.Result<WorkerJournalResult, WorkerJournalError>,
    Store,
  ] {
    const snapshot = detach(value);
    const returned = detach(snapshot);
    const updated = Match.value(edit).pipe(
      Match.tag('RequestCancellation', ({ atMs }) =>
        spreadAuthority(current, snapshot, Option.some(atMs)),
      ),
      Match.orElse(() =>
        Result.succeed(HashMap.set(current, snapshot.operation.operationId, snapshot)),
      ),
    );
    return Result.match(updated, {
      onFailure: (error) => [Result.fail(error), current],
      onSuccess: (store) => [Result.succeed({ _tag: 'Committed', snapshot: returned }), store],
    });
  }
  function unchanged(
    result: WorkerJournalResult,
  ): readonly [Result.Result<WorkerJournalResult, WorkerJournalError>, Store] {
    return [Result.succeed(result), current];
  }
  function successful(result: WorkerJournalResult) {
    return Match.value(result).pipe(Match.tag('Committed', committed), Match.orElse(unchanged));
  }
  return evaluate(current, edit).pipe(
    Result.match({
      onFailure: (error) => [Result.fail(error), current],
      onSuccess: successful,
    }),
  );
}

function authorityTransition(
  current: Store,
  operationId: WorkerOperationId,
  identity: CandidateIdentity,
  cancelledAtMs: Option.Option<number>,
): readonly [Result.Result<Option.Option<WorkerJournalSnapshot>, WorkerJournalError>, Store] {
  function replace(
    snapshot: WorkerJournalSnapshot,
  ): readonly [Result.Result<Option.Option<WorkerJournalSnapshot>, WorkerJournalError>, Store] {
    function committed(
      next: WorkerJournalSnapshot,
    ): readonly [Result.Result<Option.Option<WorkerJournalSnapshot>, WorkerJournalError>, Store] {
      const detached = detach(next);
      const returned = Option.some(detach(detached));
      return spreadAuthority(current, detached, cancelledAtMs).pipe(
        Result.match({
          onFailure: (error) => [Result.fail(error), current],
          onSuccess: (store) => [Result.succeed(returned), store],
        }),
      );
    }
    return changedAuthority(snapshot, identity, cancelledAtMs).pipe(
      Result.match({ onFailure: (error) => [Result.fail(error), current], onSuccess: committed }),
    );
  }
  return Option.match(HashMap.get(current, operationId), {
    onNone: () => [Result.succeed(Option.none()), current],
    onSome: replace,
  });
}

function toStore(current: ReadonlyArray<WorkerJournalSnapshot>) {
  return HashMap.fromIterable(
    current.map((snapshot) => [snapshot.operation.operationId, snapshot] as const),
  );
}

function detachedRecords(next: Store, current: ReadonlyArray<WorkerJournalSnapshot>) {
  const retained = current.flatMap((snapshot) =>
    Option.toArray(HashMap.get(next, snapshot.operation.operationId)),
  );
  const inserted = Array.fromIterable(HashMap.values(next)).filter(
    (snapshot) =>
      !current.some(
        (previous) => previous.operation.operationId === snapshot.operation.operationId,
      ),
  );
  return [...retained, ...inserted].map(detach);
}

export function evaluateWorkerJournalEdit(
  current: ReadonlyArray<WorkerJournalSnapshot>,
  edit: WorkerJournalEdit,
) {
  const [result, next] = transition(toStore(current), edit);
  return Result.map(result, (value) => ({ result: value, next: detachedRecords(next, current) }));
}

export function replaceWorkerAuthority(
  current: ReadonlyArray<WorkerJournalSnapshot>,
  operationId: WorkerOperationId,
  identity: CandidateIdentity,
  cancelledAtMs: Option.Option<number>,
) {
  const [result, next] = authorityTransition(
    toStore(current),
    operationId,
    identity,
    cancelledAtMs,
  );
  return Result.map(result, () => detachedRecords(next, current));
}
