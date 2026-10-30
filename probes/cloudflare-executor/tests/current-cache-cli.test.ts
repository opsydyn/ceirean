import { expect, test } from 'bun:test';

const script = new URL('../scripts/prepare-current-cache.ts', import.meta.url).pathname;
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
  ['--prepare'],
  ['--prepare', 'relative', '/tmp', '/tmp/node'],
  ['--build', '/tmp', '/tmp', '/tmp/node'],
  ['--prepare', '/tmp', '/tmp', '/tmp/node', '--activate'],
]) {
  test(`offline cache CLI rejects unsupported argv: ${args}`, async () => {
    expect(await invoke(args)).toEqual({ code: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
  });
}
test('offline cache CLI refuses missing fixed source with a sanitized diagnostic', async () => {
  expect(await invoke(['--prepare', '/private/tmp', '/private/tmp', '/private/tmp/node'])).toEqual({
    code: 1,
    stdout: '',
    stderr: '{"_tag":"CurrentCachePreparationRefused","activation":"Blocked"}\n',
  });
});
