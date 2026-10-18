export type PhaseResult = Readonly<{
  phase: 'domain' | 'flue' | 'restart' | 'cancellation';
  status: 'pass' | 'fail' | 'not_run';
  evidence: ReadonlyArray<string>;
}>;

export function summarize(results: readonly PhaseResult[]) {
  const required = ['domain', 'flue', 'restart', 'cancellation'] as const;
  const seen = new Set<string>();
  for (const result of results) {
    if (!required.includes(result.phase)) throw new Error(`Unknown phase: ${result.phase}`);
    if (seen.has(result.phase)) throw new Error(`Duplicate phase: ${result.phase}`);
    if (!['pass', 'fail', 'not_run'].includes(result.status)) throw new Error('Unknown phase status');
    if (!Array.isArray(result.evidence) || result.evidence.some((value) => typeof value !== 'string')) {
      throw new Error('Evidence must be a string array');
    }
    seen.add(result.phase);
  }
  const phases = results.map((result) => Object.freeze({ ...result, evidence: Object.freeze([...result.evidence]) }));
  const passed = required.every((phase) => phases.some((result) => result.phase === phase
    && result.status === 'pass' && result.evidence.length > 0
    && result.evidence.every((entry) => entry.trim().length > 0)));
  return Object.freeze({
    verdict: passed ? 'offline-compatible' as const : 'blocked' as const,
    phases: Object.freeze(phases), realProvider: 'not_run' as const,
    docker: 'not_run' as const, hostLoss: 'not_run' as const, productionQualification: false as const,
  });
}
