import { expect, test } from 'bun:test';

import { Result } from 'effect';

import { decodeManifest, decodeRequest } from '../src/contract.ts';
import { manifest, request } from './contracts-fixtures.ts';

function admitsFixedOperations() {
  for (const kind of [
    'Baseline',
    'NetworkDenial',
    'CancelTree',
    'Deadline',
    'Disconnect',
    'Isolation',
  ]) {
    const result = decodeRequest({ ...request(), kind });
    expect(Result.isSuccess(result)).toBe(true);
  }
}
test('request admits only the six fixed offline operation names', admitsFixedOperations);

function rejectsEscalation() {
  const original = request();
  for (const input of [
    { ...original, argv: ['sh', '-c', 'anything'] },
    { ...original, sandboxId: 'caller-owned' },
    { ...original, sourceSha: 'f'.repeat(40) },
    { ...original, kind: 'Execute' },
    { ...original, activation: 'Enabled' },
    { ...original, budget: { commandOutputBytes: 10485761, artifactBytes: 536870912 } },
    { ...original, budget: { commandOutputBytes: 10485760, artifactBytes: 536870913 } },
    { ...original, budget: { ...original.budget, maxActiveRuns: 2 } },
    { ...original, operationId: '../other' },
    { ...original, durationMs: 0 },
    { ...original, durationMs: 2700001 },
  ]) {
    const result = decodeRequest(input);
    expect(Result.isFailure(result)).toBe(true);
  }
}
test(
  'request rejects arbitrary commands identities fields and expanded budgets',
  rejectsEscalation,
);

function validatesBlockedManifest() {
  const original = decodeManifest(manifest());
  expect(Result.isSuccess(original)).toBe(true);
  for (const input of [
    { ...manifest(), activation: 'Enabled' },
    { ...manifest(), outcome: 'Feasible' },
    { ...manifest(), integrity: 'Verified' },
    {
      ...manifest(),
      artifacts: [{ name: '../trace', entryType: 'File', byteLength: 1, claimedSha256: 'x' }],
    },
    { ...manifest(), artifacts: [manifest().artifacts[0], manifest().artifacts[0]] },
  ]) {
    const result = decodeManifest(input);
    expect(Result.isFailure(result)).toBe(true);
  }
}
test(
  'offline manifest cannot assert feasibility verified integrity or activation',
  validatesBlockedManifest,
);

function rejectsMalformedManifests() {
  const original = manifest();
  const artifact = original.artifacts[0];
  for (const input of [
    { ...original, unexpected: true },
    { ...original, artifacts: [{ ...artifact, target: '/tmp' }] },
    { ...original, commandOutput: [{ commandId: 'check', byteLength: 1, unexpected: true }] },
    {
      ...original,
      commandOutput: [
        { commandId: 'check', byteLength: 1 },
        { commandId: 'check', byteLength: 1 },
      ],
    },
    {
      ...original,
      artifacts: [{ ...artifact, byteLength: 536870912 }],
      commandOutput: [{ commandId: 'check', byteLength: 1 }],
    },
    { ...original, commandOutput: [{ commandId: 'check', byteLength: 10485761 }] },
  ]) {
    const result = decodeManifest(input);
    expect(Result.isFailure(result)).toBe(true);
  }
  const exact = decodeManifest({
    ...original,
    artifacts: [{ ...artifact, byteLength: 536870912 }],
  });
  expect(Result.isSuccess(exact)).toBe(true);
}
test(
  'manifest rejects unknown nested fields duplicate commands and aggregate overflow',
  rejectsMalformedManifests,
);
