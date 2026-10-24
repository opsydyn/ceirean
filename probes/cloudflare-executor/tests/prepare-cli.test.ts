import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Path, Schema } from 'effect';

import baseline from '../fixtures/baseline.json' with { type: 'json' };

const script = new URL('../scripts/prepare.ts', import.meta.url).pathname;
const inputPath = decodeURIComponent(
  new URL('../fixtures/baseline.json', import.meta.url).pathname,
);
const recipePath = decodeURIComponent(new URL('../image/Dockerfile', import.meta.url).pathname);
const report = Schema.Struct({
  _tag: Schema.Literal('PreparationOnly'),
  activation: Schema.Literal('Blocked'),
  recipeSha256: Schema.String,
  blockers: Schema.Array(Schema.String),
});
const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(report));

async function invoke(args: ReadonlyArray<string>, cwd: string, entrypoint = script) {
  const child = Bun.spawn([process.execPath, '--no-env-file', entrypoint, ...args], {
    cwd,
    env: { PATH: '/usr/bin:/bin', HOME: cwd, CF_TOKEN: 'environment-sentinel-never-log' },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10000,
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  return { stdout, stderr, exitCode };
}

function* verifyNonMutatingCheck() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-prepare-cli-' });
  const environmentPath = path.join(cwd, '.env');
  yield* fs.writeFileString(environmentPath, 'CF_TOKEN=dotenv-sentinel-never-log\n');
  const inputBefore = yield* fs.readFileString(inputPath);
  const recipeBefore = yield* fs.readFileString(recipePath);
  const result = yield* Effect.promise(() => invoke(['--check'], cwd));
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toBe('');
  const parsed = decodeReport(result.stdout);
  expect(parsed.blockers).toContain('PrivateInvocationUnverified');
  expect(parsed.blockers).toContain('FinalImageUnbuilt');
  expect(result.stdout).not.toContain('sentinel');
  const inputAfter = yield* fs.readFileString(inputPath);
  const recipeAfter = yield* fs.readFileString(recipePath);
  expect(inputAfter).toBe(inputBefore);
  expect(recipeAfter).toBe(recipeBefore);
  const environmentAfter = yield* fs.readFileString(environmentPath);
  expect(environmentAfter).toBe('CF_TOKEN=dotenv-sentinel-never-log\n');
}
const nonMutatingWorkflow = Effect.gen(verifyNonMutatingCheck);
const nonMutatingCheck = Effect.scoped(nonMutatingWorkflow);
export const nativeNonMutatingCheck = Effect.provide(nonMutatingCheck, BunServices.layer);

test('check is non-mutating, credential-independent and never activation success', async function checksCli() {
  await Effect.runPromise(nativeNonMutatingCheck);
});

function* verifyUnsupportedCommands() {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-prepare-cli-' });
  for (const args of [
    [],
    ['--build'],
    ['--check', '--deploy'],
    ['--check', '--manifest', '/tmp/input'],
  ]) {
    const result = yield* Effect.promise(() => invoke(args, cwd));
    expect(result.exitCode).toBe(64);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('{"_tag":"UsageError"}\n');
  }
}
const unsupportedWorkflow = Effect.gen(verifyUnsupportedCommands);
const unsupportedCommands = Effect.scoped(unsupportedWorkflow);
export const nativeUnsupportedCommands = Effect.provide(unsupportedCommands, BunServices.layer);

test('unsupported commands cannot build, fetch or run consumer scripts', async function rejectsCommands() {
  await Effect.runPromise(nativeUnsupportedCommands);
});

function* makeCliFixture() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-prepare-drift-' });
  for (const relative of [
    'scripts/prepare.ts',
    'src/preparation.ts',
    'src/pins.ts',
    'image/Dockerfile',
    'fixtures/baseline.json',
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
    entrypoint: path.join(cwd, 'scripts/prepare.ts'),
    manifest: path.join(cwd, 'fixtures/baseline.json'),
  };
}
const encodeInput = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function* verifyFreshProcessDrift() {
  const fs = yield* FileSystem.FileSystem;
  const copy = yield* makeCliFixture();
  for (const drift of [
    { ...baseline, images: { ...baseline.images, base: 'ubuntu:latest' } },
    { ...baseline, commands: { ...baseline.commands, test: { cwd: '.', argv: ['true'] } } },
  ]) {
    yield* fs.writeFileString(copy.manifest, encodeInput(drift));
    const result = yield* Effect.promise(() => invoke(['--check'], copy.cwd, copy.entrypoint));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('{"_tag":"PreparationCheckFailed"}\n');
  }
}
const driftWorkflow = Effect.gen(verifyFreshProcessDrift);
const scopedDrift = Effect.scoped(driftWorkflow);
export const nativeFreshProcessDrift = Effect.provide(scopedDrift, BunServices.layer);
test('fresh CLI processes reject fixture drift rather than redefining reviewed pins', async function rejectsDrift() {
  await Effect.runPromise(nativeFreshProcessDrift);
});

function* verifyInvalidInputFailures() {
  const fs = yield* FileSystem.FileSystem;
  const copy = yield* makeCliFixture();
  for (const text of ['{"secret":"loader-sentinel"', ' '.repeat(65537)]) {
    yield* fs.writeFileString(copy.manifest, text);
    const result = yield* Effect.promise(() => invoke(['--check'], copy.cwd, copy.entrypoint));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('{"_tag":"PreparationCheckFailed"}\n');
  }
  yield* fs.remove(copy.manifest);
  const missing = yield* Effect.promise(() => invoke(['--check'], copy.cwd, copy.entrypoint));
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toBe('{"_tag":"PreparationCheckFailed"}\n');
  const usage = yield* Effect.promise(() => invoke(['--build'], copy.cwd, copy.entrypoint));
  expect(usage.exitCode).toBe(64);
  expect(usage.stderr).toBe('{"_tag":"UsageError"}\n');
}
const invalidInputWorkflow = Effect.gen(verifyInvalidInputFailures);
const scopedInvalidInput = Effect.scoped(invalidInputWorkflow);
export const nativeInvalidInputs = Effect.provide(scopedInvalidInput, BunServices.layer);
test('missing malformed and oversized input failures are sanitized before module loading', async function rejectsInvalidInputs() {
  await Effect.runPromise(nativeInvalidInputs);
});
