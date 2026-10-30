import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

import { inspectCurrentOfflineArchives } from '../src/current-archive-preflight.ts';

const script = new URL('../scripts/check-current-archives.ts', import.meta.url).pathname;
async function invoke(args: readonly string[]) {
  const child = Bun.spawn([process.execPath, '--no-env-file', '--no-install', script, ...args], {
    cwd: '/private/tmp',
    env: { PATH: '/usr/bin:/bin', HOME: '/private/tmp' },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10000,
  });
  const code = await child.exited;
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}
for (const args of [
  [],
  ['--run', '/tmp'],
  ['--inspect', 'relative'],
  ['--inspect', '/tmp', '--activate'],
]) {
  test(`archive preflight rejects unsupported argv: ${args}`, async () => {
    expect(await invoke(args)).toEqual({ code: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
  });
}
test('archive preflight refuses missing fixed input without exposing a stack', async () => {
  expect(await invoke(['--inspect', '/private/tmp'])).toEqual({
    code: 1,
    stdout: '',
    stderr: '{"_tag":"ArchivePreflightInputRefused","activation":"Blocked"}\n',
  });
});
async function rejectsSelfDeclaredInventory() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped();
    const root = yield* fs.realPath(temporary);
    yield* fs.writeFileString(`${root}/inventory.json`, '{"artifacts":[]}');
    const result = yield* inspectCurrentOfflineArchives(root).pipe(Effect.result);
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'InventoryError', code: 'InputChanged' },
    });
    expect(yield* fs.readDirectory(root)).toEqual(['inventory.json']);
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'read-only preflight cannot trust a replacement manifest or create rehearsal outputs',
  rejectsSelfDeclaredInventory,
);
