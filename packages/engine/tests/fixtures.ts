import { decideCancellation, decideQualification } from '@ceirean/domain';
import { Deferred, Effect, Layer, Match, Ref } from 'effect';
import { TestClock } from 'effect/testing';

import { makeEvidenceCase, makeFrozenRun } from '../../domain/tests/fixtures.ts';
import type { RunSnapshot } from '../src/contracts.ts';
import {
  CandidateVerifier,
  CandidateVerifierError,
  RunRepository,
  type VerificationRequest,
} from '../src/index.ts';

export { makeEvidenceCase, makeFrozenRun };

export function coordinatorTestLayers(
  repository: typeof RunRepository.Service,
  verifier: typeof CandidateVerifier.Service,
) {
  const layers = Layer.mergeAll(
    Layer.succeed(RunRepository, repository),
    Layer.succeed(CandidateVerifier, verifier),
    TestClock.layer(),
  );
  return layers;
}

export function makeSnapshot(): RunSnapshot {
  return {
    revision: 7,
    state: makeFrozenRun(),
    contract: makeEvidenceCase().contract,
    history: [],
  };
}

export function makeQualifiedChange() {
  const snapshot = makeSnapshot();
  const decision = decideQualification(
    snapshot.state,
    snapshot.contract,
    makeEvidenceCase().receipt,
    999,
  );
  return Match.value(decision).pipe(
    Match.tag('Accepted', ({ state, facts }) => ({
      runId: snapshot.state.runId,
      expectedRevision: 7,
      state,
      facts,
    })),
    Match.tag('Refused', () => {
      throw new TypeError('Invalid qualification fixture');
    }),
    Match.exhaustive,
  );
}

export function makeCancelledChange() {
  const snapshot = makeSnapshot();
  const decision = decideCancellation(snapshot.state, 999);
  return Match.value(decision).pipe(
    Match.tag('Accepted', ({ state, facts }) => ({
      runId: snapshot.state.runId,
      expectedRevision: 7,
      state,
      facts,
    })),
    Match.tag('Refused', () => {
      throw new TypeError('Invalid cancellation fixture');
    }),
    Match.exhaustive,
  );
}

export function makeControlledVerifier() {
  function* acquire() {
    const first = yield* Deferred.make<VerificationRequest>();
    const second = yield* Deferred.make<VerificationRequest>();
    const releaseFirst = yield* Deferred.make<unknown, CandidateVerifierError>();
    const releaseSecond = yield* Deferred.make<unknown, CandidateVerifierError>();
    const calls = yield* Ref.make(0);
    function verify(request: VerificationRequest) {
      function* verification() {
        const index = yield* Ref.getAndUpdate(calls, (count) => count + 1);
        const barrier = Match.value(index).pipe(
          Match.when(0, () => ({ entered: first, release: releaseFirst })),
          Match.orElse(() => ({ entered: second, release: releaseSecond })),
        );
        yield* Deferred.succeed(barrier.entered, request);
        return yield* Deferred.await(barrier.release);
      }
      const operation = Effect.gen(verification);
      return operation;
    }
    return {
      service: CandidateVerifier.of({ verify }),
      first,
      second,
      releaseFirst,
      releaseSecond,
      calls,
    };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
