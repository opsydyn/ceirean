import { expect, test } from 'bun:test';

import { Result } from 'effect';

import { validateLocalQualification } from '../src/qualification-report.ts';

const hash = 'ab'.repeat(32);
const tree = 'cd'.repeat(20);
const workspaces = [
  'domain',
  'engine',
  'probe',
  'github-admission',
  'github-adapter',
  'github-ingress',
];
const gateIds = [
  'install',
  'check',
  ...workspaces.map((name) => `${name}:typecheck`),
  ...workspaces.map((name) => `${name}:test`),
  'whitespace',
  'integrity',
];
function measured() {
  return {
    source: {
      commit: 'e8fb83c437ebcf1709be4f0e119597319728c653',
      tree,
      filesHash: hash,
      lockHash: '8cb4d58bd88280daee28101e542cd9b7120ec7ee63dd5094daf59c2a45fddf59',
    },
    gates: gateIds.map((id) => ({ id, exit: 0, logHash: hash, sourceHash: hash })),
    suites: workspaces.map((workspace) => ({ workspace, passed: 1, failed: 0, assertions: 2 })),
    totals: { passed: 6, failed: 0, assertions: 12 },
    laws: { newPrimary: 24000, legacyPrimary: 3000, shrinks: 0 },
    controls: [
      'EvidenceBinding',
      'PolicyRevision',
      'ReplayUniqueness',
      'TransactionRollback',
      'AbortOwnership',
    ].map((name) => ({
      name,
      beforeHash: hash,
      mutatedHash: 'ef'.repeat(32),
      restoredHash: hash,
      red: [1, 2].map(() => ({ exit: 1, logHash: hash, reason: name })),
      green: { exit: 0, logHash: hash },
    })),
    live: false,
    deployed: false,
  };
}
function completeEvidence() {
  const input = measured();
  const output = validateLocalQualification(input);
  expect(output._tag).toBe('Success');
  const report = Result.getOrThrow(output);
  Reflect.set(input.source, 'tree', 'unknown');
  expect(report).toMatchObject({ live: false, deployed: false, source: { tree } });
}
test(
  'measured complete local evidence returns only local qualification, detached from caller data',
  completeEvidence,
);
function sourceIdentity() {
  for (const value of [undefined, 'unknown', '0'.repeat(40)]) {
    const input = measured();
    Reflect.set(input.source, 'commit', value);
    expect(validateLocalQualification(input)._tag).toBe('Failure');
  }
  const changed = measured();
  changed.gates[0].sourceHash = 'ef'.repeat(32);
  expect(validateLocalQualification(changed)._tag).toBe('Failure');
  changed.source.lockHash = hash;
  expect(validateLocalQualification(changed)._tag).toBe('Failure');
}
test('unknown, missing and unbound source identities cannot qualify', sourceIdentity);
test('missing, duplicate, unknown or nonzero gates and absent raw hashes are refused', () => {
  for (const change of [
    (input: ReturnType<typeof measured>) => input.gates.pop(),
    (input: ReturnType<typeof measured>) => input.gates.push(input.gates[0]),
    (input: ReturnType<typeof measured>) => {
      input.gates[0].id = 'unknown';
    },
    (input: ReturnType<typeof measured>) => {
      input.gates[0].exit = 1;
    },
    (input: ReturnType<typeof measured>) => {
      input.gates[0].logHash = '';
    },
  ]) {
    const input = measured();
    change(input);
    expect(validateLocalQualification(input)._tag).toBe('Failure');
  }
});
test('all five twice-RED restored GREEN controls are mandatory and cannot inflate law totals', () => {
  for (const change of [
    (input: ReturnType<typeof measured>) => input.controls.pop(),
    (input: ReturnType<typeof measured>) => input.controls.push(input.controls[0]),
    (input: ReturnType<typeof measured>) => input.controls[0].red.pop(),
    (input: ReturnType<typeof measured>) => {
      input.controls[0].red[0].exit = 0;
    },
    (input: ReturnType<typeof measured>) => {
      input.controls[0].red[0].reason = 'PolicyRevision';
    },
    (input: ReturnType<typeof measured>) => {
      input.controls[0].restoredHash = 'ef'.repeat(32);
    },
    (input: ReturnType<typeof measured>) => {
      input.controls[0].mutatedHash = hash;
    },
    (input: ReturnType<typeof measured>) => {
      input.controls[0].green.exit = 1;
    },
    (input: ReturnType<typeof measured>) => {
      input.laws.newPrimary = 24005;
    },
  ]) {
    const input = measured();
    change(input);
    expect(validateLocalQualification(input)._tag).toBe('Failure');
  }
});
test('suite totals must be measured, complete and internally consistent', () => {
  for (const change of [
    (input: ReturnType<typeof measured>) => input.suites.pop(),
    (input: ReturnType<typeof measured>) => {
      input.suites[0].failed = 1;
    },
    (input: ReturnType<typeof measured>) => {
      input.totals.passed++;
    },
    (input: ReturnType<typeof measured>) => {
      input.totals.assertions++;
    },
    (input: ReturnType<typeof measured>) => {
      input.suites[0].assertions = -1;
    },
  ]) {
    const input = measured();
    change(input);
    expect(validateLocalQualification(input)._tag).toBe('Failure');
  }
});
test('caller cannot set live/deployed flags or smuggle unvalidated fields', () => {
  for (const key of ['live', 'deployed', 'productionReady']) {
    const input = measured();
    Reflect.set(input, key, true);
    expect(validateLocalQualification(input)._tag).toBe('Failure');
  }
});
