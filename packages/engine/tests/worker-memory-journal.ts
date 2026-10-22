import { type CandidateIdentity, type WorkerOperationId } from '@ceirean/domain';
import { Array, Effect, Match, Option, Ref, Result, Schema } from 'effect';

import {
  WorkerJournalSnapshot,
  type WorkerJournalEdit,
  type WorkerJournalResult,
} from '../src/worker-contracts.ts';
import { WorkerJournalError } from '../src/worker-errors.ts';
import { evaluateWorkerJournalEdit, replaceWorkerAuthority } from '../src/worker-journal-policy.ts';
import { detach } from '../src/worker-journal-record.ts';
import { WorkerJournal } from '../src/worker-ports.ts';

const sameAuthority = Schema.toEquivalence(WorkerJournalSnapshot.fields.authority);
function findDetached(
  current: ReadonlyArray<WorkerJournalSnapshot>,
  operationId: WorkerOperationId,
) {
  const found = Array.findFirst(
    current,
    (snapshot) => snapshot.operation.operationId === operationId,
  );
  return Option.map(found, detach);
}
function validateSeeds(snapshots: readonly WorkerJournalSnapshot[]) {
  const unique = snapshots.every(
    (snapshot, index) =>
      !snapshots
        .slice(0, index)
        .some((previous) => previous.operation.operationId === snapshot.operation.operationId),
  );
  const coherent = snapshots.every((snapshot) =>
    snapshots.every(
      (other) =>
        other.operation.identity.runId !== snapshot.operation.identity.runId ||
        sameAuthority(snapshot.authority, other.authority),
    ),
  );
  return Match.value(unique && coherent).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () =>
      Result.fail(new WorkerJournalError({ operation: 'load', code: 'InvalidData' })),
    ),
    Match.exhaustive,
  );
}

export function makeMemoryWorkerJournal(initial: readonly WorkerJournalSnapshot[]) {
  function* acquire() {
    const snapshots = yield* Effect.forEach(initial, (snapshot) =>
      Schema.decodeUnknownResult(WorkerJournalSnapshot)(snapshot).pipe(
        Result.mapError(() => new WorkerJournalError({ operation: 'load', code: 'InvalidData' })),
        Effect.fromResult,
        Effect.map(detach),
      ),
    );
    yield* Effect.fromResult(validateSeeds(snapshots));
    const store = yield* Ref.make<ReadonlyArray<WorkerJournalSnapshot>>(snapshots);
    const load = (operationId: WorkerOperationId) =>
      Ref.get(store).pipe(Effect.map((current) => findDetached(current, operationId)));
    function commit(edit: WorkerJournalEdit) {
      return Ref.modify(store, (current) =>
        evaluateWorkerJournalEdit(current, edit).pipe(
          Result.match({
            onFailure: (
              error,
            ): readonly [
              Result.Result<WorkerJournalResult, WorkerJournalError>,
              ReadonlyArray<WorkerJournalSnapshot>,
            ] => [Result.fail(error), current],
            onSuccess: ({ result, next }) => [Result.succeed(result), next] as const,
          }),
        ),
      ).pipe(Effect.flatMap(Effect.fromResult));
    }
    const service = WorkerJournal.of({
      load,
      commit,
    });
    const replaceAuthority = (
      operationId: WorkerOperationId,
      identity: CandidateIdentity,
      cancelledAtMs: Option.Option<number>,
    ) =>
      Ref.modify(store, (current) =>
        replaceWorkerAuthority(current, operationId, identity, cancelledAtMs).pipe(
          Result.match({
            onFailure: (
              error,
            ): readonly [
              Result.Result<Option.Option<WorkerJournalSnapshot>, WorkerJournalError>,
              ReadonlyArray<WorkerJournalSnapshot>,
            ] => [Result.fail(error), current],
            onSuccess: (next) => [Result.succeed(findDetached(next, operationId)), next] as const,
          }),
        ),
      ).pipe(Effect.flatMap(Effect.fromResult));
    return { service, inspect: load, replaceAuthority };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
