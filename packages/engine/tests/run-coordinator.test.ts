import { expect, test } from 'bun:test';

import {
  AttemptId,
  CheckId,
  ContractId,
  Digest,
  RunId,
  type QualificationRefusal,
} from '@leviathan/domain';
import { Effect, Match, Option, Result, Tracer } from 'effect';
import { TestClock } from 'effect/testing';

import {
  CandidateVerifier,
  CandidateVerifierError,
  RunRepository,
  RunRepositoryError,
  qualifyRun,
  type RunSnapshot,
  type VerificationRequest,
} from '../src/index.ts';
import {
  coordinatorTestLayers,
  makeCancelledChange,
  makeEvidenceCase,
  makeQualifiedChange,
  makeSnapshot,
} from './fixtures.ts';
import { makeMemoryRepository } from './memory-repository.ts';

export async function happyPath() {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  const requests: VerificationRequest[] = [];
  function verify(request: VerificationRequest) {
    function deliver() {
      requests.push(request);
      return makeEvidenceCase().receipt;
    }
    const delivery = Effect.sync(deliver);
    return delivery;
  }
  const verifier = CandidateVerifier.of({ verify });
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    const outcome = yield* qualifyRun(seed.state.runId);
    expect(outcome._tag).toBe('Qualified');
    const expected = makeQualifiedChange();
    const snapshot = { ...seed, revision: 8, state: expected.state, history: expected.facts };
    expect(outcome).toEqual({ _tag: 'Qualified', snapshot });
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(snapshot));
    expect(requests).toEqual([{ identity: makeEvidenceCase().identity, contract: seed.contract }]);
    expect(yield* qualifyRun(seed.state.runId)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'InvalidPhase', phase: 'Qualified' },
    });
    expect(requests).toHaveLength(1);
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(snapshot));
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(memory.service, verifier);
  const traced = program.pipe(Effect.withTracer(tracer));
  const provided = Effect.provide(traced, services);
  await Effect.runPromise(provided);
  expect(spans.map((span) => [span.name, span.status._tag])).toEqual([
    ['RunCoordinator.qualifyRun', 'Ended'],
    ['RunCoordinator.qualifyRun', 'Ended'],
  ]);
}
test('qualifies stored authority at 999 with one complete fact and refuses a repeat', happyPath);

export async function storedAuthority() {
  const identity = {
    runId: RunId.make('stored-run'),
    attemptId: AttemptId.make('stored-attempt'),
    generation: 13,
    candidateDigest: Digest.make('b'.repeat(64)),
    contractId: ContractId.make('stored-contract'),
    contractDigest: Digest.make('d'.repeat(64)),
  };
  const contract = {
    contractId: identity.contractId,
    contractDigest: identity.contractDigest,
    requiredChecks: [CheckId.make('custom')],
  };
  const seed = {
    ...makeSnapshot(),
    revision: 41,
    state: { ...makeSnapshot().state, ...identity },
    contract,
    history: makeCancelledChange().facts.map((fact) => ({ ...fact, runId: identity.runId })),
  };
  const receipt = {
    ...identity,
    checks: [{ checkId: CheckId.make('custom'), outcome: 'Passed' as const }],
  };
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  const requests: VerificationRequest[] = [];
  function deliver(request: VerificationRequest) {
    requests.push(request);
    return receipt;
  }
  const verifier = CandidateVerifier.of({
    verify: (request) => Effect.sync(deliver.bind(undefined, request)),
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    const outcome = yield* qualifyRun(identity.runId);
    const snapshot = {
      ...seed,
      revision: 42,
      state: { ...seed.state, _tag: 'Qualified' as const, receipt, qualifiedAtMs: 999 },
      history: [
        ...seed.history,
        { _tag: 'RunQualified' as const, ...identity, receipt, atMs: 999 },
      ],
    };
    expect(outcome).toEqual({ _tag: 'Qualified', snapshot });
    expect(requests).toEqual([{ identity, contract }]);
    expect(yield* memory.inspect(identity.runId)).toEqual(Option.some(snapshot));
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(memory.service, verifier);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided);
}
test(
  'uses noncanonical stored authority and original revision while appending to existing history',
  storedAuthority,
);

export async function alreadyLateResult() {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  function* verification() {
    yield* TestClock.setTime(1001);
    return makeEvidenceCase().receipt;
  }
  const verifier = CandidateVerifier.of({ verify: () => Effect.gen(verification) });
  let commits = 0;
  const repository = RunRepository.of({
    ...memory.service,
    commit(change) {
      commits++;
      return memory.service.commit(change);
    },
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    expect(yield* qualifyRun(seed.state.runId)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'DeadlineExpired' },
    });
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(seed));
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(repository, verifier);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided);
  expect(commits).toBe(0);
}
test(
  'an immediately returned verifier result already past deadline cannot qualify',
  alreadyLateResult,
);

const shortCircuits = [
  { name: 'missing', seeds: () => [], now: 999, refusal: { _tag: 'RunNotFound' } },
  {
    name: 'cancelled',
    seeds: () => [
      {
        ...makeSnapshot(),
        state: makeCancelledChange().state,
        history: makeCancelledChange().facts,
      },
    ],
    now: 999,
    refusal: { _tag: 'InvalidPhase', phase: 'Cancelled' },
  },
  {
    name: 'qualified',
    seeds: () => [
      {
        ...makeSnapshot(),
        state: makeQualifiedChange().state,
        history: makeQualifiedChange().facts,
      },
    ],
    now: 999,
    refusal: { _tag: 'InvalidPhase', phase: 'Qualified' },
  },
  {
    name: 'expired',
    seeds: () => [makeSnapshot()],
    now: 1000,
    refusal: { _tag: 'DeadlineExpired' },
  },
] satisfies readonly {
  name: string;
  seeds: () => readonly RunSnapshot[];
  now: number;
  refusal: unknown;
}[];

export async function shortCircuit(example: (typeof shortCircuits)[number]) {
  const seeds = example.seeds();
  const memory = await Effect.runPromise(makeMemoryRepository(seeds));
  let verifications = 0;
  let commits = 0;
  const repository = RunRepository.of({
    ...memory.service,
    commit(change) {
      commits++;
      return memory.service.commit(change);
    },
  });
  function deliver() {
    verifications++;
    return makeEvidenceCase().receipt;
  }
  const verifier = CandidateVerifier.of({ verify: () => Effect.sync(deliver) });
  function* scenario() {
    yield* TestClock.setTime(example.now);
    expect(yield* qualifyRun(makeSnapshot().state.runId)).toEqual<unknown>({
      _tag: 'Refused',
      refusal: example.refusal,
    });
    expect(yield* memory.inspect(makeSnapshot().state.runId)).toEqual(
      Option.fromUndefinedOr(seeds[0]),
    );
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(repository, verifier);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided);
  expect(verifications).toBe(0);
  expect(commits).toBe(0);
}
for (const example of shortCircuits) {
  test(`${example.name} refuses without verifier or write and retains history`, () =>
    shortCircuit(example));
}

function identityCase(
  field: 'runId' | 'attemptId' | 'generation' | 'candidateDigest' | 'contractId' | 'contractDigest',
) {
  function receipt() {
    const value = Match.value(field).pipe(
      Match.when('generation', () => 4),
      Match.when('candidateDigest', () => 'b'.repeat(64)),
      Match.when('contractDigest', () => 'd'.repeat(64)),
      Match.orElse(() => 'other'),
    );
    return { ...makeEvidenceCase().receipt, [field]: value };
  }
  return { name: field, receipt, refusal: { _tag: 'IdentityMismatch' as const, field } };
}
const receiptCases = [
  { name: 'malformed', receipt: () => ({ checks: [] }), refusal: { _tag: 'InvalidReceipt' } },
  ...(
    ['runId', 'attemptId', 'generation', 'candidateDigest', 'contractId', 'contractDigest'] as const
  ).map(identityCase),
  {
    name: 'missing',
    receipt: () => ({
      ...makeEvidenceCase().receipt,
      checks: makeEvidenceCase().receipt.checks.slice(1),
    }),
    refusal: {
      _tag: 'IncompleteVerification',
      reason: 'MissingCheck',
      checkId: CheckId.make('lint'),
    },
  },
  {
    name: 'empty',
    receipt: () => ({ ...makeEvidenceCase().receipt, checks: [] }),
    refusal: {
      _tag: 'IncompleteVerification',
      reason: 'MissingCheck',
      checkId: CheckId.make('lint'),
    },
  },
  {
    name: 'duplicate',
    receipt: () => ({
      ...makeEvidenceCase().receipt,
      checks: [...makeEvidenceCase().receipt.checks, makeEvidenceCase().receipt.checks[0]],
    }),
    refusal: {
      _tag: 'IncompleteVerification',
      reason: 'DuplicateCheck',
      checkId: CheckId.make('lint'),
    },
  },
  {
    name: 'unknown',
    receipt: () => ({
      ...makeEvidenceCase().receipt,
      checks: [...makeEvidenceCase().receipt.checks, { checkId: 'other', outcome: 'Passed' }],
    }),
    refusal: {
      _tag: 'IncompleteVerification',
      reason: 'UnknownCheck',
      checkId: CheckId.make('other'),
    },
  },
  ...(['Failed', 'NotRun'] as const).map((outcome) => ({
    name: outcome,
    receipt: () => ({
      ...makeEvidenceCase().receipt,
      checks: makeEvidenceCase().receipt.checks.map((check) => ({ ...check, outcome })),
    }),
    refusal: {
      _tag: 'IncompleteVerification' as const,
      reason: 'NonPassingCheck' as const,
      checkId: CheckId.make('lint'),
    },
  })),
] satisfies readonly { name: string; receipt: () => unknown; refusal: QualificationRefusal }[];

export async function refusedReceipt(example: (typeof receiptCases)[number]) {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  let commits = 0;
  const repository = RunRepository.of({
    ...memory.service,
    commit(change) {
      commits++;
      return memory.service.commit(change);
    },
  });
  const verifier = CandidateVerifier.of({ verify: () => Effect.succeed(example.receipt()) });
  function* scenario() {
    yield* TestClock.setTime(999);
    expect(yield* qualifyRun(seed.state.runId)).toEqual({
      _tag: 'Refused',
      refusal: example.refusal,
    });
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(seed));
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(repository, verifier);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided);
  expect(commits).toBe(0);
}
for (const example of receiptCases) {
  test(`${example.name} receipt refuses without commit`, () => refusedReceipt(example));
}

export async function mutatedAuthority() {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  function mutate(request: VerificationRequest) {
    Reflect.set(request.identity, 'generation', 4);
    Reflect.set(request.contract.requiredChecks, 'length', 1);
    return {
      ...makeEvidenceCase().receipt,
      generation: 4,
      checks: [makeEvidenceCase().receipt.checks[0]],
    };
  }
  const verifier = CandidateVerifier.of({
    verify: (request) => Effect.sync(mutate.bind(undefined, request)),
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    expect(yield* qualifyRun(seed.state.runId)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'IdentityMismatch', field: 'generation' },
    });
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(seed));
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(memory.service, verifier);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided);
}
test(
  'verifier input mutation cannot redefine the authoritative identity during verification',
  mutatedAuthority,
);

export async function mutatedChecks() {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  function mutate(request: VerificationRequest) {
    Reflect.set(request.contract.requiredChecks, 'length', 1);
    return { ...makeEvidenceCase().receipt, checks: [makeEvidenceCase().receipt.checks[0]] };
  }
  const verifier = CandidateVerifier.of({
    verify: (request) => Effect.sync(mutate.bind(undefined, request)),
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    expect(yield* qualifyRun(seed.state.runId)).toEqual<unknown>({
      _tag: 'Refused',
      refusal: { _tag: 'IncompleteVerification', reason: 'MissingCheck', checkId: 'types' },
    });
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(seed));
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(memory.service, verifier);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided);
}
test('verifier cannot shrink authoritative required checks while executing', mutatedChecks);

export async function detachedVerifierData() {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  const receipt = makeEvidenceCase().receipt;
  const requests: VerificationRequest[] = [];
  function deliver(request: VerificationRequest) {
    requests.push(request);
    return receipt;
  }
  const verifier = CandidateVerifier.of({
    verify: (request) => Effect.sync(deliver.bind(undefined, request)),
  });
  function* scenario() {
    yield* TestClock.setTime(999);
    const outcome = yield* qualifyRun(seed.state.runId);
    expect(outcome._tag).toBe('Qualified');
    const before = yield* memory.inspect(seed.state.runId);
    Reflect.set(receipt.checks[0], 'outcome', 'Failed');
    Reflect.set(receipt.checks, 'length', 0);
    Reflect.set(requests[0]!.contract.requiredChecks, 'length', 0);
    expect(outcome._tag).toBe('Qualified');
    const expected = makeQualifiedChange();
    const stored = { ...seed, revision: 8, state: expected.state, history: expected.facts };
    expect(outcome).toEqual({ _tag: 'Qualified', snapshot: stored });
    expect(before).toEqual(Option.some(stored));
    expect(yield* memory.inspect(seed.state.runId)).toEqual(before);
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(memory.service, verifier);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided);
}
test(
  'verifier-owned input and output arrays cannot alter committed data afterward',
  detachedVerifierData,
);

export async function operationalFailure(stage: 'load' | 'verify' | 'commit') {
  const seed = makeSnapshot();
  const memory = await Effect.runPromise(makeMemoryRepository([seed]));
  const readError = new RunRepositoryError({
    runId: seed.state.runId,
    operation: 'load',
    code: 'ReadFailed',
  });
  const commitError = new RunRepositoryError({
    runId: seed.state.runId,
    operation: 'commit',
    code: 'CommitFailed',
  });
  const verificationError = new CandidateVerifierError({
    runId: seed.state.runId,
    code: 'VerificationFailed',
  });
  const error = Match.value(stage).pipe(
    Match.when('verify', () => verificationError),
    Match.when('load', () => readError),
    Match.when('commit', () => commitError),
    Match.exhaustive,
  );
  const calls = { load: 0, verify: 0, commit: 0 };
  function load(id: typeof seed.state.runId) {
    calls.load++;
    return Match.value(stage).pipe(
      Match.when('load', () => Effect.fail(readError)),
      Match.orElse(() => memory.service.load(id)),
    );
  }
  function commit() {
    calls.commit++;
    const failure = Effect.fail(commitError);
    return failure;
  }
  const repository = RunRepository.of({ load, commit });
  function verify() {
    calls.verify++;
    const result = Match.value(stage).pipe(
      Match.when('verify', () => Result.fail(verificationError)),
      Match.orElse(() => Result.succeed(makeEvidenceCase().receipt)),
    );
    const verification = Effect.fromResult(result);
    return verification;
  }
  const verifier = CandidateVerifier.of({ verify });
  function* scenario() {
    yield* TestClock.setTime(999);
    const result = yield* Effect.result(qualifyRun(seed.state.runId));
    expect(result).toEqual(Result.fail(error));
    const failure = Option.getOrThrow(Result.getFailure(result));
    expect(failure).toBe(error);
    expect(yield* memory.inspect(seed.state.runId)).toEqual(Option.some(seed));
  }
  const program = Effect.gen(scenario);
  const services = coordinatorTestLayers(repository, verifier);
  const provided = Effect.provide(program, services);
  await Effect.runPromise(provided);
  const expected = Match.value(stage).pipe(
    Match.when('load', () => ({ load: 1, verify: 0, commit: 0 })),
    Match.when('verify', () => ({ load: 1, verify: 1, commit: 0 })),
    Match.when('commit', () => ({ load: 1, verify: 1, commit: 1 })),
    Match.exhaustive,
  );
  expect(calls).toEqual(expected);
}
for (const stage of ['load', 'verify', 'commit'] as const) {
  test(`${stage} operational failure propagates exactly once without a fact or retry`, () =>
    operationalFailure(stage));
}
