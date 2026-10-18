import { expect, test } from 'bun:test';

import { summarize, type PhaseResult } from '../src/report.ts';

const complete: readonly PhaseResult[] = [
  { phase: 'domain', status: 'pass', evidence: ['fixture assertions'] },
  { phase: 'flue', status: 'pass', evidence: ['real tool loop'] },
  { phase: 'restart', status: 'pass', evidence: ['SIGKILL and receipt readback'] },
  { phase: 'cancellation', status: 'pass', evidence: ['read-only and abort settlement'] },
];

test('missing phases cannot qualify compatibility', () => {
  expect(summarize(complete.slice(0, 3)).verdict).toBe('blocked');
  expect(summarize([]).verdict).toBe('blocked');
});
test('failed or unrun phases cannot qualify compatibility', () => {
  for (const status of ['fail', 'not_run'] as const) {
    expect(
      summarize([...complete.slice(0, 3), { phase: 'cancellation', status, evidence: [] }]).verdict,
    ).toBe('blocked');
  }
});
test('duplicate and unknown phases are rejected', () => {
  expect(() => summarize([...complete, complete[0]!])).toThrow(/duplicate/i);
  const unknown = {
    phase: 'production',
    status: 'pass',
    evidence: ['not an approved phase'],
  } as unknown as PhaseResult;
  expect(() => summarize([unknown])).toThrow(/unknown/i);
});
test('evidence-free and blank evidence cannot qualify compatibility', () => {
  for (const evidence of [[], [''], ['   ']]) {
    expect(
      summarize([...complete.slice(0, 3), { phase: 'cancellation', status: 'pass', evidence }])
        .verdict,
    ).toBe('blocked');
  }
});
test('four evidenced passes remain offline only', () => {
  expect(summarize(complete)).toEqual({
    verdict: 'offline-compatible',
    phases: complete,
    realProvider: 'not_run',
    docker: 'not_run',
    hostLoss: 'not_run',
    productionQualification: false,
  });
});
test('startup failure remains visible rather than being promoted', () => {
  const error = new Error('synthetic startup failure');
  const phases = complete.map((phase) =>
    phase.phase === 'flue'
      ? { ...phase, status: 'fail' as const, evidence: [error.message] }
      : phase,
  );
  const report = summarize(phases);
  expect(report.verdict).toBe('blocked');
  expect(report.phases.find((phase) => phase.phase === 'flue')).toEqual({
    phase: 'flue',
    status: 'fail',
    evidence: ['synthetic startup failure'],
  });
});
test('report snapshots evidence instead of retaining mutable caller arrays', () => {
  const evidence = ['measured fixture result'];
  const report = summarize(
    complete.map((phase) => (phase.phase === 'domain' ? { ...phase, evidence } : phase)),
  );
  evidence.length = 0;
  expect(report.phases[0]!.evidence).toEqual(['measured fixture result']);
});
