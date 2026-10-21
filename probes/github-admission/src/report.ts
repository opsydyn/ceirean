import { DecisionId } from '@ceirean/domain';
import { Result, Schema } from 'effect';

export const RestartResult = Schema.Struct({
  disposition: Schema.Literals(['Recorded', 'Duplicate']),
  decisionId: DecisionId,
});
export type RestartResult = typeof RestartResult.Type;
export const RestartPhase = Schema.Struct({
  phase: Schema.Literals(['AfterCommit', 'AfterDecision']),
});

export const requiredGates = [
  'install',
  'check',
  'domain:typecheck',
  'engine:typecheck',
  'probe:typecheck',
  'github-admission:typecheck',
  'domain:test',
  'engine:test',
  'probe:test',
  'github-admission:test',
  'diff:check',
] as const;
export const requiredLaws = [
  'domain:command coherent admission',
  'domain:command single authority mutation',
  'domain:command invalid interval and time',
  'domain:command rename invariance',
  'domain:command tuple key injectivity',
  'domain:command generated extra text',
  'engine:at most one admission per command key',
  'engine:original decisions immutable',
  'engine:authority and time races never activate stale drafts',
  'engine:resolved blocker admits only a new comment',
] as const;

const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const GitId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const Text = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(4096));
const Count = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const FileIdentity = Schema.Struct({ path: Text, sha256: Sha256 });
const Gate = Schema.Literals(requiredGates);
const TestGate = Schema.Literals([
  'domain:test',
  'engine:test',
  'probe:test',
  'github-admission:test',
]);
const GateResult = Schema.Struct({ gate: Gate, exitCode: Schema.Literal(0), log: FileIdentity });
const TestCount = Schema.Struct({
  gate: TestGate,
  passed: Count.check(Schema.isGreaterThan(0)),
  failed: Schema.Literal(0),
  log: FileIdentity,
});
const Law = Schema.Struct({
  law: Schema.Literals(requiredLaws),
  seed: Schema.Literals([0, 1, 163]),
  runs: Schema.Literal(1000),
  size: Schema.Literal(50),
  maxShrinks: Schema.Literal(1000),
  maxDiscards: Schema.Literal(10000),
  validation: Schema.Literal('Passed.runs===1000'),
  source: FileIdentity,
  gate: TestGate,
  log: FileIdentity,
});
const controlNames = [
  'command-key',
  'native-dedup',
  'authority-revision',
  'rollback',
  'reject-everything',
] as const;
const Control = Schema.Struct({
  control: Schema.Literals(controlNames),
  source: Text,
  originalSha256: Sha256,
  mutantSha256: Sha256,
  restoredSha256: Sha256,
  redExit: Count.check(Schema.isGreaterThan(0)),
  greenExit: Schema.Literal(0),
  behavioralFailure: Text,
  redLog: FileIdentity,
  greenLog: FileIdentity,
}).check(
  Schema.makeFilter(
    (control) =>
      control.originalSha256 === control.restoredSha256 &&
      control.originalSha256 !== control.mutantSha256,
  ),
);
const Artifact = Schema.Struct({
  name: Schema.Literals(['@flue/github', '@flue/runtime']),
  version: Schema.Literal('2.3.0'),
  registryIntegrity: Schema.String.check(Schema.isPattern(/^sha512-[A-Za-z0-9+/]{86}==$/)),
  fetchedIntegrity: Schema.String.check(Schema.isPattern(/^sha512-[A-Za-z0-9+/]{86}==$/)),
  exportsSha256: Sha256,
}).check(Schema.makeFilter((artifact) => artifact.registryIntegrity === artifact.fetchedIntegrity));
const Cohort = Schema.Struct({
  effectVersion: Schema.Literal('4.0.5'),
  effectRealpath: Text,
  physicalEffectPaths: Schema.Array(Text),
  consumers: Schema.Array(Schema.Struct({ name: Text, effectRealpath: Text })),
  audit: FileIdentity,
}).check(
  Schema.makeFilter((cohort) =>
    [
      cohort.physicalEffectPaths.length === 1,
      cohort.physicalEffectPaths[0] === cohort.effectRealpath,
      cohort.consumers.length > 0,
      cohort.consumers.every((consumer) => consumer.effectRealpath === cohort.effectRealpath),
    ].every(Boolean),
  ),
);
const Identity = Schema.Struct({
  testedCommit: GitId,
  testedTree: GitId,
  lockSha256: Sha256,
  sources: Schema.Array(FileIdentity).check(Schema.isMinLength(1)),
  artifacts: Schema.Array(Artifact),
  cohort: Cohort,
}).check(
  Schema.makeFilter(
    (identity) =>
      exactlyOnce(
        identity.artifacts.map((artifact) => artifact.name),
        ['@flue/github', '@flue/runtime'],
      ) && new Set(identity.sources.map((source) => source.path)).size === identity.sources.length,
  ),
);

function exactlyOnce(actual: ReadonlyArray<string>, required: ReadonlyArray<string>) {
  return (
    actual.length === required.length &&
    required.every((name) => actual.filter((value) => value === name).length === 1)
  );
}
const EvidenceFields = Schema.Struct({
  identity: Identity,
  gates: Schema.Array(GateResult),
  tests: Schema.Array(TestCount),
  laws: Schema.Array(Law),
  controls: Schema.Array(Control),
});
function validEvidence(evidence: typeof EvidenceFields.Type) {
  const lawKeys = requiredLaws.flatMap((law) => [0, 1, 163].map((seed) => `${law}:${seed}`));
  const sameFile = Schema.toEquivalence(FileIdentity);
  function fromGate(entry: { readonly gate: string; readonly log: typeof FileIdentity.Type }) {
    return evidence.gates.some((gate) => gate.gate === entry.gate && sameFile(gate.log, entry.log));
  }
  function fromSource(source: typeof FileIdentity.Type) {
    return evidence.identity.sources.some((known) => sameFile(known, source));
  }
  return (
    exactlyOnce(
      evidence.gates.map((gate) => gate.gate),
      requiredGates,
    ) &&
    exactlyOnce(
      evidence.tests.map((test) => test.gate),
      ['domain:test', 'engine:test', 'probe:test', 'github-admission:test'],
    ) &&
    exactlyOnce(
      evidence.laws.map((law) => `${law.law}:${law.seed}`),
      lawKeys,
    ) &&
    evidence.laws.every((law) => law.gate === `${law.law.split(':')[0]}:test`) &&
    evidence.tests.every(fromGate) &&
    evidence.laws.every(fromGate) &&
    evidence.laws.every((law) => fromSource(law.source)) &&
    evidence.controls.every((control) =>
      fromSource({ path: control.source, sha256: control.restoredSha256 }),
    ) &&
    exactlyOnce(
      evidence.controls.map((control) => control.control),
      controlNames,
    )
  );
}
const MeasuredEvidence = EvidenceFields.check(Schema.makeFilter(validEvidence));
export type MeasuredEvidence = typeof MeasuredEvidence.Type;

/** Validates supplied observations only; it never invokes tools or measures a gate itself. */
export function buildReport(input: unknown) {
  return Schema.decodeUnknownResult(MeasuredEvidence)(input).pipe(
    Result.map((evidence) => ({
      qualification: 'offline-local-process-restart-only' as const,
      productionQualified: false as const,
      exclusions: [
        'live-permissions',
        'models',
        'workers',
        'publishing',
        'hosting',
        'power-loss',
        'host-loss',
        'distributed-storage',
        'exactly-once-execution',
      ] as const,
      primaryLawCases: evidence.laws.reduce((total, law) => total + law.runs, 0),
      lawCountBasis: 'validated-law-source-and-passing-gate-attribution' as const,
      evidence: structuredClone(evidence),
    })),
  );
}
