import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Result, Schema } from 'effect';

import { currentBaseline, decodeCurrentBaseline } from '../src/current-baseline.ts';

function approvedChecks() {
  const contract = currentBaseline();
  expect(contract.source).toEqual({
    repository: 'opsydyn/fold-kit-experiments',
    sha: '1183e3c067f873fdd29f14f06030515929c1b956',
    lockSha256: '9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89',
  });
  expect(contract.checks.map((check) => check.id)).toEqual([
    'Install',
    'Check',
    'Typecheck',
    'Test',
    'Build',
    'Storybook',
    'PackCore',
    'PackFoldkit',
    'PackRapier',
    'PackTroika',
    'ApiCore',
    'ApiFoldkit',
    'ApiRapier',
    'ApiTroika',
    'ThreeBrowser',
    'BrowserJourneys',
  ]);
  expect(contract.checks[0]?.argv).toEqual(['bun', 'install', '--frozen-lockfile']);
  expect(contract.checks[14]?.argv).toEqual([
    'bun',
    'run',
    '--filter',
    '@opsydyn/effect-three-foldkit',
    'test:e2e',
  ]);
  expect(contract.checks[15]?.argv).toEqual([
    'bun',
    '--no-env-file',
    '--no-install',
    'x',
    '--no-install',
    'playwright',
    'test',
    '--config',
    'playwright.config.ts',
  ]);
  expect(contract.browserCases).toEqual([
    'desktop/carousel',
    'desktop/line',
    'mobile/carousel',
    'mobile/line',
  ]);
  expect(contract.toolchain.bun).toBe('1.4.3');
  expect(contract.toolchain.npm).toBe('10.9.9');
  expect(contract.execution).toBe('Blocked');
  expect(contract.image).toBe('Unbuilt');
}
test('approved baseline produces the complete fixed runnable command plan', approvedChecks);

function refusesDrift() {
  const contract = currentBaseline();
  for (const input of [
    { ...contract, extra: 'SECRET_SENTINEL' },
    { ...contract, execution: 'Approved' },
    { ...contract, image: 'Built' },
    {
      ...contract,
      source: { ...contract.source, sha: 'b7484cb46e66b162c8afddcfba235c9507b4f0ab' },
    },
    { ...contract, source: { ...contract.source, lockSha256: 'a'.repeat(64) } },
    { ...contract, toolchain: { ...contract.toolchain, bun: '1.3.11' } },
    { ...contract, checks: contract.checks.slice(0, -1) },
    { ...contract, checks: [...contract.checks].reverse() },
    { ...contract, checks: [...contract.checks, contract.checks[0]] },
    { ...contract, browserCases: ['desktop/carousel'] },
    { ...contract, limits: { ...contract.limits, executionMs: 60000 } },
    { ...contract, browserPolicy: { ...contract.browserPolicy, chromiumSandbox: false } },
  ])
    expect(decodeCurrentBaseline(input).pipe(Result.getFailure)).toMatchObject({
      value: { _tag: 'CurrentBaselineError', code: 'InvalidContract' },
    });
}
test('scope weakening, historical inputs and caller readiness claims cannot decode', refusesDrift);

function detachedPlan() {
  const contract = currentBaseline();
  Reflect.set(contract.checks[0]?.argv ?? [], '0', 'sh');
  expect(decodeCurrentBaseline(contract).pipe(Result.isFailure)).toBe(true);
  expect(currentBaseline().checks[0]?.argv).toEqual(['bun', 'install', '--frozen-lockfile']);
}
test('returned command plans cannot mutate future baseline authority', detachedPlan);

const cases = Arbitrary.schema(Schema.Int);
function changedCommand(value: number) {
  const contract = currentBaseline();
  const index = Math.abs(value) % contract.checks.length;
  Reflect.set(contract.checks[index]?.argv ?? [], '0', 'unapproved-executable');
  return Result.isFailure(decodeCurrentBaseline(contract));
}
for (const seed of [0, 1, 163]) {
  test(`property: arbitrary command substitution always refuses; seed ${seed}`, async () => {
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(cases, changedCommand, { seed, runs: 200, size: 30 }),
    );
    expect(result).toMatchObject({ _tag: 'Passed', runs: 200 });
  });
}
