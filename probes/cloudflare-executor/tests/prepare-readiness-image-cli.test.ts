import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Path, Schema } from 'effect';

import baseline from '../fixtures/readiness-image.json' with { type: 'json' };

const script = decodeURIComponent(
  new URL('../scripts/prepare-readiness-image.ts', import.meta.url).pathname,
);
const manifestPath = decodeURIComponent(
  new URL('../fixtures/readiness-image.json', import.meta.url).pathname,
);
const recipePath = decodeURIComponent(
  new URL('../readiness-image/Dockerfile', import.meta.url).pathname,
);
const report = Schema.Struct({
  _tag: Schema.Literal('PreparationOnly'),
  activation: Schema.Literal('Blocked'),
  image: Schema.Literal('Unbuilt'),
  recipeSha256: Schema.String,
  blockers: Schema.Array(Schema.String),
});
const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(report), {
  onExcessProperty: 'error',
});
const encodeInput = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

async function invoke(args: ReadonlyArray<string>, cwd: string, entrypoint = script) {
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', entrypoint, ...args],
    {
      cwd,
      env: { PATH: '/usr/bin:/bin', HOME: cwd },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10000,
    },
  );
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  return { stdout, stderr, exitCode };
}

function* makeCliFixture() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-readiness-check-' });
  for (const relative of [
    'scripts/prepare-readiness-image.ts',
    'src/readiness-image.ts',
    'src/preparation.ts',
    'src/pins.ts',
    'src/runner-input.ts',
    'readiness-image/Dockerfile',
    'fixtures/readiness-image.json',
  ]) {
    const target = path.join(cwd, relative);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    const source = decodeURIComponent(new URL(`../${relative}`, import.meta.url).pathname);
    yield* fs.copyFile(source, target);
  }
  const moduleRoot = decodeURIComponent(new URL('../node_modules', import.meta.url).pathname);
  yield* fs.symlink(moduleRoot, path.join(cwd, 'node_modules'));
  return {
    cwd,
    entrypoint: path.join(cwd, 'scripts/prepare-readiness-image.ts'),
    manifest: path.join(cwd, 'fixtures/readiness-image.json'),
    recipe: path.join(cwd, 'readiness-image/Dockerfile'),
  };
}

function* verifyCheck() {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-readiness-cwd-' });
  const manifestBefore = yield* fs.readFileString(manifestPath);
  const recipeBefore = yield* fs.readFileString(recipePath);
  const result = yield* Effect.promise(() => invoke(['--check'], cwd));
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toBe('');
  const parsed = decodeReport(result.stdout);
  expect(parsed).toEqual({
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
  const manifestAfter = yield* fs.readFileString(manifestPath);
  const recipeAfter = yield* fs.readFileString(recipePath);
  expect(manifestAfter).toBe(manifestBefore);
  expect(recipeAfter).toBe(recipeBefore);
}
const checking = Effect.gen(verifyCheck);
const checkWorkflow = Effect.scoped(checking);
const nativeCheck = Effect.provide(checkWorkflow, BunServices.layer);
test('fixed check emits only the blocked pending report independent of cwd', async function checksCli() {
  await Effect.runPromise(nativeCheck);
});

function* verifyUsage() {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-readiness-usage-' });
  for (const args of [
    [],
    ['--build'],
    ['--run'],
    ['--fetch'],
    ['--check', '--build'],
    ['--check', '/tmp/other'],
    ['--check', 'https://example.invalid/input'],
    ['--check', '--manifest', '/tmp/other'],
    ['--check', '--check'],
    ['--help'],
  ]) {
    const result = yield* Effect.promise(() => invoke(args, cwd));
    expect(result).toEqual({ stdout: '', stderr: '{"_tag":"UsageError"}\n', exitCode: 64 });
  }
}
const checkingUsage = Effect.gen(verifyUsage);
const usageWorkflow = Effect.scoped(checkingUsage);
const nativeUsage = Effect.provide(usageWorkflow, BunServices.layer);
test('all other argument vectors refuse without build or path selection', async function checksUsage() {
  await Effect.runPromise(nativeUsage);
});

function* verifyRefusals() {
  const fs = yield* FileSystem.FileSystem;
  const copy = yield* makeCliFixture();
  const originalRecipe = yield* fs.readFileString(copy.recipe);
  for (const text of [
    '{"broken":',
    ' '.repeat(65537),
    encodeInput({ ...baseline, activation: 'Approved' }),
  ]) {
    yield* fs.writeFileString(copy.manifest, text);
    const result = yield* Effect.promise(() => invoke(['--check'], copy.cwd, copy.entrypoint));
    expect(result).toEqual({
      stdout: '',
      stderr: '{"_tag":"PreparationCheckFailed"}\n',
      exitCode: 1,
    });
  }
  yield* fs.writeFileString(copy.manifest, encodeInput(baseline));
  for (const text of [originalRecipe + '\nRUN echo unsafe\n', ' '.repeat(65537)]) {
    yield* fs.writeFileString(copy.recipe, text);
    const result = yield* Effect.promise(() => invoke(['--check'], copy.cwd, copy.entrypoint));
    expect(result).toEqual({
      stdout: '',
      stderr: '{"_tag":"PreparationCheckFailed"}\n',
      exitCode: 1,
    });
  }
  yield* fs.writeFileString(copy.recipe, originalRecipe);
  yield* fs.remove(copy.manifest);
  yield* fs.symlink(copy.recipe, copy.manifest);
  const linked = yield* Effect.promise(() => invoke(['--check'], copy.cwd, copy.entrypoint));
  expect(linked).toEqual({
    stdout: '',
    stderr: '{"_tag":"PreparationCheckFailed"}\n',
    exitCode: 1,
  });
  yield* fs.remove(copy.manifest);
  const missing = yield* Effect.promise(() => invoke(['--check'], copy.cwd, copy.entrypoint));
  expect(missing).toEqual({
    stdout: '',
    stderr: '{"_tag":"PreparationCheckFailed"}\n',
    exitCode: 1,
  });
  const usage = yield* Effect.promise(() => invoke(['--build'], copy.cwd, copy.entrypoint));
  expect(usage).toEqual({ stdout: '', stderr: '{"_tag":"UsageError"}\n', exitCode: 64 });
}
const checkingRefusals = Effect.gen(verifyRefusals);
const refusalWorkflow = Effect.scoped(checkingRefusals);
const nativeRefusals = Effect.provide(refusalWorkflow, BunServices.layer);
test('malformed missing oversized or drifted fixed files refuse without disclosing their contents', async function checksRefusals() {
  await Effect.runPromise(nativeRefusals);
});
