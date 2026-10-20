import { expect, test } from 'bun:test';

import { Match, Result, Schema } from 'effect';

import { buildReport, requiredGates, requiredLaws, RestartResult } from '../src/report.ts';

// Synthetic builder inputs test validation, never constitute qualification evidence.
function syntheticEvidence() {
  const sha256 = 'a'.repeat(64);
  const integrity = `sha512-${btoa('x'.repeat(64))}`;
  const log = { path: 'synthetic.log', sha256 };
  function syntheticLaw(law: (typeof requiredLaws)[number]) {
    const gate = Match.value(law.startsWith('domain:')).pipe(
      Match.when(true, () => 'domain:test'),
      Match.orElse(() => 'engine:test'),
    );
    return [0, 1, 163].map((seed) => ({
      law,
      seed,
      runs: 1000,
      size: 50,
      maxShrinks: 1000,
      maxDiscards: 10000,
      validation: 'Passed.runs===1000',
      source: { path: 'synthetic-properties.ts', sha256 },
      gate,
      log,
    }));
  }
  const laws = requiredLaws.flatMap(syntheticLaw);
  return {
    identity: {
      testedCommit: 'b'.repeat(40),
      testedTree: 'c'.repeat(40),
      lockSha256: sha256,
      sources: [
        { path: 'synthetic-source.ts', sha256 },
        { path: 'synthetic-properties.ts', sha256 },
      ],
      artifacts: ['@flue/github', '@flue/runtime'].map((name) => ({
        name,
        version: '2.3.0',
        registryIntegrity: integrity,
        fetchedIntegrity: integrity,
        exportsSha256: sha256,
      })),
      cohort: {
        effectVersion: '4.0.5',
        effectRealpath: '/synthetic/effect',
        physicalEffectPaths: ['/synthetic/effect'],
        consumers: ['@flue/github', '@flue/runtime', 'domain', 'engine', 'github-admission'].map(
          (name) => ({ name, effectRealpath: '/synthetic/effect' }),
        ),
        audit: log,
      },
    },
    gates: requiredGates.map((gate) => ({ gate, exitCode: 0, log })),
    tests: ['domain:test', 'engine:test', 'probe:test', 'github-admission:test'].map((gate) => ({
      gate,
      passed: 123,
      failed: 0,
      log,
    })),
    laws,
    controls: [
      'command-key',
      'native-dedup',
      'authority-revision',
      'rollback',
      'reject-everything',
    ].map((control) => ({
      control,
      source: 'synthetic-source.ts',
      originalSha256: sha256,
      mutantSha256: 'd'.repeat(64),
      restoredSha256: sha256,
      redExit: 1,
      greenExit: 0,
      behavioralFailure: 'synthetic assertion failure',
      redLog: log,
      greenLog: log,
    })),
  };
}
function expectInvalid(input: unknown) {
  const result = buildReport(input);
  expect(Result.isFailure(result)).toBe(true);
}
function refusesGates() {
  const input = syntheticEvidence();
  const result = buildReport(input);
  expect(Result.isSuccess(result)).toBe(true);
  for (const gate of requiredGates) {
    expectInvalid({ ...input, gates: input.gates.filter((entry) => entry.gate !== gate) });
    const gates = input.gates.map((entry) => ({ ...entry, exitCode: Number(entry.gate === gate) }));
    expectInvalid({ ...input, gates });
  }
  expectInvalid({ ...input, gates: [...input.gates, input.gates[0]] });
  expectInvalid({
    ...input,
    gates: [...input.gates, { gate: 'unknown', exitCode: 0, log: input.gates[0]!.log }],
  });
}
test('report refuses any missing or nonzero gate', refusesGates);
function separatesGuarantees() {
  const input = syntheticEvidence();
  const built = buildReport(input);
  const report = Result.getOrThrow(built);
  expect(report.qualification).toBe('offline-local-process-restart-only');
  expect(report.productionQualified).toBe(false);
  expect(report.exclusions).toEqual([
    'live-permissions',
    'models',
    'workers',
    'publishing',
    'hosting',
    'power-loss',
    'host-loss',
    'distributed-storage',
    'exactly-once-execution',
  ]);
  expect(report.primaryLawCases).toBe(30000);
  expect(report.lawCountBasis).toBe('validated-law-source-and-passing-gate-attribution');
  expect<unknown>(report.evidence).toEqual(input);
  input.identity.sources[0]!.sha256 = 'e'.repeat(64);
  expect(report.evidence.identity.sources[0]!.sha256).toBe('a'.repeat(64));
}
test('report separates local persistence from production durability', separatesGuarantees);
function invalidEvidence() {
  const input = syntheticEvidence();
  for (const changed of [
    { laws: input.laws.slice(1) },
    { laws: [...input.laws, input.laws[0]] },
    { laws: input.laws.map((law) => ({ ...law, runs: 999 })) },
    { laws: input.laws.map((law) => ({ ...law, seed: 2 })) },
    { controls: [] },
    { controls: input.controls.map((control) => ({ ...control, restoredSha256: 'e'.repeat(64) })) },
    { controls: input.controls.map((control) => ({ ...control, redExit: 0 })) },
    { identity: { ...input.identity, testedCommit: '' } },
    { identity: { ...input.identity, sources: [] } },
    {
      identity: {
        ...input.identity,
        artifacts: input.identity.artifacts.map((artifact) => ({
          ...artifact,
          fetchedIntegrity: 'sha512-Yg==',
        })),
      },
    },
    {
      identity: {
        ...input.identity,
        cohort: { ...input.identity.cohort, physicalEffectPaths: ['/one', '/two'] },
      },
    },
    { tests: input.tests.map((counts) => ({ ...counts, failed: 1 })) },
  ])
    expectInvalid({ ...input, ...changed });
}
test(
  'report refuses unvalidated laws, identity gaps, split cohort and unrestored controls',
  invalidEvidence,
);
function invalidRestart() {
  const decode = Schema.decodeUnknownResult(RestartResult);
  const valid = decode({ disposition: 'Duplicate', decisionId: '12' });
  expect(Result.isSuccess(valid)).toBe(true);
  for (const decisionId of ['0', '01', '-1', 'NaN', 1, '', '1.5']) {
    const result = decode({ disposition: 'Duplicate', decisionId });
    expect(Result.isFailure(result)).toBe(true);
  }
  const unrecorded = decode({ disposition: 'Unrecorded', decisionId: '1' });
  expect(Result.isFailure(unrecorded)).toBe(true);
}
function contradictoryAttribution() {
  const input = syntheticEvidence();
  const changedLog = { path: 'different.log', sha256: 'e'.repeat(64) };
  const variants = [
    { tests: [] },
    { tests: input.tests.map((entry) => ({ ...entry, passed: 0 })) },
    { tests: input.tests.map((entry) => ({ ...entry, log: changedLog })) },
    { laws: input.laws.map((entry) => ({ ...entry, log: changedLog })) },
    {
      laws: input.laws.map((entry) => ({
        ...entry,
        source: { ...entry.source, sha256: 'e'.repeat(64) },
      })),
    },
    {
      identity: {
        ...input.identity,
        artifacts: input.identity.artifacts.map((artifact) => ({
          ...artifact,
          registryIntegrity: 'bogus',
          fetchedIntegrity: 'bogus',
        })),
      },
    },
  ];
  for (const variant of variants) expectInvalid({ ...input, ...variant });
}
test('report refuses contradictory source, test and gate attribution', contradictoryAttribution);
test(
  'restart result rejects malformed decision identities and non-recording dispositions',
  invalidRestart,
);
