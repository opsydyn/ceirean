import { expect, test } from 'bun:test';

import { Arbitrary, Deferred, Effect, Fiber, Option, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { qualifyReadOnlyOperator } from '../src/readonly/operator.ts';
import { describeReadiness } from '../src/readonly/readiness.ts';

const policy = {
  sessionId: 'operator-test',
  installationId: 10,
  ownerId: 20,
  repositoryId: 30,
  issueNumber: 40,
  operatorId: 50,
  opensAtMs: 1000,
  closesAtMs: 301000,
};
const job = {
  _tag: 'Succeeded' as const,
  sessionId: policy.sessionId,
  queuedAtMs: 1100,
  closesAtMs: 301000,
  startedAtMs: 1200,
  runtime: 'v22.23.4',
};
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

async function successfulProbe() {
  const calls: string[] = [];
  const source = {
    readiness: async () => {
      calls.push('readiness');
      return describeReadiness(policy);
    },
    status: async () => {
      calls.push('status');
      return encode(job);
    },
    enqueueReadyV1: async () => {
      calls.push('FORBIDDEN admission');
      return '';
    },
    fetch: async () => {
      calls.push('FORBIDDEN HTTP');
      return new Response();
    },
  };
  const report = await Effect.runPromise(qualifyReadOnlyOperator(source, policy));
  expect(report).toEqual({ protocol: 'readonly-policy-v1', policy, job });
  expect(calls).toEqual(['readiness', 'status', 'readiness']);
}
test('operator reads an unchanged retained job without admission or HTTP', successfulProbe);

async function stalePeers() {
  let statusReads = 0;
  const source = {
    readiness: async () => describeReadiness({ ...policy, operatorId: 99 }),
    status: async () => {
      statusReads += 1;
      return encode(job);
    },
  };
  const result = await Effect.runPromise(
    qualifyReadOnlyOperator(source, policy).pipe(Effect.result),
  );
  const failure = Option.getOrThrow(Result.getFailure(result));
  expect(failure).toMatchObject({ code: 'Mismatch' });
  expect(statusReads).toBe(0);
}
test('two peers agreeing on the wrong policy do not pass the operator gate', stalePeers);

async function invalidReplies() {
  for (const status of [
    'not json',
    encode({}),
    encode({ ...job, sessionId: 'other' }),
    'x'.repeat(16385),
  ]) {
    const source = { readiness: async () => describeReadiness(policy), status: async () => status };
    const result = await Effect.runPromise(
      qualifyReadOnlyOperator(source, policy).pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
  }
}
test('operator rejects malformed, oversized and wrong-session status', invalidReplies);

async function missingOrFailedRpc() {
  for (const source of [
    {},
    { readiness: () => Promise.reject({ detail: 'SECRET transport detail' }) },
  ]) {
    const result = await Effect.runPromise(
      qualifyReadOnlyOperator(source, policy).pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(encode(result)).not.toContain('SECRET');
  }
}
test(
  'missing RPC and transport failure fail closed without disclosing details',
  missingOrFailedRpc,
);

async function skewDuringStatus() {
  let reads = 0;
  const source = {
    readiness: async () => {
      reads += 1;
      return describeReadiness({ ...policy, operatorId: policy.operatorId + reads - 1 });
    },
    status: async () => encode(job),
  };
  const result = await Effect.runPromise(
    qualifyReadOnlyOperator(source, policy).pipe(Effect.result),
  );
  expect(Result.isFailure(result)).toBe(true);
  expect(reads).toBe(2);
}
test('operator refuses policy skew observed after reading status', skewDuringStatus);

const withClock = Effect.provide(TestClock.layer());
async function probeDeadline() {
  function* scenario() {
    const entered = yield* Deferred.make<void>();
    const client = {
      readiness: async () => {
        await Effect.runPromise(Deferred.succeed(entered, undefined));
        return await new Promise<string>(() => {});
      },
      status: async () => encode(null),
    };
    const fiber = yield* qualifyReadOnlyOperator(client, policy).pipe(
      Effect.result,
      Effect.forkScoped,
    );
    yield* Deferred.await(entered).pipe(Effect.timeout('1 second'));
    yield* TestClock.adjust(15001);
    const result = yield* Fiber.join(fiber);
    const failure = Option.getOrThrow(Result.getFailure(result));
    expect(failure).toMatchObject({ code: 'Unavailable' });
  }
  await Effect.runPromise(Effect.gen(scenario).pipe(Effect.scoped, withClock));
}
test('operator has a cooperative total deadline without retries', probeDeadline, 3000);

async function rpcEnvelopes() {
  const source = {
    readiness: async () => describeReadiness(policy),
    status: async () => ({ _tag: '~alchemy/rpc/error', error: { detail: 'SECRET remote error' } }),
  };
  const refused = await Effect.runPromise(
    qualifyReadOnlyOperator(source, policy).pipe(Effect.result),
  );
  expect(Result.isFailure(refused)).toBe(true);
  expect(encode(refused)).not.toContain('SECRET');
  const empty = { readiness: source.readiness, status: async () => encode(null) };
  const observed = await Effect.runPromise(qualifyReadOnlyOperator(empty, policy));
  expect(observed.job).toBeNull();
}
test('operator decodes actual Alchemy error envelopes and permits an empty ledger', rpcEnvelopes);

async function desiredPolicyProperty() {
  const offsetSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 }));
  const offset = Arbitrary.schema(offsetSchema);
  function law(delta: number) {
    const source = {
      readiness: async () =>
        describeReadiness({ ...policy, operatorId: policy.operatorId + delta }),
      status: async () => encode(job),
    };
    return qualifyReadOnlyOperator(source, policy).pipe(
      Effect.result,
      Effect.map(Result.isFailure),
    );
  }
  const checked = await Effect.runPromise(
    Arbitrary.checkEffect(offset, law, { seed: 169, runs: 100 }),
  );
  expect(checked).toMatchObject({ _tag: 'Passed', runs: 100 });
}
test(
  'property: agreeing remote peers cannot substitute a different desired operator',
  desiredPolicyProperty,
);
