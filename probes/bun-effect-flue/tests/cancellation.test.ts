import { expect, test } from 'bun:test';

import { decodeCancellationResult } from '../src/protocol.ts';
import { collectChild, deadline, spawnProbe, stopChild, withStateDirectory } from './process.ts';

async function scenario(mode: 'read-only' | 'abort') {
  let result: unknown;
  await withStateDirectory(async (directory) => {
    const child = spawnProbe(new URL('../src/cancellation-child.ts', import.meta.url), [
      mode,
      directory,
    ]);
    await Promise.resolve()
      .then(async () => {
        const output = await deadline(collectChild(child), `${mode} cancellation and cleanup`);
        expect(output.code).toBe(0);
        expect(output.stderr).toBe('');
        result = decodeCancellationResult(output.stdout.trim());
      })
      .finally(() => stopChild(child));
  });
  return result;
}

test('read cancellation does not abort the submission', async () => {
  expect(await scenario('read-only')).toMatchObject({
    readerOutcome: 'read_cancelled',
    submissionOutcome: 'completed',
    cleanup: 'confirmed',
    reply: { text: 'probe-complete' },
    lifecycle: { acquired: 1, released: 1 },
  });
});

test('explicit abort settles synthetic work', async () => {
  expect(await scenario('abort')).toMatchObject({
    readerOutcome: 'aborted',
    submissionOutcome: 'aborted',
    cleanup: 'confirmed',
    lifecycle: { acquired: 1, released: 1 },
  });
});

test('late completion cannot advance cancelled fixture', async () => {
  expect(await scenario('read-only')).toMatchObject({
    submissionOutcome: 'completed',
    lateDecision: {
      ok: false,
      reason: 'InvalidPhase',
      state: {
        phase: 'cancelled',
        generation: 1,
        digest: 'candidate-a',
        deadlineMs: 2000000000000,
        spentMicros: 12345,
        repairs: 1,
      },
    },
    retainedStateIdentity: true,
  });
});
