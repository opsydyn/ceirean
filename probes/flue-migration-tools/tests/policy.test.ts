import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { withCheckout } from './checkout.ts';
import { resolveRead, resolveWrite } from './run.ts';

/**
 * Every property here is a refusal the tool surface depends on. A relaxation
 * that turns one of these green is a loss of the boundary, not a fix.
 */

test('a path inside the root resolves to its absolute location', async () => {
  await withCheckout(async ({ root, policy }) => {
    expect(await resolveRead(policy, 'src/index.ts')).toEqual({
      value: join(root, 'src', 'index.ts'),
    });
  });
});

test('a parent traversal is refused', async () => {
  await withCheckout(async ({ policy }) => {
    expect(await resolveRead(policy, '../secret.ts')).toEqual({ code: 'UnsafePath' });
  });
});

test('a traversal that leaves and re-enters is refused', async () => {
  await withCheckout(async ({ policy }) => {
    expect(await resolveRead(policy, 'src/../../outside/secret.ts')).toEqual({
      code: 'UnsafePath',
    });
  });
});

test('an absolute path is refused even when it names a file inside the root', async () => {
  await withCheckout(async ({ root, outside, policy }) => {
    const candidates = [join(outside, 'secret.ts'), join(root, 'src', 'index.ts'), '/etc/hosts'];
    for (const candidate of candidates)
      expect(await resolveRead(policy, candidate)).toEqual({ code: 'UnsafePath' });
  });
});

test('a NUL byte in a path is refused', async () => {
  await withCheckout(async ({ policy }) => {
    expect(await resolveRead(policy, 'src/in\0dex.ts')).toEqual({ code: 'UnsafePath' });
  });
});

test('a symlink that escapes the root is refused for reading and for writing', async () => {
  await withCheckout(async ({ policy }) => {
    expect(await resolveRead(policy, 'src/escape.ts')).toEqual({ code: 'UnsafePath' });
    expect(await resolveWrite(policy, 'src/escape.ts')).toEqual({ code: 'UnsafePath' });
  });
});

test('.git is refused although it sits inside the root', async () => {
  await withCheckout(async ({ policy }) => {
    for (const candidate of ['.git', '.git/config', 'src/../.git/config'])
      expect(await resolveRead(policy, candidate)).toEqual({ code: 'UnsafePath' });
  });
});

test('a readable path outside every writable prefix is not writable', async () => {
  await withCheckout(async ({ root, policy }) => {
    expect(await resolveRead(policy, 'docs/notes.md')).toEqual({
      value: join(root, 'docs', 'notes.md'),
    });
    expect(await resolveWrite(policy, 'docs/notes.md')).toEqual({
      code: 'NotWritable',
    });
  });
});

test('a new file under a writable prefix is accepted before it exists', async () => {
  await withCheckout(async ({ root, policy }) => {
    expect(await resolveWrite(policy, 'src/added.ts')).toEqual({
      value: join(root, 'src', 'added.ts'),
    });
    expect(await resolveRead(policy, 'src/added.ts')).toEqual({
      code: 'NotRegularFile',
    });
  });
});

test('the root itself is not writable', async () => {
  await withCheckout(async ({ policy }) => {
    for (const candidate of ['.', '', 'src/..'])
      expect(await resolveWrite(policy, candidate)).toEqual({ code: 'UnsafePath' });
  });
});

test('a sibling that merely shares a writable prefix by name is refused', async () => {
  await withCheckout(async ({ root, policy }) => {
    expect(await resolveRead(policy, 'srcx/nearby.ts')).toEqual({
      value: join(root, 'srcx', 'nearby.ts'),
    });
    expect(await resolveWrite(policy, 'srcx/nearby.ts')).toEqual({
      code: 'NotWritable',
    });
  });
});

test('a directory is not a readable file', async () => {
  await withCheckout(async ({ policy }) => {
    expect(await resolveRead(policy, 'src')).toEqual({ code: 'NotRegularFile' });
  });
});

test('a policy whose root is relative is refused before any path is considered', async () => {
  await withCheckout(async ({ policy }) => {
    const relative = { ...policy, root: 'checkout' };
    expect(await resolveRead(relative, 'src/index.ts')).toEqual({
      code: 'InvalidPolicy',
    });
  });
});
