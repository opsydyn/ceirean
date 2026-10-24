import { expect, test } from 'bun:test';
import { mkdtemp, cp, symlink, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
async function refusesUnsupported() {
  const directory = await mkdtemp(join(tmpdir(), 'ceirean-cache-cli-'));
  await cp(root + 'src', join(directory, 'src'), { recursive: true });
  await cp(root + 'scripts', join(directory, 'scripts'), { recursive: true });
  await cp(root + 'fixtures', join(directory, 'fixtures'), { recursive: true });
  await symlink(root + 'node_modules', join(directory, 'node_modules'));
  await unlink(join(directory, 'fixtures/dependencies/consumer.bun.lock'));
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', join(directory, 'scripts/prepare-caches.ts'), '--deploy'],
    {
      cwd: directory,
      env: { HOME: directory, PATH: '/usr/bin:/bin' },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15000,
    },
  );
  const code = await child.exited;
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  await rm(directory, { recursive: true, force: true });
  expect({ code, stdout, stderr }).toEqual({
    code: 64,
    stdout: '',
    stderr: '{"_tag":"UsageError"}\n',
  });
}
test('cache CLI refuses unsupported argv before data/config/network work', refusesUnsupported);

for (const code of [
  "require('node:https').get('https://registry.npmjs.org/vite')",
  "require('node:net').connect(443, 'registry.npmjs.org')",
  "require('node:dns').lookup('registry.npmjs.org',()=>{})",
]) {
  async function tripwire() {
    const node = Bun.which('node') ?? process.execPath;
    const child = Bun.spawn(
      [node, '--require', root + 'scripts/npm-offline-guard.cjs', '-e', code],
      {
        env: { PATH: '/usr/bin:/bin' },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 5000,
      },
    );
    expect(await child.exited).toBe(76);
    expect(await new Response(child.stderr).text()).toBe('{"_tag":"OfflineNetworkDenied"}\n');
  }
  test(`native offline tripwire rejects ${code.split('.')[0]}`, tripwire);
}
