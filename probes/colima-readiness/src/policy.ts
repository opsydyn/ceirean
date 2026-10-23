import { Match, Result, Schema } from 'effect';

import {
  ActivationApproval,
  ActivationManifest,
  DiagnosticReport,
  ReadinessProblem,
  diagnosticOutcome,
} from './contracts.ts';

const strict = { onExcessProperty: 'error' } as const;
const problem = (code: typeof ReadinessProblem.Type.code) => ({
  _tag: 'ReadinessProblem' as const,
  code,
});
const Clock = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const SummaryInput = Schema.Struct({
  invocationId: DiagnosticReport.fields.invocationId,
  evidence: DiagnosticReport.fields.evidence,
  cleanup: DiagnosticReport.fields.cleanup,
});

function requireFact(condition: boolean, code: typeof ReadinessProblem.Type.code) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.orElse(() => Result.fail(problem(code))),
  );
}

export function decodeManifest(input: unknown) {
  return Schema.decodeUnknownResult(
    ActivationManifest,
    strict,
  )(input).pipe(Result.mapError(() => problem('InvalidManifest')));
}

export function validateActivation(manifest: unknown, approval: unknown, nowMs: unknown) {
  function* validate() {
    const m = yield* decodeManifest(manifest);
    const a = yield* Schema.decodeUnknownResult(
      ActivationApproval,
      strict,
    )(approval).pipe(Result.mapError(() => problem('InvalidApproval')));
    const now = yield* Schema.decodeUnknownResult(Clock)(nowMs).pipe(
      Result.mapError(() => problem('InvalidClock')),
    );
    yield* requireFact(a.manifestDigest === m.manifestDigest, 'ApprovalMismatch');
    yield* requireFact(now >= a.startMs && now < a.deadlineMs, 'OutsideWindow');
    const budget = m.commands.reduce((sum, c) => sum + c.timeoutMs, 0) + m.cleanupReserveMs;
    yield* requireFact(
      a.deadlineMs - a.startMs <= m.durationMs && a.deadlineMs - now >= budget,
      'InsufficientBudget',
    );
    return {
      _tag: 'ActivationValidated' as const,
      manifestDigest: m.manifestDigest,
      startMs: a.startMs,
      deadlineMs: a.deadlineMs,
      canExecuteReplay: false as const,
    };
  }
  return Result.gen(validate);
}

export function summarizeDiagnostics(
  manifest: unknown,
  invocationId: unknown,
  evidence: unknown,
  cleanup: unknown,
) {
  function* summarize() {
    const m = yield* decodeManifest(manifest);
    const input = yield* Schema.decodeUnknownResult(
      SummaryInput,
      strict,
    )({ invocationId, evidence, cleanup }).pipe(Result.mapError(() => problem('InvalidEvidence')));
    const report = {
      _tag: 'DiagnosticReport' as const,
      canExecuteReplay: false as const,
      evidenceBoundary: 'DiagnosticOnly' as const,
      manifest: m,
      ...input,
      outcome: diagnosticOutcome(m, input.invocationId, input.evidence, input.cleanup),
    };
    return yield* Schema.decodeUnknownResult(
      DiagnosticReport,
      strict,
    )(report).pipe(Result.mapError(() => problem('InvalidEvidence')));
  }
  return Result.gen(summarize);
}
