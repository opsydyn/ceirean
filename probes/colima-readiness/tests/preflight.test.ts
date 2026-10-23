import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { YAML } from 'bun';
import { Arbitrary, Effect, Match, Schema } from 'effect';

import { PreflightReport } from '../src/contracts.ts';
import { HostReadError, makeHostReader } from '../src/host-reader.ts';
import { inspectHost } from '../src/preflight.ts';
import type { InspectRequest } from '../src/preflight.ts';

const conservativeYaml = [
  'runtime: docker',
  'mounts: []',
  'forwardAgent: false',
  'cpu: 2',
  'memory: 4',
  'disk: 30',
  '',
].join('\n');
const isReport = Schema.is(PreflightReport);
const request = {
  profile: 'ceirean' as const,
  colimaRoot: '/synthetic/colima',
  configPath: '/synthetic/colima/ceirean/colima.yaml',
  configurationSemantics: 'ReviewedColimaYaml' as const,
  host: {
    architecture: 'arm64',
    totalMemoryBytes: 34359738368,
    freeMemoryBytes: 17179869184,
    cpuCount: 8,
  },
};
const encode = Schema.encodeSync(Schema.fromJsonString(PreflightReport));
function observation(text: string) {
  return {
    text,
    bytes: new TextEncoder().encode(text),
    truncated: false as const,
    observedAtMs: 123,
  };
}
function reader(text = conservativeYaml) {
  function version(tool: 'Colima' | 'Docker') {
    const text = Match.value(tool).pipe(
      Match.when('Colima', () => 'colima version 0.9.1\n'),
      Match.orElse(() => 'Docker version 28.0.1, build abc123\n'),
    );
    const program = Effect.succeed(observation(text));
    return program;
  }
  return {
    readRegular: () => Effect.succeed(observation(text)),
    runVersion: version,
  };
}
async function inspect(r = reader(), input: InspectRequest = request) {
  const program = inspectHost(r, input);
  const provided = Effect.provide(program, BunServices.layer);
  const report = await Effect.runPromise(provided);
  expect(isReport(report)).toBe(true);
  return report;
}

async function conservativeProjection() {
  const report = await inspect();
  expect(report.host).toEqual({
    architecture: { _tag: 'Known', value: 'arm64' },
    totalMemoryBytes: { _tag: 'Known', value: 34359738368 },
    freeMemoryBytes: { _tag: 'Known', value: 17179869184 },
    cpuCount: { _tag: 'Known', value: 8 },
  });
  expect(report.versions).toEqual([
    { tool: 'Colima', status: 'Available', version: '0.9.1' },
    { tool: 'Docker', status: 'Available', version: '28.0.1' },
  ]);
  expect(report.config).toEqual({
    status: 'Read',
    mounts: 'Unknown',
    forwardAgent: 'Disabled',
    proposedEndpoint: {
      _tag: 'Proposed',
      endpoint: 'unix:///synthetic/colima/ceirean/docker.sock',
    },
  });
  expect(report.nativeReadiness).toBe('Unqualified');
  expect(report.canExecuteReplay).toBe(false);
  expect(report.activationDraft).toEqual({
    _tag: 'Unresolved',
    missing: [
      'Image',
      'DaemonIdentity',
      'Commands',
      'Security',
      'Storage',
      'Network',
      'VmAllocation',
      'Budgets',
      'Cleanup',
      'Approval',
    ],
  });
  expect(report.blockers).toContain('CheckBlocked');
  expect(report.blockers).toContain('UnknownConfiguration');
  expect(report).not.toHaveProperty('activationManifest');
}
test(
  'projects conservative observations without granting native or activation authority',
  conservativeProjection,
);

async function emptyMountDefaults() {
  const report = await inspect(reader(conservativeYaml));
  expect(report.config.mounts).not.toBe('Disabled');
  expect(
    report.blockers.some((reason) =>
      ['UnknownConfiguration', 'UnsafeConfiguration'].includes(reason),
    ),
  ).toBe(true);
  expect(report.nativeReadiness).toBe('Unqualified');
  expect(report.canExecuteReplay).toBe(false);
}
test('empty mounts cannot disable installed Colima defaults', emptyMountDefaults);

const mountCases = Arbitrary.schema(
  Schema.Struct({
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })),
    writable: Schema.Boolean,
    colima: Schema.Literals([
      'colima version 0.9.1\n',
      'colima version 0.0.0\n',
      'colima version 99.0.0\n',
      'Docker version 28.0.1, build abc123\n',
      'SYNTHETIC_PRIVATE_VERSION',
    ]),
    docker: Schema.Literals([
      'Docker version 28.0.1, build abc123\n',
      'Docker version 0.0.0, build abc123\n',
      'colima version 0.9.1\n',
      'SYNTHETIC_PRIVATE_VERSION',
    ]),
  }),
);

type MountCase = typeof mountCases extends Arbitrary.Arbitrary<infer A> ? A : never;
const projections = {
  empty: { status: 'Read', mounts: 'Unknown', forwardAgent: 'Disabled' },
  absent: { status: 'Read', mounts: 'Unknown', forwardAgent: 'Disabled' },
  null: { status: 'Invalid', mounts: 'Unknown', forwardAgent: 'Unknown' },
  nonempty: { status: 'Read', mounts: 'Enabled', forwardAgent: 'Disabled' },
} as const;
const mountBlockers = {
  empty: 'UnknownConfiguration',
  absent: 'UnknownConfiguration',
  null: 'InvalidConfiguration',
  nonempty: 'UnsafeConfiguration',
} as const;

for (const kind of ['empty', 'absent', 'null', 'nonempty'] as const) {
  async function checkCase({ count, writable, colima, docker }: MountCase) {
    const mounts = Match.value(kind).pipe(
      Match.when('absent', () => ({})),
      Match.when('empty', () => ({ mounts: [] })),
      Match.when('null', () => ({ mounts: null })),
      Match.when('nonempty', () => ({
        mounts: Array.from({ length: count }, (_, index) => ({
          location: `/SYNTHETIC_PRIVATE_HOME/${index}`,
          mountPoint: `/SYNTHETIC_PRIVATE_MOUNT/${index}`,
          writable,
        })),
      })),
      Match.exhaustive,
    );
    const yaml = YAML.stringify({ runtime: 'docker', ...mounts, forwardAgent: false }, null, 2);
    function version(tool: 'Colima' | 'Docker') {
      const text = Match.value(tool).pipe(
        Match.when('Colima', () => colima),
        Match.when('Docker', () => docker),
        Match.exhaustive,
      );
      const program = Effect.succeed(observation(text));
      return program;
    }
    const report = await inspect({ ...reader(yaml), runVersion: version });
    expect(report.config).toMatchObject(projections[kind]);
    expect(report.config.mounts).not.toBe('Disabled');
    expect(report.blockers).toContain(mountBlockers[kind]);
    expect(report.nativeReadiness).toBe('Unqualified');
    expect(report.canExecuteReplay).toBe(false);
    expect(encode(report)).not.toContain('SYNTHETIC_PRIVATE');
    return true;
  }
  async function runLaw() {
    function* checkSeeds() {
      for (const seed of [0, 1, 163]) {
        const result = yield* Arbitrary.checkEffect(
          mountCases,
          (input) => Effect.promise(() => checkCase(input)),
          { seed, runs: 1000, size: 50, maxShrinks: 1000, maxDiscards: 10000 },
        );
        expect(result).toMatchObject({ _tag: 'Passed', runs: 1000 });
      }
    }
    const program = Effect.gen(checkSeeds);
    await Effect.runPromise(program);
  }
  test(`law: ${kind} mounts cannot prove disabled sharing (seeds 0/1/163, 1000 runs each)`, runLaw);
}

async function hostileConfig() {
  for (const yaml of [
    `${conservativeYaml}provision:\n  - script: SYNTHETIC_PRIVATE_HOOK\n`,
    `${conservativeYaml}env:\n  TOKEN: SYNTHETIC_PRIVATE_SECRET\n`,
    `${conservativeYaml}dockerHost: tcp://SYNTHETIC_PRIVATE_ENDPOINT\n`,
    `${conservativeYaml}version: SYNTHETIC_PRIVATE_VERSION\n`,
    conservativeYaml.replace('docker', 'containerd'),
    `${conservativeYaml}mounts: []\n`,
    'runtime: docker\nmounts: &mounts []\nforwardAgent: false\n',
    'runtime: docker\nmounts: []\nforwardAgent: "false"\n',
    '[]',
    'null',
    '{broken',
    '---\n{}\n---\n{}',
  ]) {
    const report = await inspect(reader(yaml));
    expect(['Invalid', 'Unsupported']).toContain(report.config.status);
    expect(report.config.mounts).toBe('Unknown');
    expect(report.config.forwardAgent).toBe('Unknown');
    expect(report.config.proposedEndpoint).toEqual({ _tag: 'Unknown' });
    expect(encode(report)).not.toContain('SYNTHETIC_PRIVATE');
  }
}
test(
  'rejects hostile unknown fields, unsupported runtime and ambiguous YAML without leaking values',
  hostileConfig,
);

async function unsafeConfig() {
  const mounted = conservativeYaml.replace(
    'mounts: []',
    'mounts:\n  - location: /SYNTHETIC_PRIVATE_HOME\n    writable: true',
  );
  const yaml = mounted.replace('forwardAgent: false', 'forwardAgent: true');
  const report = await inspect(reader(yaml));
  expect(report.config.status).toBe('Read');
  expect(report.config.mounts).toBe('Enabled');
  expect(report.config.forwardAgent).toBe('Enabled');
  expect(report.blockers).toContain('UnsafeConfiguration');
  expect(encode(report)).not.toContain('SYNTHETIC_PRIVATE');
}
test('unsafe sharing and forwarding are projected only as finite states', unsafeConfig);

async function absentSecurity() {
  const report = await inspect(reader('runtime: docker\n'));
  expect(report.config.mounts).toBe('Unknown');
  expect(report.config.forwardAgent).toBe('Unknown');
  expect(report.blockers).toContain('UnknownConfiguration');
}
test('absent security fields are unknown, never safe defaults', absentSecurity);

function readerCapabilities() {
  const r = makeHostReader({
    colimaRoot: '/synthetic',
    home: '/synthetic/home',
    parentDirectoriesTrusted: false,
    now: () => 0,
    executableCandidates: {
      Colima: { path: '/synthetic/client', semantics: 'Unsupported' },
      Docker: { path: '/synthetic/client', semantics: 'Unsupported' },
    },
  });
  expect(Object.keys(r).sort()).toEqual(['readRegular', 'runVersion']);
}
test('reader exposes no daemon/start/download capability', readerCapabilities);

async function readerFailures() {
  for (const [code, status, truncated] of [
    ['ReadFailed', 'Invalid', false],
    ['NotRegular', 'Invalid', false],
    ['FileChanged', 'Invalid', false],
    ['UntrustedParents', 'Invalid', false],
    ['FileTooLarge', 'Truncated', false],
    ['Unavailable', 'Unavailable', false],
    ['UnsupportedSemantics', 'Invalid', false],
    ['TimedOut', 'TimedOut', false],
    ['OutputTooLarge', 'Truncated', true],
  ] as const) {
    const failed = Effect.fail(new HostReadError({ code, truncated }));
    const program = inspectHost({ readRegular: () => failed, runVersion: () => failed }, request);
    const provided = Effect.provide(program, BunServices.layer);
    const report = await Effect.runPromise(provided);
    expect(isReport(report)).toBe(true);
    expect(report.config.status).toBe('Unreadable');
    expect(report.config.mounts).toBe('Unknown');
    expect(report.config.proposedEndpoint).toEqual({ _tag: 'Unknown' });
    expect(report.versions).toEqual([
      { tool: 'Colima', status },
      { tool: 'Docker', status },
    ]);
  }
}
test('finite reader failures block config and version evidence', readerFailures);

async function versionFormats() {
  for (const text of [
    'SYNTHETIC_PRIVATE 1.2.3',
    'colima version v0.9.1',
    'colima version 0.9.1\nserver 1.2.3',
    'colima version 0.9.1-dev',
    'x'.repeat(65537),
  ]) {
    const r = { ...reader(), runVersion: () => Effect.succeed(observation(text)) };
    const report = await inspect(r);
    expect(report.versions.map((v) => v.status)).not.toContain('Available');
    expect(encode(report)).not.toContain('SYNTHETIC_PRIVATE');
  }
}
test(
  'version parsing accepts only bounded exact client formats, not arbitrary digits',
  versionFormats,
);

async function requestGuards() {
  let calls = 0;
  function read() {
    calls += 1;
    const program = Effect.succeed(observation(conservativeYaml));
    return program;
  }
  const r = { readRegular: read, runVersion: read };
  const inputs: InspectRequest[] = [
    { ...request, configPath: '/synthetic/other/colima.yaml' },
    { ...request, colimaRoot: '/synthetic/../colima' },
    { ...request, colimaRoot: 'relative' },
    { ...request, profile: 'default' },
    { ...request, configurationSemantics: 'Unsupported' },
  ];
  for (const input of inputs) {
    const report = await inspect(r, input);
    expect(report.config.status).toBe('Unsupported');
    expect(report.blockers).toContain('InvalidConfiguration');
  }
  expect(calls).toBe(0);
}
test(
  'request guards refuse alternate profiles, roots, config paths and unreviewed semantics before observation',
  requestGuards,
);

async function invalidHost() {
  const report = await inspect(reader(), {
    ...request,
    host: {
      architecture: 'SYNTHETIC_PRIVATE_ARCH',
      totalMemoryBytes: Number.NaN,
      freeMemoryBytes: -1,
      cpuCount: 1.5,
    },
  });
  expect(Object.values(report.host)).toEqual([
    { _tag: 'Unknown' },
    { _tag: 'Unknown' },
    { _tag: 'Unknown' },
    { _tag: 'Unknown' },
  ]);
  const missing = await inspect(reader(), { ...request, host: undefined });
  expect(Object.values(missing.host)).toEqual([
    { _tag: 'Unknown' },
    { _tag: 'Unknown' },
    { _tag: 'Unknown' },
    { _tag: 'Unknown' },
  ]);
  const inconsistent = await inspect(reader(), {
    ...request,
    host: { ...request.host, freeMemoryBytes: 34359738369 },
  });
  expect(inconsistent.host.freeMemoryBytes).toEqual({ _tag: 'Unknown' });
}
test(
  'host metrics remain unknown for absent, inconsistent, fractional or unsafe observations',
  invalidHost,
);

async function unresolvedResources() {
  const report = await inspect(reader(), {
    ...request,
    host: { ...request.host, freeMemoryBytes: 1073741824, cpuCount: 1 },
  });
  expect(report.blockers).toContain('LimitExceeded');
  expect(report.activationDraft.missing).toContain('VmAllocation');
  expect(report.activationDraft.missing).toContain('Storage');
  const storage = await inspect(reader(`${conservativeYaml}storage: { quota: 20 }\n`));
  expect(storage.config.status).toBe('Unsupported');
}
test(
  'insufficient headroom and unsupported storage never resolve allocation or quota',
  unresolvedResources,
);

async function zeroHeadroom() {
  const report = await inspect(reader(), {
    ...request,
    host: { ...request.host, freeMemoryBytes: 0 },
  });
  expect(report.host.freeMemoryBytes).toEqual({ _tag: 'Known', value: 0 });
  expect(report.blockers).toContain('LimitExceeded');
}
test('zero available memory is measured exhaustion, not an unknown snapshot', zeroHeadroom);

async function observationIntegrity() {
  for (const text of [
    `${conservativeYaml}mounts:\n  - location: /SYNTHETIC_PRIVATE\n    writable: true\n    writable: false\n`,
    `${conservativeYaml}mounts:\n  - location: /SYNTHETIC_PRIVATE\n    hook: SYNTHETIC_PRIVATE\n`,
    `${conservativeYaml}mounts: null\n`,
    `${conservativeYaml}forwardAgent: true\nforwardAgent: false\n`,
    `${conservativeYaml}runtime: docker\n`,
    'runtime: docker\nmounts: &a [*a]\nforwardAgent: false\n',
    `${conservativeYaml}# SYNTHETIC_PRIVATE_COMMENT\n`,
  ]) {
    const report = await inspect(reader(text));
    expect(['Invalid', 'Unsupported']).toContain(report.config.status);
    expect(report.config.proposedEndpoint).toEqual({ _tag: 'Unknown' });
    expect(encode(report)).not.toContain('SYNTHETIC_PRIVATE');
  }
  const mismatch = {
    ...reader(),
    readRegular: () =>
      Effect.succeed({ ...observation(conservativeYaml), bytes: new Uint8Array() }),
  };
  const report = await inspect(mismatch);
  expect(report.config.status).not.toBe('Read');
  expect(report.config.mounts).toBe('Unknown');
  const excess = ' '.repeat(262145);
  const oversized = await inspect(reader(excess));
  expect(oversized.config.status).not.toBe('Read');
  expect(oversized.blockers).toContain('OutputTruncated');
}
test(
  'ambiguous nested fields, cyclic aliases and incomplete observations cannot produce a proposal',
  observationIntegrity,
);

async function requestSnapshot() {
  const input = { ...request };
  function mutate() {
    input.colimaRoot = '/SYNTHETIC_PRIVATE_CHANGED';
    return observation(conservativeYaml);
  }
  const r = { ...reader(), readRegular: () => Effect.sync(mutate) };
  const report = await inspect(r, input);
  expect(report.config.proposedEndpoint).toEqual({
    _tag: 'Proposed',
    endpoint: 'unix:///synthetic/colima/ceirean/docker.sock',
  });
  expect(encode(report)).not.toContain('SYNTHETIC_PRIVATE');
}
test('request identity is snapshotted before asynchronous reader observations', requestSnapshot);

async function hiddenApprovedRoot() {
  const report = await inspect(reader(), {
    ...request,
    colimaRoot: '/synthetic/.colima',
    configPath: '/synthetic/.colima/ceirean/colima.yaml',
  });
  expect(report.config.proposedEndpoint).toEqual({
    _tag: 'Proposed',
    endpoint: 'unix:///synthetic/.colima/ceirean/docker.sock',
  });
}
test('approved hidden root segments are valid without allowing dot traversal', hiddenApprovedRoot);
