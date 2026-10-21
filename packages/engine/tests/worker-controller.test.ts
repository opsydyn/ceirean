import { expect, test } from 'bun:test';

import {
  WorkerIssuerId,
  WorkerOperationId,
  WorkerContainerId,
  WorkerHostId,
  WorkerDaemonId,
} from '@ceirean/domain';
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Match,
  Option,
  Queue,
  Ref,
  Result,
} from 'effect';
import { TestClock } from 'effect/testing';

import * as Engine from '../src/index.ts';
import type { WorkerJournalSnapshot } from '../src/worker-contracts.ts';
import { WorkerJournalError, WorkerMechanismError } from '../src/worker-errors.ts';
import { WorkerJournal, WorkerMechanism } from '../src/worker-ports.ts';
import {
  LifecycleHarness,
  journalGate,
  lifecycleTestLayer,
  makeControlledWorkerMechanism,
  type MutationBarrier,
  type ObservationBarrier,
} from './worker-fakes.ts';
import {
  makeStartedWorkerSnapshot,
  makeWorkerCase,
  makeWorkerSnapshot,
} from './worker-fixtures.ts';
import { makeMemoryWorkerJournal } from './worker-memory-journal.ts';

function* consumeLifecycle() {
  const lifecycle = yield* Engine.WorkerLifecycle;
  const c = makeWorkerCase();
  yield* lifecycle.acquire(c.operation);
  yield* lifecycle.requestExecution(c.operation.operationId);
  yield* lifecycle.cancel(c.operation.operationId);
  yield* lifecycle.reconcile(c.operation.operationId);
  yield* lifecycle.requestCleanup(c.operation.operationId);
  yield* lifecycle.read(c.operation.operationId);
  yield* lifecycle.shutdown();
}
const consumer = Effect.gen(consumeLifecycle);
export async function consumerBoundaryProof(
  service: Effect.Success<ReturnType<typeof Engine.makeWorkerLifecycle>>,
) {
  const onlyLifecycle = Layer.succeed(Engine.WorkerLifecycle, service);
  const supplied = Effect.provide(consumer, onlyLifecycle);
  await Effect.runPromise(supplied);
  const acquisition = Engine.makeWorkerLifecycle(WorkerIssuerId.make('controller-1'));
  const scoped = Effect.scoped(acquisition);
  // @ts-expect-error Actual scoped acquisition still needs both real ports.
  await Effect.runPromise(scoped);
  const journal = makeMemoryWorkerJournal([makeWorkerSnapshot()]).pipe(
    Effect.map((memory) => memory.service),
  );
  const journalOnly = Layer.effect(WorkerJournal, journal);
  const withoutMechanism = Effect.provide(scoped, journalOnly);
  // @ts-expect-error A real journal alone cannot acquire the interpreter service.
  await Effect.runPromise(withoutMechanism);
  const mechanism = makeControlledWorkerMechanism(makeWorkerCase().observation).pipe(
    Effect.map((fake) => fake.service),
  );
  const mechanismOnly = Layer.effect(WorkerMechanism, mechanism);
  const withoutJournal = Effect.provide(scoped, mechanismOnly);
  // @ts-expect-error A real mechanism alone cannot acquire the interpreter service.
  await Effect.runPromise(withoutJournal);
}

const issuer = WorkerIssuerId.make('controller-1');

async function concurrentAcquisition() {
  expect(Engine).toHaveProperty('makeWorkerLifecycle');
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    const replies = yield* Effect.all(
      [service.acquire(c.operation), service.acquire(c.operation)],
      { concurrency: 'unbounded' },
    );
    expect(replies).toEqual([
      { _tag: 'Accepted', operationId: c.operation.operationId },
      { _tag: 'Accepted', operationId: c.operation.operationId },
    ]);
    const create = yield* Queue.take(h.fake.barriers.mutations);
    expect(create.request.intent.kind).toBe('Create');
    expect((yield* Ref.get(h.edits)).map((edit) => edit._tag)).toEqual(['Claim']);
    const refused = yield* service.acquire({ ...c.operation, purpose: 'Baseline' });
    expect(refused).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'ConflictingOperation', operationId: c.operation.operationId },
    });
    expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toHaveLength(1);
    expect(yield* service.acquire({ operationId: 'worker-1' })).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'InvalidInput' },
    });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'concurrent identical acquisition owns one root and rejects immutable conflicts',
  concurrentAcquisition,
);

async function rejectedFirstAcquisition() {
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    const conflicting = { ...c.operation, purpose: 'Baseline' };
    expect(yield* service.acquire(conflicting)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'ConflictingOperation', operationId: c.operation.operationId },
    });
    expect(yield* Ref.get(h.fake.calls)).toEqual([]);
    expect(yield* service.acquire(c.operation)).toEqual({
      _tag: 'Accepted',
      operationId: c.operation.operationId,
    });
    const create = yield* Queue.take(h.fake.barriers.mutations);
    expect(create.request.operation.purpose).toBe('Candidate');
    expect((yield* Ref.get(h.edits)).map((edit) => edit._tag)).toEqual(['Claim']);
    expect(yield* service.acquire(conflicting)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'ConflictingOperation', operationId: c.operation.operationId },
    });
    expect((yield* service.acquire(c.operation))._tag).toBe('Accepted');
    expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toHaveLength(1);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'rejected conflicting-first intake cannot poison later canonical persisted-operation ownership',
  rejectedFirstAcquisition,
);

async function rejectedConcurrentAcquisition() {
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    const gate = yield* journalGate(h, 'before-load');
    const rejected = yield* service
      .acquire({ ...c.operation, purpose: 'Baseline' })
      .pipe(Effect.forkScoped);
    yield* Deferred.await(gate.entered);
    const canonical = yield* service.acquire(c.operation).pipe(Effect.forkScoped);
    const duplicate = yield* service.acquire(c.operation).pipe(Effect.forkScoped);
    yield* service.read(c.operation.operationId);
    expect(canonical.pollUnsafe()).toBeUndefined();
    expect(duplicate.pollUnsafe()).toBeUndefined();
    yield* Deferred.succeed(gate.resume, undefined);
    expect((yield* Fiber.join(rejected))._tag).toBe('Refused');
    expect(yield* Fiber.join(canonical)).toEqual({
      _tag: 'Accepted',
      operationId: c.operation.operationId,
    });
    expect(yield* Fiber.join(duplicate)).toEqual({
      _tag: 'Accepted',
      operationId: c.operation.operationId,
    });
    const create = yield* Queue.take(h.fake.barriers.mutations);
    expect(create.request.operation.purpose).toBe('Candidate');
    expect((yield* Ref.get(h.edits)).map((edit) => edit._tag)).toEqual(['Claim']);
    expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toHaveLength(1);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'canonical concurrent intake waits out a rejected pre-actor reservation and shares one owner',
  rejectedConcurrentAcquisition,
);

async function rejectedReservationDrainRace() {
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    const gate = yield* journalGate(h, 'before-load');
    const rejected = yield* service
      .acquire({ ...c.operation, purpose: 'Baseline' })
      .pipe(Effect.forkScoped);
    yield* Deferred.await(gate.entered);
    const canonical = yield* service.acquire(c.operation).pipe(Effect.forkScoped);
    const draining = yield* service.shutdown().pipe(Effect.result, Effect.forkScoped);
    yield* Effect.yieldNow;
    expect(yield* service.acquire(c.operation)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'ShuttingDown', operationId: c.operation.operationId },
    });
    yield* Deferred.succeed(gate.resume, undefined);
    expect((yield* Fiber.join(rejected))._tag).toBe('Refused');
    expect((yield* Fiber.join(canonical))._tag).toBe('Refused');
    const drained = yield* Fiber.join(draining);
    expect(drained._tag).toBe('Failure');
    expect(yield* service.shutdown().pipe(Effect.result)).toEqual(drained);
    expect(yield* Ref.get(h.fake.calls)).toEqual([]);
    expect(yield* Ref.get(h.edits)).toEqual([]);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'pre-actor rejection retirement cannot reopen the atomic drain gate for a waiting canonical caller',
  rejectedReservationDrainRace,
);

async function shutdownAcquisitionRace() {
  expect(Engine).toHaveProperty('makeWorkerLifecycle');
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    const gate = yield* journalGate(h, 'before-load');
    const acquiring = yield* service.acquire(c.operation).pipe(Effect.forkScoped);
    yield* Deferred.await(gate.entered);
    const draining = yield* service.shutdown().pipe(Effect.result, Effect.forkScoped);
    yield* Effect.yieldNow;
    expect(yield* service.acquire(c.operation)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'ShuttingDown', operationId: c.operation.operationId },
    });
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(draining);
    expect(result._tag).toBe('Failure');
    yield* Fiber.join(acquiring).pipe(Effect.result);
    yield* Deferred.succeed(gate.resume, undefined);
    expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toEqual([]);
    expect(yield* service.shutdown().pipe(Effect.result)).toEqual(result);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'shutdown atomically fences an in-flight acquisition and closes its invocation',
  shutdownAcquisitionRace,
);

async function committedExecutionAcknowledgment() {
  expect(Engine).toHaveProperty('makeWorkerLifecycle');
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    yield* h.fake.materialize({ ...c.observation, atMs: 950 });
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* h.fake.readback(yield* Queue.take(h.fake.barriers.observations));
    yield* h.fake.readback(yield* Queue.take(h.fake.barriers.observations));
    const gate = yield* journalGate(h, 'before-AuthorizeExecution');
    const request = yield* service
      .requestExecution(c.operation.operationId)
      .pipe(Effect.forkScoped);
    yield* Deferred.await(gate.entered);
    expect(request.pollUnsafe()).toBeUndefined();
    const before = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
    expect(before.executionAuthorizedAtMs).toEqual(Option.none());
    yield* Deferred.succeed(gate.resume, undefined);
    const observed = yield* Fiber.join(request);
    expect(observed._tag).toBe('Observed');
    const snapshot = Match.value(observed).pipe(
      Match.tag('Observed', ({ snapshot }) => snapshot),
      Match.orElse(() => expect.unreachable('authorization must commit')),
    );
    expect(snapshot.executionAuthorizedAtMs).toEqual(Option.some(950));
    const execution = yield* Queue.take(h.fake.barriers.executions);
    expect(Option.isNone(yield* Deferred.poll(execution.reply))).toBe(true);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeStartedWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'execution acknowledgment waits for committed authorization rather than mailbox delivery',
  committedExecutionAcknowledgment,
);

function isMutation(call: { readonly kind: string }) {
  return Match.value(call.kind).pipe(
    Match.when('mutate', () => true),
    Match.orElse(() => false),
  );
}

function observationFor(barrier: ObservationBarrier, running = true, absent = false) {
  const c = makeWorkerCase();
  const operation = barrier.request.operation;
  const containerId = Option.getOrElse(barrier.request.containerId, () => c.containerId);
  const resource = { ...c.resource, ...operation, containerId, running };
  const resources = Match.value(absent).pipe(
    Match.when(true, () => []),
    Match.orElse(() => [resource]),
  );
  return { ...c.observation, ...operation, atMs: 950, resources };
}
function answerObservation(barrier: ObservationBarrier, running = true, absent = false) {
  function* readAtCurrentTime() {
    const atMs = yield* Clock.currentTimeMillis;
    const observation = observationFor(barrier, running, absent);
    yield* Deferred.succeed(barrier.reply, { ...observation, atMs });
  }
  const program = Effect.gen(readAtCurrentTime);
  return program;
}
function siblingSnapshot(): WorkerJournalSnapshot {
  const snapshot = makeStartedWorkerSnapshot();
  const operationId = WorkerOperationId.make('worker-2');
  const containerId = WorkerContainerId.make('container-2');
  const operation = {
    ...snapshot.operation,
    operationId,
    custody: {
      ...snapshot.operation.custody,
      stagingDirectory: '/synthetic/ceirean/worker-2',
      containerSlot: 'slot-2',
      retainedArtifacts: ['/synthetic/evidence/worker-2.json'],
    },
  };
  const c = makeWorkerCase();
  const observation = {
    ...c.observation,
    ...operation,
    atMs: 950,
    resources: [{ ...c.resource, ...operation, containerId }],
  };
  function rebind(intent: WorkerJournalSnapshot['intents'][number]) {
    const resource = Match.value(intent.kind).pipe(
      Match.when('Create', () => 'slot-2'),
      Match.orElse(() => containerId),
    );
    return {
      ...intent,
      operationId,
      resource,
      outcome: { _tag: 'Completed' as const, observation },
    };
  }
  const intents = snapshot.intents.map(rebind);
  return { ...snapshot, operation, intents, containerId: Option.some(containerId) };
}

async function cancelOwnedSibling() {
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    const sibling = siblingSnapshot();
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* service.acquire(sibling.operation);
    for (let i = 0; i < 4; i++)
      yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    const authorized = yield* service.requestExecution(sibling.operation.operationId);
    expect(authorized._tag).toBe('Observed');
    const execution = yield* Queue.take(h.fake.barriers.executions);
    const cancelled = yield* service.cancel(c.operation.operationId);
    expect(cancelled._tag).toBe('Observed');
    yield* Deferred.await(execution.interrupted);
    for (const id of [c.operation.operationId, sibling.operation.operationId]) {
      const snapshot = Option.getOrThrow(yield* h.journal.inspect(id));
      expect(snapshot.authority.cancelledAtMs).toEqual(Option.some(950));
      expect(snapshot.cleanup).toEqual(
        Option.some({ _tag: 'CleanupPending', requestedAtMs: 950, deadlineMs: 1050 }),
      );
    }
    expect((yield* service.requestExecution(sibling.operation.operationId))._tag).toBe('Refused');
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(
    scoped,
    lifecycleTestLayer(makeStartedWorkerSnapshot(), [siblingSnapshot()]),
  );
  await Effect.runPromise(provided);
}
test(
  'run cancellation persists sibling cleanup and interrupts its owned execution',
  cancelOwnedSibling,
);

async function shutdownReadbackFailure() {
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    const draining = yield* service.shutdown().pipe(Effect.result, Effect.forkScoped);
    const readback = yield* Queue.take(h.fake.barriers.observations);
    const error = new WorkerMechanismError({ operation: 'observe', code: 'Unavailable' });
    yield* Deferred.fail(readback.reply, error);
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(draining);
    expect(result).toEqual(Result.fail(error));
    expect(yield* service.read(c.operation.operationId).pipe(Effect.result)).toEqual(
      Result.fail(error),
    );
    expect(yield* service.shutdown().pipe(Effect.result)).toEqual(result);
    const snapshot = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
    expect(Option.getOrThrow(snapshot.cleanup)._tag).not.toBe('CleanupConfirmed');
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeStartedWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'shutdown retains a typed readback failure instead of masking it as drain expiry',
  shutdownReadbackFailure,
);

for (const failure of ['defect', 'typed failure'] as const) {
  async function shutdownCleanupFault() {
    function* scenario() {
      const c = makeWorkerCase();
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(950);
      const service = yield* Engine.makeWorkerLifecycle(issuer);
      yield* service.acquire(c.operation);
      yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
      yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
      const journalError = new WorkerJournalError({ operation: 'commit', code: 'CommitFailed' });
      const fault = Match.value(failure).pipe(
        Match.when('defect', () => ({
          _tag: 'Defect' as const,
          defect: 'private-cleanup-journal-defect',
        })),
        Match.orElse(() => ({ _tag: 'Failure' as const, error: journalError })),
      );
      yield* Ref.set(h.cleanupFault, Option.some(fault));
      const first = yield* service.shutdown().pipe(Effect.exit);
      const calls = yield* Ref.get(h.fake.calls);
      const repeated = yield* service.shutdown().pipe(Effect.exit);
      const laterRead = yield* service.read(c.operation.operationId).pipe(Effect.exit);
      const expected = Match.value(failure).pipe(
        Match.when('defect', () => ({
          _tag: 'WorkerLifecycleRuntimeError',
          operationId: 'worker-1',
          code: 'ActorFailed',
        })),
        Match.orElse(() => ({
          _tag: 'WorkerJournalError',
          operation: 'commit',
          code: 'CommitFailed',
        })),
      );
      for (const exit of [first, repeated, laterRead]) {
        const cause = Match.value(exit).pipe(
          Match.tag('Failure', ({ cause }) => cause),
          Match.orElse(() => expect.unreachable('cleanup failure must remain visible')),
        );
        expect(cause.reasons.map((reason) => reason._tag)).toEqual(['Fail']);
        const reason = Cause.findFail(cause).pipe(Result.getSuccess, Option.getOrThrow);
        const error = reason.error;
        expect(error).toEqual(expect.objectContaining(expected));
        expect(error.message).not.toContain('private-cleanup-journal-defect');
        expect('cause' in error).toBe(false);
      }
      expect(repeated).toEqual(first);
      expect(yield* Ref.get(h.fake.calls)).toEqual(calls);
      const snapshot = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
      expect(snapshot.cleanup).toEqual(Option.none());
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, lifecycleTestLayer(makeStartedWorkerSnapshot()));
    await Effect.runPromise(provided);
  }
  test(
    `shutdown cleanup ${failure} is tagged before caching and remains visible on repeated shutdown and read`,
    shutdownCleanupFault,
  );
}

function completeMutation(barrier: MutationBarrier, running: boolean, absent = false) {
  function* completeExternalWork() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    const operation = barrier.request.operation;
    const atMs = yield* Clock.currentTimeMillis;
    const resources = Match.value(absent).pipe(
      Match.when(true, () => []),
      Match.orElse(() => [{ ...c.resource, ...operation, containerId: c.containerId, running }]),
    );
    const observation = { ...c.observation, ...operation, atMs, resources };
    yield* h.fake.materialize(observation);
    yield* Deferred.succeed(barrier.reply, {
      ...operation,
      intentId: barrier.request.intent.intentId,
      issuerId: barrier.request.intent.issuerId,
      atMs,
      outcome: { _tag: 'Completed', observation },
    });
  }
  const program = Effect.gen(completeExternalWork);
  return program;
}

for (const point of [
  'post-claim/pre-call',
  'in-flight-create',
  'post-create/pre-outcome',
  'in-flight-remove',
] as const) {
  async function simulatedReconstruction() {
    function* firstScope() {
      const c = makeWorkerCase();
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(950);
      const postClaim = Match.value(point).pipe(
        Match.when('post-claim/pre-call', () => true),
        Match.orElse(() => false),
      );
      const postCreate = Match.value(point).pipe(
        Match.when('post-create/pre-outcome', () => true),
        Match.orElse(() => false),
      );
      const removing = Match.value(point).pipe(
        Match.when('in-flight-remove', () => true),
        Match.orElse(() => false),
      );
      const gatePoint = Match.value(postClaim).pipe(
        Match.when(true, () => 'after-Claim'),
        Match.orElse(() => 'before-RecordOutcome'),
      );
      const gate = yield* journalGate(h, gatePoint);
      const service = yield* Engine.makeWorkerLifecycle(issuer);
      yield* service.acquire(c.operation);
      function* duringRemove() {
        yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
        yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
        yield* service.requestCleanup(c.operation.operationId);
        yield* answerObservation(yield* Queue.take(h.fake.barriers.observations), false);
        const remove = yield* Queue.take(h.fake.barriers.mutations);
        expect(remove.request.intent.kind).toBe('Remove');
      }
      function* duringCreate() {
        const create = yield* Queue.take(h.fake.barriers.mutations);
        expect(create.request.intent.kind).toBe('Create');
        const completed = Effect.sync(() => postCreate);
        yield* completeMutation(create, false).pipe(Effect.when(completed));
        yield* Deferred.await(gate.entered).pipe(Effect.when(completed));
      }
      const creating = Effect.gen(duringCreate);
      const removal = Effect.gen(duringRemove);
      const waiting = Match.value({ postClaim, removing }).pipe(
        Match.when({ postClaim: true }, () => Deferred.await(gate.entered)),
        Match.when({ removing: true }, () => removal),
        Match.orElse(() => creating),
      );
      yield* waiting;
      const stored = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
      const cancellation = yield* h.journal.service.commit({
        _tag: 'RequestCancellation',
        operationId: c.operation.operationId,
        expectedRevision: stored.revision,
        atMs: 950,
        cleanupWindowMs: 100,
      });
      expect(cancellation._tag).toBe('Committed');
      const snapshot = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
      const external = yield* Ref.get(h.fake.external);
      expect(snapshot.intents.at(-1)?.issuerId).toBe(issuer);
      return { snapshot, external };
    }
    const removing = Match.value(point).pipe(
      Match.when('in-flight-remove', () => true),
      Match.orElse(() => false),
    );
    const seed = Match.value(removing).pipe(
      Match.when(true, makeStartedWorkerSnapshot),
      Match.orElse(makeWorkerSnapshot),
    );
    const initial = Effect.gen(firstScope);
    const initialScope = Effect.scoped(initial);
    const initialServices = Effect.provide(initialScope, lifecycleTestLayer(seed));
    const detached = await Effect.runPromise(initialServices);
    function* freshScope() {
      const c = makeWorkerCase();
      const h = yield* LifecycleHarness;
      yield* TestClock.setTime(950);
      const gate = yield* journalGate(h, 'after-RecordCleanup');
      const external = Match.value(removing).pipe(
        Match.when(true, () => ({
          ...c.observation,
          atMs: 950,
          resources: [],
          staging: 'Absent' as const,
        })),
        Match.orElse(() => detached.external),
      );
      yield* h.fake.materialize(external);
      const service = yield* Engine.makeWorkerLifecycle(WorkerIssuerId.make('controller-2'));
      yield* service.acquire(c.operation);
      const reconcile = yield* Queue.take(h.fake.barriers.observations);
      expect((yield* Ref.get(h.fake.calls)).map((call) => call.kind)).toEqual(['observe']);
      expect(reconcile.request.containerId).toEqual(detached.snapshot.containerId);
      yield* h.fake.readback(reconcile);
      yield* Deferred.await(gate.entered);
      const persisted = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
      expect(persisted.operation.limits).toEqual({ deadlineMs: 1000, spentMicros: 17, repairs: 1 });
      expect(persisted.authority.cancelledAtMs).toEqual(Option.some(950));
      expect(Option.getOrThrow(persisted.cleanup).deadlineMs).toBe(1050);
      expect(persisted.createdAtMs).toBe(900);
      expect(persisted.editTimeFloorMs).toBe(detached.snapshot.editTimeFloorMs);
      expect(persisted.outcomeEvidenceFloorMs).toBe(950);
      expect(persisted.intents[0]?.issuerId).toBe(issuer);
      const expectedOutcome = Match.value(point).pipe(
        Match.whenOr('post-claim/pre-call', 'in-flight-create', () => 'Claimed' as const),
        Match.orElse(() => 'Completed' as const),
      );
      expect(persisted.intents[0]?.outcome._tag).toBe(expectedOutcome);
      yield* Deferred.succeed(gate.resume, undefined);
      const postCreate = Match.value(point).pipe(
        Match.when('post-create/pre-outcome', () => true),
        Match.orElse(() => false),
      );
      function* newCleanupOnly() {
        const remove = yield* Queue.take(h.fake.barriers.mutations);
        expect(remove.request.intent.kind).toBe('Remove');
        expect(remove.request.intent.resource).toBe('container-1');
        expect(remove.request.intent.issuerId).toBe(WorkerIssuerId.make('controller-2'));
      }
      const cleanup = Effect.gen(newCleanupOnly);
      const completed = Effect.sync(() => postCreate);
      yield* cleanup.pipe(Effect.when(completed));
      const writes = (yield* Ref.get(h.fake.calls)).filter(isMutation);
      const expectedCount = Match.value(postCreate).pipe(
        Match.when(true, () => 1),
        Match.orElse(() => 0),
      );
      expect(writes).toHaveLength(expectedCount);
      const first = persisted.intents[0]!;
      const current = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
      const lostClaim = yield* h.journal.service.commit({
        _tag: 'Claim',
        operationId: c.operation.operationId,
        expectedRevision: current.revision,
        atMs: 950,
        intent: {
          ...first,
          claimedAtMs: 950,
          outcome: { _tag: 'Claimed' },
          issuerId: WorkerIssuerId.make('controller-2'),
        },
      });
      expect(lostClaim).toEqual({
        _tag: 'Refused',
        refusal: { _tag: 'AlreadyClaimed', operationId: c.operation.operationId },
      });
      yield* service.acquire(c.operation);
      expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toHaveLength(expectedCount);
      const cleanupTag = Option.getOrThrow(persisted.cleanup)._tag;
      const expectedTag = Match.value(removing).pipe(
        Match.when(true, () => 'CleanupConfirmed' as const),
        Match.orElse(() => 'CleanupUnknown' as const),
      );
      expect(cleanupTag).toBe(expectedTag);
    }
    const fresh = Effect.gen(freshScope);
    const freshScoped = Effect.scoped(fresh);
    const freshProvided = Effect.provide(freshScoped, lifecycleTestLayer(detached.snapshot));
    await Effect.runPromise(freshProvided);
  }
  test(
    `simulated reconstruction at ${point} uses detached business evidence without replay`,
    simulatedReconstruction,
  );
}

async function successfulShutdownAndTombstone() {
  function* firstScope() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* TestClock.setTime(1000);
    const draining = yield* service.shutdown().pipe(Effect.forkScoped);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    const stop = yield* Queue.take(h.fake.barriers.mutations);
    expect(stop.request.intent.kind).toBe('Stop');
    yield* completeMutation(stop, false);
    yield* Deferred.await(stop.finished);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations), false);
    const remove = yield* Queue.take(h.fake.barriers.mutations);
    expect(remove.request.intent.kind).toBe('Remove');
    yield* completeMutation(remove, false, true);
    yield* Deferred.await(remove.finished);
    const absence = yield* Queue.take(h.fake.barriers.observations);
    const atMs = yield* Clock.currentTimeMillis;
    yield* Deferred.succeed(absence.reply, {
      ...c.observation,
      atMs,
      resources: [],
      staging: 'Absent',
    });
    expect(yield* Fiber.join(draining)).toEqual({ _tag: 'Drained' });
    const before = yield* Ref.get(h.fake.calls);
    expect(yield* service.shutdown()).toEqual({ _tag: 'Drained' });
    expect(yield* service.acquire(c.operation)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'ShuttingDown', operationId: c.operation.operationId },
    });
    expect(yield* Ref.get(h.fake.calls)).toEqual(before);
    const snapshot = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
    expect(snapshot.cleanup).toEqual(
      Option.some({
        _tag: 'CleanupConfirmed',
        requestedAtMs: 1000,
        deadlineMs: 1100,
        observedAtMs: 1000,
      }),
    );
    expect(snapshot.operation.limits).toEqual({ deadlineMs: 1000, spentMicros: 17, repairs: 1 });
    return snapshot;
  }
  const initial = Effect.gen(firstScope);
  const initialScoped = Effect.scoped(initial);
  const initialProvided = Effect.provide(
    initialScoped,
    lifecycleTestLayer(makeStartedWorkerSnapshot()),
  );
  const snapshot = await Effect.runPromise(initialProvided);
  function* freshScope() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(1000);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    expect(yield* service.acquire(snapshot.operation)).toEqual({
      _tag: 'Accepted',
      operationId: snapshot.operation.operationId,
    });
    expect(yield* service.acquire({ ...snapshot.operation, purpose: 'Baseline' })).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'ConflictingOperation', operationId: snapshot.operation.operationId },
    });
    expect(yield* service.acquire(snapshot.operation)).toEqual({
      _tag: 'Accepted',
      operationId: snapshot.operation.operationId,
    });
    expect((yield* service.requestExecution(snapshot.operation.operationId))._tag).toBe('Refused');
    expect(yield* Ref.get(h.fake.calls)).toEqual([]);
    expect(yield* service.shutdown()).toEqual({ _tag: 'Drained' });
  }
  const fresh = Effect.gen(freshScope);
  const freshScoped = Effect.scoped(fresh);
  const freshProvided = Effect.provide(freshScoped, lifecycleTestLayer(snapshot));
  await Effect.runPromise(freshProvided);
}
test(
  'shutdown confirms exact container and staging absence and reconstruction retains a tombstone',
  successfulShutdownAndTombstone,
);

async function lateChildDefect() {
  function* scenario() {
    const c = makeWorkerCase();
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* service.requestExecution(c.operation.operationId);
    const execution = yield* Queue.take(h.fake.barriers.executions);
    const draining = yield* service.shutdown().pipe(Effect.result, Effect.forkScoped);
    const gate = yield* journalGate(h, 'before-RequestCleanup');
    yield* Deferred.await(gate.entered);
    yield* Deferred.die(execution.reply, 'private driver detail');
    yield* Deferred.await(execution.finished);
    yield* Deferred.succeed(gate.resume, undefined);
    const result = yield* Fiber.join(draining);
    const expectedFailure = expect.objectContaining({
      _tag: 'WorkerLifecycleRuntimeError',
      operationId: 'worker-1',
      code: 'ActorFailed',
    });
    const expected = Option.some(expectedFailure);
    expect(Result.getFailure(result)).toEqual(expected);
    const read = yield* service.read(c.operation.operationId).pipe(Effect.result);
    expect(Result.getFailure(read)).toEqual(expected);
    expect(yield* service.shutdown().pipe(Effect.result)).toEqual(result);
    const snapshot = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
    expect(Option.getOrThrow(snapshot.cleanup)._tag).not.toBe('CleanupConfirmed');
    const failure = Option.getOrThrow(Result.getFailure(read));
    expect(failure.message).not.toContain('private driver detail');
    expect('cause' in failure).toBe(false);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeStartedWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'late invoked child defects are sanitized and retained through drain and later reads',
  lateChildDefect,
);

async function invocationAndOwnerLifetime() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    yield* TestClock.setTime(950);
    function* invocationScope() {
      const service = yield* Engine.makeWorkerLifecycle(issuer);
      yield* service.acquire(makeWorkerCase().operation);
      const create = yield* Queue.take(h.fake.barriers.mutations);
      yield* completeMutation(create, false);
      yield* Deferred.await(create.finished);
      const start = yield* Queue.take(h.fake.barriers.mutations);
      expect(Option.isNone(yield* Deferred.poll(start.finished))).toBe(true);
      return start;
    }
    const owned = Effect.gen(invocationScope);
    const start = yield* Effect.scoped(owned);
    expect(yield* Deferred.poll(start.interrupted)).toEqual(Option.some(Effect.void));
    yield* Deferred.await(start.finished);
    expect((yield* Ref.get(h.fake.external)).resources).toHaveLength(1);
    const snapshot = Option.getOrThrow(
      yield* h.journal.inspect(makeWorkerCase().operation.operationId),
    );
    expect(snapshot.cleanup).toEqual(Option.none());
    expect(snapshot.intents.map((intent) => intent.outcome._tag)).toEqual(['Completed', 'Claimed']);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'task completion keeps its actor alive and owner closure interrupts remaining invocations without absence proof',
  invocationAndOwnerLifetime,
);

function replacementSnapshot(): WorkerJournalSnapshot {
  const sibling = siblingSnapshot();
  const identity = { ...sibling.operation.identity, generation: 4 };
  const operation = { ...sibling.operation, identity };
  const c = makeWorkerCase();
  const observation = {
    ...c.observation,
    ...operation,
    atMs: 950,
    resources: [
      { ...c.resource, ...operation, containerId: WorkerContainerId.make('container-2') },
    ],
  };
  const intents = sibling.intents.map((intent) => ({
    ...intent,
    outcome: { _tag: 'Completed' as const, observation },
  }));
  return { ...sibling, operation, intents };
}
function oldCleanupSnapshot(): WorkerJournalSnapshot {
  return {
    ...makeStartedWorkerSnapshot(),
    cleanup: Option.some({ _tag: 'CleanupPending', requestedAtMs: 1000, deadlineMs: 1100 }),
  };
}

async function replacementUntouched() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    const replacement = replacementSnapshot();
    yield* TestClock.setTime(1000);
    yield* h.journal.replaceAuthority(
      c.operation.operationId,
      replacement.operation.identity,
      Option.none(),
    );
    const before = yield* h.journal.inspect(replacement.operation.operationId);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    const first = yield* Queue.take(h.fake.barriers.observations);
    expect(first.request.containerId).toEqual(Option.some(c.containerId));
    expect(first.request.operation.identity.generation).toBe(3);
    yield* answerObservation(first);
    const stop = yield* Queue.take(h.fake.barriers.mutations);
    expect(stop.request.intent.kind).toBe('Stop');
    expect(stop.request.intent.resource).toBe('container-1');
    yield* completeMutation(stop, false);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations), false);
    const remove = yield* Queue.take(h.fake.barriers.mutations);
    expect(remove.request.intent.kind).toBe('Remove');
    expect(remove.request.intent.resource).toBe('container-1');
    yield* completeMutation(remove, false, true);
    const gate = yield* journalGate(h, 'after-RecordCleanup');
    const last = yield* Queue.take(h.fake.barriers.observations);
    yield* Deferred.succeed(last.reply, {
      ...c.observation,
      atMs: 1000,
      resources: [],
      staging: 'Absent',
    });
    yield* Deferred.await(gate.entered);
    yield* Deferred.succeed(gate.resume, undefined);
    expect(yield* h.journal.inspect(replacement.operation.operationId)).toEqual(before);
    const old = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
    expect(old.operation.limits).toEqual({ deadlineMs: 1000, spentMicros: 17, repairs: 1 });
    expect(old.executionAuthorizedAtMs).toEqual(Option.none());
    expect(Option.getOrThrow(old.cleanup)._tag).toBe('CleanupConfirmed');
    const count = (yield* Ref.get(h.fake.calls)).length;
    yield* service.acquire(c.operation);
    expect((yield* Ref.get(h.fake.calls)).length).toBe(count);
    const cancelled = yield* service.cancel(c.operation.operationId);
    expect(cancelled).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'NotCurrent', operationId: c.operation.operationId },
    });
    expect(yield* h.journal.inspect(replacement.operation.operationId)).toEqual(before);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(
    scoped,
    lifecycleTestLayer(oldCleanupSnapshot(), [replacementSnapshot()]),
  );
  await Effect.runPromise(provided);
}
test(
  'generation 3 cleanup targets only container-1 while generation 4 container-2 authority stays untouched',
  replacementUntouched,
);

async function cancellationWinsAuthorization() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    const gate = yield* journalGate(h, 'before-AuthorizeExecution');
    const execution = yield* service
      .requestExecution(c.operation.operationId)
      .pipe(Effect.forkScoped);
    yield* Deferred.await(gate.entered);
    const cancelled = yield* service.cancel(c.operation.operationId);
    expect(cancelled._tag).toBe('Observed');
    const result = yield* Fiber.join(execution);
    expect(result).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'Cancelled', operationId: c.operation.operationId },
    });
    expect(
      Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId)).executionAuthorizedAtMs,
    ).toEqual(Option.none());
    const calls = yield* Ref.get(h.fake.calls);
    expect(calls.map((call) => call.kind)).not.toContain('execute');
    yield* Deferred.succeed(gate.resume, undefined);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeStartedWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'cancellation winning an authorization race returns a refusal rather than an uncommitted execution acknowledgment',
  cancellationWinsAuthorization,
);

async function replacementInterruptsSibling() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    const sibling = siblingSnapshot();
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* service.acquire(sibling.operation);
    for (let i = 0; i < 4; i++)
      yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* service.requestExecution(sibling.operation.operationId);
    const execution = yield* Queue.take(h.fake.barriers.executions);
    yield* h.journal.replaceAuthority(
      c.operation.operationId,
      replacementSnapshot().operation.identity,
      Option.none(),
    );
    const reconciling = yield* service.reconcile(c.operation.operationId).pipe(Effect.forkScoped);
    for (let i = 0; i < 2; i++)
      yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* Fiber.join(reconciling);
    yield* service.read(sibling.operation.operationId);
    expect(Option.isSome(yield* Deferred.poll(execution.interrupted))).toBe(true);
    const old = Option.getOrThrow(yield* h.journal.inspect(sibling.operation.operationId));
    expect(old.operation.limits).toEqual({ deadlineMs: 1000, spentMicros: 17, repairs: 1 });
    expect(old.authority.identity.generation).toBe(4);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(
    scoped,
    lifecycleTestLayer(makeStartedWorkerSnapshot(), [siblingSnapshot()]),
  );
  await Effect.runPromise(provided);
}
test(
  'reconciling replaced authority interrupts stale same-run siblings without cancelling replacement authority',
  replacementInterruptsSibling,
);

async function pendingRemovalDrainBound() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* TestClock.setTime(1000);
    const first = yield* service.shutdown().pipe(Effect.result, Effect.forkScoped);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* completeMutation(yield* Queue.take(h.fake.barriers.mutations), false);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations), false);
    const remove = yield* Queue.take(h.fake.barriers.mutations);
    expect(remove.request.intent.kind).toBe('Remove');
    yield* TestClock.adjust(99);
    expect(first.pollUnsafe()).toBeUndefined();
    const second = yield* service.shutdown().pipe(Effect.result, Effect.forkScoped);
    yield* Effect.yieldNow;
    yield* TestClock.adjust(1);
    const failure = yield* Fiber.join(first);
    const expired = expect.objectContaining({ code: 'DrainExpired' });
    expect(Result.getFailure(failure)).toEqual(Option.some(expired));
    expect(yield* Fiber.join(second)).toEqual(failure);
    yield* Deferred.await(remove.interrupted);
    yield* Deferred.await(remove.finished);
    const snapshot = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
    expect(Option.getOrThrow(snapshot.cleanup).deadlineMs).toBe(1100);
    expect(Option.getOrThrow(snapshot.cleanup)._tag).not.toBe('CleanupConfirmed');
    expect(snapshot.intents.map((intent) => intent.kind)).toEqual([
      'Create',
      'Start',
      'Stop',
      'Remove',
    ]);
    expect(snapshot.intents.at(-1)?.outcome._tag).toBe('Claimed');
    const calls = yield* Ref.get(h.fake.calls);
    expect(yield* service.shutdown().pipe(Effect.result)).toEqual(failure);
    expect(yield* Ref.get(h.fake.calls)).toEqual(calls);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(makeStartedWorkerSnapshot()));
  await Effect.runPromise(provided);
}
test(
  'pending removal drains for exactly the first 100ms and repeated shutdown neither resets nor retries',
  pendingRemovalDrainBound,
);

async function cancelledSiblingWithCleanupConflict() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    const sibling = siblingSnapshot();
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* service.acquire(sibling.operation);
    for (let i = 0; i < 4; i++)
      yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* service.requestExecution(sibling.operation.operationId);
    const execution = yield* Queue.take(h.fake.barriers.executions);
    const gate = yield* journalGate(h, 'before-RequestCleanup:worker-2');
    const cancellation = yield* service.cancel(c.operation.operationId).pipe(Effect.forkScoped);
    yield* Deferred.await(gate.entered);
    const snapshot = Option.getOrThrow(yield* h.journal.inspect(sibling.operation.operationId));
    expect(snapshot.authority.cancelledAtMs).toEqual(Option.some(950));
    const competing = yield* h.journal.service.commit({
      _tag: 'RequestCleanup',
      operationId: sibling.operation.operationId,
      expectedRevision: snapshot.revision,
      atMs: 950,
      cleanupWindowMs: 100,
    });
    expect(competing._tag).toBe('Committed');
    yield* Deferred.succeed(gate.resume, undefined);
    expect(yield* Fiber.join(cancellation)).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'NotCurrent', operationId: sibling.operation.operationId },
    });
    yield* service.read(sibling.operation.operationId);
    expect(Option.isSome(yield* Deferred.poll(execution.interrupted))).toBe(true);
    const edits = yield* Ref.get(h.edits);
    const cancellations = edits.filter((edit) =>
      Match.value(edit).pipe(
        Match.tag('RequestCancellation', () => true),
        Match.orElse(() => false),
      ),
    );
    expect(cancellations).toHaveLength(1);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(
    scoped,
    lifecycleTestLayer(makeStartedWorkerSnapshot(), [siblingSnapshot()]),
  );
  await Effect.runPromise(provided);
}
test(
  'persisted cancellation still interrupts a sibling when its cleanup CAS loses without retry',
  cancelledSiblingWithCleanupConflict,
);

async function failedStartupStillCleans() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations), false);
    const draining = yield* service.shutdown().pipe(Effect.forkScoped);
    yield* answerObservation(yield* Queue.take(h.fake.barriers.observations), false);
    const remove = yield* Queue.take(h.fake.barriers.mutations);
    expect(remove.request.intent.kind).toBe('Remove');
    yield* completeMutation(remove, false, true);
    const last = yield* Queue.take(h.fake.barriers.observations);
    yield* Deferred.succeed(last.reply, {
      ...c.observation,
      atMs: 950,
      resources: [],
      staging: 'Absent',
    });
    expect(yield* Fiber.join(draining)).toEqual({ _tag: 'Drained' });
    const read = yield* service.read(c.operation.operationId);
    const snapshot = Match.value(read).pipe(
      Match.tag('Observed', ({ snapshot }) => snapshot),
      Match.orElse(() => expect.unreachable('released business record must remain readable')),
    );
    expect(snapshot.intents.map((intent) => intent.kind)).toEqual(['Create', 'Start', 'Remove']);
    expect(snapshot.intents[1]?.outcome).toEqual({
      _tag: 'Failed',
      reason: { _tag: 'ReadinessMismatch', operationId: c.operation.operationId },
    });
    expect(Option.getOrThrow(snapshot.cleanup)._tag).toBe('CleanupConfirmed');
  }
  const seed = makeStartedWorkerSnapshot();
  const intents = seed.intents.map((intent) =>
    Match.value(intent.kind).pipe(
      Match.when('Start', () => ({
        ...intent,
        outcome: {
          _tag: 'Failed' as const,
          reason: { _tag: 'ReadinessMismatch' as const, operationId: seed.operation.operationId },
        },
      })),
      Match.orElse(() => intent),
    ),
  );
  const snapshot = { ...seed, intents };
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, lifecycleTestLayer(snapshot));
  await Effect.runPromise(provided);
}
test(
  'owned cleanup preserves the reviewed failed Start issue through Released without repeating Start',
  failedStartupStillCleans,
);

const readFailure = new WorkerJournalError({ operation: 'load', code: 'ReadFailed' });
function* journalFailureScenario() {
  const service = yield* Engine.makeWorkerLifecycle(issuer);
  expect(yield* service.acquire({})).toEqual({
    _tag: 'Refused',
    refusal: { _tag: 'InvalidInput' },
  });
  expect(yield* service.acquire(makeWorkerCase().operation).pipe(Effect.result)).toEqual(
    Result.fail(readFailure),
  );
  expect(yield* service.acquire(makeWorkerCase().operation).pipe(Effect.result)).toEqual(
    Result.fail(readFailure),
  );
  expect(yield* service.shutdown().pipe(Effect.result)).toEqual(Result.fail(readFailure));
}
const journalFailureProgram = Effect.gen(journalFailureScenario);
async function journalFailureVisible() {
  const journal = Engine.makeWorkerJournal({
    load: () => Result.fail(readFailure),
    commit: () =>
      Result.fail(new WorkerJournalError({ operation: 'commit', code: 'CommitFailed' })),
  });
  const journalLayer = Layer.succeed(WorkerJournal, journal);
  const mechanismAcquisition = makeControlledWorkerMechanism(makeWorkerCase().observation).pipe(
    Effect.map((fake) => fake.service),
  );
  const mechanismLayer = Layer.effect(WorkerMechanism, mechanismAcquisition);
  const dependencies = Layer.merge(journalLayer, mechanismLayer);
  const scoped = Effect.scoped(journalFailureProgram);
  const provided = Effect.provide(scoped, dependencies);
  await Effect.runPromise(provided);
}
test(
  'journal acquisition failures remain tagged across duplicate intake and drain',
  journalFailureVisible,
);

async function currentReplacementKeepsExecuting() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    const replacement = replacementSnapshot();
    yield* TestClock.setTime(950);
    yield* h.journal.replaceAuthority(
      c.operation.operationId,
      replacement.operation.identity,
      Option.none(),
    );
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* service.acquire(replacement.operation);
    for (let i = 0; i < 3; i++)
      yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    yield* service.requestExecution(replacement.operation.operationId);
    const execution = yield* Queue.take(h.fake.barriers.executions);
    const before = yield* h.journal.inspect(replacement.operation.operationId);
    const reconciling = yield* service.reconcile(c.operation.operationId).pipe(Effect.forkScoped);
    const readback = yield* Queue.take(h.fake.barriers.observations);
    expect(readback.request.operation.operationId).toBe(c.operation.operationId);
    yield* answerObservation(readback);
    yield* Fiber.join(reconciling);
    expect(yield* Deferred.poll(execution.interrupted)).toEqual(Option.none());
    expect(yield* h.journal.inspect(replacement.operation.operationId)).toEqual(before);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(
    scoped,
    lifecycleTestLayer(makeStartedWorkerSnapshot(), [replacementSnapshot()]),
  );
  await Effect.runPromise(provided);
}
test(
  'old reconciliation does not interrupt an executing current replacement or mutate its authority',
  currentReplacementKeepsExecuting,
);

async function failingAndPendingDrain() {
  function* scenario() {
    const h = yield* LifecycleHarness;
    const c = makeWorkerCase();
    yield* TestClock.setTime(950);
    const service = yield* Engine.makeWorkerLifecycle(issuer);
    yield* service.acquire(c.operation);
    yield* service.acquire(siblingSnapshot().operation);
    for (let i = 0; i < 4; i++)
      yield* answerObservation(yield* Queue.take(h.fake.barriers.observations));
    const draining = yield* service.shutdown().pipe(Effect.result, Effect.forkScoped);
    const failing = yield* Queue.take(h.fake.barriers.observations);
    const pending = yield* Queue.take(h.fake.barriers.observations);
    const error = new WorkerMechanismError({ operation: 'observe', code: 'Unavailable' });
    yield* Deferred.fail(failing.reply, error);
    yield* Deferred.await(failing.finished);
    yield* TestClock.adjust(100);
    const result = yield* Fiber.join(draining);
    expect(result).toEqual(Result.fail(error));
    yield* Deferred.await(pending.interrupted);
    yield* Deferred.await(pending.finished);
    expect(yield* service.shutdown().pipe(Effect.result)).toEqual(result);
    for (const operation of [c.operation, siblingSnapshot().operation]) {
      const snapshot = Option.getOrThrow(yield* h.journal.inspect(operation.operationId));
      expect(Option.getOrThrow(snapshot.cleanup)._tag).not.toBe('CleanupConfirmed');
    }
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(
    scoped,
    lifecycleTestLayer(makeStartedWorkerSnapshot(), [siblingSnapshot()]),
  );
  await Effect.runPromise(provided);
}
test(
  'a pending sibling cannot mask another owned actor failure when the drain bound expires',
  failingAndPendingDrain,
);

for (const invalid of ['host', 'daemon', 'foreign-id', 'custody', 'malformed'] as const) {
  async function refusesDestruction() {
    function* scenario() {
      const h = yield* LifecycleHarness;
      const c = makeWorkerCase();
      yield* TestClock.setTime(1000);
      yield* h.journal.replaceAuthority(
        c.operation.operationId,
        replacementSnapshot().operation.identity,
        Option.none(),
      );
      const service = yield* Engine.makeWorkerLifecycle(issuer);
      yield* service.acquire(c.operation);
      function corrupted(barrier: ObservationBarrier) {
        const observation = observationFor(barrier);
        return Match.value(invalid).pipe(
          Match.when('host', () => ({
            ...observation,
            atMs: 1000,
            hostId: WorkerHostId.make('host-2'),
          })),
          Match.when('daemon', () => ({
            ...observation,
            atMs: 1000,
            daemonId: WorkerDaemonId.make('daemon-2'),
          })),
          Match.when('foreign-id', () => ({
            ...observation,
            atMs: 1000,
            resources: [{ ...c.resource, containerId: WorkerContainerId.make('container-2') }],
          })),
          Match.when('custody', () => ({
            ...observation,
            atMs: 1000,
            resources: [
              {
                ...c.resource,
                configuration: {
                  ...c.resource.configuration,
                  mounts: [{ source: '/foreign', target: '/workspace', readOnly: false }],
                },
              },
            ],
          })),
          Match.when('malformed', () => ({ ...observation, atMs: 1000, resources: 'invalid' })),
          Match.exhaustive,
        );
      }
      const first = yield* Queue.take(h.fake.barriers.observations);
      yield* Deferred.succeed(first.reply, corrupted(first));
      const reconciling = yield* service.reconcile(c.operation.operationId).pipe(Effect.forkScoped);
      const next = yield* Queue.take(h.fake.barriers.observations);
      yield* Deferred.succeed(next.reply, corrupted(next));
      expect((yield* Fiber.join(reconciling))._tag).toBe('Refused');
      expect((yield* Ref.get(h.fake.calls)).filter(isMutation)).toEqual([]);
      const old = Option.getOrThrow(yield* h.journal.inspect(c.operation.operationId));
      expect(Option.getOrThrow(old.cleanup)._tag).toBe('CleanupPending');
      expect(old.operation.limits).toEqual({ deadlineMs: 1000, spentMicros: 17, repairs: 1 });
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, lifecycleTestLayer(oldCleanupSnapshot()));
    await Effect.runPromise(provided);
  }
  test(
    `superseded cleanup refuses ${invalid} readback before destructive work`,
    refusesDestruction,
  );
}
