import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Schema } from 'effect';

import { fromBunLock, fromNpmLock, npmProfiles } from '../src/dependency-inventory.ts';

const integrity = 'sha512-' + 'A'.repeat(86) + '==';
const lock = {
  lockfileVersion: 1,
  configVersion: 1,
  workspaces: {},
  packages: {
    tool: ['tool@1.2.3', '', {}, integrity],
    'parent/tool': ['tool@2.0.0', '', {}, integrity],
    linux: ['linux@1.0.0', '', { os: 'linux', cpu: 'x64' }, integrity],
    darwin: ['darwin@1.0.0', '', { os: 'darwin', cpu: 'arm64' }, integrity],
    unknown: ['unknown@1.0.0', '', { os: 'linux', cpu: 'none' }, integrity],
  },
};
async function preservesAliases() {
  const result = await Effect.runPromise(fromBunLock(lock));
  expect(result.selected.map((item) => item.key)).toEqual(['linux', 'parent/tool', 'tool']);
  expect(result.selected[1]).toMatchObject({
    identity: 'tool@2.0.0',
    url: 'https://registry.npmjs.org/tool/-/tool-2.0.0.tgz',
  });
  expect(result.excluded.map((item) => item.key)).toEqual(['darwin', 'unknown']);
  expect(result.activation).toBe('Blocked');
}
test(
  'Linux candidates preserve nested keys and versions, excluding incompatible records',
  preservesAliases,
);
for (const [name, tuple] of [
  ['floating identity', ['tool@latest', '', {}, integrity]],
  ['custom registry', ['tool@1.2.3', 'https://evil.invalid', {}, integrity]],
  ['missing integrity', ['tool@1.2.3', '', {}]],
  ['bad integrity', ['tool@1.2.3', '', {}, 'sha512-not-a-digest']],
  ['noncanonical integrity', ['tool@1.2.3', '', {}, 'sha512-' + 'A'.repeat(85) + 'B==']],
] as const) {
  async function refusesTuple() {
    const changed = { ...lock, packages: { tool: tuple } };
    const result = await Effect.runPromise(fromBunLock(changed).pipe(Effect.result));
    expect(result._tag).toBe('Failure');
  }
  test(`Bun inventory refuses ${name}`, refusesTuple);
}
function exactRoots() {
  const manifest = npmProfiles[0].manifest;
  expect(manifest.devDependencies).toMatchObject({ vite: '8.3.1', typescript: '6.0.3' });
  expect(manifest).not.toHaveProperty('scripts');
  expect(manifest.dependencies).toMatchObject({ foldkit: '0.165.0', effect: '4.0.0' });
}
test('generated template roots are exact, inert, and do not inherit root Vite', exactRoots);
async function registryBoundary() {
  const input = {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/tool': {
        version: '1.2.3',
        resolved: 'https://registry.npmjs.org/tool/-/tool-1.2.3.tgz',
        integrity,
      },
    },
  };
  const result = await Effect.runPromise(fromNpmLock(input));
  expect(result.selected[0]).toMatchObject({
    key: 'node_modules/tool',
    identity: 'tool@1.2.3',
    integrity,
  });
  const changed = {
    ...input,
    packages: {
      '': {},
      'node_modules/tool': {
        ...input.packages['node_modules/tool'],
        resolved: 'https://github.com/example/archive.tgz',
      },
    },
  };
  const refused = await Effect.runPromise(fromNpmLock(changed).pipe(Effect.result));
  expect(refused._tag).toBe('Failure');
}
test(
  'npm records retain exact registry URLs and cannot hide nonregistry dependencies',
  registryBoundary,
);

const Platform = Schema.Struct({
  os: Schema.Literals(['linux', 'darwin']),
  cpu: Schema.Literals(['x64', 'arm64', 'none']),
  libc: Schema.Literals(['glibc', 'musl']),
});
const isLinux = Schema.is(Schema.Literal('linux'));
const isX64 = Schema.is(Schema.Literal('x64'));
const isGlibc = Schema.is(Schema.Literal('glibc'));
function platformLaw(seed: number) {
  async function run() {
    const inputs = Arbitrary.schema(Platform);
    function matchesTarget(platform: typeof Platform.Type) {
      const data = { ...lock, packages: { tool: ['tool@1.2.3', '', platform, integrity] } };
      const expected = [isLinux(platform.os), isX64(platform.cpu), isGlibc(platform.libc)].every(
        Boolean,
      );
      return fromBunLock(data).pipe(
        Effect.map(
          (result) =>
            result.selected.length === Number(expected) &&
            result.selected.length + result.excluded.length === 1,
        ),
      );
    }
    const checking = Arbitrary.checkEffect(inputs, matchesTarget, {
      seed,
      runs: 100,
      maxShrinks: 100,
    });
    const result = await Effect.runPromise(checking);
    expect(result).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  return run;
}
for (const seed of [0, 1, 163])
  test(`Linux platform selection law; seed ${seed}`, platformLaw(seed));
