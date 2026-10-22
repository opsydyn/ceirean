import type { RunId } from '@ceirean/domain';
import { Effect, HashMap, Match, Option, Ref, Result } from 'effect';

import type { RunChange, RunSnapshot, CommitResult } from '../src/contracts.ts';
import type { RunRepositoryError } from '../src/errors.ts';
import { RunRepository } from '../src/ports.ts';
import { evaluateRunChange } from '../src/run-repository-policy.ts';

function commitTransition(
  current: HashMap.HashMap<RunId, RunSnapshot>,
  change: RunChange,
): readonly [Result.Result<CommitResult, RunRepositoryError>, HashMap.HashMap<RunId, RunSnapshot>] {
  const result = evaluateRunChange(HashMap.get(current, change.runId), change);
  function retain(value: CommitResult) {
    return Match.value(value).pipe(
      Match.tag('Conflict', () => current),
      Match.tag('Committed', ({ snapshot }) =>
        HashMap.set(current, change.runId, structuredClone(snapshot)),
      ),
      Match.exhaustive,
    );
  }
  const next = Result.match(result, {
    onFailure: () => current,
    onSuccess: retain,
  });
  return [result, next];
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
