import { Match, Result, Schema } from 'effect';

const digest = Schema.String.check(Schema.isPattern(/^(?!0+$)[a-f0-9]{64}$/));
const gitIdentity = Schema.String.check(Schema.isPattern(/^(?!0+$)[a-f0-9]{40}$/));
const count = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const positive = count.check(Schema.isGreaterThan(0));
const qualificationWorkspaces = [
  'domain',
  'engine',
  'probe',
  'github-admission',
  'github-adapter',
  'github-ingress',
] as const;
const qualificationGateIds = [
  'install',
  'check',
  'domain:typecheck',
  'engine:typecheck',
  'probe:typecheck',
  'github-admission:typecheck',
  'github-adapter:typecheck',
  'github-ingress:typecheck',
  'domain:test',
  'engine:test',
  'probe:test',
  'github-admission:test',
  'github-adapter:test',
  'github-ingress:test',
  'whitespace',
  'integrity',
] as const;
const qualificationControls = [
  'EvidenceBinding',
  'PolicyRevision',
  'ReplayUniqueness',
  'TransactionRollback',
  'AbortOwnership',
] as const;
const controlName = Schema.Literals(qualificationControls);
const report = Schema.Struct({
  source: Schema.Struct({
    commit: gitIdentity,
    tree: gitIdentity,
    filesHash: digest,
    lockHash: Schema.Literal('8cb4d58bd88280daee28101e542cd9b7120ec7ee63dd5094daf59c2a45fddf59'),
  }),
  gates: Schema.Array(
    Schema.Struct({
      id: Schema.Literals(qualificationGateIds),
      exit: Schema.Literal(0),
      logHash: digest,
      sourceHash: digest,
    }),
  ),
  suites: Schema.Array(
    Schema.Struct({
      workspace: Schema.Literals(qualificationWorkspaces),
      passed: positive,
      failed: Schema.Literal(0),
      assertions: positive,
    }),
  ),
  totals: Schema.Struct({ passed: positive, failed: Schema.Literal(0), assertions: positive }),
  laws: Schema.Struct({
    newPrimary: Schema.Literal(24000),
    legacyPrimary: positive,
    shrinks: count,
  }),
  controls: Schema.Array(
    Schema.Struct({
      name: controlName,
      beforeHash: digest,
      mutatedHash: digest,
      restoredHash: digest,
      red: Schema.Array(Schema.Struct({ exit: positive, logHash: digest, reason: controlName })),
      green: Schema.Struct({ exit: Schema.Literal(0), logHash: digest }),
    }),
  ),
  live: Schema.Literal(false),
  deployed: Schema.Literal(false),
});
function complete(actual: ReadonlyArray<string>, required: ReadonlyArray<string>) {
  return (
    actual.length === required.length &&
    new Set(actual).size === required.length &&
    required.every((id) => actual.includes(id))
  );
}
function validate(value: typeof report.Type) {
  const passed = value.suites.reduce((sum, suite) => sum + suite.passed, 0);
  const assertions = value.suites.reduce((sum, suite) => sum + suite.assertions, 0);
  function restored(control: (typeof value.controls)[number]) {
    return [
      control.beforeHash === control.restoredHash,
      control.beforeHash !== control.mutatedHash,
      control.red.length === 2,
      control.red.every((red) => red.reason === control.name),
    ].every(Boolean);
  }
  const controlsRestored = value.controls.every(restored);
  return Match.value(true).pipe(
    Match.when(
      () =>
        !complete(
          value.gates.map((gate) => gate.id),
          qualificationGateIds,
        ),
      () => Result.fail('GateCoverage' as const),
    ),
    Match.when(
      () => value.gates.some((gate) => gate.sourceHash !== value.source.filesHash),
      () => Result.fail('SourceMismatch' as const),
    ),
    Match.when(
      () =>
        !complete(
          value.suites.map((suite) => suite.workspace),
          qualificationWorkspaces,
        ) ||
        passed !== value.totals.passed ||
        assertions !== value.totals.assertions,
      () => Result.fail('SuiteTotals' as const),
    ),
    Match.when(
      () =>
        !complete(
          value.controls.map((control) => control.name),
          qualificationControls,
        ),
      () => Result.fail('ControlCoverage' as const),
    ),
    Match.when(
      () => !controlsRestored,
      () => Result.fail('ControlRestoration' as const),
    ),
    Match.orElse(() => Result.succeed(value)),
  );
}
// Pure consistency validation, not filesystem measurement or attestation of supplied bytes.
export function validateLocalQualification(input: unknown) {
  const decoded = Schema.decodeUnknownResult(report, { onExcessProperty: 'error' })(input);
  return decoded.pipe(
    Result.mapError(() => 'InvalidReport' as const),
    Result.flatMap(validate),
  );
}
