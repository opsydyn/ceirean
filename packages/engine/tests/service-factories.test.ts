import { expect, test } from 'bun:test';

import { Data, Deferred, Effect, Fiber, Match, Option, Result, Tracer } from 'effect';

import type { RunChange } from '../src/contracts.ts';
import { CandidateVerifierError, RunRepositoryError } from '../src/errors.ts';
import { CandidateVerifier, RunRepository } from '../src/ports.ts';
import {
  makeCandidateVerifier,
  makeRunRepository,
  type RunRepositoryDriver,
} from '../src/service-factories.ts';
import { makeEvidenceCase, makeQualifiedChange, makeSnapshot } from './fixtures.ts';

class NativeFailure extends Data.TaggedError('NativeFailure')<{ readonly detail: string }> {}

async function lazyRepository() {
  const snapshot = makeSnapshot();
  const change = makeQualifiedChange();
  const calls: unknown[] = [];
  function load(id: typeof change.runId) {
    calls.push(id);
    return Result.succeed(Option.some(snapshot));
  }
  function commit(value: RunChange) {
    calls.push(value);
    return Result.succeed({
      _tag: 'Conflict' as const,
      runId: value.runId,
      expectedRevision: value.expectedRevision,
    });
  }
  const service = makeRunRepository({ load, commit });
  const loading = service.load(snapshot.state.runId);
  const committing = service.commit(change);
  expect(calls).toEqual([]);
  expect(await Effect.runPromise(loading)).toEqual(Option.some(snapshot));
  expect(await Effect.runPromise(loading)).toEqual(Option.some(snapshot));
  expect(await Effect.runPromise(committing)).toEqual({
    _tag: 'Conflict',
    runId: change.runId,
    expectedRevision: 7,
  });
  expect(calls).toEqual([snapshot.state.runId, snapshot.state.runId, change]);
}
test(
  'repository calls are deferred, repeatable, and preserve native success values',
  lazyRepository,
);

function repositoryOperation(driver: RunRepositoryDriver, operation: 'load' | 'commit') {
  const change = makeQualifiedChange();
  const service = makeRunRepository(driver);
  return Match.value(operation).pipe(
    Match.when('load', () => service.load(change.runId)),
    Match.when('commit', () => service.commit(change)),
    Match.exhaustive,
    Effect.asVoid,
    Effect.result,
  );
}

for (const operation of ['load', 'commit'] as const) {
  async function typedFailure() {
    const { runId } = makeQualifiedChange();
    const error = new RunRepositoryError({ operation, runId, code: 'InvalidData' });
    const effect = repositoryOperation(
      { load: () => Result.fail(error), commit: () => Result.fail(error) },
      operation,
    );
    const result = await Effect.runPromise(effect);
    expect(Result.getFailure(result)).toEqual(Option.some(error));
    const failure = Result.getFailure(result);
    expect(Option.getOrThrow(failure)).toBe(error);
  }
  test(`repository ${operation} preserves tagged Result failures`, typedFailure);

  async function nativeFailure() {
    const { runId } = makeQualifiedChange();
    function explode(): never {
      throw new NativeFailure({ detail: 'private native detail' });
    }
    const effect = repositoryOperation({ load: explode, commit: explode }, operation);
    const code = Match.value(operation).pipe(
      Match.when('load', () => 'ReadFailed' as const),
      Match.when('commit', () => 'CommitFailed' as const),
      Match.exhaustive,
    );
    expect(await Effect.runPromise(effect)).toEqual(
      Result.fail(new RunRepositoryError({ operation, runId, code })),
    );
  }
  test(
    `repository ${operation} maps unexpected native throws to a safe tagged error`,
    nativeFailure,
  );
}

async function lazyVerifier() {
  const evidence = makeEvidenceCase();
  const request = { identity: evidence.identity, contract: evidence.contract };
  const calls: unknown[] = [];
  let delivered: AbortSignal | undefined;
  function driver(received: typeof request, signal: AbortSignal) {
    calls.push(received);
    delivered = signal;
    return Promise.resolve(Result.succeed(evidence.receipt));
  }
  const service = makeCandidateVerifier(driver);
  const effect = service.verify(request);
  expect(calls).toEqual([]);
  expect(await Effect.runPromise(effect)).toBe(evidence.receipt);
  expect(calls).toEqual([request]);
  expect(delivered).toBeInstanceOf(AbortSignal);
  expect(delivered?.aborted).toBe(false);
}
test(
  'verifier defers native invocation and delivers the exact request and success value',
  lazyVerifier,
);

async function interruptedVerifier() {
  const { identity, contract } = makeEvidenceCase();
  let delivered: AbortSignal | undefined;
  function* scenario() {
    function driver(_request: unknown, signal: AbortSignal) {
      delivered = signal;
      return new Promise<Result.Result<unknown, CandidateVerifierError>>(() => {});
    }
    const service = makeCandidateVerifier(driver);
    const native = service.verify({ identity, contract });
    const fiber = yield* Effect.forkChild(native, { startImmediately: true });
    yield* Fiber.interrupt(fiber);
    expect(delivered).toBeInstanceOf(AbortSignal);
    expect(delivered?.aborted).toBe(true);
  }
  const effect = Effect.gen(scenario);
  await Effect.runPromise(effect.pipe(Effect.scoped, Effect.timeout('2 seconds')));
}
test('verifier delivers interruption to a still-pending native operation', interruptedVerifier);

async function verifierFailure() {
  const { identity, contract } = makeEvidenceCase();
  const request = { identity, contract };
  const error = new CandidateVerifierError({ runId: identity.runId, code: 'VerificationFailed' });
  const typed = makeCandidateVerifier(() => Promise.resolve(Result.fail(error)));
  const typedResult = typed.verify(request).pipe(Effect.result);
  const result = await Effect.runPromise(typedResult);
  const failure = Result.getFailure(result);
  expect(Option.getOrThrow(failure)).toBe(error);
  const rejected = makeCandidateVerifier(() =>
    Promise.reject(new NativeFailure({ detail: 'private verifier detail' })),
  );
  const rejectedResult = rejected.verify(request).pipe(Effect.result);
  expect(await Effect.runPromise(rejectedResult)).toEqual(Result.fail(error));
}
test(
  'verifier preserves tagged Result failure and maps rejection without native details',
  verifierFailure,
);

async function synchronousVerifierThrow() {
  const { identity, contract } = makeEvidenceCase();
  function explode(): never {
    throw new NativeFailure({ detail: 'private synchronous detail' });
  }
  const service = makeCandidateVerifier(explode);
  const effect = service.verify({ identity, contract }).pipe(Effect.result);
  expect(await Effect.runPromise(effect)).toEqual(
    Result.fail(new CandidateVerifierError({ runId: identity.runId, code: 'VerificationFailed' })),
  );
}
test('verifier normalizes a synchronous native throw without a defect', synchronousVerifierThrow);

async function tracedBoundaries() {
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const seed = makeSnapshot();
  const committed = { _tag: 'Committed' as const, snapshot: seed };
  const repository = makeRunRepository({
    load: () => Result.succeed(Option.none()),
    commit: () => Result.succeed(committed),
  });
  const { identity, contract, receipt } = makeEvidenceCase();
  const verifier = makeCandidateVerifier(() => Promise.resolve(Result.succeed(receipt)));
  function* scenario() {
    expect(yield* repository.load(identity.runId)).toEqual(Option.none());
    expect(yield* repository.commit(makeQualifiedChange())).toBe(committed);
    expect(yield* verifier.verify({ identity, contract })).toBe(receipt);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program.pipe(Effect.withTracer(tracer)));
  expect(spans.map((span) => span.name)).toEqual([
    'RunRepository.load',
    'RunRepository.commit',
    'CandidateVerifier.verify',
  ]);
  expect(spans.map((span) => span.status._tag)).toEqual(['Ended', 'Ended', 'Ended']);
}
test('native boundaries preserve success data and finish named trace spans', tracedBoundaries);

async function nativeEffects() {
  function* scenario() {
    const { identity, contract, receipt } = makeEvidenceCase();
    const deferred = yield* Deferred.make<unknown, CandidateVerifierError>();
    const timeoutError = new CandidateVerifierError({
      runId: identity.runId,
      code: 'VerificationFailed',
    });
    const verifier = CandidateVerifier.of({
      verify: () =>
        Deferred.await(deferred).pipe(
          Effect.timeoutOrElse({ duration: '2 seconds', orElse: () => Effect.fail(timeoutError) }),
        ),
    });
    const error = new RunRepositoryError({
      runId: identity.runId,
      operation: 'load',
      code: 'ReadFailed',
    });
    const repository = RunRepository.of({
      load: () => Effect.fail(error),
      commit: () => Effect.fail(error),
    });
    const verify = CandidateVerifier.use((service) => service.verify({ identity, contract }));
    const fiber = yield* verify.pipe(
      Effect.provideService(CandidateVerifier, verifier),
      Effect.provideService(RunRepository, repository),
      Effect.forkChild,
    );
    yield* Deferred.succeed(deferred, receipt);
    expect(yield* Fiber.join(fiber)).toEqual(receipt);
    expect(yield* Effect.result(repository.load(identity.runId))).toEqual(Result.fail(error));
  }
  const effect = Effect.gen(scenario);
  await Effect.runPromise(effect.pipe(Effect.scoped, Effect.timeout('2 seconds')));
}
test(
  'Effect-native services support Deferred verification and typed injected failures directly',
  nativeEffects,
);
