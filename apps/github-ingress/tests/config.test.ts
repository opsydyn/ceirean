import { expect, test } from 'bun:test';

import { Result } from 'effect';

import { decodeConfig, parseArgv } from '../src/config.ts';

export function policy() {
  return {
    revision: 'local-1',
    ingressScopeId: 'test-app',
    appId: 77,
    installationId: 11,
    ownerId: 33,
    repositoryId: 22,
    profile: { _tag: 'Enabled', profileId: 'foldkit', profileRevision: 'profile-1' },
    policyRevision: 'policy-1',
    allowedOperatorIds: [66],
  };
}
export function configuration(stateRoot?: string) {
  return {
    policy: policy(),
    stateRoot,
    webhookSecretFile: '/explicit/secret',
    privateKeyFile: '/explicit/key',
  };
}

function configValidation() {
  const input = configuration();
  const decoded = decodeConfig(input, '/Users/operator').pipe(Result.getOrThrow);
  expect(decoded.stateRoot).toBe('/Users/operator/Library/Application Support/Ceirean');
  const explicit = decodeConfig(
    configuration('/Users/operator/Library/Application Support/Leviathan'),
    '/Users/operator',
  ).pipe(Result.getOrThrow);
  expect(explicit.stateRoot).toBe('/Users/operator/Library/Application Support/Leviathan');
  for (const patch of [
    { arbitrary: true },
    { privateKeyFile: undefined },
    { webhookSecretFile: '' },
    { stateRoot: 'relative' },
    { stateRoot: '/safe/../unsafe' },
    { policy: { ...policy(), appId: 0 } },
    { policy: { ...policy(), repositoryId: 9007199254740992 } },
    { policy: { ...policy(), allowedOperatorIds: [] } },
    { policy: { ...policy(), allowedOperatorIds: [66, 66] } },
    { policy: { ...policy(), injected: true } },
  ]) {
    const decoded = decodeConfig({ ...input, ...patch }, '/Users/operator');
    expect(Result.isFailure(decoded)).toBe(true);
  }
}
test('config defaults state root and rejects extra keys and unsafe policy', configValidation);

function argumentValidation() {
  for (const command of ['init', 'start', 'status'] as const) {
    const decoded = parseArgv([
      command,
      '--config',
      '/config.json',
      '--database',
      '/state/db',
    ]).pipe(Result.getOrThrow);
    expect(decoded).toEqual({ command, configFile: '/config.json', database: '/state/db' });
  }
  const configured = parseArgv([
    'configure',
    '--config',
    '/config.json',
    '--expected-revision',
    'local-1',
  ]).pipe(Result.getOrThrow);
  expect(configured).toEqual({
    command: 'configure',
    configFile: '/config.json',
    expectedRevision: 'local-1',
  });
  for (const args of [
    [],
    ['reset'],
    ['start'],
    ['start', '--config', 'relative'],
    ['start', '--config', '/a', '--config', '/b'],
    ['start', '--config', '/a', '--wat', 'x'],
    ['status', '--config', '/a', 'positional'],
    ['configure', '--config', '/a'],
    ['init', '--config', '/a', '--expected-revision', 'r1'],
    ['start', '--config', '/a', '--database'],
    ['start', '--config', '/a', '--database', 'relative'],
    ['start', '--config', '/a', 'toString', 'ignored'],
  ]) {
    const decoded = parseArgv(args);
    expect(Result.isFailure(decoded)).toBe(true);
  }
}
test(
  'argv accepts only documented forms and expected revision is configure-only',
  argumentValidation,
);
