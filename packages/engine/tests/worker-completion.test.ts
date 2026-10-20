import { expect, test } from 'bun:test';

import type { WorkerOperationId } from '@leviathan/domain';
import { ActorScope } from '@xstate/effect';
import { Context, Deferred, Effect, Fiber, Layer, Match, Option, Queue, Ref, Scope } from 'effect';
import { TestClock } from 'effect/testing';

import type { WorkerJournalEdit } from '../src/worker-contracts.ts';
import { WorkerJournal } from '../src/worker-ports.ts';
import { makeWorkerCase } from './worker-fixtures.ts';
import {
  PropertyFixture,
  closePropertyOwner,
  openPropertyOwner,
  propertyFixtureLayer,
  waitForPropertyEdit,
} from './worker-property-fixture.ts';

function makeCompletionFixture() {
  function* assemble() {
    const fixture = yield* PropertyFixture;
    const released = yield* Deferred.make<void>();
    const entered = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const barrier = { entered, resume };
    const pauseLoad = yield* Ref.make(false);
    function load(id: WorkerOperationId) {
      function* readThroughBarrier() {
        const snapshot = yield* fixture.journalService.load(id);
        const pause = yield* Ref.getAndSet(pauseLoad, false);
        const selected = Effect.sync(() => pause);
        const pausing = Deferred.succeed(barrier.entered, undefined).pipe(
          Effect.andThen(Deferred.await(barrier.resume)),
        );
        yield* pausing.pipe(Effect.when(selected));
        return snapshot;
      }
      const program = Effect.gen(readThroughBarrier);
      return program;
    }
    function commit(edit: WorkerJournalEdit) {
      function* recordWithReleaseSignal() {
        const result = yield* fixture.journalService.commit(edit);
        function* registerRelease() {
          const actorScope = yield* Effect.serviceOption(ActorScope);
          yield* Scope.addFinalizer(
            Option.getOrThrow(actorScope),
            Deferred.succeed(released, undefined),
          );
        }
        const registering = Effect.gen(registerRelease);
        const selected = Match.value({ edit, result }).pipe(
          Match.when(
            { edit: { _tag: 'RecordCleanup' }, result: { _tag: 'Committed' } },
            () => true,
          ),
          Match.orElse(() => false),
        );
        const confirmed = Effect.sync(() => selected);
        yield* registering.pipe(Effect.when(confirmed));
        return result;
      }
      const program = Effect.gen(recordWithReleaseSignal);
      return program;
    }
    const journal = WorkerJournal.of({ load, commit });
    return Layer.mergeAll(
      Layer.succeed(WorkerJournal, journal),
      Layer.succeed(CompletionFixture, { released, entered, resume, pauseLoad }),
    );
  }
  const acquisition = Effect.gen(assemble);
  const layer = Layer.unwrap(acquisition);
  const base = propertyFixtureLayer();
  return layer.pipe(Layer.provideMerge(base));
}

class CompletionFixture extends Context.Service<
  CompletionFixture,
  {
    readonly released: Deferred.Deferred<void>;
    readonly entered: Deferred.Deferred<void>;
    readonly resume: Deferred.Deferred<void>;
    readonly pauseLoad: Ref.Ref<boolean>;
  }
>()('@leviathan/test/CompletionFixture') {}

for (const { mode, callCount } of [
  { mode: 'execution', callCount: 9 },
  { mode: 'cancellation', callCount: 8 },
] as const) {
  async function completedOwner() {
    function* scenario() {
      const c = makeWorkerCase();
      const fixture = yield* PropertyFixture;
      const completion = yield* CompletionFixture;
      yield* TestClock.setTime(950);
      yield* fixture.startResponders;
      const owner = yield* openPropertyOwner();
      expect(yield* owner.service.acquire(c.operation)).toEqual({
        _tag: 'Accepted',
        operationId: c.operation.operationId,
      });
      yield* waitForPropertyEdit('RecordReadiness');
      const action = Match.value(mode).pipe(
        Match.when('execution', () => owner.service.requestExecution(c.operation.operationId)),
        Match.orElse(() => owner.service.cancel(c.operation.operationId)),
      );
      expect((yield* action)._tag).toBe('Observed');
      yield* Deferred.await(completion.released);
      const before = yield* fixture.readSnapshot;
      expect(Option.getOrThrow(before.cleanup)._tag).toBe('CleanupConfirmed');
      expect(before.intents.map((intent) => intent.kind)).toEqual([
        'Create',
        'Start',
        'Stop',
        'Remove',
      ]);
      const calls = yield* Ref.get(fixture.fake.calls);
      expect(calls).toHaveLength(callCount);
      for (let i = 0; i < 2; i++) {
        expect(yield* owner.service.reconcile(c.operation.operationId)).toEqual({
          _tag: 'Observed',
          snapshot: before,
        });
      }
      expect(yield* owner.service.acquire(c.operation)).toEqual({
        _tag: 'Accepted',
        operationId: c.operation.operationId,
      });
      expect(yield* owner.service.read(c.operation.operationId)).toEqual({
        _tag: 'Observed',
        snapshot: before,
      });
      expect(yield* owner.service.requestExecution(c.operation.operationId)).toEqual({
        _tag: 'Refused',
        refusal: { _tag: 'AlreadyClaimed', operationId: c.operation.operationId },
      });
      expect((yield* fixture.readSnapshot).intents).toEqual(before.intents);
      expect(yield* Ref.get(fixture.fake.calls)).toEqual(calls);
      expect(yield* owner.service.shutdown()).toEqual({ _tag: 'Drained' });
      expect(yield* owner.service.shutdown()).toEqual({ _tag: 'Drained' });
      const drained = yield* fixture.readSnapshot;
      expect(yield* owner.service.reconcile(c.operation.operationId)).toEqual({
        _tag: 'Observed',
        snapshot: drained,
      });
      expect(yield* owner.service.read(c.operation.operationId)).toEqual({
        _tag: 'Observed',
        snapshot: drained,
      });
      yield* closePropertyOwner(owner);
      const rebuilt = yield* openPropertyOwner();
      expect(yield* rebuilt.service.acquire(c.operation)).toEqual({
        _tag: 'Accepted',
        operationId: c.operation.operationId,
      });
      for (let i = 0; i < 2; i++) {
        expect(yield* rebuilt.service.reconcile(c.operation.operationId)).toEqual({
          _tag: 'Observed',
          snapshot: drained,
        });
      }
      expect(yield* rebuilt.service.requestExecution(c.operation.operationId)).toEqual({
        _tag: 'Refused',
        refusal: { _tag: 'AlreadyClaimed', operationId: c.operation.operationId },
      });
      expect((yield* fixture.readSnapshot).intents).toEqual(before.intents);
      expect(yield* Ref.get(fixture.fake.calls)).toEqual(calls);
      expect(yield* rebuilt.service.shutdown()).toEqual({ _tag: 'Drained' });
      expect((yield* fixture.readSnapshot).intents).toEqual(before.intents);
      expect(yield* Ref.get(fixture.fake.calls)).toEqual(calls);
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, makeCompletionFixture());
    await Effect.runPromise(provided);
  }
  test(
    `normal ${mode} release reconciles repeatedly in an OPEN service without replay`,
    completedOwner,
  );
}

async function releaseRacesWaiterStartup() {
  function* scenario() {
    const c = makeWorkerCase();
    const fixture = yield* PropertyFixture;
    const completion = yield* CompletionFixture;
    yield* TestClock.setTime(950);
    const responders = yield* fixture.startResponders;
    yield* Fiber.interrupt(responders[2]!);
    const owner = yield* openPropertyOwner();
    yield* owner.service.acquire(c.operation);
    yield* waitForPropertyEdit('RecordReadiness');
    expect((yield* owner.service.requestExecution(c.operation.operationId))._tag).toBe('Observed');
    const execution = yield* Queue.take(fixture.fake.barriers.executions);
    yield* Ref.set(completion.pauseLoad, true);
    const reconciling = yield* owner.service
      .reconcile(c.operation.operationId)
      .pipe(Effect.forkScoped);
    yield* Deferred.await(completion.entered);
    expect(reconciling.pollUnsafe()).toBeUndefined();
    yield* Deferred.succeed(execution.reply, {
      operationId: c.operation.operationId,
      identity: c.operation.identity,
      completedAtMs: 950,
    });
    yield* Deferred.await(completion.released);
    const tombstone = yield* fixture.readSnapshot;
    expect(Option.getOrThrow(tombstone.cleanup)._tag).toBe('CleanupConfirmed');
    const calls = yield* Ref.get(fixture.fake.calls);
    yield* Deferred.succeed(completion.resume, undefined);
    expect(yield* Fiber.join(reconciling)).toEqual({ _tag: 'Observed', snapshot: tombstone });
    expect(yield* owner.service.reconcile(c.operation.operationId)).toEqual({
      _tag: 'Observed',
      snapshot: tombstone,
    });
    expect((yield* fixture.readSnapshot).intents).toEqual(tombstone.intents);
    expect(yield* Ref.get(fixture.fake.calls)).toEqual(calls);
    expect(yield* owner.service.shutdown()).toEqual({ _tag: 'Drained' });
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, makeCompletionFixture());
  await Effect.runPromise(provided);
}
test(
  'normal release racing reconciliation waiter startup observes the committed tombstone',
  releaseRacesWaiterStartup,
);
