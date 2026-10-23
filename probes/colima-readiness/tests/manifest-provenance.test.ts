import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Match, Record, Result, Schema } from 'effect';

import {
  DiagnosticReport,
  deriveManifestDigest,
  diagnosticOutcome,
  type CleanupEvidence,
} from '../src/contracts.ts';
import { decodeManifest, summarizeDiagnostics, validateActivation } from '../src/policy.ts';
import { diagnosticFixture } from './fixtures.ts';

function rejects<A, E>(result: Result.Result<A, E>) {
  expect(Result.isFailure(result)).toBe(true);
}
function accepts<A, E>(result: Result.Result<A, E>) {
  expect(Result.isSuccess(result)).toBe(true);
}

function contentBinding() {
  const f = diagnosticFixture();
  const m = f.manifest;
  const approval = {
    _tag: 'ActivationApproval',
    manifestDigest: m.manifestDigest,
    startMs: 100,
    deadlineMs: 1200100,
  };
  const mutations = [
    { ...m, commands: m.commands.map((c) => ({ ...c, argv: ['different-unapproved-command'] })) },
    { ...m, limits: { ...m.limits, cpuCores: 1 } },
    { ...m, network: { ...m.network, dnsDestination: 'changed.invalid' } },
    { ...m, cleanupCommands: m.cleanupCommands.map((c) => ({ ...c, argv: ['changed-cleanup'] })) },
  ];
  accepts(decodeManifest(m));
  for (const changed of mutations) {
    rejects(decodeManifest(changed));
    rejects(validateActivation(changed, approval, 100));
    expect(
      diagnosticOutcome(changed, f.invocationId, f.evidence, f.cleanup, f.approval, f.execution),
    ).not.toBe('Pass');
    rejects(
      summarizeDiagnostics(changed, f.invocationId, f.evidence, f.cleanup, f.approval, f.execution),
    );
  }
}
test(
  'old content digest cannot approve or aggregate changed argv, limits, destinations or cleanup',
  contentBinding,
);

function missingWindow() {
  const f = diagnosticFixture();
  rejects(
    summarizeDiagnostics(f.manifest, f.invocationId, f.evidence, f.cleanup, undefined, undefined),
  );
}
test('diagnostics without approval and actual observation timing fail closed', missingWindow);

type Fixture = ReturnType<typeof diagnosticFixture>;
function typedOutcome(f: Fixture) {
  return diagnosticOutcome(
    f.manifest,
    f.invocationId,
    f.evidence,
    f.cleanup,
    f.approval,
    f.execution,
  );
}

function safeIntegerIntervals() {
  const original = diagnosticFixture();
  for (const offset of [-100, 0, Number.MAX_SAFE_INTEGER - original.approval.deadlineMs]) {
    const approval = {
      ...original.approval,
      startMs: original.approval.startMs + offset,
      deadlineMs: original.approval.deadlineMs + offset,
    };
    const f = {
      ...original,
      approval,
      execution: {
        startedAtMs: original.execution.startedAtMs + offset,
        completedAtMs: original.execution.completedAtMs + offset,
      },
      evidence: original.evidence.map((e) => ({
        ...e,
        approval,
        observed: {
          startedAtMs: e.observed.startedAtMs + offset,
          completedAtMs: e.observed.completedAtMs + offset,
        },
      })),
      cleanup: {
        ...original.cleanup,
        approval,
        observed: {
          startedAtMs: original.cleanup.observed.startedAtMs + offset,
          completedAtMs: approval.deadlineMs,
        },
      },
    };
    expect(typedOutcome(f)).toBe('Pass');
    expect(summarize(f).pipe(Result.getOrThrow).outcome).toBe('Pass');
  }
}
test(
  'typed intervals accept nonnegative safe-integer bounds including zero and maximum',
  safeIntegerIntervals,
);

for (const [field, fractional] of [
  ['startedAtMs', 200.5],
  ['completedAtMs', 1099.5],
] as const) {
  for (const [label, value] of [
    ['fractional', fractional],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ] as const) {
    function invalidExecutionInterval() {
      const original = diagnosticFixture();
      const f = {
        ...original,
        execution: { ...original.execution, [field]: value },
        evidence: original.evidence.map((e) => ({
          ...e,
          observed: { startedAtMs: 300, completedAtMs: 1000 },
        })),
      };
      rejects(summarize(f));
      expect(typedOutcome(f)).toBe('Blocked');
    }
    test(
      `typed execution ${field} rejects ${label} and agrees with unknown input`,
      invalidExecutionInterval,
    );

    for (let index = 0; index < 7; index++) {
      function invalidCheckInterval() {
        const original = diagnosticFixture();
        const f = {
          ...original,
          evidence: original.evidence.map((e, i) => ({
            ...e,
            observed: { ...e.observed, ...(i === index && { [field]: value }) },
          })),
        };
        rejects(summarize(f));
        expect(typedOutcome(f)).toBe('Blocked');
      }
      test(
        `typed check ${index} ${field} rejects ${label} and agrees with unknown input`,
        invalidCheckInterval,
      );
    }
  }
}

function reversedTypedEvidence() {
  const f = diagnosticFixture();
  const evidence = f.evidence.map((e) => ({
    ...e,
    observed: { startedAtMs: 1100, completedAtMs: 100 },
  }));
  const cleanup = { ...f.cleanup, observed: { startedAtMs: 37100, completedAtMs: 7100 } };
  const unconfirmed: unknown = { ...f.cleanup, containersAbsent: false };
  expect(
    diagnosticOutcome(
      f.manifest,
      f.invocationId,
      f.evidence,
      unconfirmed as CleanupEvidence,
      f.approval,
      f.execution,
    ),
  ).toBe('Blocked');
  expect(
    diagnosticOutcome(f.manifest, f.invocationId, evidence, f.cleanup, f.approval, f.execution),
  ).toBe('Blocked');
  expect(
    diagnosticOutcome(f.manifest, f.invocationId, f.evidence, cleanup, f.approval, f.execution),
  ).toBe('Blocked');
  expect(
    diagnosticOutcome(f.manifest, f.invocationId, f.evidence, f.cleanup, f.approval, {
      startedAtMs: 7100,
      completedAtMs: 100,
    }),
  ).toBe('Blocked');
}
test('typed aggregation also rejects reversed observation intervals', reversedTypedEvidence);

function summarize(
  f: Fixture,
  approval: unknown = f.approval,
  execution: unknown = f.execution,
  evidence: unknown = f.evidence,
  cleanup: unknown = f.cleanup,
) {
  return summarizeDiagnostics(f.manifest, f.invocationId, evidence, cleanup, approval, execution);
}
function cannotPass(result: ReturnType<typeof summarize>) {
  function incomplete(report: DiagnosticReport) {
    return Match.value(report.outcome).pipe(
      Match.when('Pass', () => false),
      Match.orElse(() => true),
    );
  }
  return Result.match(result, {
    onFailure: () => true,
    onSuccess: incomplete,
  });
}
function assertCannotPass(result: ReturnType<typeof summarize>) {
  expect(cannotPass(result)).toBe(true);
}

function timingProvenance() {
  const f = diagnosticFixture();
  const report = summarize(f).pipe(Result.getOrThrow);
  expect(report.outcome).toBe('Pass');
  expect(report.approval).toEqual(f.approval);
  expect(report.execution).toEqual(f.execution);
  const invalidApprovals = [
    undefined,
    {},
    { ...f.approval, extra: true },
    { ...f.approval, manifestDigest: '0'.repeat(64) },
    { ...f.approval, startMs: f.approval.deadlineMs },
    { ...f.approval, startMs: 101 },
    { ...f.approval, deadlineMs: 1200101 },
  ];
  for (const approval of invalidApprovals)
    assertCannotPass(
      summarizeDiagnostics(
        f.manifest,
        f.invocationId,
        f.evidence,
        f.cleanup,
        approval,
        f.execution,
      ),
    );
  for (const execution of [
    undefined,
    {},
    { ...f.execution, extra: true },
    { startedAtMs: 99, completedAtMs: 7100 },
    { startedAtMs: 7101, completedAtMs: 7100 },
    { startedAtMs: 1133101, completedAtMs: 1133101 },
    { startedAtMs: 100, completedAtMs: 1140101 },
    { startedAtMs: 100, completedAtMs: 1200101 },
  ]) {
    assertCannotPass(
      summarizeDiagnostics(
        f.manifest,
        f.invocationId,
        f.evidence,
        f.cleanup,
        f.approval,
        execution,
      ),
    );
  }
  const decode = Schema.decodeUnknownResult(DiagnosticReport, { onExcessProperty: 'error' });
  for (const mutation of [
    { approval: undefined },
    { execution: undefined },
    { approval: { ...f.approval, deadlineMs: 1200099 } },
    { evidence: f.evidence.map((e) => ({ ...e, observed: undefined })) },
    { cleanup: { ...f.cleanup, observed: undefined } },
  ]) {
    rejects(decode({ ...report, ...mutation }));
  }
}
test(
  'strict reports retain exact approval and diagnostic intervals, never inferred windows',
  timingProvenance,
);

function cleanupOnly() {
  const f = diagnosticFixture();
  const late = {
    ...f.cleanup,
    phase: 'CleanupOnly' as const,
    observed: { startedAtMs: f.approval.deadlineMs, completedAtMs: f.approval.deadlineMs + 1000 },
  };
  const report = summarize(f, f.approval, f.execution, f.evidence, late).pipe(Result.getOrThrow);
  expect(report.outcome).toBe('Blocked');
  expect(report.cleanup.observed).toEqual(late.observed);
  expect(report.cleanup.phase).toBe('CleanupOnly');
  const decode = Schema.decodeUnknownResult(DiagnosticReport, { onExcessProperty: 'error' });
  rejects(decode({ ...report, outcome: 'Pass' }));
  rejects(summarize(f, f.approval, f.execution, f.evidence, { ...late, phase: 'WithinWindow' }));
  rejects(
    summarize(f, f.approval, f.execution, f.evidence, { ...f.cleanup, phase: 'CleanupOnly' }),
  );
  const crossing = { ...late, observed: { startedAtMs: 1200000, completedAtMs: 1200101 } };
  expect(
    summarize(f, f.approval, f.execution, f.evidence, crossing).pipe(Result.getOrThrow).outcome,
  ).toBe('Blocked');
  const edge = { ...f.cleanup, observed: { startedAtMs: 7100, completedAtMs: 1200100 } };
  expect(
    summarize(f, f.approval, f.execution, f.evidence, edge).pipe(Result.getOrThrow).outcome,
  ).toBe('Pass');
}
test('late cleanup is an explicit retained cleanup-only record, not timely success', cleanupOnly);

function canonicalContent() {
  const f = diagnosticFixture();
  const m = f.manifest;
  const reordered = Record.fromEntries(Object.entries(m).reverse());
  accepts(decodeManifest(reordered));
  expect(deriveManifestDigest({ ...m, manifestDigest: '0'.repeat(64) })).toBe(m.manifestDigest);
  expect(
    deriveManifestDigest({
      ...m,
      identity: Record.fromEntries(Object.entries(m.identity).reverse()) as typeof m.identity,
    }),
  ).toBe(m.manifestDigest);
  const changed = {
    ...m,
    commands: m.commands.map((c) => ({ ...c, argv: [...c.argv, 'changed'] })),
  };
  const rebound = { ...changed, manifestDigest: deriveManifestDigest(changed) };
  accepts(decodeManifest(rebound));
  rejects(validateActivation(rebound, f.approval, 100));
  assertCannotPass(
    summarizeDiagnostics(rebound, f.invocationId, f.evidence, f.cleanup, f.approval, f.execution),
  );
  const approval = { ...f.approval, manifestDigest: rebound.manifestDigest };
  accepts(validateActivation(rebound, approval, 100));
  const evidence = f.evidence.map((e) => ({
    ...e,
    manifestDigest: rebound.manifestDigest,
    approval,
  }));
  const cleanup = { ...f.cleanup, manifestDigest: rebound.manifestDigest, approval };
  const renewed = summarizeDiagnostics(
    rebound,
    f.invocationId,
    evidence,
    cleanup,
    approval,
    f.execution,
  ).pipe(Result.getOrThrow);
  expect(renewed.outcome).toBe('Pass');
  expect(deriveManifestDigest({ ...m, commands: [...m.commands].reverse() })).not.toBe(
    m.manifestDigest,
  );
}
test(
  'canonical SHA-256 ignores digest and object insertion order, not array order or changed content',
  canonicalContent,
);

const generated = Arbitrary.schema(
  Schema.Struct({
    index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
    delta: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000000 })),
  }),
);
type Case = typeof generated extends Arbitrary.Arbitrary<infer A> ? A : never;
function observationLaw({ index, delta }: Case) {
  const f = diagnosticFixture();
  const original = summarize(f);
  const mutations = [
    { observed: undefined },
    { approval: undefined },
    { approval: { ...f.approval, deadlineMs: f.approval.deadlineMs - delta } },
    { observed: { startedAtMs: 100, completedAtMs: f.approval.deadlineMs + delta } },
    { observed: { startedAtMs: 7100 + delta, completedAtMs: 7100 } },
    { observed: { startedAtMs: 99, completedAtMs: 100 } },
  ];
  function invalid(mutation: (typeof mutations)[number]) {
    const evidence = f.evidence.map((e, i) => ({ ...e, ...(i === index && mutation) }));
    return (
      cannotPass(summarize(f, f.approval, f.execution, evidence)) &&
      cannotPass(summarize(f, f.approval, f.execution, f.evidence, { ...f.cleanup, ...mutation }))
    );
  }
  return !cannotPass(original) && mutations.every(invalid);
}
function manifestLaw({ index, delta }: Case) {
  const f = diagnosticFixture();
  const m = f.manifest;
  const mutations = [
    {
      ...m,
      commands: m.commands.map((c, i) => ({
        ...c,
        ...(i === index && { argv: [...c.argv, `${delta}`] }),
      })),
    },
    { ...m, vm: { ...m.vm, diskBytes: m.vm.diskBytes + delta } },
    { ...m, network: { ...m.network, dnsDestination: `changed-${delta}.invalid` } },
    {
      ...m,
      cleanupCommands: m.cleanupCommands.map((c) => ({ ...c, argv: [...c.argv, `${delta}`] })),
    },
  ];
  return (
    Result.isSuccess(decodeManifest(m)) &&
    mutations.every(
      (changed) =>
        Result.isFailure(decodeManifest(changed)) &&
        Result.isFailure(validateActivation(changed, f.approval, 100)) &&
        cannotPass(
          summarizeDiagnostics(
            changed,
            f.invocationId,
            f.evidence,
            f.cleanup,
            f.approval,
            f.execution,
          ),
        ),
    )
  );
}
for (const [name, law] of Object.entries({
  'manifest content binding': manifestLaw,
  'observation window binding': observationLaw,
})) {
  async function runLaw() {
    function* checkSeeds() {
      for (const seed of [0, 1, 163]) {
        const result = yield* Arbitrary.checkEffect(generated, law, {
          seed,
          runs: 1000,
          size: 50,
          maxShrinks: 1000,
          maxDiscards: 10000,
        });
        expect(result).toMatchObject({ _tag: 'Passed', runs: 1000 });
      }
    }
    const program = Effect.gen(checkSeeds);
    await Effect.runPromise(program);
  }
  test(`law: ${name} (seeds 0/1/163, 1000 runs each)`, runLaw);
}
