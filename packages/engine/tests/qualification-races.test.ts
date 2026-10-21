import { expect, test } from 'bun:test';

import { AttemptId } from '@ceirean/domain';
import { Deferred, Effect, Fiber, Match, Option, Ref, Result } from 'effect';
import { TestClock } from 'effect/testing';

import {
  CandidateVerifierError,
  RunRepository,
  RunRepositoryError,
  qualifyRun,
  type RunSnapshot,
} from '../src/index.ts';
import {
  coordinatorTestLayers,
  makeCancelledChange,
  makeControlledVerifier,
  makeEvidenceCase,
  makeQualifiedChange,
  makeSnapshot,
} from './fixtures.ts';
import { makeMemoryRepository } from './memory-repository.ts';

export async function controlledRace(winner: 'cancellation' | 'replacement' | 'qualifier') {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  const controlled = await Effect.runPromise(makeControlledVerifier());
  const revisions: number[] = [];
  function recordRevision(found: Option.Option<RunSnapshot>) {
    Option.map(found, (snapshot) => revisions.push(snapshot.revision));
    return found;
  }
  const repository = RunRepository.of({
    ...memory.service,
    load: (id) => memory.service.load(id).pipe(Effect.map(recordRevision)),
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    const first = yield* Effect.forkChild(qualifyRun(seed.state.runId));
    const firstRequest = yield* Deferred.await(controlled.first);
    const second = yield* Effect.forkChild(qualifyRun(seed.state.runId));
    const secondRequest = yield* Deferred.await(controlled.second);
    expect(firstRequest).toEqual({
      identity: makeEvidenceCase().identity,
      contract: seed.contract,
    });
    expect(secondRequest).toEqual(firstRequest);
    expect(revisions).toEqual([7, 7]);
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(seed));

    const replacement = { ...seed.state, attemptId: AttemptId.make('attempt-2'), generation: 4 };
    const competing = Match.value(winner).pipe(
      Match.when('cancellation', () => Option.some(makeCancelledChange())),
      Match.when('replacement', () =>
        Option.some({
          runId: seed.state.runId,
          expectedRevision: 7,
          state: replacement,
          facts: [],
        }),
      ),
      Match.when('qualifier', () => Option.none()),
      Match.exhaustive,
    );
    const compete = Option.match(competing, {
      onNone: () => Effect.void,
      onSome: (change) => memory.service.commit(change).pipe(Effect.asVoid),
    });
    yield* compete;
    yield* Deferred.succeed(controlled.releaseFirst, makeEvidenceCase().receipt);
    const firstOutcome = yield* Fiber.join(first);
    const winningSnapshot = Option.getOrThrow(yield* memory.inspect(seed.state.runId));
    yield* Deferred.succeed(controlled.releaseSecond, makeEvidenceCase().receipt);
    const secondOutcome = yield* Fiber.join(second);
    const conflict = { _tag: 'Conflict' as const, runId: seed.state.runId, expectedRevision: 7 };
    expect(secondOutcome).toEqual(conflict);
    const qualified = makeQualifiedChange();
    const expected = Match.value(winner).pipe(
      Match.when('cancellation', () => ({
        ...seed,
        revision: 8,
        state: makeCancelledChange().state,
        history: makeCancelledChange().facts,
      })),
      Match.when('replacement', () => ({ ...seed, revision: 8, state: replacement })),
      Match.when('qualifier', () => ({
        ...seed,
        revision: 8,
        state: qualified.state,
        history: qualified.facts,
      })),
      Match.exhaustive,
    );
    const expectedOutcome = Match.value(winner).pipe(
      Match.when('qualifier', () => ({ _tag: 'Qualified' as const, snapshot: expected })),
      Match.orElse(() => conflict),
    );
    expect(firstOutcome).toEqual(expectedOutcome);
    expect(winningSnapshot).toEqual(expected);
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(expected));
    expect(yield* Ref.get(controlled.calls)).toBe(2);
    expect(revisions).toEqual([7, 7]);
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(repository, controlled.service);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided.pipe(Effect.scoped, Effect.timeout('2 seconds')));
}
for (const winner of ['cancellation', 'replacement', 'qualifier'] as const) {
  test(`${winner} wins after both qualifiers enter at revision 7; stale results cannot overwrite it`, () =>
    controlledRace(winner));
}

export async function lateReceipt(now: number) {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  const controlled = await Effect.runPromise(makeControlledVerifier());
  let commits = 0;
  const repository = RunRepository.of({
    ...memory.service,
    commit(change) {
      commits++;
      return memory.service.commit(change);
    },
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    const child = yield* Effect.forkChild(qualifyRun(seed.state.runId));
    yield* Deferred.await(controlled.first);
    yield* TestClock.setTime(now);
    yield* Deferred.succeed(controlled.releaseFirst, makeEvidenceCase().receipt);
    expect(yield* Fiber.join(child)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'DeadlineExpired' },
    });
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(seed));
    expect(yield* Ref.get(controlled.calls)).toBe(1);
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(repository, controlled.service);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided.pipe(Effect.scoped, Effect.timeout('2 seconds')));
  expect(commits).toBe(0);
}
for (const now of [1000, 1001]) {
  test(`receipt arriving at ${now} is refused using the final clock with no commit`, () =>
    lateReceipt(now));
}

export async function competingFailure(stage: 'verify' | 'commit') {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  const controlled = await Effect.runPromise(makeControlledVerifier());
  const verificationError = new CandidateVerifierError({
    runId: seed.state.runId,
    code: 'VerificationFailed',
  });
  const commitError = new RunRepositoryError({
    runId: seed.state.runId,
    operation: 'commit',
    code: 'CommitFailed',
  });
  let commits = 0;
  const repository = RunRepository.of({
    ...memory.service,
    commit() {
      commits++;
      const failure = Effect.fail(commitError);
      return failure;
    },
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    const pending = Effect.result(qualifyRun(seed.state.runId));
    const child = yield* Effect.forkChild(pending);
    yield* Deferred.await(controlled.first);
    yield* memory.service.commit(makeCancelledChange());
    const release = Match.value(stage).pipe(
      Match.when('verify', () => Deferred.fail(controlled.releaseFirst, verificationError)),
      Match.when('commit', () =>
        Deferred.succeed(controlled.releaseFirst, makeEvidenceCase().receipt),
      ),
      Match.exhaustive,
    );
    yield* release;
    const expectedError = Match.value(stage).pipe(
      Match.when('verify', () => verificationError),
      Match.when('commit', () => commitError),
      Match.exhaustive,
    );
    expect(yield* Fiber.join(child)).toEqual(Result.fail(expectedError));
    expect(yield* memory.inspect(seed.state.runId)).toEqual(
      Option.some({
        ...seed,
        revision: 8,
        state: makeCancelledChange().state,
        history: makeCancelledChange().facts,
      }),
    );
    expect(yield* Ref.get(controlled.calls)).toBe(1);
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(repository, controlled.service);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided.pipe(Effect.scoped, Effect.timeout('2 seconds')));
  const expected = Match.value(stage).pipe(
    Match.when('verify', () => 0),
    Match.when('commit', () => 1),
    Match.exhaustive,
  );
  expect(commits).toBe(expected);
}
for (const stage of ['verify', 'commit'] as const) {
  test(`${stage} failure retains competing cancellation without retries or qualification facts`, () =>
    competingFailure(stage));
}
