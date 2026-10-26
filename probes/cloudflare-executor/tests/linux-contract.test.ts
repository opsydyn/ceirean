import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Match, Result, Schema } from 'effect';

import {
  CaseObservation,
  CleanupObservation,
  QualificationReceipt,
  decodeRequest,
} from '../src/linux-qualification/contract.ts';
import { makeReceipt, qualificationExitCode } from '../src/linux-qualification/receipt.ts';
import { qualificationInstall, toolPins } from '../src/linux-qualification/tool-pins.ts';

const strict = { onExcessProperty: 'error' } as const;
const budgets = {
  jobMs: 900000,
  qualificationMs: 540000,
  commandMs: 90000,
  cleanupMs: 30000,
  jobs: 1,
  automaticRetries: 0,
  cpus: 2,
  memoryBytes: 4294967296,
  swapBytes: 4294967296,
  pids: 128,
  tmpfsBytes: 3221225472,
  artifactBytes: 67108864,
  totalArtifactBytes: 536870912,
  expandedPackageBytes: 268435456,
  expandedEntryBytes: 201326592,
  totalExpandedBytes: 2147483648,
  packageEntries: 10000,
  totalEntries: 200000,
  pathBytes: 512,
  evidenceBytes: 16777216,
  streamBytes: 262144,
  retentionDays: 7,
} as const;
const tools = {
  installerImage:
    'docker.io/oven/bun@sha256:38919894db4e117a37f74e3dca503e84f24d97f19cabc5f499a289c2a5d0db7c',
  nodeImage:
    'docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09',
  controller: {
    package: '@oven/bun-linux-x64@1.4.2',
    url: 'https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.4.2.tgz',
    integrity:
      'sha512-9/E/UXOTpSo3YsV5g+FhtTd/qTpiWoKuxS12cqtuYA1ssu9fRAoPQnipFgGyck3tWO63iUdxBiygq+kELFawng==',
  },
  effect: '4.0.5',
  npm: '10.9.9',
  uploadArtifact: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
} as const;
const pinnedInput = {
  lockSha256: '47fbd0c33dc391b1ac3d801ab5fb2db638d901d419c67222f708d186065ac19d',
};
const digest = 'a'.repeat(64);
const request = {
  authority: 'RequiresRunWorksheet',
  ceireanRevision: '2921aa747b198f38357e41aaa297422dc207fd84',
  lockBlob: 'b'.repeat(40),
  harnessSha256: digest,
  toolCapsuleSha256: digest,
  sourceRevision: 'b7484cb46e66b162c8afddcfba235c9507b4f0ab',
  sourceTree: '8fcd5b7960541679a163dcbfbf60393e1e256241',
  inventorySha256: 'd416b758e7410ad2069120b58df9272bed86c4ef9d24a3088d4904e46d7308cb',
  registry: 'http://127.0.0.1:4873',
  run: { runner: 'ubuntu-24.04', runId: 'fixture-run', attempt: 1 },
  tools,
  limits: budgets,
} as const;
const readbacks = {
  _tag: 'Verified',
  os: 'Linux',
  architecture: 'x86_64',
  libc: 'glibc',
  bun: '1.3.11',
  node: '22.23.4',
  runnerImage: 'fixture-image',
  runnerVersion: 'fixture-version',
  dockerVersion: 'fixture-docker',
  installerConfigSha256: digest,
  nodeConfigSha256: digest,
  nodeExecutableSha256: digest,
  controllerExecutableSha256: digest,
  controls: {
    networkNone: true,
    readOnlyRoot: true,
    unprivileged: true,
    capabilitiesDropped: true,
    noNewPrivileges: true,
    noExtraDevices: true,
    privatePidIpc: true,
    noPublishedPorts: true,
    noDockerSocket: true,
    boundedTmpfs: true,
    noexecNosuidNodev: true,
    networkDnsTcpDenied: true,
    resourceLimitsVerified: true,
    runnerEligible: true,
  },
} as const;
const digests = {
  _tag: 'Recorded',
  sourceBefore: digest,
  sourceAfter: digest,
  lockBefore: pinnedInput.lockSha256,
  lockAfter: pinnedInput.lockSha256,
  seedBefore: digest,
  seedAfter: digest,
  harnessSha256: digest,
  toolCapsuleSha256: digest,
} as const;
const cases = [
  ['RuntimeIsolationPreflight', 'Preflight', 'Verified'],
  ['ArchiveAdmissionNegatives', 'Admission', 'ArchiveRefused'],
  ['ScriptCanaries', 'Canaries', 'ScriptsSuppressed'],
  ['Warmup', 'Warmup', 'CacheMaterialized'],
  ['FreshPositive', 'Offline', 'InstalledFromCache'],
  ['EmptyCache', 'Offline', 'EmptyCacheRefused'],
  ['MissingRequiredArtifact', 'Offline', 'MissingArtifactRefused'],
  ['CorruptCacheContent', 'Admission', 'CacheIntegrityRefused'],
  ['CaseIsolation', 'Isolation', 'CopiesIsolated'],
  ['CancellationDeadline', 'Cleanup', 'CancellationConfirmed'],
] as const;
function observations(): readonly CaseObservation[] {
  return cases.map(([caseId, stage, reason]) => ({
    caseId,
    stage,
    outcome: 'Passed' as const,
    reason,
    evidence: ['fixture.json'],
    readbacks,
    digests,
  }));
}
const cleanup = { _tag: 'ConfirmedRemoval', evidence: ['cleanup.json'] } as const;
async function receipt(input = observations(), removal: CleanupObservation = cleanup) {
  const decoded = await Effect.runPromise(decodeRequest(request));
  const result = await Effect.runPromise(makeReceipt(decoded, input, removal));
  return result;
}
async function rejected(input: unknown) {
  return Result.isFailure(await Effect.runPromise(decodeRequest(input).pipe(Effect.result)));
}

async function rejectsConfigurableExecution() {
  expect(await rejected(request)).toBe(false);
  for (const input of [
    { ...request, argv: ['sh'] },
    { ...request, environment: { TOKEN: 'fixture' } },
    { ...request, image: 'arbitrary:latest' },
    { ...request, registry: 'https://registry.npmjs.org' },
    { ...request, run: { ...request.run, attempt: 2 } },
    { ...request, run: { ...request.run, extra: true } },
    { ...request, authority: 'Approved' },
  ])
    expect(await rejected(input)).toBe(true);
}
test('rejects_configurable_execution', rejectsConfigurableExecution);

async function requiresAllCases() {
  const complete = await receipt();
  expect(complete.outcome).toBe('Passed');
  expect(qualificationExitCode(complete)).toBe(0);
  expect(complete.authority).toBe('EvidenceOnly');
  for (let index = 0; index < cases.length; index++) {
    const missing = await receipt(observations().filter((_, position) => position !== index));
    expect(missing.reasons).toContain('EvidenceIncomplete');
    expect(qualificationExitCode(missing)).toBe(1);
  }
}
test('requires_all_cases', requiresAllCases);

async function rejectsUnrelatedNegativeFailure() {
  for (const caseId of ['EmptyCache', 'MissingRequiredArtifact', 'CorruptCacheContent']) {
    const input = observations().map((item) =>
      Match.value(item.caseId === caseId).pipe(
        Match.when(true, () => ({
          ...item,
          outcome: 'Failed' as const,
          reason: 'BlockedRuntime' as const,
        })),
        Match.orElse(() => item),
      ),
    );
    const result = await receipt(input);
    expect(result.outcome).toBe('Failed');
    expect(qualificationExitCode(result)).toBe(1);
    const falsePass = input.map((item) => ({ ...item, outcome: 'Passed' as const }));
    expect(qualificationExitCode(await receipt(falsePass))).toBe(1);
  }
}
test('rejects_unrelated_negative_failure', rejectsUnrelatedNegativeFailure);

async function requiresIndependentPins() {
  expect(toolPins).toEqual(tools);
  expect(qualificationInstall).toEqual({
    cwd: '.',
    argv: [
      'bun',
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--backend=copyfile',
      '--registry=http://127.0.0.1:4873',
    ],
  });
  for (const input of [
    { ...request, sourceRevision: 'f'.repeat(40) },
    { ...request, sourceTree: 'f'.repeat(40) },
    { ...request, inventorySha256: 'f'.repeat(64) },
    { ...request, tools: { ...tools, installerImage: 'docker.io/oven/bun:1.3.11' } },
    { ...request, tools: { ...tools, nodeImage: 'docker.io/library/node:22.23.4' } },
    {
      ...request,
      tools: { ...tools, controller: { ...tools.controller, integrity: 'sha512-forged' } },
    },
    { ...request, tools: { ...tools, effect: '4.0.6' } },
    { ...request, tools: { ...tools, uploadArtifact: 'actions/upload-artifact@v4' } },
  ])
    expect(await rejected(input)).toBe(true);
  const changed = observations().map((item) => ({
    ...item,
    digests: { ...digests, harnessSha256: 'f'.repeat(64) },
  }));
  expect(qualificationExitCode(await receipt(changed))).toBe(1);
}
test('requires_independent_pins', requiresIndependentPins);

async function neverEnablesActivation() {
  const passed = await receipt();
  const blocked = await receipt([]);
  for (const result of [passed, blocked]) {
    expect(result.activation).toBe('Blocked');
    expect(
      Schema.decodeUnknownResult(
        QualificationReceipt,
        strict,
      )({
        ...result,
        activation: 'Enabled',
      })._tag,
    ).toBe('Failure');
  }
  expect(qualificationExitCode({ ...blocked, outcome: 'Passed' })).toBe(1);
  const unsupported = observations().map((item) => ({
    ...item,
    outcome: 'Blocked' as const,
    reason: 'UnsupportedInvocation' as const,
  }));
  expect(qualificationExitCode(await receipt(unsupported))).toBe(64);
}
test('never_enables_activation', neverEnablesActivation);

async function cleanupUnknownCannotPass() {
  for (const removal of [
    { _tag: 'Unknown', evidence: [] },
    { _tag: 'RemainingResources', resources: ['owned-container'], evidence: ['cleanup.json'] },
  ] as const) {
    const result = await receipt(observations(), removal);
    expect(result.outcome).toBe('Blocked');
    expect(result.reasons).toContain('CleanupUnknown');
    expect(qualificationExitCode(result)).toBe(1);
  }
  expect(
    Schema.decodeUnknownResult(
      CleanupObservation,
      strict,
    )({
      ...cleanup,
      resources: ['still-running'],
    })._tag,
  ).toBe('Failure');
}
test('cleanup_unknown_cannot_pass', cleanupUnknownCannotPass);

async function evidenceCannotBeForged() {
  for (const field of ['sourceAfter', 'lockAfter', 'seedAfter', 'toolCapsuleSha256'] as const) {
    const input = observations().map((item) => ({
      ...item,
      digests: { ...digests, [field]: 'f'.repeat(64) },
    }));
    expect(qualificationExitCode(await receipt(input))).toBe(1);
  }
  for (const item of observations()) {
    const input = observations().map((other) =>
      Match.value(other.caseId === item.caseId).pipe(
        Match.when(true, () => ({ ...other, evidence: [] })),
        Match.orElse(() => other),
      ),
    );
    expect(qualificationExitCode(await receipt(input))).toBe(1);
  }
  const input = observations().map((item) => ({
    ...item,
    readbacks: { _tag: 'Unknown' as const },
  }));
  expect(qualificationExitCode(await receipt(input))).toBe(1);
  const passed = await receipt();
  expect(qualificationExitCode({ ...passed, reasons: ['EvidenceIncomplete'] })).toBe(1);
}
test('receipt_rechecks_evidence_instead_of_trusting_outcome', evidenceCannotBeForged);

async function requiresCacheCaseDigests() {
  for (const caseId of [
    'Warmup',
    'FreshPositive',
    'EmptyCache',
    'MissingRequiredArtifact',
    'CorruptCacheContent',
    'CaseIsolation',
    'CancellationDeadline',
  ]) {
    const input = observations().map((item) =>
      Match.value(item.caseId === caseId).pipe(
        Match.when(true, () => ({ ...item, digests: { _tag: 'Unknown' as const } })),
        Match.orElse(() => item),
      ),
    );
    expect(qualificationExitCode(await receipt(input))).toBe(1);
  }
}
test('requires_all_cache_case_digests', requiresCacheCaseDigests);

async function requiresCoherentRuntime() {
  const conflicting = observations().map((item) =>
    Match.value(item.caseId).pipe(
      Match.when('FreshPositive', () => ({
        ...item,
        readbacks: { ...readbacks, nodeExecutableSha256: 'f'.repeat(64) },
      })),
      Match.orElse(() => item),
    ),
  );
  expect(qualificationExitCode(await receipt(conflicting))).toBe(1);
}
test('requires_coherent_runtime_readbacks', requiresCoherentRuntime);

async function rejectsTrailingHashAndEvidenceNewlines() {
  for (const suffix of ['\n', '\r', '\r\n']) {
    expect(await rejected({ ...request, harnessSha256: digest + suffix })).toBe(true);
    expect(await rejected({ ...request, ceireanRevision: request.ceireanRevision + suffix })).toBe(
      true,
    );
    const decoded = await Effect.runPromise(decodeRequest(request));
    const input = observations().map((item) => ({ ...item, evidence: ['fixture.json' + suffix] }));
    const result = await Effect.runPromise(
      makeReceipt(decoded, input, cleanup).pipe(Effect.result),
    );
    expect(result._tag).toBe('Failure');
  }
}
test('rejects_trailing_hash_and_evidence_newlines', rejectsTrailingHashAndEvidenceNewlines);

const generated = Schema.Struct({
  ranks: Schema.Array(Schema.Int).check(Schema.isMinLength(10), Schema.isMaxLength(10)),
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
  amount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100000 })),
  suffix: Schema.String.check(Schema.isMaxLength(32)),
});
async function contractProperties() {
  async function law(sample: typeof generated.Type) {
    const ordered = observations()
      .map((item, index) => ({ item, rank: sample.ranks[index]! }))
      .sort((left, right) => left.rank - right.rank)
      .map(({ item }) => item);
    expect(qualificationExitCode(await receipt(ordered))).toBe(0);
    const omitted = ordered.filter((_, index) => index !== sample.index);
    expect(qualificationExitCode(await receipt(omitted))).toBe(1);
    const duplicate = [...omitted, omitted[0]!];
    expect(qualificationExitCode(await receipt(duplicate))).toBe(1);
    const decoded = await Effect.runPromise(decodeRequest(request));
    const conflictingDuplicate = {
      ...ordered[sample.index]!,
      outcome: 'Failed' as const,
      reason: 'InputChanged' as const,
    };
    for (const input of [
      [...ordered, conflictingDuplicate],
      [conflictingDuplicate, ...ordered],
    ]) {
      const result = await Effect.runPromise(
        makeReceipt(decoded, input, cleanup).pipe(Effect.result),
      );
      expect(result._tag).toBe('Failure');
    }
    for (const [name, value] of Object.entries(budgets)) {
      for (const changed of [value - sample.amount, value + sample.amount, NaN]) {
        expect(await rejected({ ...request, limits: { ...budgets, [name]: changed } })).toBe(true);
      }
    }
    const extra = `extra_${sample.suffix}`;
    for (const input of [
      { ...request, [extra]: true },
      { ...request, tools: { ...tools, [extra]: true } },
      { ...request, tools: { ...tools, controller: { ...tools.controller, [extra]: true } } },
      { ...request, limits: { ...budgets, [extra]: true } },
    ])
      expect(await rejected(input)).toBe(true);
    for (const bad of ['', 'g'.repeat(64), 'A'.repeat(64), digest + sample.suffix + 'x', NaN]) {
      expect(await rejected({ ...request, harnessSha256: bad })).toBe(true);
      expect(
        Schema.decodeUnknownResult(
          CaseObservation,
          strict,
        )({
          ...ordered[0],
          digests: { ...digests, seedAfter: bad },
        })._tag,
      ).toBe('Failure');
    }
    for (const input of [
      { ...ordered[0], [extra]: true },
      { ...ordered[0], digests: { ...digests, [extra]: true } },
      { ...ordered[0], readbacks: { ...readbacks, [extra]: true } },
      {
        ...ordered[0],
        readbacks: { ...readbacks, controls: { ...readbacks.controls, [extra]: true } },
      },
    ])
      expect(Schema.decodeUnknownResult(CaseObservation, strict)(input)._tag).toBe('Failure');
    return true;
  }
  const checking = Arbitrary.checkEffect(
    Arbitrary.schema(generated),
    (sample) => Effect.promise(() => law(sample)),
    {
      seed: 2921,
      runs: 100,
      maxShrinks: 100,
    },
  );
  const result = await Effect.runPromise(checking);
  expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
  expect(result).toMatchObject({ runs: 100 });
}
test('fixed_seed_contract_properties_100_runs', contractProperties);
