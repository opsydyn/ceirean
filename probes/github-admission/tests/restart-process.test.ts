import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function watchdog<A>(promise: Promise<A>): Promise<A> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TypeError('5000ms child watchdog')), 5000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
export async function boundedOutput(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  async function drain() {
    while (true) {
      const next = await watchdog(reader.read());
      if (next.done) break;
      length += next.value.length;
      if (length > 4096) throw new TypeError('child output exceeds 4096 bytes');
      chunks.push(next.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  }
  return watchdog(drain()).finally(() => reader.releaseLock());
}
function spawn(mode: string, file: string) {
  const child = Bun.spawn(
    [Bun.which('bun')!, '--no-env-file', '--no-install', 'src/restart-child.ts', mode, file],
    {
      cwd: import.meta.dir + '/..',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const stderr = boundedOutput(child.stderr);
  void stderr.catch(() => undefined);
  return { child, stderr };
}
export type Owned = ReturnType<typeof spawn>;
export async function joined(owned: Owned) {
  const code = await watchdog(owned.child.exited);
  expect(await watchdog(owned.stderr)).toBe('');
  return code;
}
async function stop(owned: Owned) {
  owned.child.kill('SIGKILL');
  await watchdog(owned.child.exited);
  await watchdog(owned.stderr).catch(() => undefined);
}
export async function phaseText(owned: Owned) {
  const reader = owned.child.stdout.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const buffer = { text: '' };
  async function drainPhase() {
    while (!buffer.text.endsWith('\n')) {
      const next = await watchdog(reader.read());
      if (next.done) throw new TypeError('child exited before phase sentinel');
      buffer.text += decoder.decode(next.value, { stream: true });
      if (buffer.text.length > 1024) throw new TypeError('oversized phase sentinel');
    }
    return buffer.text.trim();
  }
  return watchdog(drainPhase()).finally(() => reader.releaseLock());
}
export function counts(file: string) {
  using db = new Database(file, { readonly: true, strict: true });
  return ['decisions', 'receipts'].map(
    (table) => db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n,
  );
}
export function committedIdentity(file: string) {
  using db = new Database(file, { readonly: true, strict: true });
  return String(db.query<{ id: number }, []>('SELECT id FROM decisions').get()!.id);
}
export function storedRecord(file: string) {
  using db = new Database(file, { readonly: true });
  return db.query<{ record: string }, []>('SELECT record FROM decisions').get()!.record;
}
export function corrupt(file: string) {
  writeFileSync(file, 'not sqlite');
}
export async function withProcesses(
  run: (file: string, own: (mode: string) => Owned) => Promise<void>,
) {
  const root = tmpdir();
  const directory = mkdtempSync(join(root, 'leviathan-restart-'));
  const file = join(directory, 'inbox.sqlite');
  const children: Owned[] = [];
  function own(mode: string) {
    const owned = spawn(mode, file);
    children.push(owned);
    return owned;
  }
  async function cleanup() {
    const stopped = await Promise.allSettled(children.map(stop));
    rmSync(directory, { recursive: true, force: true });
    expect(stopped.every((result) => result.status === 'fulfilled')).toBe(true);
  }
  await Promise.resolve()
    .then(() => run(file, own))
    .finally(cleanup);
}
