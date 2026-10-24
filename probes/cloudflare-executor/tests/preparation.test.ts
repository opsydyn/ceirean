import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Arbitrary, Effect, FileSystem, Result, Schema } from 'effect';

import baseline from '../fixtures/baseline.json' with { type: 'json' };
import {
  isSafeArchivePath,
  validatePreparation,
  validateRegistryRequest,
  validateSourceInventory,
} from '../src/preparation.ts';

const recipeUrl = new URL('../image/Dockerfile', import.meta.url);
const readingRecipe = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.readFileString(decodeURIComponent(recipeUrl.pathname))),
);
export const recipeReading = Effect.provide(readingRecipe, BunServices.layer);
const recipeText = await Effect.runPromise(recipeReading);

function fixture() {
  return structuredClone(baseline);
}

async function checksRecipe() {
  const operation = validatePreparation(fixture(), recipeText);
  const result = await Effect.runPromise(operation);
  expect(result).toMatchObject({ _tag: 'PreparationOnly', activation: 'Blocked' });
  expect(result.blockers).toEqual([
    'PrivateInvocationUnverified',
    'FinalImageUnbuilt',
    'SourcePending',
    'BunCachePending',
    'NpmCachePending',
    'BrowserHarnessPending',
  ]);
  expect(result.recipeSha256).toMatch(/^[a-f0-9]{64}$/);
}
test(
  'valid recipe remains preparation-only with pending artifacts and both activation blockers',
  checksRecipe,
);

async function rejectsChangedRecipe() {
  const operation = validatePreparation(fixture(), 'FROM ubuntu:latest\n');
  const result = await Effect.runPromise(operation.pipe(Effect.result));
  expect(Result.isFailure(result)).toBe(true);
}
test('changing the trusted recipe fails validation', rejectsChangedRecipe);

async function rejectsChanges() {
  const original = fixture();
  for (const input of [
    { ...original, sourceSha: 'a'.repeat(40) },
    { ...original, toolchain: { ...original.toolchain, bun: '1.4.2' } },
    { ...original, images: { ...original.images, base: 'ubuntu:latest' } },
    { ...original, images: { ...original.images, helper: '' } },
    { ...original, artifacts: { ...original.artifacts, npmCache: 'Ready' } },
    { ...original, image: 'Ready' },
    { ...original, privateInvocation: 'Verified' },
    { ...original, commands: { ...original.commands, test: { cwd: '.', argv: ['true'] } } },
    { ...original, CF_TOKEN: 'must-not-be-accepted' },
  ]) {
    const operation = validatePreparation(input, recipeText);
    const result = await Effect.runPromise(operation.pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
  }
}
test(
  'rejects source/toolchain drift, floating images, extra config and readiness claims',
  rejectsChanges,
);

async function admitsFiles() {
  const operation = validateSourceInventory([
    { path: 'src', kind: 'Directory' },
    { path: 'src/main.ts', kind: 'File', content: 'export const value = 1;' },
  ]);
  const result = await Effect.runPromise(operation);
  expect(result).toEqual({ _tag: 'ValidatedInventory', entries: 2 });
}
test('admits ordinary files and directories without extracting them', admitsFiles);

function unsafePathTest(path: string) {
  async function rejectsPath() {
    const operation = validateSourceInventory([{ path, kind: 'File' }]);
    const result = await Effect.runPromise(operation.pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
  }
  return rejectsPath;
}
for (const path of ['../secret', '/etc/passwd', 'a/../b', 'a\\b', 'a//b', 'a/%2e%2e/b']) {
  test(`rejects archive path ${path}`, unsafePathTest(path));
}

async function rejectsSpecialFiles() {
  for (const kind of ['Symlink', 'Fifo', 'Socket', 'Device']) {
    const operation = validateSourceInventory([{ path: 'src/link', kind, target: '../../etc' }]);
    const result = await Effect.runPromise(operation.pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
  }
}
test('rejects symlinks and special files rather than guessing their safety', rejectsSpecialFiles);

async function rejectsCollisions() {
  for (const path of ['src', 'src/file.ts']) {
    const operation = validateSourceInventory([
      { path: 'src', kind: 'File' },
      { path, kind: 'File' },
    ]);
    const result = await Effect.runPromise(operation.pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
  }
}
test('rejects duplicate paths and file-as-parent collisions', rejectsCollisions);

async function rejectsSensitiveInputs() {
  for (const entry of [
    { path: '.env', kind: 'File' },
    { path: 'config/.npmrc', kind: 'File' },
    { path: 'app.private-key.pem', kind: 'File' },
    { path: '.git/config', kind: 'File' },
    { path: 'src/config.ts', kind: 'File', content: '-----BEGIN RSA PRIVATE KEY-----' },
  ]) {
    const operation = validateSourceInventory([entry]);
    const result = await Effect.runPromise(operation.pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
  }
}
test('rejects secret-bearing tracked names and known private-key contents', rejectsSensitiveInputs);

const registryArtifact = new URL('https://registry.npmjs.org/effect/-/effect-4.0.0.tgz');
async function approvesRead() {
  const operation = validateRegistryRequest(registryArtifact.href, 'GET', [registryArtifact.href]);
  const result = await Effect.runPromise(operation);
  expect(result).toEqual({ _tag: 'ApprovedRegistryRequest', url: registryArtifact.href });
}
test('allows only an inventoried HTTPS GET', approvesRead);

async function rejectsDestinations() {
  for (const url of [
    'https://example.com/effect.tgz',
    'https://token@registry.npmjs.org/effect/-/effect-4.0.0.tgz',
    `${registryArtifact.href}?secret=value`,
    'http://registry.npmjs.org/effect/-/effect-4.0.0.tgz',
  ]) {
    const operation = validateRegistryRequest(url, 'GET', [registryArtifact.href, url]);
    const result = await Effect.runPromise(operation.pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
  }
  const operation = validateRegistryRequest('https://registry.npmjs.org/other', 'GET', [
    registryArtifact.href,
  ]);
  const unknown = await Effect.runPromise(operation.pipe(Effect.result));
  expect(Result.isFailure(unknown)).toBe(true);
}
test('rejects external redirects, unknown paths and credential-bearing URLs', rejectsDestinations);

async function rejectsWrites() {
  const operation = validateRegistryRequest(registryArtifact.href, 'POST', [registryArtifact.href]);
  const result = await Effect.runPromise(operation.pipe(Effect.result));
  expect(Result.isFailure(result)).toBe(true);
}
test('rejects write methods even on an inventoried URL', rejectsWrites);

function archivePathLaw(values: ReadonlyArray<number>) {
  const parts = values.map((value) => `part-${value}`);
  return (
    isSafeArchivePath(parts.join('/')) &&
    !isSafeArchivePath([...parts, '..', 'escape'].join('/')) &&
    !isSafeArchivePath(`/${parts.join('/')}`)
  );
}

function seedTest(seed: number) {
  async function verifiesPathLaws() {
    const segment = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000000 }));
    const segmentList = Schema.Array(segment).check(Schema.isMinLength(1), Schema.isMaxLength(12));
    const segments = Arbitrary.schema(segmentList);
    const checking = Arbitrary.checkEffect(segments, archivePathLaw, {
      seed,
      runs: 200,
      maxShrinks: 100,
    });
    const result = await Effect.runPromise(checking);
    expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
    expect(result).toMatchObject({ runs: 200 });
  }
  return verifiesPathLaws;
}
for (const seed of [0, 1, 163]) {
  test(`archive path laws; seed ${seed}; 200 sequences`, seedTest(seed));
}
