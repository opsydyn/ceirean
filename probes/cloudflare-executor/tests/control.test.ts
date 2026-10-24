import { expect, test } from 'bun:test';

import { Arbitrary, Deferred, Effect, Fiber, Match, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { makeExecutor } from '../src/control.ts';
import {
  DriverFailure,
  type DriverQuery,
  type Observation,
  type OwnedIdentity,
} from '../src/driver-protocol.ts';
import { makeSimulationDriver } from '../src/driver.ts';
import { request, sessionConfig } from './contracts-fixtures.ts';

type Options = {
  auth: 'Permit' | 'Deny' | 'Hang';
  start: 'Ack' | 'Lost' | 'Uncertain' | 'Hang' | 'Late';
  terminate: 'Ack' | 'Hang';
  destroy: 'Clear' | 'LeaveChild' | 'Hang';
  inspect: 'Normal' | 'Borrowed' | 'HangFirst';
};
function fake(overrides: Partial<Options> = {}) {
  const options: Options = {
    auth: 'Permit',
    start: 'Ack',
    terminate: 'Ack',
    destroy: 'Clear',
    inspect: 'Normal',
    ...overrides,
  };
  const calls: DriverQuery[] = [];
  let observation: Observation = {
    state: { _tag: 'Absent' },
    attempt: 'NeverIssued',
    settlement: 'Quiescent',
  };
  const started = Deferred.makeUnsafe<void>();
  const authorizing = Deferred.makeUnsafe<void>();
  const inspecting = Deferred.makeUnsafe<void>();
  let inspections = 0;
  let completeLateStart = () => {};
  function acknowledged(identity: OwnedIdentity, action: 'Start' | 'Terminate' | 'Destroy') {
    return Result.succeed({ _tag: 'Acknowledged', identity, action });
  }
  function start(operation: Extract<DriverQuery, { _tag: 'Start' }>['operation']) {
    observation = {
      state: { _tag: 'Running', processIds: ['root', 'child'] },
      attempt: 'Issued',
      settlement: 'Quiescent',
    };
    Deferred.doneUnsafe(started, Effect.void);
    return Match.value(options.start).pipe(
      Match.when('Ack', () => Promise.resolve(acknowledged(operation.identity, 'Start'))),
      Match.when('Lost', () =>
        Promise.resolve(Result.fail(new DriverFailure({ code: 'TransportLost' }))),
      ),
      Match.when('Uncertain', uncertain),
      Match.when('Hang', hanging),
      Match.when('Late', () => late(operation.identity)),
      Match.exhaustive,
    );
  }
  function late(identity: OwnedIdentity) {
    observation = { ...observation, settlement: 'Uncertain' };
    return new Promise<Result.Result<unknown, DriverFailure>>((resolve) => {
      completeLateStart = () => {
        observation = {
          state: { _tag: 'Running', processIds: ['late-root', 'late-child'] },
          attempt: 'Issued',
          settlement: 'Quiescent',
        };
        resolve(acknowledged(identity, 'Start'));
      };
    });
  }
  function uncertain() {
    observation = { ...observation, settlement: 'Uncertain' };
    return Promise.resolve(Result.fail(new DriverFailure({ code: 'TransportLost' })));
  }
  function hanging() {
    observation = { ...observation, settlement: 'Uncertain' };
    return new Promise<Result.Result<unknown, DriverFailure>>(() => {});
  }
  function terminate(identity: OwnedIdentity) {
    observation = { ...observation, state: { _tag: 'Running', processIds: ['child'] } };
    return Match.value(options.terminate).pipe(
      Match.when('Ack', () => Promise.resolve(acknowledged(identity, 'Terminate'))),
      Match.when('Hang', hanging),
      Match.exhaustive,
    );
  }
  function destroy(identity: OwnedIdentity) {
    function clear() {
      observation = { ...observation, state: { _tag: 'Absent' } };
      return Promise.resolve(acknowledged(identity, 'Destroy'));
    }
    return Match.value(options.destroy).pipe(
      Match.when('Clear', clear),
      Match.when('LeaveChild', () => Promise.resolve(acknowledged(identity, 'Destroy'))),
      Match.when('Hang', hanging),
      Match.exhaustive,
    );
  }
  function inspect(identity: OwnedIdentity) {
    inspections += 1;
    Deferred.doneUnsafe(inspecting, Effect.void);
    const resultIdentity = Match.value(options.inspect).pipe(
      Match.when('Normal', () => identity),
      Match.when('HangFirst', () => identity),
      Match.when('Borrowed', () => ({ ...identity, operationId: 'other-operation' })),
      Match.exhaustive,
    );
    const result = Promise.resolve(
      Result.succeed({ _tag: 'Observed', identity: resultIdentity, observation }),
    );
    const first = Match.value(options.inspect).pipe(
      Match.when('HangFirst', () => inspections === 1),
      Match.orElse(() => false),
    );
    return Match.value(first).pipe(
      Match.when(true, () => new Promise<Result.Result<unknown, DriverFailure>>(() => {})),
      Match.orElse(() => result),
    );
  }
  function transport(query: DriverQuery, _signal: AbortSignal) {
    calls.push(structuredClone(query));
    return Match.value(query).pipe(
      Match.tag('Authorize', authorize),
      Match.tag('Start', ({ operation }) => start(operation)),
      Match.tag('Inspect', ({ identity }) => inspect(identity)),
      Match.tag('Terminate', ({ identity }) => terminate(identity)),
      Match.tag('Destroy', ({ identity }) => destroy(identity)),
      Match.exhaustive,
    );
  }
  function authorize({ identity }: Extract<DriverQuery, { _tag: 'Authorize' }>) {
    Deferred.doneUnsafe(authorizing, Effect.void);
    return Match.value(options.auth).pipe(
      Match.when('Permit', () => Promise.resolve(Result.succeed({ _tag: 'Authorized', identity }))),
      Match.when('Deny', () => Promise.resolve(Result.succeed({ _tag: 'Denied', identity }))),
      Match.when('Hang', hanging),
      Match.exhaustive,
    );
  }
  function count(tag: DriverQuery['_tag']) {
    return calls.filter((query) => query._tag === tag).length;
  }
  function observe(value: Observation) {
    observation = structuredClone(value);
  }
  return {
    driver: makeSimulationDriver(transport),
    calls,
    count,
    observe,
    started: Deferred.await(started).pipe(Effect.timeout('1 second')),
    authorizing: Deferred.await(authorizing).pipe(Effect.timeout('1 second')),
    inspecting: Deferred.await(inspecting).pipe(Effect.timeout('1 second')),
    snapshot: () => structuredClone(observation),
    finishLateStart: () => completeLateStart(),
  };
}

function* verifyStartAndReplay() {
  const native = fake();
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  const results = yield* Effect.forEach(
    [request(), request(), request('operation-2')],
    (input) => executor.start(input),
    { concurrency: 'unbounded' },
  );
  expect(results).toContainEqual(
    expect.objectContaining({ _tag: 'Started', activation: 'Blocked' }),
  );
  expect(results).toContainEqual(
    expect.objectContaining({ _tag: 'Replayed', activation: 'Blocked' }),
  );
  expect(native.count('Start')).toBe(1);
  expect(yield* executor.inspect('operation-1')).toMatchObject({
    _tag: 'Running',
    activation: 'Blocked',
  });
  expect(yield* executor.cancel('operation-1')).toMatchObject({
    cleanup: 'Confirmed',
    activation: 'Blocked',
  });
  expect(native.count('Destroy')).toBe(1);
  expect(native.snapshot().state).toEqual({ _tag: 'Absent' });
}
async function startAndReplay() {
  const workflow = Effect.gen(verifyStartAndReplay);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('simulated owner starts once under races and replay never dispatches again', startAndReplay);

function* verifyDenied() {
  const native = fake({ auth: 'Deny' });
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  expect(yield* executor.start(request())).toMatchObject({
    _tag: 'Refused',
    reason: 'AuthorizationDenied',
  });
  expect(native.count('Start')).toBe(0);
  expect(native.count('Destroy')).toBe(0);
}
async function denied() {
  const workflow = Effect.gen(verifyDenied);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('authorization refusal precedes any simulated allocation or mutation', denied);

function* verifyLostResponse() {
  const native = fake({ start: 'Lost' });
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  expect(yield* executor.start(request())).toMatchObject({ _tag: 'Started' });
  yield* executor.start(request());
  expect(native.count('Start')).toBe(1);
  expect(yield* executor.close('session-1')).toMatchObject({ cleanup: 'Confirmed' });
}
async function lostResponse() {
  const workflow = Effect.gen(verifyLostResponse);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('lost start acknowledgement reconciles the same identity without replacement', lostResponse);

function* verifyUncertainCleanup() {
  const native = fake({ start: 'Uncertain' });
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  yield* executor.start(request());
  const result = yield* executor.close('session-1');
  expect(result).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
  expect(native.snapshot().state).toEqual({ _tag: 'Absent' });
  expect(yield* executor.start(request('operation-2'))).toMatchObject({
    _tag: 'Refused',
    reason: 'OwnerClosed',
  });
  yield* executor.close('session-1');
  expect(native.count('Start')).toBe(1);
  expect(native.count('Destroy')).toBe(1);
}
async function uncertainCleanup() {
  const workflow = Effect.gen(verifyUncertainCleanup);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test(
  'absence does not prove cleanup while a previous mutation remains uncertain',
  uncertainCleanup,
);

function* verifyDescendantCleanup() {
  const native = fake({ destroy: 'LeaveChild' });
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  yield* executor.start(request());
  expect(yield* executor.cancel('operation-1')).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
  expect(native.snapshot().state).toEqual({ _tag: 'Running', processIds: ['child'] });
}
async function descendants() {
  const workflow = Effect.gen(verifyDescendantCleanup);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test(
  'terminate acknowledgement cannot hide a surviving descendant or lying destroy acknowledgement',
  descendants,
);

function* verifyDeadline() {
  const native = fake();
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  yield* executor.start(request());
  yield* TestClock.adjust('1000 millis');
  expect(native.count('Destroy')).toBe(1);
  expect(yield* executor.close('session-1')).toMatchObject({ cleanup: 'Confirmed' });
  expect(native.count('Destroy')).toBe(1);
}
async function deadline() {
  const workflow = Effect.gen(verifyDeadline);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('owned lifetime reaches its deadline and cleans the same job', deadline);

function* verifyDisconnect() {
  const native = fake({ start: 'Hang' });
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  const waiter = yield* Effect.forkChild(executor.start(request()));
  yield* native.started;
  yield* Fiber.interrupt(waiter);
  expect(yield* executor.close('session-1')).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
  expect(native.count('Destroy')).toBe(1);
  expect(native.count('Start')).toBe(1);
}
async function disconnect() {
  const workflow = Effect.gen(verifyDisconnect);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test(
  'interrupting a client waiter initiates owned cleanup but does not certify remote termination',
  disconnect,
);

function* verifyCleanupTimeout() {
  const native = fake({ terminate: 'Hang', destroy: 'Hang' });
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  yield* executor.start(request());
  const closing = yield* Effect.forkChild(executor.close('session-1'));
  yield* TestClock.adjust('10 seconds');
  expect(yield* Fiber.join(closing)).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
}
async function cleanupTimeout() {
  const workflow = Effect.gen(verifyCleanupTimeout);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test(
  'unresponsive terminate and destroy waits are bounded and never green cleanup',
  cleanupTimeout,
);

function* verifyScopeOwnership() {
  const native = fake();
  function* session() {
    const executor = yield* makeExecutor(native.driver, sessionConfig());
    yield* executor.start(request());
    return executor;
  }
  const lifetime = Effect.gen(session);
  const executor = yield* Effect.scoped(lifetime);
  expect(native.snapshot().state).toEqual({ _tag: 'Absent' });
  expect(yield* executor.start(request())).toMatchObject({
    _tag: 'Refused',
    reason: 'OwnerClosed',
  });
}
async function scopeOwnership() {
  const workflow = Effect.gen(verifyScopeOwnership);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('scope exit owns cleanup and escaped service handles cannot start work', scopeOwnership);

function* verifyBorrowedReply() {
  const native = fake({ inspect: 'Borrowed' });
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  expect(yield* executor.start(request())).toMatchObject({ _tag: 'Unknown' });
  expect(native.count('Start')).toBe(0);
  expect(yield* executor.close('session-1')).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
}
async function borrowedReply() {
  const workflow = Effect.gen(verifyBorrowedReply);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('borrowed inspection identities cannot authorize start or cleanup', borrowedReply);

function* verifyExistingAttempt() {
  for (const attempt of ['Issued', 'Unknown'] as const) {
    const native = fake();
    native.observe({ state: { _tag: 'Absent' }, attempt, settlement: 'Quiescent' });
    const executor = yield* makeExecutor(native.driver, sessionConfig());
    expect(yield* executor.start(request())).toMatchObject({ _tag: 'Unknown' });
    expect(native.count('Start')).toBe(0);
    yield* executor.close('session-1');
  }
}
async function existingAttempt() {
  const workflow = Effect.gen(verifyExistingAttempt);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('absence cannot authorize a retry of a previously issued or unknown start', existingAttempt);

function* verifyExitedAndWrongOwner() {
  const native = fake();
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  yield* executor.start(request());
  native.observe({
    state: { _tag: 'Exited', exitCode: 7 },
    attempt: 'Issued',
    settlement: 'Quiescent',
  });
  expect(yield* executor.inspect('operation-1')).toMatchObject({ _tag: 'Exited', exitCode: 7 });
  expect(yield* executor.inspect('other')).toMatchObject({ _tag: 'Unknown' });
  expect(yield* executor.cancel('other')).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
  expect(yield* executor.close('other')).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
  expect(native.count('Destroy')).toBe(0);
  yield* Effect.all(
    [executor.cancel('operation-1'), executor.close('session-1'), executor.close('session-1')],
    { concurrency: 'unbounded' },
  );
  expect(native.count('Destroy')).toBe(1);
}
async function exitedAndWrongOwner() {
  const workflow = Effect.gen(verifyExitedAndWrongOwner);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test(
  'inspection preserves exit status and foreign handles cannot mutate the owner',
  exitedAndWrongOwner,
);

function* verifyCloseRace() {
  const native = fake();
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  yield* Effect.all([executor.close('session-1'), executor.start(request())], {
    concurrency: 'unbounded',
  });
  expect(yield* executor.start(request())).toMatchObject({
    _tag: 'Refused',
    reason: 'OwnerClosed',
  });
  expect(native.count('Start')).toBe(0);
}
async function closeRace() {
  const workflow = Effect.gen(verifyCloseRace);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('close wins an empty-owner race without permitting a later allocation', closeRace);

function* verifyDuplicateOwners() {
  const native = fake();
  const first = yield* makeExecutor(native.driver, sessionConfig());
  const constructing = makeExecutor(native.driver, sessionConfig());
  expect((yield* constructing.pipe(Effect.result))._tag).toBe('Failure');
  yield* first.start(request());
  yield* first.close('session-1');
  const reopening = makeExecutor(native.driver, sessionConfig());
  expect((yield* reopening.pipe(Effect.result))._tag).toBe('Failure');
  expect(native.count('Start')).toBe(1);
}
async function duplicateOwners() {
  const workflow = Effect.gen(verifyDuplicateOwners);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('a simulation driver cannot host duplicate or replacement session owners', duplicateOwners);

function* verifySingleDecode() {
  const native = fake();
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  let reads = 0;
  function readSession() {
    reads += 1;
    return Match.value(reads).pipe(
      Match.when(1, () => 'session-1'),
      Match.orElse(() => 'foreign-session'),
    );
  }
  const input = {
    ...request(),
    get sessionId() {
      return readSession();
    },
  };
  const result = yield* executor.start(input);
  expect(result).toMatchObject({ _tag: 'Started' });
  const isStart = Schema.is(Schema.Struct({ _tag: Schema.Literal('Start') }));
  const starts = native.calls.filter(isStart);
  expect(starts).toMatchObject([
    { operation: { identity: { sessionId: 'session-1' }, request: { sessionId: 'session-1' } } },
  ]);
  expect(reads).toBe(1);
}
async function singleDecode() {
  const workflow = Effect.gen(verifySingleDecode);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('the dispatched request uses the same single decoded snapshot as admission', singleDecode);

function* verifyLateMutation() {
  const native = fake({ start: 'Late' });
  const executor = yield* makeExecutor(native.driver, sessionConfig());
  const waiter = yield* Effect.forkChild(executor.start({ ...request(), durationMs: 500 }));
  yield* native.started;
  yield* TestClock.adjust('500 millis');
  expect(native.count('Destroy')).toBe(1);
  expect(yield* Fiber.join(waiter)).toMatchObject({ _tag: 'Unknown' });
  expect(yield* executor.close('session-1')).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
  native.finishLateStart();
  expect(native.snapshot().state).toEqual({
    _tag: 'Running',
    processIds: ['late-root', 'late-child'],
  });
  expect(yield* executor.close('session-1')).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
  expect(yield* executor.start(request('operation-2'))).toMatchObject({
    _tag: 'Refused',
    reason: 'OwnerClosed',
  });
  expect(native.count('Start')).toBe(1);
}
async function lateMutation() {
  const workflow = Effect.gen(verifyLateMutation);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test(
  'deadline during startup cannot green cleanup when a cancelled mutation completes late',
  lateMutation,
);

function* verifyScopeDuringStartup() {
  const native = fake({ start: 'Hang' });
  function* session() {
    const executor = yield* makeExecutor(native.driver, sessionConfig());
    const waiter = yield* Effect.forkChild(executor.start(request()));
    yield* Effect.addFinalizer(() => Fiber.interrupt(waiter));
    yield* native.started;
    return executor;
  }
  const workflow = Effect.gen(session);
  const executor = yield* Effect.scoped(workflow);
  expect(native.count('Destroy')).toBe(1);
  expect(yield* executor.close('session-1')).toMatchObject({ cleanup: 'CleanupUnconfirmed' });
}
async function scopeDuringStartup() {
  const workflow = Effect.gen(verifyScopeDuringStartup);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test('disposing a scope during startup preserves owned unconfirmed cleanup', scopeDuringStartup);

function preStartCase(phase: 'Authorize' | 'Inspect') {
  function* verify() {
    const native = Match.value(phase).pipe(
      Match.when('Authorize', () => fake({ auth: 'Hang' })),
      Match.when('Inspect', () => fake({ inspect: 'HangFirst' })),
      Match.exhaustive,
    );
    const executor = yield* makeExecutor(native.driver, sessionConfig());
    const waiter = yield* Effect.forkChild(executor.start(request()));
    const entered = Match.value(phase).pipe(
      Match.when('Authorize', () => native.authorizing),
      Match.when('Inspect', () => native.inspecting),
      Match.exhaustive,
    );
    yield* entered;
    yield* Fiber.interrupt(waiter);
    expect(native.count('Start')).toBe(0);
    const cleanup = yield* executor.close('session-1');
    const expected = Match.value(phase).pipe(
      Match.when('Authorize', () => 'CleanupUnconfirmed' as const),
      Match.when('Inspect', () => 'Confirmed' as const),
      Match.exhaustive,
    );
    expect(cleanup.cleanup).toBe(expected);
  }
  const workflow = Effect.gen(verify);
  return workflow;
}
function* verifyPreStartInterruptions() {
  yield* Effect.forEach(['Authorize', 'Inspect'] as const, preStartCase, {
    concurrency: 1,
    discard: true,
  });
}
async function preStartInterruptions() {
  const workflow = Effect.gen(verifyPreStartInterruptions);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test(
  'client interruption during authorization or preflight inspection never dispatches Start',
  preStartInterruptions,
);

const Owned = {
  sessionId: 'session-1',
  operationId: 'operation-1',
  resourceId: 'ceirean:session-1:operation-1',
};
function* verifyProtocolRejection() {
  for (const raw of [
    { _tag: 'Acknowledged', identity: Owned, action: 'Start' },
    { _tag: 'Authorized', identity: Owned, unexpected: true },
    { _tag: 'Authorized', identity: { ...Owned, resourceId: 'other' } },
  ]) {
    const driver = makeSimulationDriver(() => Promise.resolve(Result.succeed(raw)));
    const result = yield* driver
      .request({ _tag: 'Authorize', identity: Owned })
      .pipe(Effect.result);
    expect(result._tag).toBe('Failure');
  }
}
async function protocolRejection() {
  const workflow = Effect.gen(verifyProtocolRejection);
  await Effect.runPromise(workflow);
}
test(
  'simulation transport rejects wrong actions, excess fields and substituted resources',
  protocolRejection,
);

const Action = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 }));
const Actions = Schema.Array(Action).check(Schema.isMaxLength(12));
const Clean = Schema.Struct({ cleanup: Schema.Literal('Confirmed') });
const AbsentSettled = Schema.Struct({
  state: Schema.TaggedStruct('Absent', {}),
  settlement: Schema.Literal('Quiescent'),
});
const isClean = Schema.is(Clean);
const isAbsentSettled = Schema.is(AbsentSettled);
const Scenario = Schema.Struct({
  start: Schema.Literals(['Ack', 'Lost', 'Uncertain']),
  destroy: Schema.Literals(['Clear', 'LeaveChild']),
  actions: Actions,
});
function ownershipLaw(seed: number) {
  function law(scenario: typeof Scenario.Type) {
    function* verify() {
      const native = fake(scenario);
      const executor = yield* makeExecutor(native.driver, sessionConfig());
      yield* executor.start(request());
      for (const action of scenario.actions) {
        yield* Match.value(action).pipe(
          Match.when(0, () => executor.start(request())),
          Match.when(1, () => executor.inspect('operation-1')),
          Match.when(2, () => executor.cancel('operation-1')),
          Match.when(3, () => executor.close('session-1')),
          Match.orElse(() => executor.start(request('operation-2'))),
        );
      }
      const cleanup = yield* executor.close('session-1');
      const clean = isClean(cleanup);
      const absentSettled = isAbsentSettled(native.snapshot());
      const identities = native.calls.map((query) =>
        Match.value(query).pipe(
          Match.tag('Start', ({ operation }) => operation.identity),
          Match.orElse(({ identity }) => identity),
        ),
      );
      return [
        native.count('Start') === 1,
        native.count('Destroy') === 1,
        !clean || absentSettled,
        identities.every((identity) => identity.resourceId === Owned.resourceId),
      ].every(Boolean);
    }
    const workflow = Effect.gen(verify);
    const scoped = Effect.scoped(workflow);
    return scoped.pipe(Effect.result, Effect.map(Result.getOrElse(() => false)));
  }
  function* check() {
    const result = yield* Arbitrary.checkEffect(Arbitrary.schema(Scenario), law, {
      seed,
      runs: 100,
      maxShrinks: 100,
    });
    expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
    expect(result).toMatchObject({ runs: 100 });
  }
  async function run() {
    const workflow = Effect.gen(check);
    const provided = Effect.provide(workflow, TestClock.layer());
    await Effect.runPromise(provided);
  }
  return run;
}
for (const seed of [0, 1, 163])
  test(`simulated lifecycle ownership laws; seed ${seed}`, ownershipLaw(seed));
