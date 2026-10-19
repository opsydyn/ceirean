import { expect, test } from 'bun:test';

import { Arbitrary, Cause, Data, Effect, Exit, Fiber, Match, Option, Result, Schema } from 'effect';

import { AttemptId, CheckId, ContractId, Digest, RunId, validateReceipt } from '../src/index.ts';
import type { CandidateIdentity, VerificationReceipt } from '../src/index.ts';
import { evidenceCaseArbitrary, makeEvidenceCase } from './fixtures.ts';
import { checkLaw, validateCheckResult } from './properties.ts';

type EvidenceCase = ReturnType<typeof makeEvidenceCase>;

function coherentLaw(c: EvidenceCase) {
  return Result.isSuccess(validateReceipt(c.identity, c.contract, c.receipt));
}

test('coherent passing evidence is accepted', async function passingEvidence() {
  await Effect.runPromise(
    checkLaw('coherent passing evidence', evidenceCaseArbitrary, coherentLaw),
  );
});

function distinctDigest(digest: Digest) {
  const alternative = Digest.make('b'.repeat(64));
  const primary = Digest.make('a'.repeat(64));
  return Match.value(digest).pipe(
    Match.when(primary, () => alternative),
    Match.orElse(() => primary),
  );
}

const identityMutations = [
  {
    field: 'runId',
    mutate: (r: VerificationReceipt) => ({ ...r, runId: RunId.make(`${r.runId}-other`) }),
  },
  {
    field: 'attemptId',
    mutate: (r: VerificationReceipt) => ({
      ...r,
      attemptId: AttemptId.make(`${r.attemptId}-other`),
    }),
  },
  {
    field: 'generation',
    mutate: (r: VerificationReceipt) => ({
      ...r,
      generation: Number.MAX_SAFE_INTEGER - r.generation,
    }),
  },
  {
    field: 'candidateDigest',
    mutate: (r: VerificationReceipt) => ({
      ...r,
      candidateDigest: distinctDigest(r.candidateDigest),
    }),
  },
  {
    field: 'contractId',
    mutate: (r: VerificationReceipt) => ({
      ...r,
      contractId: ContractId.make(`${r.contractId}-other`),
    }),
  },
  {
    field: 'contractDigest',
    mutate: (r: VerificationReceipt) => ({
      ...r,
      contractDigest: distinctDigest(r.contractDigest),
    }),
  },
] as const;

function identityLaw(
  c: EvidenceCase,
  field: keyof CandidateIdentity,
  mutate: (r: VerificationReceipt) => VerificationReceipt,
) {
  const result = validateReceipt(c.identity, c.contract, mutate(c.receipt));
  return Match.value(result).pipe(
    Match.when({ _tag: 'Failure', failure: { _tag: 'IdentityMismatch', field } }, () => true),
    Match.orElse(() => false),
  );
}

test.each([...identityMutations])(
  'distinct $field refuses',
  async function mutatedIdentity({ field, mutate }) {
    await Effect.runPromise(
      checkLaw(`distinct ${field}`, evidenceCaseArbitrary, (c) => identityLaw(c, field, mutate)),
    );
  },
);

function mutateChecks(
  c: EvidenceCase,
  mutation: 'MissingCheck' | 'DuplicateCheck' | 'UnknownCheck' | 'Failed' | 'NotRun',
) {
  const first = Option.getOrThrow(Option.fromUndefinedOr(c.receipt.checks[0]));
  const unknown = CheckId.make(`${c.contract.requiredChecks.join('|')}unknown`);
  return Match.value(mutation).pipe(
    Match.when('MissingCheck', () => ({
      checks: c.receipt.checks.slice(1),
      reason: 'MissingCheck' as const,
      checkId: first.checkId,
    })),
    Match.when('DuplicateCheck', () => ({
      checks: [...c.receipt.checks, first],
      reason: 'DuplicateCheck' as const,
      checkId: first.checkId,
    })),
    Match.when('UnknownCheck', () => ({
      checks: [...c.receipt.checks, { checkId: unknown, outcome: 'Passed' as const }],
      reason: 'UnknownCheck' as const,
      checkId: unknown,
    })),
    Match.orElse((outcome) => ({
      checks: [{ ...first, outcome }, ...c.receipt.checks.slice(1)],
      reason: 'NonPassingCheck' as const,
      checkId: first.checkId,
    })),
  );
}

function incompleteLaw(c: EvidenceCase, mutation: Parameters<typeof mutateChecks>[1]) {
  const { checks, reason, checkId } = mutateChecks(c, mutation);
  const result = validateReceipt(c.identity, c.contract, { ...c.receipt, checks });
  return Match.value(result).pipe(
    Match.when(
      { _tag: 'Failure', failure: { _tag: 'IncompleteVerification', reason, checkId } },
      () => true,
    ),
    Match.orElse(() => false),
  );
}

test.each(['MissingCheck', 'DuplicateCheck', 'UnknownCheck', 'Failed', 'NotRun'] as const)(
  '%s evidence refuses',
  async function incompleteEvidence(mutation) {
    await Effect.runPromise(
      checkLaw(`${mutation} evidence`, evidenceCaseArbitrary, (c) => incompleteLaw(c, mutation)),
    );
  },
);

function permutationLaw({
  evidence: c,
  ranks,
}: {
  readonly evidence: EvidenceCase;
  readonly ranks: readonly number[];
}) {
  const checks = c.receipt.checks
    .map((check, index) => ({ check, rank: ranks[index] ?? 0 }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ check }) => check);
  return Result.isSuccess(
    validateReceipt(
      c.identity,
      { ...c.contract, requiredChecks: [...c.contract.requiredChecks].reverse() },
      { ...c.receipt, checks },
    ),
  );
}

async function permutations() {
  const ranks = Arbitrary.array(Arbitrary.schema(Schema.Int), { minLength: 8, maxLength: 8 });
  const arbitrary = Arbitrary.all({ evidence: evidenceCaseArbitrary, ranks });
  await Effect.runPromise(checkLaw('permutation invariance', arbitrary, permutationLaw));
}
test('permutation invariance', permutations);

const integer = Arbitrary.schema(Schema.Int);
const controlOptions = { seed: 163, runs: 10, size: 50, maxShrinks: 1000, maxDiscards: 10 };

async function falseControl() {
  const result = await Effect.runPromise(
    Arbitrary.checkEffect(integer, () => false, controlOptions),
  );
  expect(result._tag).toBe('Falsified');
  const falsified = Match.value(result).pipe(
    Match.tag('Falsified', (value) => Option.some(value)),
    Match.orElse(() => Option.none()),
    Option.getOrThrow,
  );
  expect(falsified.shrinks).toBeGreaterThan(0);
  expect(falsified.replay.length).toBeGreaterThan(0);
  const report = validateCheckResult('false control', 163, result, 10);
  const failure = Result.getOrThrow(Result.flip(report));
  expect(failure._tag).toBe('LawFailure');
  expect(failure.name).toBe('false control');
  expect(failure.seed).toBe(163);
  expect(failure.diagnostic).toContain('Effect 4.0.5');
  expect(failure.diagnostic).toContain(Arbitrary.formatCheckFailure(result)!);
}
test('reporting rejects a real false property with shrinking and replay coordinates', falseControl);

async function exhaustedControl() {
  const result = await Effect.runPromise(
    Arbitrary.checkEffect(
      Arbitrary.filter(integer, () => false),
      () => true,
      controlOptions,
    ),
  );
  expect(result._tag).toBe('Exhausted');
  const report = validateCheckResult('exhaustion control', 163, result, 10);
  const failure = Result.getOrThrow(Result.flip(report));
  expect(failure.diagnostic).toContain(Arbitrary.formatCheckFailure(result)!);
}
test('reporting refuses actual exhausted generation', exhaustedControl);

async function replayControl() {
  const failed = await Effect.runPromise(
    Arbitrary.checkEffect(integer, () => false, controlOptions),
  );
  expect(failed._tag).toBe('Falsified');
  const replay = Match.value(failed).pipe(
    Match.tag('Falsified', (falsified) => falsified.replay),
    Match.orElse(() => ''),
  );
  const result = await Effect.runPromise(Arbitrary.checkEffect(integer, () => true, { replay }));
  expect(result._tag).toBe('ReplayMismatch');
  const report = validateCheckResult('replay control', 163, result, 10);
  expect(Result.isFailure(report)).toBe(true);
  const failure = Result.getOrThrow(Result.flip(report));
  expect(failure.diagnostic).toContain(Arbitrary.formatCheckFailure(result)!);
}
test('reporting refuses a real replay mismatch against an always true property', replayControl);

async function runCountControl() {
  const result = await Effect.runPromise(
    Arbitrary.checkEffect(integer, () => true, controlOptions),
  );
  expect(result._tag).toBe('Passed');
  const exact = validateCheckResult('passed control', 163, result, 10);
  const short = validateCheckResult('short control', 163, result, 1000);
  expect(Result.isSuccess(exact)).toBe(true);
  expect(Result.isFailure(short)).toBe(true);
}
test('reporting accepts only Passed with exact requested runs', runCountControl);

async function executionControl() {
  let calls = 0;
  function countCall() {
    calls += 1;
    return true;
  }
  const law = checkLaw('execution control', Arbitrary.Constant(1), countCall);
  expect(calls).toBe(0);
  await Effect.runPromise(law);
  expect(calls).toBe(3000);
}
test('checkLaw runs predicates lazily with all three full seed budgets', executionControl);

test('checkLaw fails a false Boolean law', async function falseLawControl() {
  const exit = await Effect.runPromiseExit(checkLaw('false law', integer, () => false));
  expect(Exit.isFailure(exit)).toBe(true);
});

class DeliberateDefect extends Data.TaggedError('DeliberateDefect')<{ readonly message: string }> {}

async function defectControl() {
  function throwDefect(): boolean {
    throw new DeliberateDefect({ message: 'deliberate property defect' });
  }
  const exit = await Effect.runPromiseExit(checkLaw('defect law', integer, throwDefect));
  expect(Exit.isFailure(exit)).toBe(true);
  const cause = Option.getOrThrow(Exit.getCause(exit));
  expect(Cause.hasDies(cause)).toBe(true);
  expect(Cause.pretty(cause)).toContain('deliberate property defect');
}
test('checkLaw does not swallow a thrown property defect', defectControl);

async function interruptionControl() {
  let generations = 0;
  function discard() {
    generations += 1;
    return false;
  }
  function* interruptRunningLaw() {
    const arbitrary = Arbitrary.filter(integer, discard);
    const law = checkLaw('interrupted law', arbitrary, () => true);
    const fiber = yield* Effect.forkChild(law, { startImmediately: true });
    yield* Fiber.interrupt(fiber);
    return yield* Fiber.await(fiber);
  }
  const program = Effect.gen(interruptRunningLaw);
  const exit = await Effect.runPromise(program);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(generations).toBeGreaterThan(0);
  expect(generations).toBeLessThan(10001);
  const cause = Option.getOrThrow(Exit.getCause(exit));
  expect(Cause.hasInterrupts(cause)).toBe(true);
}
test('checkLaw preserves interruption as failure', interruptionControl);
