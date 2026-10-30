import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Schema } from 'effect';

const withPlatform = Effect.provide(BunServices.layer);
const entrypoint = new URL('../src/main.ts', import.meta.url).pathname;
const fixture = new URL('./fixtures/manifest-success.ts', import.meta.url).pathname;
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.String));
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
async function successfulExit() {
  const result = await spawn('/private/tmp', [fixture]);
  expect(result.stderr).toBe('');
  expect(decode(result.stdout)).toMatchObject({
    _tag: 'ManifestDeclarationReport',
    coverage: expect.arrayContaining(['package.json']),
  });
  expect(result.code).toBe(0);
}
test('actual main and teardown preserve successful manifest exit zero', successfulExit);

async function refusesAndStaysQuiet() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-manifest-cli-' });
    yield* fs.writeFileString(
      `${root}/.env`,
      'NODE_OPTIONS=--invalid-sentinel\nSECRET_SENTINEL=do-not-read\n',
    );
    const output = yield* Effect.promise(() =>
      spawn(root, [entrypoint, 'manifests', '--repository', '/does-not-exist/SECRET_SENTINEL']),
    );
    expect(output.code).toBe(1);
    expect(output.stdout).toBe('');
    expect(decode(output.stderr)).toMatchObject({ _tag: 'ManifestReportFailed' });
    expect(output.stderr).not.toContain('SECRET_SENTINEL');
    const usage = yield* Effect.promise(() =>
      spawn(root, [entrypoint, 'manifests', '--repository', root, '--ref', 'main']),
    );
    expect(usage).toEqual({ code: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
    const script = `import { main } from ${encode(entrypoint)}; if (typeof main !== 'function') process.exitCode = 99;`;
    const quiet = yield* Effect.promise(() => spawn(root, ['--eval', script]));
    expect(quiet).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(yield* fs.readDirectory(root)).toEqual(['.env']);
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  await Effect.runPromise(scoped.pipe(withPlatform));
}
test(
  'actual command sanitizes missing repositories, ignores dotenv, rejects ref overrides and imports quietly',
  refusesAndStaysQuiet,
);
