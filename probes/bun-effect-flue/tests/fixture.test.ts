import { expect, test } from 'bun:test';

import { decideFixture, type FixtureRun } from '../src/fixture.ts';

const frozen: FixtureRun = Object.freeze({
  phase: 'frozen',
  generation: 1,
  digest: 'candidate-a',
  deadlineMs: 2000000000000,
  spentMicros: 12345,
  repairs: 1,
});
const pending: FixtureRun = Object.freeze({ ...frozen, phase: 'pending', digest: null });

test('refuses verification before freeze', () => {
  expect(decideFixture(pending, { type: 'verify', generation: 1, digest: 'candidate-a' })).toEqual({
    ok: false,
    reason: 'InvalidPhase',
    state: pending,
  });
});
test('refuses changed digest', () => {
  expect(decideFixture(frozen, { type: 'verify', generation: 1, digest: 'candidate-b' })).toEqual({
    ok: false,
    reason: 'DigestMismatch',
    state: frozen,
  });
});
test('refuses a late generation', () => {
  expect(decideFixture(frozen, { type: 'verify', generation: 0, digest: 'candidate-b' })).toEqual({
    ok: false,
    reason: 'StaleGeneration',
    state: frozen,
  });
});
test('cancelled state rejects verification', () => {
  const cancelled: FixtureRun = { ...frozen, phase: 'cancelled' };
  expect(
    decideFixture(cancelled, { type: 'verify', generation: 1, digest: 'candidate-a' }),
  ).toEqual({ ok: false, reason: 'InvalidPhase', state: cancelled });
});
test('does not mutate rejected state', () => {
  const decision = decideFixture(frozen, { type: 'freeze', generation: 1, digest: 'candidate-b' });
  expect(decision.ok).toBe(false);
  expect(decision.state).toBe(frozen);
  expect(frozen).toEqual({
    phase: 'frozen',
    generation: 1,
    digest: 'candidate-a',
    deadlineMs: 2000000000000,
    spentMicros: 12345,
    repairs: 1,
  });
});
test('pending can freeze and verify the same digest while preserving limits', () => {
  const first = decideFixture(pending, { type: 'freeze', generation: 1, digest: 'candidate-a' });
  expect(first).toEqual({ ok: true, state: frozen });
  expect(
    decideFixture(first.state, { type: 'verify', generation: 1, digest: 'candidate-a' }),
  ).toEqual({ ok: true, state: { ...frozen, phase: 'verified' } });
});
test('cancellation is allowed only before verification', () => {
  for (const state of [pending, frozen]) {
    expect(decideFixture(state, { type: 'cancel', generation: 1 })).toEqual({
      ok: true,
      state: { ...state, phase: 'cancelled' },
    });
  }
  for (const phase of ['verified', 'cancelled'] as const) {
    const state = { ...frozen, phase };
    expect(decideFixture(state, { type: 'cancel', generation: 1 })).toEqual({
      ok: false,
      reason: 'InvalidPhase',
      state,
    });
  }
});
