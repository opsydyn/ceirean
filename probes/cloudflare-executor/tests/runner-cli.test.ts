import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';

const entrypoint = decodeURIComponent(
  new URL('../scripts/run-hosted.ts', import.meta.url).pathname,
);
async function invoke(args: ReadonlyArray<string>, cwd: string) {
  const child = Bun.spawn([process.execPath, '--no-env-file', entrypoint, ...args], {
    cwd,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: cwd,
      CF_TOKEN: 'environment-never-log',
      CEIREAN_ACTIVATION: 'enabled',
    },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10000,
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  return { stdout, stderr, code: await child.exited };
}
function* verifyNoExecutionMode() {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-runner-' });
  for (const args of [
    [],
    ['--execute'],
    ['--send'],
    ['--dry-run'],
    ['--dry-run', '--trust', '/tmp/fake'],
    ['--deploy'],
  ]) {
    const result = yield* Effect.promise(() => invoke(args, cwd));
    expect(result.code).toBe(64);
    expect(result.stderr).toBe('{"_tag":"UsageError"}\n');
    expect(result.stdout).toBe('');
  }
}
async function noExecutionMode() {
  const workflow = Effect.gen(verifyNoExecutionMode);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'runner has only exact dry-run syntax and cannot accept execution or caller-trust flags',
  noExecutionMode,
);

function* verifyBoundedInputs() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-runner-' });
  yield* fs.writeFileString(path.join(cwd, '.env'), 'CF_TOKEN=dotenv-never-log\n');
  const worksheet = path.join(cwd, 'worksheet.json');
  const approval = path.join(cwd, 'approval.json');
  const args = ['--dry-run', '--worksheet', worksheet, '--approval', approval];
  for (const body of ['{"token":"secret-never-log"', ' '.repeat(65537)]) {
    yield* fs.writeFileString(worksheet, body);
    yield* fs.writeFileString(approval, '{}');
    const result = yield* Effect.promise(() => invoke(args, cwd));
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain('never-log');
    expect(result.stdout).not.toContain('never-log');
    expect(result.stderr).toBe('{"_tag":"DryRunRefused","activation":"Blocked"}\n');
  }
  yield* fs.remove(approval);
  const missing = yield* Effect.promise(() => invoke(args, cwd));
  expect(missing.code).toBe(1);
  expect(missing.stderr).toBe('{"_tag":"DryRunRefused","activation":"Blocked"}\n');
  yield* fs.writeFileString(worksheet, '{}');
  yield* fs.writeFileString(approval, '{}');
  const blocked = yield* Effect.promise(() => invoke(args, cwd));
  expect(blocked.code).toBe(2);
  expect(blocked.stderr).toBe('');
  expect(blocked.stdout).toBe(
    '{"_tag":"DryRunBlocked","activation":"Blocked","reason":"TrustedPolicyUnconfigured"}\n',
  );
  expect(yield* fs.readFileString(path.join(cwd, '.env'))).toBe('CF_TOKEN=dotenv-never-log\n');
}
async function boundedInputs() {
  const workflow = Effect.gen(verifyBoundedInputs);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'missing malformed oversized and unsigned files cannot activate or leak credentials',
  boundedInputs,
);

function* verifyNativeInputKinds() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-runner-kinds-' });
  const worksheet = path.join(cwd, 'worksheet.json');
  const approval = path.join(cwd, 'approval.json');
  const link = path.join(cwd, 'worksheet-link.json');
  yield* fs.writeFileString(worksheet, '{}');
  yield* fs.writeFileString(approval, '{}');
  yield* fs.symlink(worksheet, link);
  for (const target of [cwd, link]) {
    const result = yield* Effect.promise(() =>
      invoke(['--dry-run', '--worksheet', target, '--approval', approval], cwd),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('{"_tag":"DryRunRefused","activation":"Blocked"}\n');
  }
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([0xff, 0xfe]),
    new TextEncoder().encode(' '.repeat(65537)),
  ]) {
    yield* fs.writeFile(approval, bytes);
    const result = yield* Effect.promise(() =>
      invoke(['--dry-run', '--worksheet', worksheet, '--approval', approval], cwd),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('{"_tag":"DryRunRefused","activation":"Blocked"}\n');
  }
}
async function nativeInputKinds() {
  const workflow = Effect.gen(verifyNativeInputKinds);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'native runner refuses directories symlinks empty invalid UTF-8 and oversized receipts',
  nativeInputKinds,
);
