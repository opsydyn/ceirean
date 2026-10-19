import { Arbitrary, Data, Effect, Match, Result } from 'effect';

export class LawFailure extends Data.TaggedError('LawFailure')<{
  readonly name: string;
  readonly seed: number;
  readonly diagnostic: string;
}> {}

export function validateCheckResult(
  name: string,
  seed: number,
  result: Arbitrary.CheckResult<unknown, unknown>,
  expectedRuns: number,
): Result.Result<void, LawFailure> {
  const diagnostic = Arbitrary.formatCheckFailure(result);
  return Match.value(result).pipe(
    Match.when({ _tag: 'Passed', runs: expectedRuns }, () => Result.succeed(undefined)),
    Match.orElse(() =>
      Result.fail(
        new LawFailure({
          name,
          seed,
          diagnostic: `${name}; seed ${seed}; Effect 4.0.5\n${diagnostic ?? `Expected exactly ${expectedRuns} runs; received an unexpected Passed run count`}`,
        }),
      ),
    ),
  );
}

export const checkLaw = <A>(
  name: string,
  arbitrary: Arbitrary.Arbitrary<A>,
  law: (value: A) => boolean,
) => {
  return Effect.gen(function* checkSeeds() {
    for (const seed of [0, 1, 163]) {
      const result = yield* Arbitrary.checkEffect(arbitrary, law, {
        seed,
        runs: 1000,
        size: 50,
        maxShrinks: 1000,
        maxDiscards: 10000,
      });
      yield* Effect.fromResult(validateCheckResult(name, seed, result, 1000));
    }
  });
};
