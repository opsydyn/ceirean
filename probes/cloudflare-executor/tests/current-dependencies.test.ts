import { expect, test } from 'bun:test';

import { Effect } from 'effect';

import { fromCurrentBunLock, uniqueCurrentArtifacts } from '../src/current-dependencies.ts';
import { fromBunLock } from '../src/dependency-inventory.ts';

const integrity = 'sha512-' + 'A'.repeat(86) + '==';
const lock = {
  lockfileVersion: 1,
  configVersion: 1,
  workspaces: {},
  packages: {
    '@opsydyn/effect-three-foldkit': [
      '@opsydyn/effect-three-foldkit@workspace:packages/effect-three-foldkit',
    ],
    tool: ['tool@1.2.3', '', {}, integrity],
    linux: ['linux@1.0.0', '', { os: 'linux', cpu: 'x64', libc: 'glibc' }, integrity],
    darwin: ['darwin@1.0.0', '', { os: 'darwin', cpu: 'arm64' }, integrity],
  },
};
async function currentWorkspaces() {
  const current = await Effect.runPromise(fromCurrentBunLock(lock));
  expect(current.selected.map(({ identity }) => identity)).toEqual(['linux@1.0.0', 'tool@1.2.3']);
  expect(current.excluded.map(({ identity }) => identity)).toEqual(['darwin@1.0.0']);
  expect(current.workspaces).toEqual([
    {
      key: '@opsydyn/effect-three-foldkit',
      identity: '@opsydyn/effect-three-foldkit@workspace:packages/effect-three-foldkit',
    },
  ]);
  const old = await Effect.runPromise(fromBunLock(lock).pipe(Effect.result));
  expect(old._tag).toBe('Failure');
}
test(
  'current Linux inventory includes its reviewed workspaces without widening historical policy',
  currentWorkspaces,
);

async function refusesWorkspaceSubstitution() {
  for (const identity of [
    '@opsydyn/effect-three-foldkit@workspace:../../outside',
    '@opsydyn/effect-three-foldkit@workspace:packages/effect-three',
    '@opsydyn/effect-three-foldkit@1.0.0',
  ]) {
    const changed = {
      ...lock,
      packages: { ...lock.packages, '@opsydyn/effect-three-foldkit': [identity] },
    };
    const result = await Effect.runPromise(fromCurrentBunLock(changed).pipe(Effect.result));
    expect(result._tag).toBe('Failure');
  }
}
test(
  'workspace identity cannot select a different path or registry package',
  refusesWorkspaceSubstitution,
);

async function refusesIntegrityConflict() {
  const artifact = {
    identity: 'tool@1.2.3',
    url: 'https://registry.npmjs.org/tool/-/tool-1.2.3.tgz',
    integrity,
  };
  const result = await Effect.runPromise(
    uniqueCurrentArtifacts([
      artifact,
      { ...artifact, integrity: 'sha512-' + 'B'.repeat(85) + 'A==' },
    ]).pipe(Effect.result),
  );
  expect(result._tag).toBe('Failure');
  const exact = await Effect.runPromise(uniqueCurrentArtifacts([artifact, artifact]));
  expect(exact).toEqual([artifact]);
}
test(
  'same archive URL can coalesce exact duplicates but never conflicting integrity',
  refusesIntegrityConflict,
);
