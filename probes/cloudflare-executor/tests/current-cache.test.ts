import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Schema } from 'effect';

import { planCacheUnion } from '../src/current-cache.ts';

const integrity = 'sha512-' + 'A'.repeat(86) + '==';
function artifact(name: string) {
  return {
    identity: `${name}@1.0.0`,
    url: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
    integrity,
  };
}

const Index = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 12 }));
const Sets = Schema.Struct({
  base: Schema.Array(Index).check(Schema.isMinLength(1)),
  added: Schema.Array(Index),
});
for (const seed of [0, 1, 909]) {
  async function unionLaw() {
    const inputs = Arbitrary.schema(Sets);
    function exactlyMissing(input: typeof Sets.Type) {
      const baseIds = new Set(input.base);
      const extraIds = new Set(input.added);
      const retained = [...baseIds].map((id) => artifact(`pkg-${id}`));
      const requested = [...extraIds].map((id) => artifact(`pkg-${id}`));
      const all = new Set([...baseIds, ...extraIds]);
      const missing = [...extraIds].filter((id) => !baseIds.has(id));
      return planCacheUnion(retained, requested).pipe(
        Effect.map((plan) =>
          [
            plan.artifacts.length === all.size,
            plan.missing.length === missing.length,
            plan.reused === baseIds.size,
          ].every(Boolean),
        ),
      );
    }
    const checking = Arbitrary.checkEffect(inputs, exactlyMissing, {
      seed,
      runs: 100,
      maxShrinks: 100,
    });
    const result = await Effect.runPromise(checking);
    expect(result).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  test(`cache union requests exactly the set difference; seed ${seed}`, unionLaw);
}
async function exactDelta() {
  const base = [artifact('base'), artifact('shared')];
  const npm = [artifact('shared'), artifact('added')];
  const plan = await Effect.runPromise(planCacheUnion(base, npm));
  expect(plan.artifacts.map(({ identity }) => identity)).toEqual([
    'added@1.0.0',
    'base@1.0.0',
    'shared@1.0.0',
  ]);
  expect(plan.missing).toEqual([artifact('added')]);
  expect(plan.reused).toBe(2);
  expect(plan.activation).toBe('Blocked');
}
test(
  'cache union preserves retained artifacts and requests only the exact missing delta',
  exactDelta,
);

for (const kind of ['integrity', 'identity', 'url', 'duplicate-base']) {
  async function refusesDrift() {
    const variants = {
      integrity: [{ ...artifact('base'), integrity: 'sha512-' + 'B'.repeat(85) + 'A==' }],
      identity: [{ ...artifact('base'), identity: 'other@1.0.0' }],
      url: [{ ...artifact('base'), url: 'https://example.com/base.tgz' }],
      'duplicate-base': [artifact('base')],
    };
    const baseVariants = {
      integrity: [artifact('base')],
      identity: [artifact('base')],
      url: [artifact('base')],
      'duplicate-base': [artifact('base'), artifact('base')],
    };
    const checking = planCacheUnion(
      baseVariants[kind as keyof typeof baseVariants],
      variants[kind as keyof typeof variants],
    ).pipe(Effect.result);
    const result = await Effect.runPromise(checking);
    expect(result._tag).toBe('Failure');
  }
  test(`cache union refuses ${kind}`, refusesDrift);
}
