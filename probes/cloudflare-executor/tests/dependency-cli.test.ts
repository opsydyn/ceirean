import { expect, test } from 'bun:test';
import { cp, mkdtemp, rm, symlink, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ceirean-inventory-cli-'));
  await cp(root + 'src', join(directory, 'src'), { recursive: true });
  await cp(root + 'fixtures', join(directory, 'fixtures'), { recursive: true });
  await cp(root + 'scripts', join(directory, 'scripts'), { recursive: true });
  await symlink(root + 'node_modules', join(directory, 'node_modules'));
  return directory;
}
async function invoke(directory: string, args: readonly string[]) {
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', join(directory, 'scripts/check-dependencies.ts'), ...args],
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
  return { code, stdout, stderr };
}
async function inventoryIsBlocked() {
  const directory = await fixture();
  const result = await invoke(directory, ['--check']);
  await rm(directory, { recursive: true, force: true });
  expect(result.code).toBe(2);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('"activation":"Blocked"');
  expect(result.stdout).toContain('"artifacts":661');
}
test(
  'frozen inventory check remains blocked and does not resolve or install anything',
  inventoryIsBlocked,
);
for (const name of [
  'consumer.bun.lock',
  'npm-generated.lock',
  'browser.bun.lock',
  'inventory.lock',
]) {
  async function tamperingRefused() {
    const directory = await fixture();
    const path = join(directory, 'fixtures/dependencies', name);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text + ' ');
    const result = await invoke(directory, ['--check']);
    await rm(directory, { recursive: true, force: true });
    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: '{"_tag":"InventoryCheckRefused","activation":"Blocked"}\n',
    });
  }
  test(`changed ${name} cannot redefine its own trusted inventory`, tamperingRefused);
}
async function usageBeforeData() {
  const directory = await fixture();
  await unlink(join(directory, 'fixtures/dependencies/consumer.bun.lock'));
  const result = await invoke(directory, ['--deploy']);
  await rm(directory, { recursive: true, force: true });
  expect(result).toEqual({ code: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
}
test('unsupported inventory argv is refused before loading inputs', usageBeforeData);
