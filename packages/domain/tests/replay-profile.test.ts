import { expect, test } from 'bun:test';

import { Option, Result, Schema } from 'effect';

import { decodeDraftProfile, decodeReplayRequest } from '../src/replay-profile.ts';
import { validDraft, validRequest } from './replay-fixtures.ts';
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function accepted(input: unknown) {
  const result = decodeDraftProfile(input);
  expect(Result.isSuccess(result)).toBe(true);
}

function invalid(input: unknown) {
  const result = decodeDraftProfile(input);
  expect(Result.isFailure(result)).toBe(true);
  const problem = Option.getOrThrow(Result.getFailure(result));
  expect(problem).toEqual({ _tag: 'InvalidProfile' });
  expect(encode(problem)).not.toContain('SECRET_SENTINEL');
}

function acceptedInputs() {
  accepted(validDraft());
  const result = decodeReplayRequest(validRequest());
  expect(Result.isSuccess(result)).toBe(true);
}
test('accepts the reviewed draft and exact inspection request', acceptedInputs);

async function canonicalCase() {
  const canonical = await Bun.file(
    new URL('../../../profiles/foldkit-0166-replay.json', import.meta.url),
  ).json();
  expect(canonical).toEqual(validDraft());
  accepted(canonical);
}
test('canonical JSON matches approved case', canonicalCase);

function unknownKeys() {
  const p = validDraft();
  const extra = { apiKey: 'SECRET_SENTINEL' };
  for (const value of [
    { ...p, ...extra },
    { ...p, repository: { ...p.repository, ...extra } },
    { ...p, targets: { ...p.targets, ...extra } },
    { ...p, host: { ...p.host, ...extra } },
    { ...p, limits: { ...p.limits, ...extra } },
    { ...p, qualification: { ...p.qualification, ...extra } },
    { ...p, scope: { ...p.scope, ...extra } },
    { ...p, scope: { ...p.scope, manifests: [{ ...p.scope.manifests[0], ...extra }] } },
    { ...p, scope: { ...p.scope, sourceRules: [{ ...p.scope.sourceRules[0], ...extra }] } },
    { ...p, checks: [{ ...p.checks[0], ...extra }] },
    { ...p, journeys: [{ ...p.journeys[0], ...extra }] },
    { ...p, journeys: [{ ...p.journeys[0], viewports: [{ width: 1440, height: 900, ...extra }] }] },
  ])
    invalid(value);
}
test('rejects unknown keys at every object level without exposing input', unknownKeys);

test('rejects Qualified, enabled publication and executable extension fields', () => {
  const p = validDraft();
  for (const value of [
    { ...p, status: 'Qualified' },
    { ...p, publication: 'Enabled' },
    { ...p, qualification: { ...p.qualification, execution: 'Approved' } },
    { ...p, env: { TOKEN: 'SECRET_SENTINEL' } },
    { ...p, hooks: ['run'] },
    { ...p, host: { ...p.host, qualification: 'Qualified' } },
  ])
    invalid(value);
});

function pathsAndCommands() {
  const p = validDraft();
  for (const path of [
    '',
    '.',
    '..',
    '../x',
    '/x',
    'x//y',
    'x/./y',
    'x/../y',
    'x\\y',
    'x\0y',
    'x\ny',
  ]) {
    invalid({ ...p, scope: { ...p.scope, generatedPaths: [path] } });
  }
  for (const scope of [
    { ...p.scope, generatedPaths: ['bun.lock', 'bun.lock'] },
    { ...p.scope, generatedPaths: [p.scope.documentationPaths[0]] },
    { ...p.scope, manifests: [p.scope.manifests[0], p.scope.manifests[0]] },
    { ...p.scope, manifests: [{ path: 'package.json', allowedJsonPointers: ['/scripts/run'] }] },
    {
      ...p.scope,
      manifests: [
        {
          path: 'package.json',
          allowedJsonPointers: ['/dependencies/foldkit', '/dependencies/foldkit'],
        },
      ],
    },
  ])
    invalid({ ...p, scope });
  for (const checks of [
    [],
    [p.checks[0], p.checks[0]],
    [{ id: 'x', cwd: '../x', argv: ['bun'] }],
    [{ id: 'x', cwd: '.', argv: 'bun run test' }],
    [{ id: 'x', cwd: '.', argv: [] }],
    [{ id: 'x', cwd: '.', argv: Array(33).fill('x') }],
  ])
    invalid({ ...p, checks });
}
test(
  'rejects invalid paths, duplicate destinations, pointers and command descriptors',
  pathsAndCommands,
);

function boundedFields() {
  const p = validDraft();
  for (const key of Object.keys(p.limits)) {
    for (const value of [-1, Infinity, NaN, 0.1, Number.MAX_SAFE_INTEGER + 1])
      invalid({ ...p, limits: { ...p.limits, [key]: value } });
  }
  const positiveKeys = [
    'durationMs',
    'maxActiveRuns',
    'cpuCores',
    'memoryBytes',
    'pidLimit',
    'writableBytes',
    'commandOutputBytes',
    'artifactBytes',
  ];
  for (const key of positiveKeys) invalid({ ...p, limits: { ...p.limits, [key]: 0 } });
  accepted({ ...p, limits: { ...p.limits, maxRepairAttempts: 0 } });
  for (const foldkit of ['^0.166.0', 'latest', '0.166.0-beta.1', 'https://x', '01.2.3'])
    invalid({ ...p, targets: { ...p.targets, foldkit } });
  for (const slug of ['../x', 'x/..', 'https://x/y', 'x/y/z', '/x'])
    invalid({ ...p, repository: { ...p.repository, slug } });
  invalid({ ...p, repository: { ...p.repository, baseSha: 'A'.repeat(40) } });
  invalid({ ...p, profileId: 'x'.repeat(65) });
  invalid({ ...p, checks: [{ id: 'x', cwd: '.', argv: ['x'.repeat(1025)] }] });
  invalid({ ...p, journeys: [p.journeys[0], p.journeys[0]] });
  const request = decodeReplayRequest({ ...validRequest(), apiKey: 'SECRET_SENTINEL' });
  const problem = Option.getOrThrow(Result.getFailure(request));
  expect(problem).toEqual({ _tag: 'InvalidRequest' });
}
test('rejects invalid limits, identities, versions and field bounds', boundedFields);
