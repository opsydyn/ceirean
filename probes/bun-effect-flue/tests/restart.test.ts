import { expect, test } from 'bun:test';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectChild, deadline, readThroughLine, spawnProbe, stopChild, withStateDirectory, type ProbeChild } from './process.ts';

const script = new URL('../src/restart-child.ts', import.meta.url);

test('completed receipt and limits survive process death', async () => {
  await withStateDirectory(async (directory) => {
    let writer: ProbeChild | undefined;
    let reader: ProbeChild | undefined;
    try {
      writer = spawnProbe(script, ['write', directory]);
      const output = await deadline(readThroughLine(writer.stdout, 'COMMITTED'), 'writer commit');
      const written = JSON.parse(output.split('\n')[0]!);
      expect(writer.exitCode).toBe(null);
      writer.kill('SIGKILL');
      await deadline(writer.exited, 'writer kill');
      expect(writer.signalCode).toBe('SIGKILL');
      const appFile = await stat(join(directory, 'app.db'));
      const flueFile = await stat(join(directory, 'flue.db'));
      expect(appFile.ino).not.toBe(flueFile.ino);
      reader = spawnProbe(script, ['read', directory]);
      const recovered = await deadline(collectChild(reader), 'reader recovery');
      expect(recovered.code).toBe(0);
      expect(recovered.stderr).toBe('');
      const result = JSON.parse(recovered.stdout.trim());
      expect(result.state).toEqual({ phase: 'frozen', generation: 1, digest: 'candidate-a',
        deadlineMs: 2000000000000, spentMicros: 12345, repairs: 1 });
      expect(result.receipt).toEqual(written.receipt);
      expect(result.receipt.submissionId).toBeString();
      expect(result.reply).toEqual({ text: 'probe-complete', submissionId: written.receipt.submissionId });
      expect(result.providerCalls).toBe(0);
    } finally {
      await stopChild(writer);
      await stopChild(reader);
    }
  });
});

test('absent application row fails instead of resetting limits', async () => {
  await withStateDirectory(async (directory) => {
    const reader = spawnProbe(script, ['read', directory]);
    try {
      const result = await deadline(collectChild(reader), 'missing ledger');
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Missing ledger row');
      expect(result.stdout).toBe('');
    } finally { await stopChild(reader); }
  });
});
