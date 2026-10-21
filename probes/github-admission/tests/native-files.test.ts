import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];
export function fileFixture() {
  const root = tmpdir();
  const prefix = join(root, 'ceirean-inbox-');
  const directory = mkdtempSync(prefix);
  directories.push(directory);
  return join(directory, 'inbox.sqlite');
}
export function cleanFiles() {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
}
export function corruptFile(file: string) {
  writeFileSync(file, 'not a sqlite database');
}
