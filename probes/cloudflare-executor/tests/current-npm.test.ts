import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Result, Schema } from 'effect';

import { currentNpmProfiles, fromCurrentNpmLock } from '../src/current-npm-profiles.ts';
import { encodeInventory } from '../src/frozen-dependencies.ts';

function preservedProfiles() {
  expect(currentNpmProfiles.map(({ id }) => id)).toEqual([
    'generated-common',
    'generated-datasets',
    'viz-pure',
    'viz-adapter',
  ]);
  expect(currentNpmProfiles[0]?.manifest.dependencies).toMatchObject({
    foldkit: '0.170.0',
    effect: '4.1.0',
    '@opsydyn/dataset-explorer': 'file:./vendor/source-highlighting',
  });
  expect(currentNpmProfiles[3]?.manifest.dependencies).toMatchObject({
    foldkit: '0.169.0',
    effect: '4.0.0',
  });
  expect(encodeInventory(currentNpmProfiles)).not.toContain('"scripts"');
}
test(
  'current inert profiles preserve generated roots and the older packed adapter pins',
  preservedProfiles,
);

async function localPolicy() {
  const profile = currentNpmProfiles[0]!;
  const packages = Object.fromEntries([
    ['', profile.manifest],
    ...profile.vendors.flatMap(({ path, manifest }) => [
      [path, manifest],
      [`node_modules/${manifest.name}`, { link: true, resolved: path }],
    ]),
  ]);
  const lock = { lockfileVersion: 3, packages };
  const inventory = await Effect.runPromise(fromCurrentNpmLock(lock, profile));
  expect(inventory.local).toHaveLength(5);
  const reversedEntries = Object.entries(profile.manifest.dependencies).reverse();
  const reorderedDependencies = Object.fromEntries(reversedEntries);
  const reordered = {
    ...profile.manifest,
    dependencies: reorderedDependencies,
  };
  const reorderedInventory = await Effect.runPromise(
    fromCurrentNpmLock({ ...lock, packages: { ...packages, '': reordered } }, profile),
  );
  expect(reorderedInventory).toEqual(inventory);
  for (const changed of [
    { ...packages, 'vendor/source-highlighting': { name: 'wrong', version: '0.0.0' } },
    { ...packages, 'vendor/unreviewed': { name: 'outside', version: '1.0.0' } },
    { ...packages, 'node_modules/@opsydyn/foldkit-viz': { link: true, resolved: '../outside' } },
    { ...packages, '': { ...profile.manifest, dependencies: { effect: '4.0.0' } } },
  ]) {
    const result = await Effect.runPromise(
      fromCurrentNpmLock({ ...lock, packages: changed }, profile).pipe(Effect.result),
    );
    expect(result._tag).toBe('Failure');
  }
}
test(
  'current npm local entries must match the exact profile and cannot widen local paths',
  localPolicy,
);

for (const seed of [0, 1, 170]) {
  async function localLinkLaw() {
    const inputs = Arbitrary.schema(Schema.String);
    const profile = currentNpmProfiles[2];
    function refusesUnreviewedLink(suffix: string) {
      const vendor = profile.vendors[0];
      const packages = {
        '': profile.manifest,
        [vendor.path]: vendor.manifest,
        [`node_modules/${vendor.manifest.name}`]: { link: true, resolved: vendor.path },
        [`vendor/unreviewed-${suffix}`]: { link: true, resolved: '../outside' },
      };
      return fromCurrentNpmLock({ lockfileVersion: 3, packages }, profile).pipe(
        Effect.result,
        Effect.map(Result.isFailure),
      );
    }
    const checking = Arbitrary.checkEffect(inputs, refusesUnreviewedLink, {
      seed,
      runs: 100,
      maxShrinks: 100,
    });
    const result = await Effect.runPromise(checking);
    expect(result).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  test(`unreviewed local links always fail closed; seed ${seed}`, localLinkLaw);
}
