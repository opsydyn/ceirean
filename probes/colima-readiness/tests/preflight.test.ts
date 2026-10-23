import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, Match, Schema } from 'effect';

import { PreflightReport } from '../src/contracts.ts';
import { HostReadError, makeHostReader } from '../src/host-reader.ts';
import { inspectHost } from '../src/preflight.ts';
import type { InspectRequest } from '../src/preflight.ts';

const safeYaml = [
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
function reader(text = safeYaml) {
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

async function safeProjection() {
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
    mounts: 'Disabled',
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
  expect(report).not.toHaveProperty('activationManifest');
}
test('projects safe observations without granting native or activation authority', safeProjection);

async function hostileConfig() {
  for (const yaml of [
    `${safeYaml}provision:\n  - script: SYNTHETIC_PRIVATE_HOOK\n`,
    `${safeYaml}env:\n  TOKEN: SYNTHETIC_PRIVATE_SECRET\n`,
    `${safeYaml}dockerHost: tcp://SYNTHETIC_PRIVATE_ENDPOINT\n`,
    `${safeYaml}version: SYNTHETIC_PRIVATE_VERSION\n`,
    safeYaml.replace('docker', 'containerd'),
    `${safeYaml}mounts: []\n`,
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
  const mounted = safeYaml.replace(
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
    const program = Effect.succeed(observation(safeYaml));
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
  const storage = await inspect(reader(`${safeYaml}storage: { quota: 20 }\n`));
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
    `${safeYaml}mounts:\n  - location: /SYNTHETIC_PRIVATE\n    writable: true\n    writable: false\n`,
    `${safeYaml}mounts:\n  - location: /SYNTHETIC_PRIVATE\n    hook: SYNTHETIC_PRIVATE\n`,
    `${safeYaml}mounts: null\n`,
    `${safeYaml}forwardAgent: true\nforwardAgent: false\n`,
    `${safeYaml}runtime: docker\n`,
    'runtime: docker\nmounts: &a [*a]\nforwardAgent: false\n',
    `${safeYaml}# SYNTHETIC_PRIVATE_COMMENT\n`,
  ]) {
    const report = await inspect(reader(text));
    expect(['Invalid', 'Unsupported']).toContain(report.config.status);
    expect(report.config.proposedEndpoint).toEqual({ _tag: 'Unknown' });
    expect(encode(report)).not.toContain('SYNTHETIC_PRIVATE');
  }
  const mismatch = {
    ...reader(),
    readRegular: () => Effect.succeed({ ...observation(safeYaml), bytes: new Uint8Array() }),
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
    return observation(safeYaml);
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
