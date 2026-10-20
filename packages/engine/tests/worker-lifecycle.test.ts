import { expect, test } from 'bun:test';

import { WorkerIssuerId, WorkerContainerId } from '@leviathan/domain';
import { createEffectActor, send, waitFor } from '@xstate/effect';
import { Clock, Deferred, Effect, Exit, Fiber, Layer, Match, Option, Queue, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import type { EventRejection } from 'xstate';

import { WorkerMechanismError } from '../src/worker-errors.ts';
import { workerLifecycleMachine } from '../src/worker-lifecycle.ts';
import { WorkerJournal, WorkerMechanism } from '../src/worker-ports.ts';
import {
  LifecycleHarness,
  journalGate,
  lifecycleTestLayer,
  makeControlledWorkerMechanism,
  type MutationBarrier,
  type Audit,
} from './worker-fakes.ts';
import {
  makeWorkerCase,
  makeWorkerSnapshot,
  makeStartedWorkerSnapshot,
  makeWorkerIntent,
} from './worker-fixtures.ts';
import { makeMemoryWorkerJournal } from './worker-memory-journal.ts';

const input = {
  operationId: makeWorkerCase().operation.operationId,
  issuerId: WorkerIssuerId.make('controller-1'),
};

function* actualMachineScenario() {
  return yield* createEffectActor(workerLifecycleMachine, { input });
}
const actualMachineProgram = Effect.gen(actualMachineScenario);

export async function actualMachineMissingServicesControl() {
  const scoped = Effect.scoped(actualMachineProgram);
  // @ts-expect-error Actual lifecycle tasks require both journal and mechanism.
  await Effect.runPromise(scoped);
  const journalAcquisition = makeMemoryWorkerJournal([makeWorkerSnapshot()]).pipe(
    Effect.map((journal) => journal.service),
  );
  const journalOnly = Layer.effect(WorkerJournal, journalAcquisition);
  const partial = Effect.provide(scoped, journalOnly);
  // @ts-expect-error Providing only WorkerJournal must leave WorkerMechanism required.
  await Effect.runPromise(partial);
  const mechanismAcquisition = makeControlledWorkerMechanism(makeWorkerCase().observation).pipe(
    Effect.map((fake) => fake.service),
  );
  const mechanismOnly = Layer.effect(WorkerMechanism, mechanismAcquisition);
  const otherPartial = Effect.provide(scoped, mechanismOnly);
  // @ts-expect-error Providing only WorkerMechanism must leave WorkerJournal required.
  await Effect.runPromise(otherPartial);
}

export async function canonicalTrace() {
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    expect(actor.getSnapshot().status).toBe('active');
    const create = yield* Queue.take(h.fake.barriers.mutations);
    expect((yield* Ref.get(h.edits)).map((edit) => edit._tag)).toEqual(['Claim']);
    expect(create.request.intent.kind).toBe('Create');
    expect(create.request.operation).toEqual(c.operation);
    const created = { ...c.observation, atMs: 950, resources: [{ ...c.resource, running: false }] };
    yield* h.fake.materialize(created);
    yield* Deferred.succeed(create.reply, {
      ...c.reply,
      atMs: 950,
      intentId: create.request.intent.intentId,
      issuerId: input.issuerId,
      outcome: { _tag: 'Completed', observation: created },
    });
    const start = yield* Queue.take(h.fake.barriers.mutations);
    expect((yield* Ref.get(h.edits)).map((edit) => edit._tag)).toEqual([
      'Claim',
      'RecordOutcome',
      'Claim',
    ]);
    expect(start.request.intent.kind).toBe('Start');
    expect(start.request.intent.resource).toBe(c.containerId);
    const running = { ...c.observation, atMs: 950 };
    yield* h.fake.materialize(running);
    yield* Deferred.succeed(start.reply, {
      ...c.reply,
      atMs: 950,
      intentId: start.request.intent.intentId,
      issuerId: input.issuerId,
      outcome: { _tag: 'Completed', observation: running },
    });
    const inspect = yield* Queue.take(h.fake.barriers.observations);
    expect(inspect.request.containerId).toEqual(Option.some(c.containerId));
    yield* h.fake.readback(inspect);
    const ready = yield* waitFor(actor, (state) => state.matches('ready'));
    expect(ready.context.snapshot).toEqual(
      expect.objectContaining({ readiness: Option.some(expect.anything()) }),
    );
    const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    yield* send(actor, {
      type: 'RequestedExecution',
      operationId: input.operationId,
      revision: stored.revision,
    });
    const execution = yield* Queue.take(h.fake.barriers.executions);
    const authorized = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    expect(authorized.executionAuthorizedAtMs).toEqual(Option.some(950));
    expect(execution.request.operation).toEqual(c.operation);
    expect((yield* Ref.get(h.edits)).map((edit) => edit._tag)).toEqual([
      'Claim',
      'RecordOutcome',
      'Claim',
      'RecordOutcome',
      'RecordReadiness',
      'AuthorizeExecution',
    ]);
    expect((yield* Ref.get(h.fake.calls)).map((call) => call.kind)).toEqual([
      'mutate',
      'mutate',
      'observe',
      'execute',
    ]);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(makeWorkerSnapshot());
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test(
  'journaled create/start/readiness and execution use exact committed authority',
  canonicalTrace,
);

function completeMutation(barrier: MutationBarrier, running: boolean, absent = false) {
  function* completeNativeWork() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    const atMs = yield* Clock.currentTimeMillis;
    const resources = Match.value(absent).pipe(
      Match.when(true, () => []),
      Match.orElse(() => [{ ...c.resource, running }]),
    );
    // Absence is explicit mechanism evidence, never inferred from interruption.
    const observation = { ...c.observation, atMs, resources };
    yield* h.fake.materialize(observation);
    yield* Deferred.succeed(barrier.reply, {
      ...c.reply,
      atMs,
      intentId: barrier.request.intent.intentId,
      issuerId: barrier.request.intent.issuerId,
      outcome: { _tag: 'Completed', observation },
    });
  }
  const program = Effect.gen(completeNativeWork);
  return program;
}

function readyActor() {
  function* prepareReady() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    yield* h.fake.materialize({ ...makeWorkerCase().observation, atMs: 950 });
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    const reconcile = yield* Queue.take(h.fake.barriers.observations);
    yield* h.fake.readback(reconcile);
    const readiness = yield* Queue.take(h.fake.barriers.observations);
    yield* h.fake.readback(readiness);
    yield* waitFor(actor, (state) => state.matches('ready'));
    return actor;
  }
  const program = Effect.gen(prepareReady);
  return program;
}

function cancelPersisted() {
  function* recordCancellation() {
    const h = yield* LifecycleHarness;
    const snapshot = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    const result = yield* h.journal.service.commit({
      _tag: 'RequestCancellation',
      operationId: input.operationId,
      expectedRevision: snapshot.revision,
      atMs: 950,
      cleanupWindowMs: 200,
    });
    expect(result._tag).toBe('Committed');
    return Option.getOrThrow(yield* h.journal.inspect(input.operationId));
  }
  const program = Effect.gen(recordCancellation);
  return program;
}

for (const point of ['before-Claim', 'after-Claim'] as const) {
  async function cancelClaimRace() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(950);
      const gate = yield* journalGate(h, point);
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      yield* Deferred.await(gate.entered);
      expect(actor.getSnapshot().matches('recordingIntent')).toBe(true);
      yield* cancelPersisted();
      yield* Deferred.succeed(gate.resume, undefined);
      const prior = yield* waitFor(
        actor,
        (snapshot) => snapshot.matches('blocked') || snapshot.matches('reconciling'),
      );
      const needsNotification = Effect.succeed(prior.matches('blocked'));
      const reconcile = send(actor, {
        type: 'RequestedReconciliation',
        operationId: input.operationId,
        revision: 7,
      }).pipe(Effect.when(needsNotification));
      yield* reconcile;
      const inspect = yield* Queue.take(h.fake.barriers.observations);
      yield* h.fake.materialize({
        ...makeWorkerCase().observation,
        atMs: 950,
        resources: [],
        staging: 'Absent',
      });
      yield* h.fake.readback(inspect);
      const state = yield* waitFor(
        actor,
        (snapshot) => snapshot.matches('blocked') || snapshot.matches('released'),
      );
      expect(state.status).not.toBe('error');
      const calls = yield* Ref.get(h.fake.calls);
      expect(calls.filter(isNativeWrite)).toEqual([]);
      const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      expect(stored.authority.cancelledAtMs).toEqual(Option.some(950));
      const expectedCount = Match.value(point).pipe(
        Match.when('before-Claim', () => 0),
        Match.orElse(() => 1),
      );
      expect(stored.intents.length).toBe(expectedCount);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(
    `persisted cancellation at ${point} prevents dispatch without a notification`,
    cancelClaimRace,
  );
}

async function externalCreateAfterInterrupt() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    const create = yield* Queue.take(h.fake.barriers.mutations);
    const cancelled = yield* cancelPersisted();
    yield* send(actor, {
      type: 'RecordedCancellation',
      operationId: input.operationId,
      revision: cancelled.revision,
    });
    yield* Deferred.await(create.interrupted);
    const first = yield* Queue.take(h.fake.barriers.observations);
    yield* h.fake.materialize({
      ...makeWorkerCase().observation,
      atMs: 950,
      resources: [],
      staging: 'Absent',
    });
    yield* h.fake.readback(first);
    const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
    expect(blocked.context.issue?._tag).toBe('UnresolvedIntent');
    expect(
      Option.getOrThrow(yield* h.journal.inspect(input.operationId)).intents[0]?.outcome._tag,
    ).toBe('Claimed');
    // The external service accepts the old Create after local interruption.
    yield* h.fake.materialize({
      ...makeWorkerCase().observation,
      atMs: 950,
      resources: [{ ...makeWorkerCase().resource, running: false }],
    });
    yield* send(actor, {
      type: 'RequestedReconciliation',
      operationId: input.operationId,
      revision: cancelled.revision,
    });
    const second = yield* Queue.take(h.fake.barriers.observations);
    yield* h.fake.readback(second);
    const remove = yield* Queue.take(h.fake.barriers.mutations);
    expect(remove.request.intent.kind).toBe('Remove');
    expect(remove.request.intent.resource).toBe(makeWorkerCase().containerId);
    const calls = yield* Ref.get(h.fake.calls);
    expect(calls.filter(isMutation).map((call) => call.request.intent.kind)).toEqual([
      'Create',
      'Remove',
    ]);
    expect(
      Option.getOrThrow(yield* h.journal.inspect(input.operationId)).authority.cancelledAtMs,
    ).toEqual(Option.some(950));
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(makeWorkerSnapshot());
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test(
  'interrupted Create can materialize externally and reconciles without replacement Start',
  externalCreateAfterInterrupt,
);

for (const malformed of [null, {}, { operationId: '', issuerId: '' }]) {
  async function invalidInput() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      // @ts-expect-error Deliberately exercise runtime validation of untrusted input.
      const creation = createEffectActor(workerLifecycleMachine, { input: malformed });
      const result = yield* Effect.exit(creation);
      expect(Exit.isFailure(result)).toBe(true);
      expect(yield* Ref.get(h.fake.calls)).toEqual([]);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(`runtime invalid input ${String(malformed)} cannot invoke native work`, invalidInput);
}

for (const atMs of [999, 1000, 1001, 949]) {
  async function readinessClockBoundary() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(atMs);
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      const inspect = yield* Queue.take(h.fake.barriers.observations);
      yield* h.fake.materialize({ ...makeWorkerCase().observation, atMs });
      yield* h.fake.readback(inspect);
      const observed = yield* waitFor(
        actor,
        (state) => state.matches('checkingReadiness') || state.matches('blocked'),
      );
      const beforeDeadline = Effect.sync(() => atMs === 999);
      const answer = answerNextObservation().pipe(Effect.when(beforeDeadline));
      yield* answer;
      const settled = yield* waitFor(
        actor,
        (state) => state.matches('ready') || state.matches('blocked'),
      );
      expect(settled.matches('ready')).toBe(atMs === 999);
      expect(observed.status).not.toBe('error');
      expect((yield* Ref.get(h.fake.calls)).filter(isNativeWrite)).toEqual([]);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeStartedWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(`readiness uses original absolute deadline and clock at ${atMs}`, readinessClockBoundary);
}

for (const invalid of [
  'malformed',
  'foreign',
  'ambiguous',
  'stale',
  'unavailable',
  'missing',
  'mismatch',
] as const) {
  async function invalidReadback() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(950);
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      const inspect = yield* Queue.take(h.fake.barriers.observations);
      const c = makeWorkerCase();
      const replies = {
        malformed: {},
        foreign: {
          ...c.observation,
          atMs: 950,
          resources: [{ ...c.resource, containerId: WorkerContainerId.make('foreign') }],
        },
        ambiguous: { ...c.observation, atMs: 950, resources: [c.resource, c.resource] },
        stale: { ...c.observation, atMs: 949 },
        unavailable: {},
        missing: { ...c.observation, atMs: 950, resources: [] },
        mismatch: {
          ...c.observation,
          atMs: 950,
          resources: [
            {
              ...c.resource,
              configuration: { ...c.resource.configuration, network: 'foreign-network' },
            },
          ],
        },
      };
      const answer = Match.value(invalid).pipe(
        Match.when('unavailable', () =>
          Deferred.fail(
            inspect.reply,
            new WorkerMechanismError({ operation: 'observe', code: 'Unavailable' }),
          ),
        ),
        Match.orElse((kind) => Deferred.succeed(inspect.reply, replies[kind])),
      );
      yield* answer;
      const state = yield* waitFor(
        actor,
        (snapshot) => snapshot.matches('blocked') || snapshot.matches('checkingReadiness'),
      );
      expect(state.matches('blocked')).toBe(true);
      expect(state.context.issue).not.toBeNull();
      expect((yield* Ref.get(h.fake.calls)).filter(isNativeWrite)).toEqual([]);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeStartedWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(`${invalid} readback blocks without new native writes`, invalidReadback);
}

function answerNextObservation() {
  function* readback() {
    const h = yield* LifecycleHarness;
    const next = yield* Queue.take(h.fake.barriers.observations);
    yield* h.fake.readback(next);
  }
  const program = Effect.gen(readback);
  return program;
}

function isNativeWrite(call: Audit) {
  return Match.value(call.kind).pipe(
    Match.whenOr('mutate', 'execute', () => true),
    Match.orElse(() => false),
  );
}
function isMutation(call: Audit): call is Extract<Audit, { readonly kind: 'mutate' }> {
  return Match.value(call.kind).pipe(
    Match.when('mutate', () => true),
    Match.orElse(() => false),
  );
}

for (const phase of ['ready', 'executing'] as const) {
  async function cancellationAndCleanup() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      const actor = yield* readyActor();
      const before = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      const executing = Match.value(phase).pipe(
        Match.when('executing', () => true),
        Match.orElse(() => false),
      );
      const inExecutionPhase = Effect.sync(() => executing);
      const executionRequest = send(actor, {
        type: 'RequestedExecution',
        operationId: input.operationId,
        revision: before.revision,
      });
      const execute = executionRequest.pipe(Effect.when(inExecutionPhase));
      yield* execute;
      const active = yield* Queue.take(h.fake.barriers.executions).pipe(
        Effect.when(inExecutionPhase),
      );
      const cancelled = yield* cancelPersisted();
      // A notification races other journal commits; the persisted cancellation wins.
      yield* send(actor, {
        type: 'RecordedCancellation',
        operationId: input.operationId,
        revision: before.revision,
      });
      const interrupted = Option.match(active, {
        onNone: () => Effect.void,
        onSome: (barrier) => Deferred.await(barrier.interrupted),
      });
      yield* interrupted;
      yield* TestClock.setTime(1001);
      yield* answerNextObservation();
      const stop = yield* Queue.take(h.fake.barriers.mutations);
      expect(stop.request.intent.kind).toBe('Stop');
      yield* completeMutation(stop, false);
      yield* answerNextObservation();
      const remove = yield* Queue.take(h.fake.barriers.mutations);
      expect(remove.request.intent.kind).toBe('Remove');
      yield* completeMutation(remove, false, true);
      yield* h.fake.materialize({
        ...makeWorkerCase().observation,
        atMs: 1001,
        resources: [],
        staging: 'Absent',
      });
      yield* answerNextObservation();
      const released = yield* waitFor(actor, (state) => state.matches('released'));
      expect(released.status).toBe('done');
      const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      expect(stored.authority.cancelledAtMs).toEqual(cancelled.authority.cancelledAtMs);
      expect(stored.operation.limits).toEqual(makeWorkerCase().operation.limits);
      expect(stored.operation.custody.retainedArtifacts).toEqual(
        makeWorkerCase().operation.custody.retainedArtifacts,
      );
      const calls = yield* Ref.get(h.fake.calls);
      expect(calls.filter(isMutation).map((call) => call.request.intent.kind)).toEqual([
        'Stop',
        'Remove',
      ]);
      expect(
        calls
          .filter(isMutation)
          .every((call) => call.request.intent.resource === makeWorkerCase().containerId),
      ).toBe(true);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeStartedWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(
    `cancel at ${phase} preserves authority and drains owned cleanup after execution expiry`,
    cancellationAndCleanup,
  );
}

async function cancelledStartMaterializes() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    const create = yield* Queue.take(h.fake.barriers.mutations);
    yield* completeMutation(create, false);
    const start = yield* Queue.take(h.fake.barriers.mutations);
    const cancelled = yield* cancelPersisted();
    yield* send(actor, {
      type: 'RecordedCancellation',
      operationId: input.operationId,
      revision: cancelled.revision,
    });
    yield* Deferred.await(start.interrupted);
    yield* answerNextObservation();
    const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
    expect(blocked.context.issue?._tag).toBe('UnresolvedIntent');
    yield* h.fake.materialize({ ...makeWorkerCase().observation, atMs: 950 });
    yield* send(actor, {
      type: 'RequestedReconciliation',
      operationId: input.operationId,
      revision: cancelled.revision,
    });
    yield* answerNextObservation();
    const stop = yield* Queue.take(h.fake.barriers.mutations);
    expect(stop.request.intent.kind).toBe('Stop');
    expect(
      (yield* Ref.get(h.fake.calls)).filter(isMutation).map((call) => call.request.intent.kind),
    ).toEqual(['Create', 'Start', 'Stop']);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(makeWorkerSnapshot());
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test(
  'cancelled Start may complete externally; exact readback permits only owned cleanup',
  cancelledStartMaterializes,
);

for (const entry of ['notification', 'reconstruction'] as const) {
  async function failedStartAllowsOwnedCleanup() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      const c = makeWorkerCase();
      yield* TestClock.setTime(950);
      const original = yield* createEffectActor(workerLifecycleMachine, { input });
      const create = yield* Queue.take(h.fake.barriers.mutations);
      yield* completeMutation(create, false);
      const start = yield* Queue.take(h.fake.barriers.mutations);
      const reason = { _tag: 'ReadinessMismatch' as const, operationId: input.operationId };
      yield* Deferred.succeed(start.reply, {
        ...c.reply,
        atMs: 950,
        intentId: start.request.intent.intentId,
        issuerId: input.issuerId,
        outcome: { _tag: 'Failed', reason },
      });
      yield* answerNextObservation();
      const failed = yield* waitFor(original, (state) => state.matches('blocked'));
      expect(failed.context.issue).toEqual(reason);
      const cancelled = yield* cancelPersisted();
      const acquire = Match.value(entry).pipe(
        Match.when('notification', () => Effect.sync(() => original)),
        Match.when('reconstruction', () => createEffectActor(workerLifecycleMachine, { input })),
        Match.exhaustive,
      );
      const actor = yield* acquire;
      const notify = send(actor, {
        type: 'RecordedCancellation',
        operationId: input.operationId,
        revision: cancelled.revision,
      });
      const needsNotification = Effect.succeed(
        Match.value(entry).pipe(
          Match.when('notification', () => true),
          Match.orElse(() => false),
        ),
      );
      yield* notify.pipe(Effect.when(needsNotification));
      const inspect = yield* Queue.take(h.fake.barriers.observations);
      expect(inspect.request.containerId).toEqual(Option.some(c.containerId));
      yield* h.fake.readback(inspect);
      const decision = yield* waitFor(
        actor,
        (state) => state.matches('blocked') || state.matches('removing'),
      );
      expect(decision.matches('removing')).toBe(true);
      expect(decision.context.issue).toEqual(reason);
      const remove = yield* Queue.take(h.fake.barriers.mutations);
      expect(remove.request.intent.kind).toBe('Remove');
      expect(remove.request.intent.resource).toBe(c.containerId);
      yield* completeMutation(remove, false, true);
      yield* h.fake.materialize({ ...c.observation, atMs: 950, resources: [], staging: 'Absent' });
      yield* answerNextObservation();
      const released = yield* waitFor(actor, (state) => state.matches('released'));
      expect(released.context.issue).toEqual(reason);
      const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      expect(stored.authority.cancelledAtMs).toEqual(Option.some(950));
      expect(stored.intents.map((intent) => [intent.kind, intent.outcome._tag])).toEqual([
        ['Create', 'Completed'],
        ['Start', 'Failed'],
        ['Remove', 'Completed'],
      ]);
      expect(Option.getOrThrow(stored.cleanup)._tag).toBe('CleanupConfirmed');
      expect(
        (yield* Ref.get(h.fake.calls)).filter(isMutation).map((call) => call.request.intent.kind),
      ).toEqual(['Create', 'Start', 'Remove']);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(
    `failed Start then cancellation via ${entry} removes once and retains its tagged failure`,
    failedStartAllowsOwnedCleanup,
  );
}

for (const staging of ['Present', 'Unknown', 'Absent'] as const) {
  async function cleanupRequiresAllAbsence() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      const c = makeWorkerCase();
      yield* TestClock.setTime(950);
      yield* h.fake.materialize({
        ...c.observation,
        atMs: 950,
        resources: [{ ...c.resource, running: false }],
      });
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      yield* answerNextObservation();
      const remove = yield* Queue.take(h.fake.barriers.mutations);
      yield* completeMutation(remove, false, true);
      yield* h.fake.materialize({ ...c.observation, atMs: 950, resources: [], staging });
      yield* answerNextObservation();
      const settled = yield* waitFor(
        actor,
        (state) => state.matches('released') || state.matches('blocked'),
      );
      const absent = Match.value(staging).pipe(
        Match.when('Absent', () => true),
        Match.orElse(() => false),
      );
      expect(settled.matches('released')).toBe(absent);
      expect(
        (yield* Ref.get(h.fake.calls)).filter(isMutation).map((call) => call.request.intent.kind),
      ).toEqual(['Remove']);
    }
    const seed = {
      ...makeStartedWorkerSnapshot(),
      cleanup: Option.some({
        _tag: 'CleanupPending' as const,
        requestedAtMs: 950,
        deadlineMs: 1150,
      }),
    };
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(seed);
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(
    `staging ${staging} and container absence determine cleanup confirmation`,
    cleanupRequiresAllAbsence,
  );
}

async function boundedPendingReadiness() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(980);
    const c = makeWorkerCase();
    yield* h.fake.materialize({
      ...c.observation,
      atMs: 980,
      resources: [{ ...c.resource, running: false }],
    });
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    yield* answerNextObservation();
    yield* answerNextObservation();
    yield* waitFor(actor, (state) => state.matches('waitingReadiness'));
    yield* TestClock.adjust('9 millis');
    expect((yield* Ref.get(h.fake.calls)).length).toBe(2);
    yield* TestClock.adjust('1 millis');
    yield* answerNextObservation();
    yield* waitFor(actor, (state) => state.matches('waitingReadiness'));
    yield* TestClock.adjust('10 millis');
    const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
    expect(blocked.context.issue?._tag).toBe('DeadlineExpired');
    expect((yield* Ref.get(h.fake.calls)).length).toBe(3);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(makeStartedWorkerSnapshot());
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test(
  'pending readiness repeats read-only at 10ms and never resets the absolute deadline',
  boundedPendingReadiness,
);

async function selfCompletedWorkRequestsCleanup() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const actor = yield* readyActor();
    const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    yield* send(actor, {
      type: 'RequestedExecution',
      operationId: input.operationId,
      revision: stored.revision,
    });
    const execution = yield* Queue.take(h.fake.barriers.executions);
    yield* Deferred.succeed(execution.reply, {
      operationId: input.operationId,
      identity: stored.operation.identity,
      completedAtMs: 950,
    });
    const inspect = yield* Queue.take(h.fake.barriers.observations);
    const next = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    expect(next.cleanup).toEqual(
      Option.some({ _tag: 'CleanupPending', requestedAtMs: 950, deadlineMs: 1050 }),
    );
    yield* h.fake.readback(inspect);
    const stop = yield* Queue.take(h.fake.barriers.mutations);
    expect(stop.request.intent.kind).toBe('Stop');
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(makeStartedWorkerSnapshot());
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test(
  'validated execution completion requests bounded cleanup before Stop',
  selfCompletedWorkRequestsCleanup,
);

for (const failure of ['FailedStop', 'FailedRemove', 'Defect'] as const) {
  async function cleanupFailureIsVisible() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(950);
      const running = Match.value(failure).pipe(
        Match.when('FailedRemove', () => false),
        Match.orElse(() => true),
      );
      yield* h.fake.materialize({
        ...makeWorkerCase().observation,
        atMs: 950,
        resources: [{ ...makeWorkerCase().resource, running }],
      });
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      yield* answerNextObservation();
      const mutation = yield* Queue.take(h.fake.barriers.mutations);
      const expectedKind = Match.value(failure).pipe(
        Match.when('FailedRemove', () => 'Remove' as const),
        Match.orElse(() => 'Stop' as const),
      );
      expect(mutation.request.intent.kind).toBe(expectedKind);
      const c = makeWorkerCase();
      const answer = Match.value(failure).pipe(
        Match.whenOr('FailedStop', 'FailedRemove', () =>
          Deferred.succeed(mutation.reply, {
            ...c.reply,
            atMs: 950,
            intentId: mutation.request.intent.intentId,
            issuerId: input.issuerId,
            outcome: {
              _tag: 'Failed',
              reason: { _tag: 'NoCustody', operationId: input.operationId },
            },
          }),
        ),
        Match.when('Defect', () =>
          Deferred.die(mutation.reply, new Error('private mechanism detail')),
        ),
        Match.exhaustive,
      );
      yield* answer;
      const isKnownFailure = Effect.succeed(
        Match.value(failure).pipe(
          Match.whenOr('FailedStop', 'FailedRemove', () => true),
          Match.orElse(() => false),
        ),
      );
      const observe = answerNextObservation().pipe(Effect.when(isKnownFailure));
      yield* observe;
      const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
      expect(blocked.status).toBe('active');
      expect(blocked.context.issue).not.toHaveProperty('cause');
      expect(String(blocked.context.issue)).not.toContain('private mechanism detail');
      const expected = Match.value(failure).pipe(
        Match.whenOr('FailedStop', 'FailedRemove', () => 'NoCustody' as const),
        Match.orElse(() => 'WorkerLifecycleRuntimeError' as const),
      );
      expect(blocked.context.issue?._tag).toBe(expected);
      const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      yield* send(actor, {
        type: 'RequestedReconciliation',
        operationId: input.operationId,
        revision: stored.revision,
      });
      yield* answerNextObservation();
      const reconciled = yield* waitFor(actor, (state) => state.matches('blocked'));
      const afterReconciliation = Match.value(failure).pipe(
        Match.when('Defect', () => 'UnresolvedIntent' as const),
        Match.orElse(() => 'NoCustody' as const),
      );
      expect(reconciled.context.issue?._tag).toBe(afterReconciliation);
      expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toHaveLength(1);
    }
    const seed = {
      ...makeStartedWorkerSnapshot(),
      cleanup: Option.some({
        _tag: 'CleanupPending' as const,
        requestedAtMs: 950,
        deadlineMs: 1150,
      }),
    };
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(seed);
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(`cleanup ${failure} is tagged, observed and not Released`, cleanupFailureIsVisible);
}

async function malformedEventIsRejected() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const actor = yield* readyActor();
    const rejections: EventRejection[] = [];
    const register: Parameters<typeof Effect.callback<EventRejection>>[0] = function register(
      resume,
      signal,
    ) {
      function rejected(event: EventRejection) {
        rejections.push(event);
        subscription.unsubscribe();
        resume(Effect.sync(() => event));
      }
      const subscription = actor.system.onRejectedEvent(rejected);
      signal.addEventListener('abort', () => subscription.unsubscribe(), { once: true });
    };
    const rejection = Effect.callback(register);
    const rejectedEvent = yield* Effect.forkChild(rejection, { startImmediately: true });
    const delivering = send(actor, {
      type: 'RequestedExecution',
      operationId: input.operationId,
      // @ts-expect-error Runtime rejection is required as well as this static rejection.
      revision: 'bad',
    });
    yield* delivering;
    const rejected = yield* Fiber.join(rejectedEvent);
    expect(rejected.reason).toBe('invalidEvent');
    expect(rejections).toHaveLength(1);
    expect(actor.getSnapshot().matches('ready')).toBe(true);
    const snapshot = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    expect(snapshot.executionAuthorizedAtMs).toEqual(Option.none());
    expect((yield* Ref.get(h.fake.calls)).filter(isNativeWrite)).toEqual([]);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(makeStartedWorkerSnapshot());
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test('runtime malformed events are rejected before native work', malformedEventIsRejected);

async function mutationDeadlineIsAmbiguous() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    const create = yield* Queue.take(h.fake.barriers.mutations);
    yield* TestClock.adjust('50 millis');
    yield* Deferred.await(create.interrupted);
    const state = yield* waitFor(
      actor,
      (snapshot) => snapshot.matches('blocked') || snapshot.matches('reconciling'),
    );
    expect(state.matches('creating')).toBe(false);
    const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    expect(stored.intents[0]?.outcome._tag).toBe('Unknown');
    expect(stored.outcomeEvidenceFloorMs).toBe(1000);
    yield* h.fake.materialize({ ...makeWorkerCase().observation, atMs: 1000 });
    expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toHaveLength(1);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(makeWorkerSnapshot());
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test(
  'absolute mutation timeout interrupts locally but records Unknown, not failure or absence',
  mutationDeadlineIsAmbiguous,
);

async function unboundAbsenceCannotFollowBindingRace() {
  const c = makeWorkerCase();
  const intent = makeWorkerIntent();
  const seed = {
    ...makeWorkerSnapshot(),
    intents: [intent],
    cleanup: Option.some({ _tag: 'CleanupPending' as const, requestedAtMs: 950, deadlineMs: 1150 }),
  };
  function* scenario() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    const discovery = yield* Queue.take(h.fake.barriers.observations);
    expect(discovery.request.containerId).toEqual(Option.none());
    const current = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    const committed = yield* h.journal.service.commit({
      _tag: 'RecordOutcome',
      operationId: input.operationId,
      expectedRevision: current.revision,
      atMs: 950,
      reply: {
        ...c.reply,
        atMs: 950,
        intentId: intent.intentId,
        outcome: { _tag: 'Completed', observation: { ...c.observation, atMs: 950 } },
      },
    });
    expect(committed._tag).toBe('Committed');
    yield* Deferred.succeed(discovery.reply, {
      ...c.observation,
      atMs: 950,
      resources: [],
      staging: 'Absent',
    });
    const settled = yield* waitFor(
      actor,
      (state) => state.matches('blocked') || state.matches('released'),
    );
    expect(settled.matches('released')).toBe(false);
    const snapshot = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
    expect(Option.getOrThrow(snapshot.cleanup)._tag).not.toBe('CleanupConfirmed');
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(seed);
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test(
  'unbound discovery absence cannot confirm cleanup after a concurrent immutable-ID binding',
  unboundAbsenceCannotFollowBindingRace,
);

for (const fault of ['malformed', 'subject', 'time'] as const) {
  async function invalidExecutionReply() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      const actor = yield* readyActor();
      const before = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      yield* send(actor, {
        type: 'RequestedExecution',
        operationId: input.operationId,
        revision: before.revision,
      });
      const execution = yield* Queue.take(h.fake.barriers.executions);
      const valid = {
        operationId: input.operationId,
        identity: before.operation.identity,
        completedAtMs: 950,
      };
      const replies = {
        malformed: {},
        subject: { ...valid, operationId: 'foreign' },
        time: { ...valid, completedAtMs: 1001 },
      };
      yield* Deferred.succeed(execution.reply, replies[fault]);
      const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
      expect(blocked.context.issue).not.toBeNull();
      const after = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      expect(after.cleanup).toEqual(Option.none());
      expect(after.executionAuthorizedAtMs).toEqual(Option.some(950));
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeStartedWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(
    `${fault} execution reply cannot request cleanup or masquerade as completion`,
    invalidExecutionReply,
  );
}

async function invalidCustodyCannotMutate() {
  const original = makeWorkerSnapshot();
  const seed = {
    ...original,
    operation: {
      ...original.operation,
      custody: { ...original.operation.custody, stagingDirectory: '/outside/controller' },
    },
  };
  function* scenario() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
    expect(blocked.context.issue?._tag).toBe('NoCustody');
    expect(yield* Ref.get(h.fake.calls)).toEqual([]);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(seed);
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test('invalid custody blocks before any native mutation or readback', invalidCustodyCannotMutate);

async function supersededOwnedCleanup() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(1001);
    const c = makeWorkerCase();
    const replacement = {
      ...c.operation.identity,
      generation: c.operation.identity.generation + 1,
    };
    yield* h.journal.replaceAuthority(input.operationId, replacement, Option.none());
    yield* h.fake.materialize({ ...c.observation, atMs: 1001 });
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    yield* answerNextObservation();
    const stop = yield* Queue.take(h.fake.barriers.mutations);
    expect(stop.request.intent.resource).toBe(c.containerId);
    expect(stop.request.operation.identity).toEqual(c.operation.identity);
    expect(stop.request.operation.limits).toEqual(c.operation.limits);
    expect(actor.getSnapshot().matches('stopping')).toBe(true);
  }
  const seed = {
    ...makeStartedWorkerSnapshot(),
    cleanup: Option.some({ _tag: 'CleanupPending' as const, requestedAtMs: 950, deadlineMs: 1150 }),
  };
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const services = lifecycleTestLayer(seed);
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
}
test(
  'superseded generation can clean only its bound old resource after execution expiry',
  supersededOwnedCleanup,
);

for (const point of ['before-AuthorizeExecution', 'after-AuthorizeExecution'] as const) {
  async function authorizationCancellationRace() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      const actor = yield* readyActor();
      const gate = yield* journalGate(h, point);
      const before = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      yield* send(actor, {
        type: 'RequestedExecution',
        operationId: input.operationId,
        revision: before.revision,
      });
      yield* Deferred.await(gate.entered);
      yield* cancelPersisted();
      yield* Deferred.succeed(gate.resume, undefined);
      yield* waitFor(actor, (state) => state.matches('blocked') || state.matches('reconciling'));
      const calls = yield* Ref.get(h.fake.calls);
      expect(calls.filter(isNativeWrite)).toEqual([]);
      const after = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      expect(after.authority.cancelledAtMs).toEqual(Option.some(950));
      const expected = Match.value(point).pipe(
        Match.when('before-AuthorizeExecution', () => false),
        Match.orElse(() => true),
      );
      expect(Option.isSome(after.executionAuthorizedAtMs)).toBe(expected);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeStartedWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(`cancellation at ${point} prevents native execution`, authorizationCancellationRace);
}

for (const fault of [
  'malformed',
  'subject',
  'intent',
  'issuer',
  'time',
  'empty',
  'foreign-resource',
] as const) {
  async function mutationReplyCannotAuthorizeNextAction() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      const c = makeWorkerCase();
      yield* TestClock.setTime(950);
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      const create = yield* Queue.take(h.fake.barriers.mutations);
      const valid = {
        ...c.reply,
        atMs: 950,
        intentId: create.request.intent.intentId,
        outcome: { _tag: 'Completed', observation: { ...c.observation, atMs: 950 } },
      };
      const replies = {
        malformed: {},
        subject: { ...valid, operationId: 'foreign-operation' },
        intent: { ...valid, intentId: 'stale-intent' },
        issuer: { ...valid, issuerId: 'foreign-issuer' },
        time: { ...valid, atMs: 1001 },
        empty: {
          ...valid,
          outcome: {
            _tag: 'Completed',
            observation: { ...c.observation, atMs: 950, resources: [] },
          },
        },
        'foreign-resource': {
          ...valid,
          outcome: {
            _tag: 'Completed',
            observation: {
              ...c.observation,
              atMs: 950,
              resources: [{ ...c.resource, operationId: 'foreign-operation' }],
            },
          },
        },
      };
      yield* Deferred.succeed(create.reply, replies[fault]);
      yield* answerNextObservation();
      const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
      expect(blocked.status).toBe('active');
      expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toHaveLength(1);
      const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      expect(stored.intents[0]?.outcome._tag).toBe('Claimed');
      expect(stored.containerId).toEqual(Option.none());
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(makeWorkerSnapshot());
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(
    `${fault} mutation reply cannot bind or authorize Start`,
    mutationReplyCannotAuthorizeNextAction,
  );
}

for (const kind of ['Create', 'Start'] as const) {
  for (const outcome of ['Claimed', 'Unknown'] as const) {
    async function unresolvedStartupBlocksCleanup() {
      const c = makeWorkerCase();
      const unresolvedOutcome = Match.value(outcome).pipe(
        Match.when('Claimed', () => ({ _tag: 'Claimed' as const })),
        Match.when('Unknown', () => ({
          _tag: 'Unknown' as const,
          reason: { _tag: 'UnresolvedIntent' as const, operationId: input.operationId },
        })),
        Match.exhaustive,
      );
      const intent = { ...makeWorkerIntent(kind), outcome: unresolvedOutcome };
      const seed = Match.value(kind).pipe(
        Match.when('Create', () => ({ ...makeWorkerSnapshot(), intents: [intent] })),
        Match.when('Start', () => ({
          ...makeStartedWorkerSnapshot(),
          intents: [...makeStartedWorkerSnapshot().intents.slice(0, 1), intent],
        })),
        Match.exhaustive,
      );
      function* scenario() {
        const h = yield* LifecycleHarness;
        yield* TestClock.setTime(950);
        const resources = Match.value(kind).pipe(
          Match.when('Create', () => []),
          Match.when('Start', () => [{ ...c.resource, running: false }]),
          Match.exhaustive,
        );
        yield* h.fake.materialize({ ...c.observation, atMs: 950, resources, staging: 'Absent' });
        yield* cancelPersisted();
        const actor = yield* createEffectActor(workerLifecycleMachine, { input });
        yield* answerNextObservation();
        const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
        expect(blocked.context.issue?._tag).toBe('UnresolvedIntent');
        expect((yield* Ref.get(h.fake.calls)).filter(isNativeWrite)).toEqual([]);
        const stored = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
        expect(stored.intents.at(-1)?.outcome._tag).toBe(outcome);
        expect(Option.getOrThrow(stored.cleanup)._tag).not.toBe('CleanupConfirmed');
      }
      const program = Effect.gen(scenario);
      const scoped = Effect.scoped(program);
      const services = lifecycleTestLayer(seed);
      const provided = Effect.provide(scoped, services);
      await Effect.runPromise(provided);
    }
    test(`${outcome} ${kind} still blocks cancelled cleanup`, unresolvedStartupBlocksCleanup);
  }
}

for (const recovery of [
  'Claimed',
  'Unknown',
  'ExecutionAuthorized',
  'RemoveAndUnresolvedCreate',
] as const) {
  async function reconstructionNeverReplays() {
    const c = makeWorkerCase();
    const unknownCreate = {
      ...makeWorkerIntent(),
      outcome: {
        _tag: 'Unknown' as const,
        reason: { _tag: 'UnresolvedIntent' as const, operationId: input.operationId },
      },
    };
    const seed = Match.value(recovery).pipe(
      Match.when('Claimed', () => ({ ...makeWorkerSnapshot(), intents: [makeWorkerIntent()] })),
      Match.when('Unknown', () => ({ ...makeWorkerSnapshot(), intents: [unknownCreate] })),
      Match.when('ExecutionAuthorized', () => ({
        ...makeStartedWorkerSnapshot(),
        executionAuthorizedAtMs: Option.some(950),
      })),
      Match.when('RemoveAndUnresolvedCreate', () => ({
        ...makeStartedWorkerSnapshot(),
        intents: [unknownCreate, { ...makeWorkerIntent('Remove'), outcome: unknownCreate.outcome }],
        cleanup: Option.some({
          _tag: 'CleanupPending' as const,
          requestedAtMs: 950,
          deadlineMs: 1150,
        }),
      })),
      Match.exhaustive,
    );
    function* scenario() {
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(950);
      const resources = Match.value(recovery).pipe(
        Match.when('ExecutionAuthorized', () => [c.resource]),
        Match.orElse(() => []),
      );
      yield* h.fake.materialize({ ...c.observation, atMs: 950, resources, staging: 'Absent' });
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      yield* answerNextObservation();
      const blocked = yield* waitFor(actor, (state) => state.matches('blocked'));
      expect(blocked.status).toBe('active');
      expect((yield* Ref.get(h.fake.calls)).filter(isNativeWrite)).toEqual([]);
      const snapshot = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      const confirmed = Option.exists(snapshot.cleanup, (cleanup) =>
        Match.value(cleanup).pipe(
          Match.tag('CleanupConfirmed', () => true),
          Match.orElse(() => false),
        ),
      );
      expect(confirmed).toBe(false);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(seed);
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(
    `fresh actor with ${recovery} reconciles without replay or guessed absence`,
    reconstructionNeverReplays,
  );
}

for (const kind of ['Create', 'Start', 'Stop', 'Remove'] as const) {
  async function lostClaimCas() {
    const c = makeWorkerCase();
    const started = makeStartedWorkerSnapshot();
    const seed = Match.value(kind).pipe(
      Match.when('Create', makeWorkerSnapshot),
      Match.when('Start', () => ({ ...started, intents: started.intents.slice(0, 1) })),
      Match.orElse(() => ({
        ...started,
        cleanup: Option.some({
          _tag: 'CleanupPending' as const,
          requestedAtMs: 950,
          deadlineMs: 1150,
        }),
      })),
    );
    function* scenario() {
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(950);
      const gate = yield* journalGate(h, 'before-Claim');
      const external = Match.value(kind).pipe(
        Match.when('Stop', () => ({ ...c.observation, atMs: 950 })),
        Match.orElse(() => ({
          ...c.observation,
          atMs: 950,
          resources: [{ ...c.resource, running: false }],
        })),
      );
      yield* h.fake.materialize(external);
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      const isExisting = Effect.succeed(
        Match.value(kind).pipe(
          Match.when('Create', () => false),
          Match.orElse(() => true),
        ),
      );
      const answer = answerNextObservation().pipe(Effect.when(isExisting));
      yield* answer;
      yield* Deferred.await(gate.entered);
      const current = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      yield* h.journal.service.commit({
        _tag: 'RequestCleanup',
        operationId: input.operationId,
        expectedRevision: current.revision,
        atMs: 950,
        cleanupWindowMs: 200,
      });
      yield* Deferred.succeed(gate.resume, undefined);
      const state = yield* waitFor(
        actor,
        (snapshot) => snapshot.matches('blocked') || snapshot.matches('reconciling'),
      );
      expect(state.matches('blocked')).toBe(true);
      expect((yield* Ref.get(h.fake.calls)).filter(isNativeWrite)).toEqual([]);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(seed);
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(`lost ${kind} claim CAS blocks rather than automatically retrying a write`, lostClaimCas);
}

for (const kind of ['Create', 'Start', 'Remove'] as const) {
  async function lostResponse() {
    const isStart = Match.value(kind).pipe(
      Match.when('Start', () => true),
      Match.orElse(() => false),
    );
    const isRemove = Match.value(kind).pipe(
      Match.when('Remove', () => true),
      Match.orElse(() => false),
    );
    function* scenario() {
      const h = yield* LifecycleHarness;
      const c = makeWorkerCase();
      yield* TestClock.setTime(950);
      const stopped = {
        ...c.observation,
        atMs: 950,
        resources: [{ ...c.resource, running: false }],
      };
      yield* h.fake.materialize(stopped);
      const actor = yield* createEffectActor(workerLifecycleMachine, { input });
      const removing = Effect.sync(() => isRemove);
      const starting = Effect.sync(() => isStart);
      const notRemoving = Effect.sync(() => !isRemove);
      const prepareRemove = answerNextObservation().pipe(Effect.when(removing));
      yield* prepareRemove;
      const first = yield* Queue.take(h.fake.barriers.mutations);
      const completeCreate = completeMutation(first, false).pipe(Effect.when(starting));
      yield* completeCreate;
      const next = yield* Queue.take(h.fake.barriers.mutations).pipe(Effect.when(starting));
      const lost = Option.getOrElse(next, () => first);
      expect(lost.request.intent.kind).toBe(kind);
      yield* Deferred.fail(
        lost.reply,
        new WorkerMechanismError({ operation: 'mutate', code: 'Unavailable' }),
      );
      const inspect = yield* Queue.take(h.fake.barriers.observations);
      const unknown = Option.getOrThrow(yield* h.journal.inspect(input.operationId));
      expect(unknown.intents.find((intent) => intent.kind === kind)?.outcome._tag).toBe('Unknown');
      const absence = { ...c.observation, atMs: 950, resources: [], staging: 'Absent' as const };
      const readback = Match.value(kind).pipe(
        Match.when('Start', () => stopped),
        Match.orElse(() => absence),
      );
      yield* h.fake.materialize(readback);
      yield* h.fake.readback(inspect);
      const settled = yield* waitFor(
        actor,
        (state) => state.matches('blocked') || state.matches('released'),
      );
      expect(settled.matches('released')).toBe(isRemove);
      expect(settled.context.taskError?._tag).toBe('WorkerMechanismError');
      const again = send(actor, {
        type: 'RequestedReconciliation',
        operationId: input.operationId,
        revision: unknown.revision,
      });
      yield* again;
      const repeat = answerNextObservation().pipe(Effect.when(notRemoving));
      yield* repeat;
      yield* waitFor(actor, (state) => state.matches('blocked') || state.matches('released'));
      expect(
        (yield* Ref.get(h.fake.calls))
          .filter(isMutation)
          .filter((call) => call.request.intent.kind === kind),
      ).toHaveLength(1);
    }
    const seed = Match.value(kind).pipe(
      Match.when('Remove', () => ({
        ...makeStartedWorkerSnapshot(),
        cleanup: Option.some({
          _tag: 'CleanupPending' as const,
          requestedAtMs: 950,
          deadlineMs: 1150,
        }),
      })),
      Match.orElse(makeWorkerSnapshot),
    );
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const services = lifecycleTestLayer(seed);
    const provided = Effect.provide(scoped, services);
    await Effect.runPromise(provided);
  }
  test(
    `lost ${kind} response preserves uncertainty and never reissues its claimed action`,
    lostResponse,
  );
}
