import { test } from 'bun:test';

import { Array, Effect, Match, Option } from 'effect';

import {
  AttemptId,
  CancelledRun,
  CheckId,
  ContractId,
  Digest,
  QualifiedRun,
  RunId,
  VerificationReceipt,
  decideCancellation,
  decideQualification,
} from '../src/index.ts';
import type { CandidateIdentity, UpgradeRun } from '../src/index.ts';
import { runCaseArbitrary, sequenceCaseArbitrary } from './fixtures.ts';
import type { RunCase, SequenceCase } from './fixtures.ts';
import { checkLaw } from './properties.ts';

type Decision = ReturnType<typeof decideQualification> | ReturnType<typeof decideCancellation>;

const invariantFields = [
  'runId',
  'attemptId',
  'generation',
  'candidateDigest',
  'contractId',
  'contractDigest',
  'deadlineMs',
  'spentMicros',
  'repairs',
] as const;

function unchangedRefusal(result: Decision, before: UpgradeRun) {
  return Match.value(result).pipe(
    Match.tag('Refused', (decision) => decision.state === before && decision.facts.length === 0),
    Match.tag('Accepted', () => false),
    Match.exhaustive,
  );
}

function preservesFrozenFields(before: UpgradeRun, after: UpgradeRun) {
  return Array.every(invariantFields, (field) => before[field] === after[field]);
}

function coherentLaw(c: RunCase) {
  const result = decideQualification(c.run, c.contract, c.receipt, c.nowMs);
  return Match.value(result).pipe(
    Match.tag('Accepted', ({ state, facts }) =>
      Array.every(
        [
          preservesFrozenFields(c.run, state),
          state.qualifiedAtMs === c.nowMs,
          state.receipt === c.receipt,
          facts.length === 1,
          facts[0].atMs === c.nowMs,
          facts[0].receipt === c.receipt,
          Array.every(
            [
              'runId',
              'attemptId',
              'generation',
              'candidateDigest',
              'contractId',
              'contractDigest',
            ] as const,
            (field) => facts[0][field] === c.run[field],
          ),
        ],
        Boolean,
      ),
    ),
    Match.tag('Refused', () => false),
    Match.exhaustive,
  );
}

async function coherent() {
  await Effect.runPromise(checkLaw('coherent run', runCaseArbitrary, coherentLaw));
}
test('coherent unexpired frozen runs qualify preserving identity and limits', coherent);

function distinctDigest(digest: Digest) {
  const primary = Digest.make('a'.repeat(64));
  const alternative = Digest.make('b'.repeat(64));
  return Match.value(digest).pipe(
    Match.when(primary, () => alternative),
    Match.orElse(() => primary),
  );
}

function distinctReceipt(receipt: VerificationReceipt, field: keyof CandidateIdentity) {
  return Match.value(field).pipe(
    Match.when('runId', () => ({ ...receipt, runId: RunId.make(`${receipt.runId}-other`) })),
    Match.when('attemptId', () => ({
      ...receipt,
      attemptId: AttemptId.make(`${receipt.attemptId}-other`),
    })),
    Match.when('generation', () => ({
      ...receipt,
      generation: Number.MAX_SAFE_INTEGER - receipt.generation,
    })),
    Match.when('candidateDigest', () => ({
      ...receipt,
      candidateDigest: distinctDigest(receipt.candidateDigest),
    })),
    Match.when('contractId', () => ({
      ...receipt,
      contractId: ContractId.make(`${receipt.contractId}-other`),
    })),
    Match.when('contractDigest', () => ({
      ...receipt,
      contractDigest: distinctDigest(receipt.contractDigest),
    })),
    Match.exhaustive,
  );
}

function identityLaw(c: RunCase, field: keyof CandidateIdentity) {
  const receipt = distinctReceipt(c.receipt, field);
  const result = decideQualification(c.run, c.contract, receipt, c.nowMs);
  return unchangedRefusal(result, c.run);
}

async function identityMismatch(field: keyof CandidateIdentity) {
  await Effect.runPromise(
    checkLaw(`run distinct ${field}`, runCaseArbitrary, (c) => identityLaw(c, field)),
  );
}
test.each([
  'runId',
  'attemptId',
  'generation',
  'candidateDigest',
  'contractId',
  'contractDigest',
] as const)('run refuses distinct %s with no facts and original reference', identityMismatch);

function incompleteReceipt(
  c: RunCase,
  kind: 'MissingCheck' | 'DuplicateCheck' | 'UnknownCheck' | 'Failed' | 'NotRun',
) {
  const first = Option.getOrThrow(Array.head(c.receipt.checks));
  const unknown = CheckId.make(`${c.contract.requiredChecks.join('|')}unknown`);
  const checks = Match.value(kind).pipe(
    Match.when('MissingCheck', () => c.receipt.checks.slice(1)),
    Match.when('DuplicateCheck', () => [...c.receipt.checks, first]),
    Match.when('UnknownCheck', () => [
      ...c.receipt.checks,
      { checkId: unknown, outcome: 'Passed' as const },
    ]),
    Match.orElse((outcome) => [{ ...first, outcome }, ...c.receipt.checks.slice(1)]),
  );
  return VerificationReceipt.make({ ...c.receipt, checks });
}

async function incomplete(kind: Parameters<typeof incompleteReceipt>[1]) {
  function law(c: RunCase) {
    const receipt = incompleteReceipt(c, kind);
    const result = decideQualification(c.run, c.contract, receipt, c.nowMs);
    return unchangedRefusal(result, c.run);
  }
  await Effect.runPromise(checkLaw(`run ${kind}`, runCaseArbitrary, law));
}
test.each(['MissingCheck', 'DuplicateCheck', 'UnknownCheck', 'Failed', 'NotRun'] as const)(
  'run refuses %s evidence without mutation',
  incomplete,
);

function expirationLaw(c: RunCase) {
  return Array.every([c.run.deadlineMs, c.run.deadlineMs + 1, Number.MAX_SAFE_INTEGER], (nowMs) =>
    unchangedRefusal(decideQualification(c.run, c.contract, c.receipt, nowMs), c.run),
  );
}
async function expiration() {
  await Effect.runPromise(checkLaw('exclusive run deadline', runCaseArbitrary, expirationLaw));
}
test('qualification refuses at and beyond the original deadline', expiration);

function invalidTimeLaw(c: RunCase) {
  return Array.every([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1], (nowMs) =>
    Array.every(
      [
        unchangedRefusal(decideQualification(c.run, c.contract, c.receipt, nowMs), c.run),
        unchangedRefusal(decideCancellation(c.run, nowMs), c.run),
      ],
      Boolean,
    ),
  );
}
async function invalidTimes() {
  await Effect.runPromise(checkLaw('run invalid explicit time', runCaseArbitrary, invalidTimeLaw));
}
test('both run decisions refuse invalid times without mutation', invalidTimes);

function cancellationLaw(c: RunCase) {
  const result = decideCancellation(c.run, c.nowMs);
  return Match.value(result).pipe(
    Match.tag('Accepted', ({ state, facts }) =>
      Array.every(
        [
          preservesFrozenFields(c.run, state),
          state.cancelledAtMs === c.nowMs,
          facts.length === 1,
          facts[0].runId === c.run.runId,
          facts[0].attemptId === c.run.attemptId,
          facts[0].generation === c.run.generation,
          facts[0].atMs === c.nowMs,
          Array.every([c.receipt, c.receipt, distinctReceipt(c.receipt, 'generation')], (receipt) =>
            unchangedRefusal(decideQualification(state, c.contract, receipt, c.nowMs), state),
          ),
          unchangedRefusal(decideCancellation(state, c.nowMs), state),
        ],
        Boolean,
      ),
    ),
    Match.tag('Refused', () => false),
    Match.exhaustive,
  );
}
async function cancellation() {
  await Effect.runPromise(
    checkLaw('cancelled run stays terminal', runCaseArbitrary, cancellationLaw),
  );
}
test('cancellation preserves limits and refuses repeated matching and old receipts', cancellation);

function terminalLaw(c: RunCase) {
  const qualified = QualifiedRun.make({
    ...c.run,
    _tag: 'Qualified',
    receipt: c.receipt,
    qualifiedAtMs: c.nowMs,
  });
  const cancelled = CancelledRun.make({ ...c.run, _tag: 'Cancelled', cancelledAtMs: c.nowMs });
  return Array.every([qualified, cancelled], (state) =>
    Array.every([c.nowMs, NaN, c.run.deadlineMs], (nowMs) =>
      Array.every(
        [
          unchangedRefusal(decideQualification(state, c.contract, c.receipt, nowMs), state),
          unchangedRefusal(decideCancellation(state, nowMs), state),
        ],
        Boolean,
      ),
    ),
  );
}
async function terminal() {
  await Effect.runPromise(checkLaw('terminal phase precedence', runCaseArbitrary, terminalLaw));
}
test('terminal phases refuse both decisions irrespective of explicit time', terminal);

function permutationLaw(c: RunCase) {
  const decision = decideQualification(
    c.run,
    { ...c.contract, requiredChecks: [...c.contract.requiredChecks].reverse() },
    { ...c.receipt, checks: [...c.receipt.checks].reverse() },
    c.nowMs,
  );
  return Match.value(decision).pipe(
    Match.tag('Accepted', () => true),
    Match.tag('Refused', () => false),
    Match.exhaustive,
  );
}
async function permutation() {
  await Effect.runPromise(checkLaw('run evidence order', runCaseArbitrary, permutationLaw));
}
test('complete unique evidence ordering cannot change qualification', permutation);

function receiptFor(c: SequenceCase, run: UpgradeRun) {
  return VerificationReceipt.make({
    ...c.evidence.receipt,
    attemptId: run.attemptId,
    generation: run.generation,
  });
}

function observationLaw(
  c: SequenceCase,
  state: UpgradeRun,
  observation: SequenceCase['observations'][number],
) {
  const oldRuns = c.history.slice(0, -1);
  const selected = Match.value(observation.old && oldRuns.length > 0).pipe(
    Match.when(true, () =>
      Option.getOrThrow(Array.get(oldRuns, observation.index % oldRuns.length)),
    ),
    Match.when(false, () => c.current),
    Match.exhaustive,
  );
  const decision = decideQualification(
    state,
    c.evidence.contract,
    receiptFor(c, selected),
    c.evidence.nowMs,
  );
  const shouldRefuse = c.cancel || selected !== c.current;
  const accepted = Match.value(decision).pipe(
    Match.tag('Accepted', ({ state: next }) => preservesFrozenFields(state, next)),
    Match.tag('Refused', () => false),
    Match.exhaustive,
  );
  return Match.value(shouldRefuse).pipe(
    Match.when(true, () => unchangedRefusal(decision, state)),
    Match.when(false, () => accepted),
    Match.exhaustive,
  );
}

function sequenceLaw(c: SequenceCase) {
  // The untouched branch is checked for every generated case, not filtered away.
  const valid = decideQualification(
    c.initial,
    c.evidence.contract,
    receiptFor(c, c.initial),
    c.evidence.nowMs,
  );
  const cancellation = Match.value(c.cancel).pipe(
    Match.when(true, () => decideCancellation(c.current, c.evidence.nowMs)),
    Match.when(false, () => ({ _tag: 'Accepted' as const, state: c.current })),
    Match.exhaustive,
  );
  const state = cancellation.state;
  function refusesOld(old: UpgradeRun) {
    const receipt = receiptFor(c, old);
    const decision = decideQualification(state, c.evidence.contract, receipt, c.evidence.nowMs);
    return unchangedRefusal(decision, state);
  }
  const oldReceiptsRefuse = Array.every(c.history.slice(0, -1), refusesOld);
  return Array.every(
    [
      Match.value(valid).pipe(
        Match.tag('Accepted', () => true),
        Match.tag('Refused', () => false),
        Match.exhaustive,
      ),
      Match.value(cancellation).pipe(
        Match.tag('Accepted', () => true),
        Match.tag('Refused', () => false),
        Match.exhaustive,
      ),
      oldReceiptsRefuse,
      Array.every(c.observations, (observation) => observationLaw(c, state, observation)),
      c.increments.length + Number(c.cancel) + c.observations.length <= 50,
      Array.every(
        ['deadlineMs', 'spentMicros', 'repairs'] as const,
        (field) => c.current[field] === c.initial[field],
      ),
    ],
    Boolean,
  );
}

async function sequences() {
  await Effect.runPromise(
    checkLaw('bounded replacement cancellation observations', sequenceCaseArbitrary, sequenceLaw),
  );
}
test('bounded sequences reject every old receipt and every receipt after cancellation', sequences);
