import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entrypoint = new URL('../scripts/prepare-inputs.ts', import.meta.url).pathname;
async function invoke(args: ReadonlyArray<string>) {
  const home = await mkdtemp(join(tmpdir(), 'ceirean-preparation-cli-'));
  const child = Bun.spawn([process.execPath, '--no-env-file', entrypoint, ...args], {
    cwd: home,
    env: { HOME: home, PATH: '/usr/bin:/bin' },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 15000,
  });
  const code = await child.exited;
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await rm(home, { force: true, recursive: true });
  return { code, stdout, stderr };
}
for (const args of [
  [],
  ['--deploy'],
  ['--source-repository', 'relative'],
  ['--source-repository', '/tmp', '--run'],
]) {
  test(`input preparer rejects unsupported argv ${args}`, async () => {
    const result = await invoke(args);
    expect(result).toEqual({ code: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
  });
}
test('missing pinned source refuses without emitting a partial payload or raw Git diagnostics', async () => {
  const result = await invoke(['--source-repository', '/private/tmp']);
  expect(result).toEqual({
    code: 1,
    stdout: '',
    stderr: '{"_tag":"PayloadPreparationRefused","activation":"Blocked"}\n',
  });
});
