import { afterEach, expect, test } from 'bun:test';

import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem, Schema } from 'effect';

const platform = Effect.provide(FileSystem.FileSystem, BunFileSystem.layer);
const fs = await Effect.runPromise(platform);

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await Effect.runPromise(fs.remove(root, { recursive: true, force: true }));
});
const entrypoint = new URL('../src/main.ts', import.meta.url).pathname;
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeString = Schema.encodeSync(Schema.fromJsonString(Schema.String));
async function spawn(cwd: string, args: ReadonlyArray<string>) {
  const child = Bun.spawn([process.execPath, '--no-env-file', '--no-install', ...args], {
    cwd,
    env: {},
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const code = await child.exited;
  return { code, stdout, stderr };
}
async function ownedCwd() {
  const root = await Effect.runPromise(fs.makeTempDirectory({ prefix: 'ceirean-inspector-test-' }));
  roots.push(root);
  await Effect.runPromise(
    fs.writeFileString(
      `${root}/.env`,
      'API_KEY=SECRET_SENTINEL\nNODE_OPTIONS=--invalid-sentinel\n',
    ),
  );
  await Effect.runPromise(fs.writeFileString(`${root}/profile.json`, '{"canExecute":true}'));
  return root;
}
async function inspectProcess() {
  const cwd = await ownedCwd();
  const before = await Effect.runPromise(fs.readDirectory(cwd));
  const output = await spawn(cwd, [entrypoint, 'inspect']);
  expect(output.code).toBe(2);
  expect(output.stderr).toBe('');
  expect(output.stdout).not.toContain('SECRET_SENTINEL');
  const report = decode(output.stdout);
  expect(report).toMatchObject({
    profileOrigin: 'UnverifiedWorkingTree',
    report: { canExecute: false, repository: { slug: 'opsydyn/fold-kit-experiments' } },
  });
  const after = await Effect.runPromise(fs.readDirectory(cwd));
  expect(after).toEqual(before);
}
test('actual CLI ignores cwd profile and sentinel env and writes no files', inspectProcess);

async function quietImport() {
  const cwd = await ownedCwd();
  const script = `import { main } from ${encodeString(entrypoint)}; if (typeof main !== 'function') process.exitCode = 99;`;
  const output = await spawn(cwd, ['--eval', script]);
  expect(output).toEqual({ code: 0, stdout: '', stderr: '' });
  const entries = await Effect.runPromise(fs.readDirectory(cwd));
  expect(entries.sort()).toEqual(['.env', 'profile.json']);
}
test('importing main is quiet and does not initialize operational state', quietImport);

async function rejectedProcesses() {
  const cwd = await ownedCwd();
  for (const args of [
    [],
    ['run'],
    ['inspect', '--profile', 'SECRET_SENTINEL'],
    ['inspect', '--api-key', 'SECRET_SENTINEL'],
    ['inspect', 'extra'],
  ]) {
    const output = await spawn(cwd, [entrypoint, ...args]);
    expect(output).toEqual({ code: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
  }
  const entries = await Effect.runPromise(fs.readDirectory(cwd));
  expect(entries.sort()).toEqual(['.env', 'profile.json']);
}
test(
  'actual CLI rejects run, profile, key and extra arguments with usage exit 64',
  rejectedProcesses,
);
