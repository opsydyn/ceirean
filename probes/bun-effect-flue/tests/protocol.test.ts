import { expect, test } from 'bun:test';

import {
  decodeCheckpoint,
  decodeRestartResult,
  decodeCancellationResult,
  encodeCheckpoint,
  encodeRestartResult,
  encodeCancellationResult,
} from '../src/protocol.ts';

const state = {
  phase: 'frozen',
  generation: 1,
  digest: 'candidate-a',
  deadlineMs: 2000000000000,
  spentMicros: 12345,
  repairs: 1,
} as const;
const receipt = { submissionId: 'submission-fixture', uid: 'instance-fixture' };

test('checkpoint codec preserves receipt and fixed limits', () => {
  expect(decodeCheckpoint(encodeCheckpoint({ state, receipt }))).toEqual({ state, receipt });
});
test('restart codec preserves the completed reply without new provider work', () => {
  const result = {
    state,
    receipt,
    reply: { text: 'probe-complete', submissionId: 'submission-fixture' },
    providerCalls: 0,
  };
  expect(decodeRestartResult(encodeRestartResult(result))).toEqual({
    state,
    receipt,
    reply: { text: 'probe-complete', submissionId: 'submission-fixture' },
    providerCalls: 0,
  });
});
test('cancellation codec preserves late rejection and cleanup evidence', () => {
  const cancelled = { ...state, phase: 'cancelled' } as const;
  const result = {
    readerOutcome: 'read_cancelled',
    submissionOutcome: 'completed',
    cleanup: 'confirmed',
    lifecycle: { acquired: 1, released: 1 },
    retainedStateIdentity: true,
    reply: { text: 'probe-complete', submissionId: 'submission-fixture' },
    lateDecision: { ok: false, reason: 'InvalidPhase', state: cancelled },
  } as const;
  expect(decodeCancellationResult(encodeCancellationResult(result))).toEqual(result);
});
test('protocol decoders reject malformed evidence instead of trusting JSON shape', () => {
  expect(() => decodeCheckpoint('{"state":{"phase":"frozen"}}')).toThrow();
  expect(() => decodeRestartResult('{"providerCalls":"zero"}')).toThrow();
  expect(() => decodeCancellationResult('{"cleanup":"confirmed"}')).toThrow();
});
