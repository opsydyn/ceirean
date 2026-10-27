import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

import baseline from '../fixtures/readiness-image.json' with { type: 'json' };
import { sha256 } from '../src/preparation.ts';
import { validateReadinessImagePreparation } from '../src/readiness-image.ts';

const recipeUrl = new URL('../readiness-image/Dockerfile', import.meta.url);
const ignoreUrl = new URL('../readiness-image/.dockerignore', import.meta.url);
const readingRecipe = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.readFileString(decodeURIComponent(recipeUrl.pathname))),
);
const readingIgnore = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.readFileString(decodeURIComponent(ignoreUrl.pathname))),
);
const recipeReading = Effect.provide(readingRecipe, BunServices.layer);
const ignoreReading = Effect.provide(readingIgnore, BunServices.layer);
const recipe = await Effect.runPromise(recipeReading);
const ignore = await Effect.runPromise(ignoreReading);

async function rejected(
  input: unknown,
  candidate = recipe,
  code: 'InvalidManifest' | 'RecipeMismatch' = 'InvalidManifest',
) {
  const result = await Effect.runPromise(
    validateReadinessImagePreparation(input, candidate).pipe(Effect.result),
  );
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code } });
}

test('fixed candidate is preparation only and names all missing inputs', async () => {
  const report = await Effect.runPromise(validateReadinessImagePreparation(baseline, recipe));
  expect(report).toEqual({
    _tag: 'PreparationOnly',
    activation: 'Blocked',
    image: 'Unbuilt',
    recipeSha256: baseline.recipeSha256,
    blockers: [
      'ReadinessWorkerPending',
      'StracePending',
      'ObserverCanaryPending',
      'ArtifactProvenancePending',
      'BuildToolchainPending',
      'TransitiveClosurePending',
      'RunnerIdentityPending',
      'FreshContextAdmissionPending',
      'IndependentReviewPending',
      'BuildAndRunApprovalPending',
      'FinalImageUnbuilt',
      'RuntimeReadbacksPending',
    ],
  });
});

test('rejects altered fixed identity, paths, pending hashes and status claims', async () => {
  for (const input of [
    { ...baseline, extra: 'value' },
    { ...baseline, activation: 'Approved' },
    { ...baseline, image: 'Built' },
    { ...baseline, platform: 'linux/arm64' },
    { ...baseline, images: { ...baseline.images, node: 'node:latest' } },
    { ...baseline, images: { ...baseline.images, bun: 'bun:latest' } },
    { ...baseline, images: { ...baseline.images, playwright: 'playwright:latest' } },
    { ...baseline, straceSource: { ...baseline.straceSource, tagObject: 'a'.repeat(40) } },
    { ...baseline, straceSource: { ...baseline.straceSource, commit: 'b'.repeat(40) } },
    { ...baseline, straceSource: { ...baseline.straceSource, extra: true } },
    { ...baseline, images: { ...baseline.images, extra: 'value' } },
    {
      ...baseline,
      artifacts: { ...baseline.artifacts, strace: { path: '../strace', sha256: 'Pending' } },
    },
    {
      ...baseline,
      artifacts: {
        ...baseline.artifacts,
        readinessWorker: { path: '/input/readiness-worker.mjs', sha256: 'Pending' },
      },
    },
    {
      ...baseline,
      artifacts: {
        ...baseline.artifacts,
        observerCanary: { ...baseline.artifacts.observerCanary, sha256: 'a'.repeat(64) },
      },
    },
    {
      ...baseline,
      artifacts: {
        ...baseline.artifacts,
        strace: { ...baseline.artifacts.strace, sha256: 'b'.repeat(64) },
      },
    },
    {
      ...baseline,
      artifacts: {
        ...baseline.artifacts,
        readinessWorker: { ...baseline.artifacts.readinessWorker, sha256: 'c'.repeat(64) },
      },
    },
    {
      ...baseline,
      artifacts: {
        ...baseline.artifacts,
        strace: { ...baseline.artifacts.strace, extra: true },
      },
    },
    { ...baseline, artifacts: { ...baseline.artifacts, extra: 'Pending' } },
  ]) {
    await rejected(input);
  }
});

test('rejects any changed recipe even with its caller-supplied matching digest', async () => {
  for (const suffix of [
    '\nCMD ["sh"]\n',
    '\nCOPY input/extra /tmp/extra\n',
    '\nRUN echo unsafe\n',
    '\nFROM node:latest\n',
  ]) {
    const changed = recipe + suffix;
    const recipeSha256 = await Effect.runPromise(sha256(changed));
    await rejected({ ...baseline, recipeSha256 }, changed);
    await rejected(baseline, changed, 'RecipeMismatch');
  }
});

function isContextCopy(line: string) {
  return line.startsWith('COPY ') && !line.includes('--from=');
}

function checksCandidateFiles() {
  const contextCopies = recipe.split('\n').filter(isContextCopy);
  expect(contextCopies).toEqual([
    'COPY --chown=root:root --chmod=0444 input/readiness-worker.mjs /opt/ceirean/readiness-worker.mjs',
    'COPY --chown=root:root --chmod=0555 input/strace /usr/local/bin/strace',
    'COPY --chown=root:root --chmod=0555 input/observer-canary /usr/local/bin/observer-canary',
  ]);
  expect(recipe).toContain('USER pwuser\n');
  expect(recipe).toContain(
    'CMD ["/usr/local/bin/bun", "--no-env-file", "--no-install", "/opt/ceirean/readiness-worker.mjs", "--worker"]',
  );
  expect(ignore).toBe(
    '*\n!input/\ninput/*\n!input/readiness-worker.mjs\n!input/strace\n!input/observer-canary\n',
  );
}
test(
  'recipe and ignore list are fixed to the candidate artifacts and worker command',
  checksCandidateFiles,
);
