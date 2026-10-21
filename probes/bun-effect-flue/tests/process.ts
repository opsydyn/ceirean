import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function withStateDirectory(body: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'ceirean-process-'));
  await chmod(directory, 0o700);
  await Promise.resolve()
    .then(() => body(directory))
    .finally(() => rm(directory, { recursive: true, force: true }));
}

export function spawnProbe(script: URL, args: string[]) {
  return Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', fileURLToPath(script), ...args],
    {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}
export type ProbeChild = ReturnType<typeof spawnProbe>;

export async function deadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: 5-second watchdog expired`)), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function stopChild(child: ProbeChild | undefined) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await child.exited;
}

export async function readThroughLine(stream: ReadableStream<Uint8Array>, line: string) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  async function readToSentinel() {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Child exited before ${line}`);
      chunks.push(decoder.decode(chunk.value, { stream: true }));
      const text = chunks.join('');
      if (text.split('\n').includes(line)) return text;
    }
  }
  return await readToSentinel().finally(() => reader.releaseLock());
}

export async function collectChild(child: ProbeChild) {
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}
