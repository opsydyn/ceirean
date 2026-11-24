import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MigrationToolPolicy } from '../src/policy.ts';

export type Checkout = Readonly<{
  /** The real path of the checkout root, with `/tmp` already resolved. */
  root: string;
  /** A second real directory outside the checkout, for escape fixtures. */
  outside: string;
  policy: MigrationToolPolicy;
}>;

/**
 * A fixture checkout holding the shapes every confinement property needs:
 * a writable `src/`, a readable-but-not-writable `docs/`, a `.git/`, a `srcx/`
 * whose name merely shares a writable prefix, and a symlink in `src/` pointing
 * at a file outside the root.
 *
 * `realpath` is applied to both roots because macOS reaches its temporary
 * directory through a `/tmp` symlink, and every check here compares a resolved
 * path against an expected one.
 */
export async function withCheckout(body: (checkout: Checkout) => Promise<void>) {
  const created = await mkdtemp(join(tmpdir(), 'ceirean-tools-'));
  const base = await realpath(created);
  await chmod(base, 0o700);
  const root = join(base, 'checkout');
  const outside = join(base, 'outside');
  await Promise.all([
    mkdir(join(root, 'src'), { recursive: true }),
    mkdir(join(root, 'srcx'), { recursive: true }),
    mkdir(join(root, 'docs'), { recursive: true }),
    mkdir(join(root, '.git'), { recursive: true }),
    mkdir(outside, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, 'src', 'index.ts'), 'export const value = 1;\n'),
    writeFile(join(root, 'srcx', 'nearby.ts'), 'export const nearby = 1;\n'),
    writeFile(join(root, 'docs', 'notes.md'), '# notes\n'),
    writeFile(join(root, 'README.md'), '# fixture\n'),
    writeFile(join(root, '.git', 'config'), '[core]\n'),
    writeFile(join(outside, 'secret.ts'), 'export const secret = 1;\n'),
  ]);
  await symlink(join(outside, 'secret.ts'), join(root, 'src', 'escape.ts'));
  const policy: MigrationToolPolicy = {
    root,
    writable: ['src', 'README.md'],
    readMaximum: 65536,
    writeMaximum: 65536,
    searchMatches: 64,
    searchMatchBytes: 512,
    outputMaximum: 8192,
    outputLineMaximum: 512,
    checks: [],
  };
  await Promise.resolve()
    .then(() => body({ root, outside, policy }))
    .finally(() => rm(base, { recursive: true, force: true }));
}

/** A state directory for one Flue runtime, removed when the body finishes. */
export async function withStateDirectory(body: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'ceirean-agent-'));
  await chmod(directory, 0o700);
  await Promise.resolve()
    .then(() => body(directory))
    .finally(() => rm(directory, { recursive: true, force: true }));
}
