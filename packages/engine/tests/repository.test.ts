import { expect, test } from 'bun:test';

import { AttemptId, RunId, type UpgradeRun, type RunFact } from '@ceirean/domain';
import { Effect, Match, Option, Result } from 'effect';

import type { CommitResult } from '../src/contracts.ts';
import { RunRepositoryError } from '../src/errors.ts';
import { RunRepository } from '../src/ports.ts';
import { makeCancelledChange, makeQualifiedChange, makeSnapshot } from './fixtures.ts';
import { makeMemoryRepository } from './memory-repository.ts';

function committedSnapshot(result: CommitResult) {
  return Match.value(result).pipe(
    Match.tag('Committed', ({ snapshot }) => snapshot),
    Match.tag('Conflict', () => {
      throw new TypeError('Expected a committed snapshot');
    }),
    Match.exhaustive,
  );
}

function qualifiedState(state: UpgradeRun) {
  return Match.value(state).pipe(
    Match.tag('Qualified', (qualified) => qualified),
    Match.orElse(() => {
      throw new TypeError('Expected a qualified state');
    }),
  );
}

function qualifiedFact(fact: RunFact) {
  return Match.value(fact).pipe(
    Match.tag('RunQualified', (qualified) => qualified),
    Match.orElse(() => {
      throw new TypeError('Expected a qualification fact');
    }),
  );
}

async function atomicCommit() {
  function* scenario() {
    const { service, inspect } = yield* makeMemoryRepository([makeSnapshot()]);
    const change = makeQualifiedChange();
    const committed = yield* service.commit(change);
    expect(committed._tag).toBe('Committed');
    const stored = Option.getOrThrow(yield* inspect(change.runId));
    expect(stored.revision).toBe(8);
    expect(stored.state._tag).toBe('Qualified');
    expect(stored.history.map((fact) => fact._tag)).toEqual(['RunQualified']);
    expect(committed).toEqual({ _tag: 'Committed', snapshot: stored });
    expect(yield* service.commit(makeCancelledChange())).toEqual({
      _tag: 'Conflict',
      runId: change.runId,
      expectedRevision: 7,
    });
    expect(yield* inspect(change.runId)).toEqual(
      Option.some({
        revision: 8,
        contract: makeSnapshot().contract,
        state: change.state,
        history: change.facts,
      }),
    );
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'conditional commit exposes revision 8, next state and fact together; stale commit is inert',
  atomicCommit,
);

async function missingRun() {
  function* scenario() {
    const { service, inspect } = yield* makeMemoryRepository([]);
    const change = makeQualifiedChange();
    expect(yield* service.load(change.runId)).toEqual(Option.none());
    expect(yield* service.commit(change)).toEqual({
      _tag: 'Conflict',
      runId: change.runId,
      expectedRevision: 7,
    });
    expect(yield* inspect(change.runId)).toEqual(Option.none());
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('missing run load returns None and missing commit returns Conflict', missingRun);

async function wrongIdentity() {
  function* scenario() {
    const { service, inspect } = yield* makeMemoryRepository([makeSnapshot()]);
    const change = makeQualifiedChange();
    const wrong = RunId.make('wrong-run');
    const badState = { ...change, state: { ...change.state, runId: wrong } };
    const badFact = { ...change, facts: change.facts.map((fact) => ({ ...fact, runId: wrong })) };
    for (const invalid of [badState, badFact]) {
      expect(yield* Effect.result(service.commit(invalid))).toEqual(
        Result.fail(
          new RunRepositoryError({ operation: 'commit', runId: change.runId, code: 'InvalidData' }),
        ),
      );
      expect(yield* inspect(change.runId)).toEqual(Option.some(makeSnapshot()));
    }
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('wrong state or fact run identity fails InvalidData without mutation', wrongIdentity);

async function exhaustedRevision() {
  function* scenario() {
    const seed = { ...makeSnapshot(), revision: Number.MAX_SAFE_INTEGER };
    const { service, inspect } = yield* makeMemoryRepository([seed]);
    const change = { ...makeQualifiedChange(), expectedRevision: Number.MAX_SAFE_INTEGER };
    expect(yield* Effect.result(service.commit(change))).toEqual(
      Result.fail(
        new RunRepositoryError({
          operation: 'commit',
          runId: change.runId,
          code: 'RevisionExhausted',
        }),
      ),
    );
    expect(yield* inspect(change.runId)).toEqual(Option.some(seed));
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('exhausted revision fails without replacement or history append', exhaustedRevision);

async function concurrentChanges() {
  function* scenario() {
    const { service, inspect } = yield* makeMemoryRepository([makeSnapshot()]);
    const change = makeQualifiedChange();
    const results = yield* Effect.all([service.commit(change), service.commit(change)], {
      concurrency: 'unbounded',
    });
    expect(results.map((result) => result._tag).sort()).toEqual(['Committed', 'Conflict']);
    const stored = Option.getOrThrow(yield* inspect(change.runId));
    expect(stored.revision).toBe(8);
    expect(stored.history.map((fact) => fact._tag)).toEqual(['RunQualified']);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('two concurrent revision-7 changes yield one commit and one conflict', concurrentChanges);

async function retainedCancellation() {
  function* scenario() {
    const { service, inspect } = yield* makeMemoryRepository([makeSnapshot()]);
    const change = makeCancelledChange();
    yield* service.commit(change);
    const before = yield* inspect(change.runId);
    expect((yield* service.commit(makeQualifiedChange()))._tag).toBe('Conflict');
    expect(yield* inspect(change.runId)).toEqual(before);
    const stored = Option.getOrThrow(before);
    expect(stored.state._tag).toBe('Cancelled');
    expect(stored.history.map((fact) => fact._tag)).toEqual(['RunCancelled']);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'conflict retains competing cancellation and appends no losing qualification fact',
  retainedCancellation,
);

async function retainedReplacement() {
  function* scenario() {
    const seed = makeSnapshot();
    const { service, inspect } = yield* makeMemoryRepository([seed]);
    const replacement = { ...seed.state, attemptId: AttemptId.make('attempt-2'), generation: 4 };
    yield* service.commit({
      runId: seed.state.runId,
      expectedRevision: 7,
      state: replacement,
      facts: [],
    });
    expect((yield* service.commit(makeQualifiedChange()))._tag).toBe('Conflict');
    expect(yield* inspect(seed.state.runId)).toEqual(
      Option.some({ ...seed, revision: 8, state: replacement }),
    );
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('conflict retains a replacement attempt with no stale fact', retainedReplacement);

async function detachedReads() {
  function* scenario() {
    const seed = makeSnapshot();
    const { service, inspect } = yield* makeMemoryRepository([seed]);
    Reflect.set(seed.state, 'repairs', 99);
    Reflect.set(seed.contract.requiredChecks, '0', 'corrupt-seed');
    Reflect.set(seed.history, '0', makeCancelledChange().facts[0]);
    expect(yield* inspect(seed.state.runId)).toEqual(Option.some(makeSnapshot()));
    const loaded = Option.getOrThrow(yield* service.load(seed.state.runId));
    Reflect.set(loaded, 'revision', 99);
    Reflect.set(loaded.state, 'repairs', 99);
    Reflect.set(loaded.contract.requiredChecks, '0', 'corrupt-load');
    Reflect.set(loaded.history, '0', makeCancelledChange().facts[0]);
    const observed = Option.getOrThrow(yield* inspect(seed.state.runId));
    expect(observed).toEqual(makeSnapshot());
    Reflect.set(observed.state, 'repairs', 99);
    expect(yield* service.load(seed.state.runId)).toEqual(Option.some(makeSnapshot()));
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('seed, load and inspect snapshots cannot mutate retained storage', detachedReads);

async function detachedReceipts() {
  function* scenario() {
    const { service, inspect } = yield* makeMemoryRepository([makeSnapshot()]);
    const change = makeQualifiedChange();
    const result = yield* service.commit(change);
    expect(result._tag).toBe('Committed');
    const returned = committedSnapshot(result);
    Reflect.set(change.state.receipt.checks[0], 'outcome', 'Failed');
    Reflect.set(change.facts, '0', makeCancelledChange().facts[0]);
    Reflect.set(returned.state, 'repairs', 99);
    const returnedState = qualifiedState(returned.state);
    Reflect.set(returnedState.receipt.checks, '0', { checkId: 'corrupt', outcome: 'Failed' });
    const returnedFact = qualifiedFact(returned.history[0]!);
    Reflect.set(returnedFact.receipt.checks[0], 'outcome', 'Failed');
    Reflect.set(returned.history, '0', makeCancelledChange().facts[0]);
    const stored = Option.getOrThrow(yield* inspect(change.runId));
    const expected = makeQualifiedChange();
    expect(stored).toEqual({
      revision: 8,
      contract: makeSnapshot().contract,
      state: expected.state,
      history: expected.facts,
    });
    const loaded = Option.getOrThrow(yield* service.load(change.runId));
    const loadedState = qualifiedState(loaded.state);
    Reflect.set(loadedState.receipt.checks[0], 'outcome', 'Failed');
    const fact = qualifiedFact(loaded.history[0]!);
    Reflect.set(fact.receipt.checks[0], 'outcome', 'Failed');
    expect(yield* inspect(change.runId)).toEqual(
      Option.some({
        revision: 8,
        contract: makeSnapshot().contract,
        state: expected.state,
        history: expected.facts,
      }),
    );
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'commit inputs and returned receipts are detached throughout state and history',
  detachedReceipts,
);

async function detachedSeedReceipts() {
  function* scenario() {
    const change = makeQualifiedChange();
    const seed = { ...makeSnapshot(), state: change.state, history: change.facts };
    const acquisition = makeMemoryRepository([seed]);
    const first = yield* acquisition;
    const second = yield* acquisition;
    Reflect.set(seed.state.receipt.checks[0], 'outcome', 'Failed');
    Reflect.set(seed.history[0].receipt.checks, '0', { checkId: 'corrupt', outcome: 'Failed' });
    const expected = makeQualifiedChange();
    expect(yield* first.inspect(change.runId)).toEqual(
      Option.some({ ...makeSnapshot(), state: expected.state, history: expected.facts }),
    );
    yield* first.service.commit({ ...makeCancelledChange(), expectedRevision: 7 });
    expect(yield* second.inspect(change.runId)).toEqual(
      Option.some({ ...makeSnapshot(), state: expected.state, history: expected.facts }),
    );
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'seed receipt arrays are detached and each acquisition owns a fresh Ref',
  detachedSeedReceipts,
);

async function preCommitFailure() {
  function* scenario() {
    const { service, inspect } = yield* makeMemoryRepository([makeSnapshot()]);
    const change = makeQualifiedChange();
    const readError = new RunRepositoryError({
      operation: 'load',
      runId: change.runId,
      code: 'ReadFailed',
    });
    const commitError = new RunRepositoryError({
      operation: 'commit',
      runId: change.runId,
      code: 'CommitFailed',
    });
    const failing = RunRepository.of({
      load: () => Effect.fail(readError),
      commit: () => Effect.fail(commitError),
    });
    expect(yield* Effect.result(failing.load(change.runId))).toEqual(Result.fail(readError));
    expect(yield* Effect.result(failing.commit(change))).toEqual(Result.fail(commitError));
    expect(yield* inspect(change.runId)).toEqual(Option.some(makeSnapshot()));
    expect(yield* service.load(change.runId)).toEqual(Option.some(makeSnapshot()));
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'typed read and pre-commit failing services leave retained storage unchanged',
  preCommitFailure,
);
