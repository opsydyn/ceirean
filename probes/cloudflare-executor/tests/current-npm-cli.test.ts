import { expect, test } from 'bun:test';

const script = new URL('../scripts/prepare-current-npm.ts', import.meta.url).pathname;
async function invoke(args: readonly string[]) {
  const child = Bun.spawn([process.execPath, '--no-env-file', '--no-install', script, ...args], {
    cwd: '/tmp',
    env: { PATH: '/usr/bin:/bin', HOME: '/tmp' },
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
  ['/tmp'],
  ['relative', '/tmp/node'],
  ['/tmp', 'relative'],
  ['/tmp', '/tmp/node', '--activate'],
  ['--deploy', '/tmp/node'],
]) {
  test(`current npm preparation refuses unsupported argv: ${args}`, async () => {
    expect(await invoke(args)).toEqual({ code: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
  });
}
test('current npm preparation refuses missing source with no secret-bearing stack', async () => {
  expect(await invoke(['/tmp', '/tmp/node'])).toEqual({
    code: 1,
    stdout: '',
    stderr: '{"_tag":"CurrentNpmPreparationRefused","activation":"Blocked"}\n',
  });
});
