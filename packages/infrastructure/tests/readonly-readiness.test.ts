import { expect, test } from 'bun:test';

import { makeRpcStub } from 'alchemy/Cloudflare/Workers/Rpc';
import { RuntimeContext } from 'alchemy/RuntimeContext';
import { Arbitrary, Context, Deferred, Effect, Fiber, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import {
  describeReadiness,
  inspectReadiness,
  makeReadOnlyJobAdmission,
} from '../src/readonly/readiness.ts';
import { makeReadOnlyAdmission } from '../src/readonly/worker.ts';

const policy = {
  sessionId: 'readiness-test',
  installationId: 10,
  ownerId: 20,
  repositoryId: 30,
  issueNumber: 40,
  operatorId: 50,
  opensAtMs: 1000,
  closesAtMs: 301000,
};
const candidate = {
  installationId: 10,
  ownerId: 20,
  repositoryId: 30,
  issueNumber: 40,
  operatorId: 50,
};
const context = Context.make(RuntimeContext, {
  Type: 'Test',
  id: 'readiness-test',
  env: {},
  get: () => Effect.sync(() => undefined),
  set: (key) => Effect.sync(() => key),
});
const run = Effect.runPromiseWith(context);
const encodeValue = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const storedReply = encodeValue({ _tag: 'Queued' });

function exactDescriptor() {
  const wire = describeReadiness(policy);
  const result = inspectReadiness(policy, wire);
  expect(Result.getOrThrow(result)).toEqual({ protocol: 'readonly-policy-v1', policy });
  for (const invalid of [
    undefined,
    null,
    '{}',
    'not json',
    wire.replace('readonly-policy-v1', 'future-v2'),
  ]) {
    const refused = inspectReadiness(policy, invalid);
    expect(Result.isFailure(refused)).toBe(true);
  }
}
test('readiness accepts only the supported protocol and a validated equal policy', exactDescriptor);

async function policyProperty() {
  const offsetSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }));
  const offset = Arbitrary.schema(offsetSchema);
  const keys = ['installationId', 'ownerId', 'repositoryId', 'issueNumber', 'operatorId'] as const;
  function mismatched(changed: typeof policy) {
    const wire = describeReadiness(changed);
    return Result.isFailure(inspectReadiness(policy, wire));
  }
  function law(delta: number) {
    const identities = keys.every((key) => mismatched({ ...policy, [key]: policy[key] + delta }));
    const windows = [
      { ...policy, sessionId: `${policy.sessionId}-${delta}` },
      { ...policy, opensAtMs: policy.opensAtMs + delta, closesAtMs: policy.closesAtMs + delta },
      { ...policy, closesAtMs: policy.closesAtMs - delta },
    ].every(mismatched);
    return identities && windows;
  }
  const checked = await run(Arbitrary.checkEffect(offset, law, { seed: 169, runs: 1000 }));
  expect(checked).toMatchObject({ _tag: 'Passed', runs: 1000 });
}
test('property: any identity, session or admission-window change fails readiness', policyProperty);

async function readOnlyProbe() {
  let admissions = 0;
  function unexpectedAdmission() {
    admissions += 1;
    const failed = Effect.die('Unexpected admission');
    return failed;
  }
  const store = {
    admit: unexpectedAdmission,
  };
  const client = makeReadOnlyJobAdmission(policy, store);
  expect(await run(client.readiness())).toBe(describeReadiness(policy));
  expect(admissions).toBe(0);
  const rejected = await run(
    client
      .enqueueReadyV1(candidate, describeReadiness({ ...policy, operatorId: 99 }))
      .pipe(Effect.result),
  );
  expect(Result.isFailure(rejected)).toBe(true);
  expect(admissions).toBe(0);
}
test('DO readiness and mismatched enqueue never access the admission store', readOnlyProbe);

async function guardedClient() {
  const calls: string[] = [];
  const wire = describeReadiness(policy);
  function recordProbe() {
    calls.push('readiness');
    return wire;
  }
  function enqueue(_candidate: typeof candidate, expected: string) {
    function record() {
      calls.push('enqueue');
      expect(expected).toBe(wire);
      return storedReply;
    }
    const enqueuing = Effect.sync(record);
    return enqueuing;
  }
  const client = {
    readiness: () => Effect.sync(recordProbe),
    enqueueReadyV1: enqueue,
  };
  const admission = makeReadOnlyAdmission({ getByName: () => client }, policy);
  expect(calls).toEqual([]);
  expect(await run(admission.readiness())).toBe(wire);
  expect(calls).toEqual(['readiness']);
  expect(await run(admission.enqueue(candidate))).toBe(storedReply);
  expect(calls).toEqual(['readiness', 'readiness', 'enqueue']);
}
test('Worker probing stays read-only and enqueue first verifies the DO descriptor', guardedClient);

async function staleOrUnavailable() {
  let admissions = 0;
  function recordAdmission() {
    admissions += 1;
    return storedReply;
  }
  function enqueue() {
    const enqueuing = Effect.sync(recordAdmission);
    return enqueuing;
  }
  for (const reading of [
    Effect.succeed(describeReadiness({ ...policy, closesAtMs: 300000 })),
    Effect.succeed(encodeValue({ _tag: 'LegacyResponse' })),
  ]) {
    const admission = makeReadOnlyAdmission(
      { getByName: () => ({ readiness: () => reading, enqueueReadyV1: enqueue }) },
      policy,
    );
    const result = await run(admission.enqueue(candidate).pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
  }
  expect(admissions).toBe(0);
}
test('stale, malformed and missing-capability replies cannot enqueue', staleOrUnavailable);

async function missingNativeMethod() {
  let admissions = 0;
  function enqueue() {
    admissions += 1;
    return Promise.resolve(storedReply);
  }
  const client = makeRpcStub<ReturnType<Parameters<typeof makeReadOnlyAdmission>[0]['getByName']>>({
    readiness: () => Promise.reject(new Error('Legacy DO does not implement readiness')),
    enqueueReadyV1: enqueue,
  });
  const admission = makeReadOnlyAdmission({ getByName: () => client }, policy);
  const result = await run(admission.enqueue(candidate).pipe(Effect.result));
  expect(Result.isFailure(result)).toBe(true);
  expect(admissions).toBe(0);
}
test('an absent method through the actual Alchemy RPC adapter fails closed', missingNativeMethod);

const withClock = Effect.provide(TestClock.layer());
async function readinessDeadline() {
  let admissions = 0;
  function recordAdmission() {
    admissions += 1;
    return storedReply;
  }
  function* scenario() {
    const entered = yield* Deferred.make<void>();
    function* slowProbe() {
      yield* Deferred.succeed(entered, undefined);
      yield* Effect.sleep('2 days');
      return describeReadiness(policy);
    }
    const client = {
      readiness: () => Effect.gen(slowProbe),
      enqueueReadyV1: () => Effect.sync(recordAdmission),
    };
    const admission = makeReadOnlyAdmission({ getByName: () => client }, policy);
    const fiber = yield* admission.enqueue(candidate).pipe(Effect.result, Effect.forkScoped);
    yield* Deferred.await(entered).pipe(Effect.timeout('1 second'));
    yield* TestClock.adjust(5001);
    const result = yield* Fiber.join(fiber);
    expect(Result.isFailure(result)).toBe(true);
  }
  await run(Effect.gen(scenario).pipe(Effect.scoped, withClock));
  expect(admissions).toBe(0);
}
test(
  'readiness has a five-second cooperative budget without enqueue retries',
  readinessDeadline,
  3000,
);
