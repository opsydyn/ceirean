import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../node_modules/@playwright/test/cli.js', import.meta.url).pathname;
const config = new URL('../browser/playwright.config.ts', import.meta.url).pathname;
async function runHarness(args: ReadonlyArray<string>) {
  const home = await mkdtemp(join(tmpdir(), 'ceirean-harness-discovery-'));
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', cli, 'test', '--config', config, ...args],
    {
      cwd: home,
      env: {
        HOME: home,
        PATH: '/usr/bin:/bin',
        DO_NOT_TRACK: '1',
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15000,
    },
  );
  const code = await child.exited;
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await rm(home, { recursive: true, force: true });
  return { code, text: stdout + stderr };
}
test('offline discovery finds four exact viewport journeys without starting a browser', async () => {
  const result = await runHarness(['--list']);
  expect(result.code).toBe(0);
  expect(result.text).toContain('Total: 4 tests in 1 file');
  expect(result.text).toContain('[desktop]');
  expect(result.text).toContain('[mobile]');
});
test('prepared harness refuses execution before browser or server access', async () => {
  const result = await runHarness([]);
  expect(result.code).toBe(1);
  expect(result.text).toContain('HostedActivationBlocked');
  expect(result.text).not.toContain('browserType.launch');
});
