import {
  CandidateIdentity,
  FrozenRun,
  CancelledRun,
  RunFact,
  UpgradeRun,
  decideCancellation,
  decideQualification,
  validateWorkerCustody,
  validateWorkerReadiness,
  type WorkerOperation,
  type WorkerCleanup,
  type WorkerReadyReceipt,
} from '@ceirean/domain';
import { Array, Match, Option, Result, Schema } from 'effect';

import { RunSnapshot, type RunChange } from './contracts.ts';
import {
  MigrationLedgerCommand,
  MigrationLedgerEvent,
  MigrationLedgerPolicyError,
  MigrationLedgerReply,
  MigrationLedgerState,
  MigrationRecovery,
  migrationLedgerBounds,
  migrationLedgerCodecs,
  migrationLedgerEncoding,
  migrationPayloadBytes,
} from './migration-ledger-contracts.ts';
import { evaluateRunChange } from './run-repository-policy.ts';
import { WorkerJournalEdit, WorkerJournalSnapshot } from './worker-contracts.ts';
import { evaluateWorkerJournalEdit } from './worker-journal-policy.ts';
import {
  detach,
  changedAuthority,
  custodyObservation,
  evidenceTime,
  sameIdentity,
  unresolved,
  canMaterialize,
} from './worker-journal-record.ts';

export * from './migration-ledger-contracts.ts';
export { RunSnapshot, RunChange, CommitResult } from './contracts.ts';
export {
  WorkerJournalSnapshot,
  WorkerJournalEdit,
  WorkerJournalResult,
} from './worker-contracts.ts';

const sameRun = Schema.toEquivalence(UpgradeRun);
const sameFacts = Schema.toEquivalence(Schema.Array(RunFact));
const sameAuthority = Schema.toEquivalence(WorkerJournalSnapshot.fields.authority);
const isFrozen = Schema.is(FrozenRun);
const isCancelled = Schema.is(CancelledRun);

function isCancellation(edit: WorkerJournalEdit) {
  return Match.value(edit).pipe(
    Match.tag('RequestCancellation', () => true),
    Match.orElse(() => false),
  );
}

function isRegistration(edit: WorkerJournalEdit) {
  return Match.value(edit).pipe(
    Match.tag('Register', () => true),
    Match.orElse(() => false),
  );
}

function cleanupConfirmed(worker: WorkerJournalSnapshot) {
  return Option.exists(worker.cleanup, (cleanup) =>
    Match.value(cleanup).pipe(
      Match.tag('CleanupConfirmed', () => true),
      Match.orElse(() => false),
    ),
  );
}

function requirePolicy(
  condition: boolean,
  code: MigrationLedgerPolicyError['code'] = 'InvalidData',
) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () => Result.fail(new MigrationLedgerPolicyError({ code }))),
    Match.exhaustive,
  );
}

function runAuthority(run: RunSnapshot) {
  const state = run.state;
  const identity = CandidateIdentity.make({
    runId: state.runId,
    attemptId: state.attemptId,
    generation: state.generation,
    candidateDigest: state.candidateDigest,
    contractId: state.contractId,
    contractDigest: state.contractDigest,
  });
  const cancelledAtMs = Match.value(state).pipe(
    Match.tag('Cancelled', (value) => Option.some(value.cancelledAtMs)),
    Match.orElse(() => Option.none<number>()),
  );
  return { identity, cancelledAtMs };
}

function historyValid(run: RunSnapshot) {
  const state = run.state;
  const frozen = {
    _tag: 'Frozen' as const,
    ...runAuthority(run).identity,
    deadlineMs: state.deadlineMs,
    spentMicros: state.spentMicros,
    repairs: state.repairs,
  };
  const expected = Match.value(state).pipe(
    Match.tag('Frozen', () => ({ state, facts: [] })),
    Match.tag('Cancelled', (value) => decideCancellation(frozen, value.cancelledAtMs)),
    Match.tag('Qualified', (value) =>
      decideQualification(frozen, run.contract, value.receipt, value.qualifiedAtMs),
    ),
    Match.exhaustive,
  );
  return sameRun(expected.state, state) && sameFacts(expected.facts, run.history);
}

function validWorker(worker: WorkerJournalSnapshot, run: RunSnapshot) {
  const operation = worker.operation;
  const identity = operation.identity;
  const limits = operation.limits;
  function validIntent(intent: WorkerJournalSnapshot['intents'][number], index: number) {
    function sameAction(previous: WorkerJournalSnapshot['intents'][number]) {
      const sameResource = previous.kind === intent.kind && previous.resource === intent.resource;
      return previous.intentId === intent.intentId || sameResource;
    }
    const duplicate = worker.intents.slice(0, index).some(sameAction);
    const identityAndTime =
      intent.operationId === operation.operationId && intent.claimedAtMs >= worker.createdAtMs;
    const valid = identityAndTime && !duplicate;
    return valid;
  }
  const intentsValid = worker.intents.every(validIntent);
  function validConfirmation(value: Extract<WorkerCleanup, { readonly _tag: 'CleanupConfirmed' }>) {
    const withinWindow =
      value.observedAtMs >= value.requestedAtMs && value.observedAtMs < value.deadlineMs;
    const unresolvedCreation = worker.intents.some(
      (intent) => unresolved(intent) && canMaterialize(intent),
    );
    return withinWindow && !unresolvedCreation;
  }
  function checkCleanup(cleanup: WorkerCleanup) {
    const confirmedValid = Match.value(cleanup).pipe(
      Match.tag('CleanupConfirmed', validConfirmation),
      Match.orElse(() => true),
    );
    return cleanup.deadlineMs >= cleanup.requestedAtMs && confirmedValid;
  }
  const cleanupValid = Option.match(worker.cleanup, { onNone: () => true, onSome: checkCleanup });
  const valid = [
    sameAuthority(worker.authority, runAuthority(run)),
    identity.contractId === run.state.contractId,
    identity.contractDigest === run.state.contractDigest,
    identity.generation <= run.state.generation,
    identity.generation < run.state.generation || sameIdentity(identity, run.state),
    limits.deadlineMs === run.state.deadlineMs,
    limits.spentMicros <= run.state.spentMicros,
    limits.repairs <= run.state.repairs,
    worker.createdAtMs < limits.deadlineMs,
    worker.editTimeFloorMs >= worker.createdAtMs,
    worker.outcomeEvidenceFloorMs >= worker.createdAtMs,
    worker.editTimeFloorMs >= evidenceTime({ ...worker, editTimeFloorMs: 0 }),
    intentsValid,
    cleanupValid,
  ].every(Boolean);
  return valid;
}

function validWorkerEvidence(worker: WorkerJournalSnapshot) {
  function* validate() {
    const operation = worker.operation;
    yield* validateWorkerCustody(operation, custodyObservation(worker, worker.createdAtMs));
    for (const intent of worker.intents) {
      const resourceMatches = Match.value(intent.kind).pipe(
        Match.when('Create', () => intent.resource === operation.custody.containerSlot),
        Match.orElse(() => Option.contains(worker.containerId, intent.resource)),
      );
      yield* requirePolicy(resourceMatches);
      function* completed(
        observation: Extract<typeof intent.outcome, { readonly _tag: 'Completed' }>['observation'],
      ) {
        yield* validateWorkerCustody(operation, observation);
        yield* requirePolicy(
          observation.atMs >= intent.claimedAtMs && observation.atMs <= worker.editTimeFloorMs,
        );
        const matchesContainer = observation.resources.every((resource) =>
          Option.contains(worker.containerId, resource.containerId),
        );
        yield* requirePolicy(matchesContainer);
        const matchesAction = Match.value(intent.kind).pipe(
          Match.when('Create', () => observation.resources.length === 1),
          Match.when(
            'Start',
            () =>
              observation.resources.length === 1 &&
              observation.resources.every((resource) => resource.running),
          ),
          Match.when(
            'Stop',
            () =>
              observation.resources.length === 1 &&
              observation.resources.every((resource) => !resource.running),
          ),
          Match.when('Remove', () => observation.resources.length === 0),
          Match.exhaustive,
        );
        yield* requirePolicy(matchesAction);
      }
      yield* Match.value(intent.outcome).pipe(
        Match.tag('Completed', ({ observation }) => Result.gen(() => completed(observation))),
        Match.orElse(() => Result.succeed(undefined)),
      );
    }
    function* ready(receipt: WorkerReadyReceipt) {
      const containerId = yield* Option.match(worker.containerId, {
        onNone: () => Result.fail(new MigrationLedgerPolicyError({ code: 'InvalidData' })),
        onSome: Result.succeed,
      });
      const resource = { ...receipt, running: true };
      const observation = {
        ...receipt,
        atMs: receipt.observedAtMs,
        resources: [resource],
        staging: 'Present' as const,
      };
      yield* validateWorkerReadiness(
        operation,
        containerId,
        observation,
        worker.createdAtMs,
        receipt.observedAtMs,
      );
    }
    yield* Option.match(worker.readiness, {
      onNone: () => Result.succeed(undefined),
      onSome: (receipt) => Result.gen(() => ready(receipt)),
    });
  }
  return Result.gen(validate).pipe(
    Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })),
  );
}

function validAuthorizationSnapshot(worker: WorkerJournalSnapshot) {
  function authorized(atMs: number) {
    function* validate() {
      yield* requirePolicy(atMs >= worker.createdAtMs && atMs < worker.operation.limits.deadlineMs);
      yield* requirePolicy(Option.isSome(worker.containerId));
      yield* requirePolicy(
        !Option.exists(worker.authority.cancelledAtMs, (cancelledAtMs) => cancelledAtMs < atMs),
      );
      yield* requirePolicy(
        !Option.exists(worker.cleanup, (cleanup) => cleanup.requestedAtMs < atMs),
      );
      const materializing = worker.intents.filter(canMaterialize);
      for (const intent of materializing) {
        yield* requirePolicy(intent.claimedAtMs <= atMs && !unresolved(intent));
        const completedBeforeAuthorization = Match.value(intent.outcome).pipe(
          Match.tag('Completed', ({ observation }) => observation.atMs <= atMs),
          Match.orElse(() => true),
        );
        yield* requirePolicy(completedBeforeAuthorization);
      }
      function createdContainer(intent: WorkerJournalSnapshot['intents'][number]) {
        const completed = Match.value(intent.outcome).pipe(
          Match.tag('Completed', ({ observation }) =>
            observation.resources.some((resource) =>
              Option.contains(worker.containerId, resource.containerId),
            ),
          ),
          Match.orElse(() => false),
        );
        return Match.value(intent.kind).pipe(
          Match.when('Create', () => completed),
          Match.orElse(() => false),
        );
      }
      yield* requirePolicy(materializing.some(createdContainer));
      const cleanupClaims = worker.intents.filter((intent) => !canMaterialize(intent));
      function invalidatingClaim(intent: WorkerJournalSnapshot['intents'][number]) {
        function withinCleanup(cleanup: WorkerCleanup) {
          // A later cleanup request may shorten the stored deadline to the old claim time.
          // Its original strict claim-time deadline is historical evidence for Task 4 replay.
          return (
            intent.claimedAtMs >= cleanup.requestedAtMs && intent.claimedAtMs <= cleanup.deadlineMs
          );
        }
        const boundedCleanup = Option.exists(worker.cleanup, withinCleanup);
        const originalCustody = Option.contains(worker.containerId, intent.resource);
        return intent.claimedAtMs >= atMs && originalCustody && boundedCleanup;
      }
      // Claims clear readiness; refreshes can replace it after authorization. Neither
      // lossy snapshot proves the original receipt: Task 4 must replay retained commands
      // from empty state and compare both records and events to prove that history.
      const readinessConsistent = Option.match(worker.readiness, {
        onNone: () => cleanupClaims.length > 0 && cleanupClaims.every(invalidatingClaim),
        onSome: () => cleanupClaims.length === 0,
      });
      yield* requirePolicy(readinessConsistent);
    }
    return Result.gen(validate);
  }
  return Option.match(worker.executionAuthorizedAtMs, {
    onNone: () => Result.succeed(undefined),
    onSome: authorized,
  });
}

function validateState(current: MigrationLedgerState) {
  function* validate() {
    const state = yield* Schema.decodeUnknownResult(MigrationLedgerState, {
      onExcessProperty: 'error',
    })(current).pipe(
      Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })),
    );
    const bounded = [
      state.runs.length <= migrationLedgerBounds.maxRuns,
      state.workers.length <= migrationLedgerBounds.maxWorkers,
      state.sequence <= migrationLedgerBounds.maxEvents,
    ].every(Boolean);
    yield* requirePolicy(bounded, 'CapacityExceeded');
    yield* requirePolicy(state.runs.filter((run) => isFrozen(run.state)).length <= 1);
    for (const [index, run] of state.runs.entries()) {
      yield* requirePolicy(
        !state.runs.slice(0, index).some((previous) => previous.state.runId === run.state.runId),
      );
      yield* requirePolicy(
        run.contract.contractId === run.state.contractId &&
          run.contract.contractDigest === run.state.contractDigest &&
          historyValid(run),
      );
      yield* requirePolicy(run.revision >= run.history.length);
      yield* requirePolicy(
        state.workers.filter((worker) => worker.operation.identity.runId === run.state.runId)
          .length <= migrationLedgerBounds.maxWorkersPerRun,
        'CapacityExceeded',
      );
    }
    for (const [index, worker] of state.workers.entries()) {
      yield* requirePolicy(
        !state.workers
          .slice(0, index)
          .some((previous) => previous.operation.operationId === worker.operation.operationId),
      );
      const parent = yield* Array.findFirst(
        state.runs,
        (run) => run.state.runId === worker.operation.identity.runId,
      ).pipe(
        Option.match({
          onNone: () => Result.fail(new MigrationLedgerPolicyError({ code: 'InvalidData' })),
          onSome: Result.succeed,
        }),
      );
      yield* requirePolicy(validWorker(worker, parent));
      yield* validWorkerEvidence(worker);
      yield* validAuthorizationSnapshot(worker);
    }
    yield* payloadSize(state);
    return state;
  }
  return Result.gen(validate);
}

function payloadSize(state: MigrationLedgerState) {
  function* measure() {
    let bytes = 0;
    for (const run of state.runs)
      bytes += migrationPayloadBytes(yield* migrationLedgerEncoding.run(run));
    for (const worker of state.workers)
      bytes += migrationPayloadBytes(yield* migrationLedgerEncoding.worker(worker));
    yield* requirePolicy(bytes <= migrationLedgerBounds.maxPayloadBytes, 'CapacityExceeded');
    return bytes;
  }
  return Result.gen(measure);
}

function unchanged(current: MigrationLedgerState, reply: MigrationLedgerReply) {
  return { reply, next: current, committed: false };
}

function registered(
  current: MigrationLedgerState,
  command: Extract<MigrationLedgerCommand, { readonly _tag: 'RegisterRun' }>,
) {
  const run = command.state;
  const reason = Match.value(current).pipe(
    Match.when(
      () =>
        run.contractId !== command.contract.contractId ||
        run.contractDigest !== command.contract.contractDigest,
      () => Option.some('InvalidInput' as const),
    ),
    Match.when(
      () => current.runs.some((value) => value.state.runId === run.runId),
      () => Option.some('RunAlreadyPresent' as const),
    ),
    Match.when(
      () => current.runs.some((value) => isFrozen(value.state)),
      () => Option.some('RunActive' as const),
    ),
    Match.when(
      () =>
        current.workers.some(
          (worker) =>
            !cleanupConfirmed(worker) ||
            worker.intents.some((intent) => unresolved(intent) && canMaterialize(intent)),
        ),
      () => Option.some('CleanupUnresolved' as const),
    ),
    Match.orElse(() => Option.none()),
  );
  return Option.match(reason, {
    onSome: (value) =>
      Result.succeed(unchanged(current, { _tag: 'RegistrationRefused', reason: value })),
    onNone: () => {
      const snapshot = RunSnapshot.make({
        revision: 0,
        state: run,
        contract: command.contract,
        history: [],
      });
      return Result.succeed({
        reply: MigrationLedgerReply.make({ _tag: 'Registered', snapshot }),
        next: { ...current, runs: [...current.runs, snapshot] },
        committed: true,
      });
    },
  });
}

function validRunChange(before: RunSnapshot, change: RunChange) {
  const state = change.state;
  const previous = before.state;
  const replacement = [
    isFrozen(previous),
    isFrozen(state),
    state.runId === previous.runId,
    state.contractId === previous.contractId,
    state.contractDigest === previous.contractDigest,
    state.deadlineMs === previous.deadlineMs,
    state.spentMicros >= previous.spentMicros,
    state.repairs >= previous.repairs,
    state.generation > previous.generation,
    state.attemptId !== previous.attemptId,
    change.facts.length === 0,
  ].every(Boolean);
  const expected = Match.value(state).pipe(
    Match.tag('Frozen', () => Option.none()),
    Match.tag('Qualified', (value) =>
      Option.some(
        decideQualification(previous, before.contract, value.receipt, value.qualifiedAtMs),
      ),
    ),
    Match.tag('Cancelled', (value) =>
      Option.some(decideCancellation(previous, value.cancelledAtMs)),
    ),
    Match.exhaustive,
  );
  function accepted(
    decision: ReturnType<typeof decideCancellation> | ReturnType<typeof decideQualification>,
  ) {
    return Match.value(decision).pipe(
      Match.tag(
        'Accepted',
        (value) => sameRun(value.state, state) && sameFacts(value.facts, change.facts),
      ),
      Match.tag('Refused', () => false),
      Match.exhaustive,
    );
  }
  return replacement || Option.exists(expected, accepted);
}

function spread(current: MigrationLedgerState, snapshot: RunSnapshot) {
  function* updatePeers() {
    const workers: WorkerJournalSnapshot[] = [];
    const authority = runAuthority(snapshot);
    for (const worker of current.workers) {
      const affected =
        worker.operation.identity.runId === snapshot.state.runId &&
        !sameAuthority(worker.authority, authority);
      const next = yield* Match.value(affected).pipe(
        Match.when(true, () =>
          changedAuthority(worker, authority.identity, authority.cancelledAtMs),
        ),
        Match.when(false, () => Result.succeed(worker)),
        Match.exhaustive,
      );
      workers.push(next);
    }
    return workers;
  }
  return Result.gen(updatePeers);
}

function changedRun(current: MigrationLedgerState, change: RunChange) {
  function* decide() {
    const before = Array.findFirst(current.runs, (run) => run.state.runId === change.runId);
    const result = yield* evaluateRunChange(before, change);
    function* committed(snapshot: RunSnapshot) {
      const previous = yield* Option.match(before, {
        onNone: () => Result.fail(new MigrationLedgerPolicyError({ code: 'InvalidData' })),
        onSome: Result.succeed,
      });
      yield* requirePolicy(validRunChange(previous, change));
      const time = Match.value(snapshot.state).pipe(
        Match.tag('Cancelled', (state) => state.cancelledAtMs),
        Match.tag('Qualified', (state) => state.qualifiedAtMs),
        Match.tag('Frozen', () => Number.MAX_SAFE_INTEGER),
        Match.exhaustive,
      );
      yield* requirePolicy(
        current.workers
          .filter((worker) => worker.operation.identity.runId === change.runId)
          .every((worker) => evidenceTime(worker) <= time),
      );
      const workers = yield* spread(current, snapshot);
      const runs = current.runs.map((run) =>
        Match.value(run.state.runId === change.runId).pipe(
          Match.when(true, () => snapshot),
          Match.when(false, () => run),
          Match.exhaustive,
        ),
      );
      return {
        reply: MigrationLedgerReply.make({ _tag: 'RunResult', result }),
        next: { ...current, runs, workers },
        committed: true,
      };
    }
    return yield* Match.value(result).pipe(
      Match.tag('Committed', ({ snapshot }) => Result.gen(() => committed(snapshot))),
      Match.tag('Conflict', () =>
        Result.succeed(unchanged(current, { _tag: 'RunResult', result })),
      ),
      Match.exhaustive,
    );
  }
  return Result.gen(decide);
}

function workerRefused(
  current: MigrationLedgerState,
  edit: WorkerJournalEdit,
  code: 'NotFound' | 'NotCurrent' | 'IdentityMismatch',
) {
  return unchanged(current, {
    _tag: 'WorkerResult',
    result: { _tag: 'Refused', refusal: { _tag: code, operationId: edit.operationId } },
  });
}

function workerGate(current: MigrationLedgerState, edit: WorkerJournalEdit) {
  const worker = Array.findFirst(
    current.workers,
    (value) => value.operation.operationId === edit.operationId,
  );
  const operation = Match.value(edit).pipe(
    Match.tag('Register', (value) => Option.some(value.operation)),
    Match.orElse(() => Option.map(worker, (value) => value.operation)),
  );
  function gate(value: WorkerOperation) {
    const run = Array.findFirst(
      current.runs,
      (entry) => entry.state.runId === value.identity.runId,
    );
    function found(parent: RunSnapshot) {
      const needsFrozen = Match.value(edit).pipe(
        Match.tag('Register', () => Option.isNone(worker)),
        Match.tag('Claim', ({ intent }) => canMaterialize(intent)),
        Match.tag('RecordReadiness', 'AuthorizeExecution', 'RequestCancellation', () => true),
        Match.orElse(() => false),
      );
      const repeatedCancellation = isCancellation(edit) && isCancelled(parent.state);
      const casLoser = Match.value(edit).pipe(
        Match.tag('Register', () => false),
        Match.orElse((value) =>
          Option.exists(worker, (snapshot) => snapshot.revision !== value.expectedRevision),
        ),
      );
      const duplicate = isRegistration(edit) && Option.isSome(worker);
      const currentIdentity = sameIdentity(value.identity, parent.state);
      const validLimits = [
        value.limits.deadlineMs === parent.state.deadlineMs,
        value.limits.spentMicros === parent.state.spentMicros,
        value.limits.repairs === parent.state.repairs,
      ].every(Boolean);
      return Match.value(true).pipe(
        Match.when(
          () => casLoser || duplicate,
          () => Option.none(),
        ),
        Match.when(
          () =>
            needsFrozen && (!currentIdentity || (!isFrozen(parent.state) && !repeatedCancellation)),
          () => Option.some(workerRefused(current, edit, 'NotCurrent')),
        ),
        Match.when(
          () => isRegistration(edit) && !validLimits,
          () => Option.some(workerRefused(current, edit, 'IdentityMismatch')),
        ),
        Match.orElse(() => Option.none()),
      );
    }
    return Option.match(run, {
      onNone: () => Option.some(workerRefused(current, edit, 'NotFound')),
      onSome: found,
    });
  }
  return Option.flatMap(operation, gate);
}

function editedWorker(current: MigrationLedgerState, edit: WorkerJournalEdit) {
  function* evaluate() {
    // Repeated cancellation is cleanup-only; unchanged authority must not bump peers.
    const parentCancelled = current.runs.some(
      (run) =>
        isCancelled(run.state) &&
        current.workers.some(
          (worker) =>
            worker.operation.operationId === edit.operationId &&
            worker.operation.identity.runId === run.state.runId,
        ),
    );
    function cancellationEdit(
      value: Extract<WorkerJournalEdit, { readonly _tag: 'RequestCancellation' }>,
    ) {
      return Match.value(parentCancelled).pipe(
        Match.when(true, (): WorkerJournalEdit => ({ ...value, _tag: 'RequestCleanup' })),
        Match.when(false, () => value),
        Match.exhaustive,
      );
    }
    const effective = Match.value(edit).pipe(
      Match.tag('RequestCancellation', cancellationEdit),
      Match.orElse((value) => value),
    );
    const decision = yield* evaluateWorkerJournalEdit(current.workers, effective);
    function* committed(snapshot: WorkerJournalSnapshot) {
      const withWorkers = { ...current, workers: decision.next };
      const run = Array.findFirst(
        current.runs,
        (value) => value.state.runId === snapshot.operation.identity.runId,
      );
      const cancellation = Option.filter(
        run,
        (value) => isFrozen(value.state) && isCancellation(edit),
      );
      function* cancel(value: RunSnapshot) {
        const cancelled = decideCancellation(value.state, edit.atMs);
        return yield* Match.value(cancelled).pipe(
          Match.tag('Accepted', (accepted) =>
            changedRun(current, {
              runId: value.state.runId,
              expectedRevision: value.revision,
              state: accepted.state,
              facts: accepted.facts,
            }),
          ),
          Match.tag('Refused', () =>
            Result.fail(new MigrationLedgerPolicyError({ code: 'InvalidData' })),
          ),
          Match.exhaustive,
        );
      }
      const updated = yield* Option.match(cancellation, {
        onNone: () => Result.succeed(withWorkers),
        onSome: (value) =>
          Result.gen(() => cancel(value)).pipe(
            Result.map((outcome) => ({ ...withWorkers, runs: outcome.next.runs })),
          ),
      });
      return {
        reply: MigrationLedgerReply.make({ _tag: 'WorkerResult', result: decision.result }),
        next: updated,
        committed: true,
      };
    }
    return yield* Match.value(decision.result).pipe(
      Match.tag('Committed', ({ snapshot }) => Result.gen(() => committed(snapshot))),
      Match.orElse(() =>
        Result.succeed(unchanged(current, { _tag: 'WorkerResult', result: decision.result })),
      ),
    );
  }
  return Option.match(workerGate(current, edit), {
    onSome: Result.succeed,
    onNone: () => Result.gen(evaluate),
  });
}

function eventFor(
  current: MigrationLedgerState,
  next: MigrationLedgerState,
  command: MigrationLedgerCommand,
): MigrationLedgerEvent {
  function runRevision(run: RunSnapshot) {
    const previous = Array.findFirst(
      current.runs,
      (value) => value.state.runId === run.state.runId,
    );
    const before = Option.map(previous, (value) => value.revision);
    return Match.value(Option.contains(before, run.revision)).pipe(
      Match.when(true, () => []),
      Match.when(false, () => [{ runId: run.state.runId, before, after: run.revision }]),
      Match.exhaustive,
    );
  }
  function workerRevision(worker: WorkerJournalSnapshot) {
    const previous = Array.findFirst(
      current.workers,
      (value) => value.operation.operationId === worker.operation.operationId,
    );
    const before = Option.map(previous, (value) => value.revision);
    return Match.value(Option.contains(before, worker.revision)).pipe(
      Match.when(true, () => []),
      Match.when(false, () => [
        { operationId: worker.operation.operationId, before, after: worker.revision },
      ]),
      Match.exhaustive,
    );
  }
  const runRevisions = next.runs.flatMap(runRevision);
  const workerRevisions = next.workers.flatMap(workerRevision);
  return { sequence: next.sequence, command, runRevisions, workerRevisions };
}

function detachDecision(
  reply: MigrationLedgerReply,
  next: MigrationLedgerState,
  event: Option.Option<MigrationLedgerEvent>,
) {
  const value = Schema.Struct({
    reply: MigrationLedgerReply,
    next: MigrationLedgerState,
    event: Schema.Option(MigrationLedgerEvent),
  });
  const json = Schema.toCodecJson(value);
  const wire = Schema.fromJsonString(json);
  const encoded = Schema.encodeUnknownResult(wire)({ reply, next, event });
  const decode = Schema.decodeUnknownResult(wire);
  return encoded.pipe(
    Result.flatMap(decode),
    Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })),
  );
}

export function decideMigrationLedger(current: MigrationLedgerState, input: unknown) {
  function* decide() {
    const state = yield* validateState(current);
    const command = yield* Schema.decodeUnknownResult(MigrationLedgerCommand, {
      onExcessProperty: 'error',
    })(input).pipe(Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })));
    const encodedCommand = yield* migrationLedgerEncoding.command(command);
    const outcome = yield* Match.value(command).pipe(
      Match.tag('RegisterRun', (value) => registered(state, value)),
      Match.tag('ChangeRun', ({ change }) => changedRun(state, change)),
      Match.tag('EditWorker', ({ edit }) => editedWorker(state, edit)),
      Match.exhaustive,
    );
    function* commit() {
      yield* requirePolicy(state.sequence < Number.MAX_SAFE_INTEGER, 'RevisionExhausted');
      yield* requirePolicy(state.sequence < migrationLedgerBounds.maxEvents, 'CapacityExceeded');
      const next = { ...outcome.next, sequence: state.sequence + 1 };
      yield* validateState(next);
      const event = eventFor(state, next, command);
      const encodedEvent = yield* migrationLedgerEncoding.event(event);
      const currentBytes = yield* payloadSize(state);
      const nextBytes = yield* payloadSize(next);
      const bytes = Math.max(currentBytes, nextBytes);
      // Task 2 bounds both current and proposed encoded records + this command/event.
      // Task 4 also counts retained commit payloads transactionally; state has no audit history.
      yield* requirePolicy(
        bytes + migrationPayloadBytes(encodedCommand) + migrationPayloadBytes(encodedEvent) <=
          migrationLedgerBounds.maxPayloadBytes,
        'CapacityExceeded',
      );
      return yield* detachDecision(outcome.reply, next, Option.some(event));
    }
    return yield* Match.value(outcome.committed).pipe(
      Match.when(true, () => Result.gen(commit)),
      Match.when(false, () => detachDecision(outcome.reply, state, Option.none())),
      Match.exhaustive,
    );
  }
  return Result.gen(decide);
}

export function recoverMigrationLedger(current: MigrationLedgerState) {
  function recovered(state: MigrationLedgerState) {
    const recovery: MigrationRecovery = {
      sequence: state.sequence,
      runs: structuredClone(state.runs),
      workers: state.workers.map((snapshot) => ({
        snapshot: detach(snapshot),
        unresolvedIntentIds: snapshot.intents.filter(unresolved).map((intent) => intent.intentId),
      })),
    };
    const encoded = Schema.encodeUnknownResult(migrationLedgerCodecs.recovery)(recovery);
    const decode = Schema.decodeUnknownResult(migrationLedgerCodecs.recovery);
    return encoded.pipe(
      Result.flatMap(decode),
      Result.mapError(() => new MigrationLedgerPolicyError({ code: 'InvalidData' })),
    );
  }
  return validateState(current).pipe(Result.flatMap(recovered));
}
