import { test } from 'bun:test';

import { AttemptId, CancelledRun, FrozenRun, WorkerOperationId } from '@ceirean/domain';
import {
  MigrationLedgerState,
  decideMigrationLedger,
  migrationLedgerCodecs,
  recoverMigrationLedger,
} from '@ceirean/engine/journal-policy';
import { Arbitrary, Effect, Match, Option, Result, Schema } from 'effect';

import { makeEvidenceCase } from '../../domain/tests/fixtures.ts';
import { checkLaw } from '../../domain/tests/properties.ts';
import { workerCaseArbitrary } from '../../domain/tests/worker-fixtures.ts';
import type { WorkerJournalSnapshot } from '../src/worker-contracts.ts';

const small = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }));
const inputs = Arbitrary.all({ worker: workerCaseArbitrary, count: Arbitrary.schema(small) });
type Input = typeof inputs extends Arbitrary.Arbitrary<infer A> ? A : never;

function construct(input: Input) {
  const seed = input.worker;
  const identity = {
    ...seed.operation.identity,
    generation: Math.min(seed.operation.identity.generation, Number.MAX_SAFE_INTEGER - 10),
  };
  const operation = { ...seed.operation, identity };
  const state = { _tag: 'Frozen' as const, ...identity, ...operation.limits };
  const evidence = makeEvidenceCase();
  const contract = {
    ...evidence.contract,
    contractId: identity.contractId,
    contractDigest: identity.contractDigest,
  };
  const workers = Array.from({ length: input.count }, (_, index): WorkerJournalSnapshot => ({
    revision: 0,
    operation: {
      ...operation,
      operationId: WorkerOperationId.make(`${operation.operationId}-${index}`),
    },
    createdAtMs: seed.createdAtMs,
    editTimeFloorMs: seed.createdAtMs,
    outcomeEvidenceFloorMs: seed.createdAtMs,
    authority: { identity, cancelledAtMs: Option.none() },
    intents: [],
    containerId: Option.none(),
    readiness: Option.none(),
    executionAuthorizedAtMs: Option.none(),
    cleanup: Option.none(),
  }));
  const ledger: MigrationLedgerState = {
    sequence: 0,
    runs: [{ revision: 0, state, contract, history: [] }],
    workers,
  };
  const first = Option.getOrThrow(Option.fromUndefinedOr(workers[0]));
  const cleanup = {
    _tag: 'EditWorker' as const,
    edit: {
      _tag: 'RequestCleanup' as const,
      operationId: first.operation.operationId,
      expectedRevision: 0,
      atMs: seed.nowMs,
      cleanupWindowMs: 100,
    },
  };
  const replacement = {
    _tag: 'ChangeRun' as const,
    change: {
      runId: state.runId,
      expectedRevision: 0,
      state: {
        ...state,
        generation: state.generation + 1,
        attemptId: AttemptId.make(`${state.attemptId}-new`),
      },
      facts: [],
    },
  };
  return { ledger, cleanup, replacement, atMs: seed.nowMs };
}

function decision(state: MigrationLedgerState, input: unknown) {
  return Result.getOrThrow(decideMigrationLedger(state, input));
}

function isCommitted(outcome: ReturnType<typeof decision>) {
  function committedResult(
    result: Extract<
      typeof outcome.reply,
      { readonly _tag: 'WorkerResult' | 'RunResult' }
    >['result'],
  ) {
    return Match.value(result).pipe(
      Match.tag('Committed', () => true),
      Match.orElse(() => false),
    );
  }
  const accepted = Match.value(outcome.reply).pipe(
    Match.tag('Registered', () => true),
    Match.tag('RunResult', 'WorkerResult', ({ result }) => committedResult(result)),
    Match.orElse(() => false),
  );
  return Option.isSome(outcome.event) && accepted;
}

function runConflict(outcome: ReturnType<typeof decision>) {
  return Match.value(outcome.reply).pipe(
    Match.when({ _tag: 'RunResult', result: { _tag: 'Conflict' } }, () => true),
    Match.orElse(() => false),
  );
}

function notCurrent(outcome: ReturnType<typeof decision>) {
  return Match.value(outcome.reply).pipe(
    Match.when(
      { _tag: 'WorkerResult', result: { _tag: 'Refused', refusal: { _tag: 'NotCurrent' } } },
      () => true,
    ),
    Match.orElse(() => false),
  );
}

function workerRefused(outcome: ReturnType<typeof decision>) {
  return Match.value(outcome.reply).pipe(
    Match.when({ _tag: 'WorkerResult', result: { _tag: 'Refused' } }, () => true),
    Match.orElse(() => false),
  );
}

function encodeState(state: MigrationLedgerState) {
  const encoded = Schema.encodeUnknownResult(migrationLedgerCodecs.state)(state);
  return Result.getOrThrow(encoded);
}

function casLaw(input: Input) {
  const c = construct(input);
  const first = decision(c.ledger, c.replacement);
  const second = decision(first.next, c.replacement);
  const reversedWinner = decision(c.ledger, {
    ...c.replacement,
    change: {
      ...c.replacement.change,
      state: { ...c.replacement.change.state, attemptId: AttemptId.make('other-winner') },
    },
  });
  const reversedLoser = decision(reversedWinner.next, c.replacement);
  return [
    isCommitted(first),
    isCommitted(reversedWinner),
    Option.isNone(second.event),
    Option.isNone(reversedLoser.event),
    first.next.sequence === 1,
    second.next.sequence === 1,
    runConflict(second),
  ].every(Boolean);
}

function coherenceLaw(input: Input) {
  const c = construct(input);
  const command = { ...c.cleanup, edit: { ...c.cleanup.edit, _tag: 'RequestCancellation' } };
  const outcome = decision(c.ledger, command);
  const run = Option.getOrThrow(Option.fromUndefinedOr(outcome.next.runs[0]));
  const event = Option.getOrThrow(outcome.event);
  return [
    isCommitted(outcome),
    Schema.is(CancelledRun)(run.state),
    run.history.length === 1,
    run.revision === 1,
    outcome.next.workers.every(
      (worker) => worker.revision === 1 && Option.contains(worker.authority.cancelledAtMs, c.atMs),
    ),
    event.runRevisions.length === 1,
    event.workerRevisions.length === c.ledger.workers.length,
    c.ledger.runs[0]?.revision === 0,
  ].every(Boolean);
}

function isolationLaw(input: Input) {
  const c = construct(input);
  const replaced = decision(c.ledger, c.replacement);
  const stale = decision(replaced.next, {
    ...c.cleanup,
    edit: { ...c.cleanup.edit, expectedRevision: 1, _tag: 'RequestCancellation' },
  });
  const cleanup = decision(replaced.next, {
    ...c.cleanup,
    edit: { ...c.cleanup.edit, expectedRevision: 1 },
  });
  return [
    isCommitted(replaced),
    isCommitted(cleanup),
    Option.isNone(stale.event),
    Schema.is(FrozenRun)(stale.next.runs[0]?.state),
    stale.next.runs[0]?.state.generation === c.replacement.change.state.generation,
    stale.next.workers.every((worker) => Option.isNone(worker.authority.cancelledAtMs)),
    notCurrent(stale),
  ].every(Boolean);
}

function rejectionLaw(input: Input) {
  const c = construct(input);
  const control = decision(c.ledger, c.cleanup);
  const before = encodeState(c.ledger);
  const refused = decision(c.ledger, {
    ...c.cleanup,
    edit: {
      _tag: 'AuthorizeExecution',
      operationId: c.cleanup.edit.operationId,
      expectedRevision: 0,
      atMs: c.atMs,
    },
  });
  const stale = decision(control.next, c.cleanup);
  const after = encodeState(refused.next);
  const invalid = decideMigrationLedger(c.ledger, {
    ...c.replacement,
    change: { ...c.replacement.change, facts: [{ _tag: 'fabricated' }] },
  });
  return [
    isCommitted(control),
    Result.isFailure(invalid),
    before === after,
    Option.isNone(refused.event),
    Option.isNone(stale.event),
    workerRefused(refused),
    stale.next.sequence === 1,
  ].every(Boolean);
}

function monotonicLaw(input: Input) {
  const c = construct(input);
  const control = decision(c.ledger, c.cleanup);
  const repeated = decision(control.next, {
    ...c.cleanup,
    edit: { ...c.cleanup.edit, expectedRevision: 1, atMs: c.atMs + 1, cleanupWindowMs: 1000 },
  });
  const renewed = decideMigrationLedger(c.ledger, {
    ...c.replacement,
    change: {
      ...c.replacement.change,
      state: {
        ...c.replacement.change.state,
        deadlineMs: c.replacement.change.state.deadlineMs + 1,
      },
    },
  });
  const spend = Math.max(1, c.replacement.change.state.spentMicros);
  const repairs = Math.max(1, c.replacement.change.state.repairs);
  const spentState = {
    ...c.ledger,
    runs: c.ledger.runs.map((run) => ({
      ...run,
      state: { ...run.state, spentMicros: spend, repairs },
    })),
  };
  const decreasingSpend = decideMigrationLedger(spentState, {
    ...c.replacement,
    change: {
      ...c.replacement.change,
      state: { ...c.replacement.change.state, spentMicros: spend - 1, repairs },
    },
  });
  const decreasingRepairs = decideMigrationLedger(spentState, {
    ...c.replacement,
    change: {
      ...c.replacement.change,
      state: { ...c.replacement.change.state, spentMicros: spend, repairs: repairs - 1 },
    },
  });
  const staleTime = decision(control.next, {
    ...c.cleanup,
    edit: { ...c.cleanup.edit, expectedRevision: 1, atMs: c.atMs - 1 },
  });
  return [
    isCommitted(control),
    isCommitted(repeated),
    Result.isFailure(renewed),
    Result.isFailure(decreasingSpend),
    Result.isFailure(decreasingRepairs),
    Option.isNone(staleTime.event),
    repeated.next.workers.every(
      (worker, index) => worker.editTimeFloorMs >= (c.ledger.workers[index]?.editTimeFloorMs ?? 0),
    ),
    Option.exists(
      repeated.next.workers[0]?.cleanup ?? Option.none(),
      (cleanup) => cleanup.deadlineMs === c.atMs + 100 && cleanup.requestedAtMs === c.atMs,
    ),
  ].every(Boolean);
}

function detachmentLaw(input: Input) {
  const c = construct(input);
  const outcome = decision(c.ledger, {
    ...c.cleanup,
    edit: { ...c.cleanup.edit, _tag: 'RequestCancellation' },
  });
  const encoded = encodeState(outcome.next);
  const decoding = Schema.decodeUnknownResult(migrationLedgerCodecs.state)(encoded);
  const decoded = Result.getOrThrow(decoding);
  const recovered = recoverMigrationLedger(decoded);
  const recovery = Result.getOrThrow(recovered);
  const worker = Option.getOrThrow(Option.fromUndefinedOr(decoded.workers[0]));
  function workerSnapshot(
    result: Extract<typeof outcome.reply, { readonly _tag: 'WorkerResult' }>['result'],
  ) {
    return Match.value(result).pipe(
      Match.tag('Committed', ({ snapshot }) => Option.some(snapshot)),
      Match.orElse(() => Option.none()),
    );
  }
  const reply = Match.value(outcome.reply).pipe(
    Match.tag('WorkerResult', ({ result }) => workerSnapshot(result)),
    Match.orElse(() => Option.none()),
  );
  const snapshot = Option.getOrThrow(reply);
  Reflect.set(snapshot.operation.identity, 'generation', -1);
  Reflect.set(Option.getOrThrow(snapshot.cleanup), 'deadlineMs', -1);
  Reflect.set(recovery.workers[0]?.snapshot.operation.identity ?? {}, 'generation', -2);
  const original = Option.getOrThrow(Option.fromUndefinedOr(outcome.next.workers[0]));
  return [
    isCommitted(outcome),
    Schema.is(MigrationLedgerState)(decoded),
    Option.isSome(worker.authority.cancelledAtMs),
    Option.isSome(worker.cleanup),
    Option.isNone(worker.readiness),
    original.operation.identity.generation >= 0,
    worker.operation.identity.generation >= 0,
    Option.exists(original.cleanup, (cleanup) => cleanup.deadlineMs === c.atMs + 100),
    c.ledger.workers.every((value) => Option.isNone(value.cleanup)),
  ].every(Boolean);
}

const laws = {
  'CAS winner uniqueness': casLaw,
  'cancellation run-worker coherence': coherenceLaw,
  'old-generation isolation': isolationLaw,
  'rejected transition immutability and no audit': rejectionLaw,
  'monotonic deadlines budgets and time floors': monotonicLaw,
  'canonical codec and returned-object detachment': detachmentLaw,
};

for (const [name, law] of Object.entries(laws)) {
  async function verifyLaw() {
    await Effect.runPromise(checkLaw(name, inputs, law));
  }
  test(`constructive ledger ${name}; 3 seeds x 1000 cases`, verifyLaw);
}
