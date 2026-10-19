import { expect, test } from 'bun:test';

import {
  createEffectActor,
  fromEffect,
  join,
  send,
  setupEffect,
  waitFor,
  withActorScope,
} from '@xstate/effect';
import { Context, Data, Deferred, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';

function makeTestContainers() {
  return { create: () => Effect.succeed({ containerId: 'container-1' }) };
}

class TestContainers extends Context.Service<
  TestContainers,
  ReturnType<typeof makeTestContainers>
>()('@leviathan/test/Containers') {}

const createContainer = fromEffect(TestContainers.use((service) => service.create()));

const compatibilityMachine = setupEffect({ actors: { createContainer } }).createMachine({
  context: { containerId: '' },
  initial: 'pending',
  states: {
    pending: {
      invoke: {
        src: 'createContainer',
        onDone: ({ context, event }) => ({
          target: 'ready',
          context: { ...context, containerId: event.output.containerId },
        }),
      },
    },
    ready: {},
  },
});

function* declaredTaskScenario() {
  const actor = yield* createEffectActor(compatibilityMachine);
  const snapshot = yield* waitFor(actor, (state) => state.matches('ready'));
  expect(snapshot.context.containerId).toBe('container-1');
}

const declaredTaskProgram = Effect.gen(declaredTaskScenario);

export async function missingServiceNegativeControl() {
  // @ts-expect-error The declared task requires TestContainers at the runtime boundary.
  await Effect.runPromise(declaredTaskProgram.pipe(Effect.scoped));
}

export async function exactCohortHostsDeclaredEffectTasks() {
  const containersLayer = Layer.succeed(TestContainers, makeTestContainers());
  const scoped = Effect.scoped(declaredTaskProgram);
  const provided = Effect.provide(scoped, containersLayer);
  await Effect.runPromise(provided);
}

test('exact_cohort_hosts_declared_effect_tasks_under_bun', exactCohortHostsDeclaredEffectTasks);

const timerMachine = setupEffect().createMachine({
  initial: 'pending',
  states: {
    pending: { after: { 10: { target: 'expired' } } },
    expired: { type: 'final' },
  },
});

export async function testClockDrivesActorTimer() {
  function* scenario() {
    const actor = yield* createEffectActor(timerMachine);
    expect(actor.getSnapshot().matches('pending')).toBe(true);
    yield* TestClock.adjust('9 millis');
    expect(actor.getSnapshot().matches('pending')).toBe(true);
    yield* TestClock.adjust('1 millis');
    const snapshot = yield* waitFor(actor, (state) => state.matches('expired'));
    expect(snapshot.matches('expired')).toBe(true);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}

test('exact_cohort_uses_effect_test_clock_for_a_10ms_timer', testClockDrivesActorTimer);

function makeTestResources(events: string[]) {
  function* prepare() {
    const retained = Effect.succeed({ kind: 'retained' });
    const releaseRetained = Effect.sync(() => {
      events.push('retained-released');
    });
    const invocation = Effect.succeed({ kind: 'invocation' });
    const releaseInvocation = Effect.sync(() => {
      events.push('invocation-released');
    });
    yield* Effect.acquireRelease(retained, () => releaseRetained).pipe(withActorScope);
    yield* Effect.acquireRelease(invocation, () => releaseInvocation);
    return { containerId: 'container-1' };
  }
  return { prepare: Effect.gen(prepare) };
}

class TestResources extends Context.Service<TestResources, ReturnType<typeof makeTestResources>>()(
  '@leviathan/test/Resources',
) {}

const prepareResources = fromEffect(TestResources.use((service) => service.prepare));
const resourceMachine = setupEffect({ actors: { prepareResources } }).createMachine({
  initial: 'pending',
  states: {
    pending: { invoke: { src: 'prepareResources', onDone: { target: 'ready' } } },
    ready: {},
  },
});

function resourceTestLayer(events: string[]) {
  return Layer.succeed(TestResources, makeTestResources(events));
}

export async function taskAndRootResourceLifetimes() {
  const events: string[] = [];
  function* scenario() {
    const actor = yield* createEffectActor(resourceMachine);
    yield* waitFor(actor, (state) => state.matches('ready'));
    expect(events).toEqual(['invocation-released']);
  }
  const program = Effect.gen(scenario);
  const services = resourceTestLayer(events);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, services);
  await Effect.runPromise(provided);
  expect(events).toEqual(['invocation-released', 'retained-released']);
}

test(
  'exact_cohort_distinguishes_invocation_and_root_resource_lifetimes',
  taskAndRootResourceLifetimes,
);

export async function stateExitInterruptsTask() {
  function* scenario() {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    const completion = yield* Deferred.make<void>();
    function* pendingWork() {
      yield* Effect.addFinalizer(() => Deferred.interrupt(completion));
      yield* Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
        Deferred.succeed(released, undefined),
      );
      return yield* Deferred.await(completion).pipe(
        Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
      );
    }
    const work = fromEffect(Effect.gen(pendingWork));
    const machine = setupEffect({ actors: { work } }).createMachine({
      initial: 'pending',
      states: {
        pending: { invoke: { src: 'work' }, on: { CANCEL: { target: 'cancelled' } } },
        cancelled: {},
      },
    });
    const actor = yield* createEffectActor(machine);
    yield* Deferred.await(started).pipe(Effect.timeout('2 seconds'));
    expect(yield* Deferred.isDone(completion)).toBe(false);
    yield* send(actor, { type: 'CANCEL' });
    const snapshot = yield* waitFor(actor, (state) => state.matches('cancelled'), {
      timeout: '2 seconds',
    });
    yield* Deferred.await(interrupted).pipe(Effect.timeout('2 seconds'));
    yield* Deferred.await(released).pipe(Effect.timeout('2 seconds'));
    expect(snapshot.matches('cancelled')).toBe(true);
    expect(yield* Deferred.isDone(interrupted)).toBe(true);
    expect(yield* Deferred.isDone(released)).toBe(true);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  await Effect.runPromise(scoped);
}

test('exact_cohort_interrupts_and_releases_an_invocation_on_state_exit', stateExitInterruptsTask);

class TestTaskFailed extends Data.TaggedError('TestTaskFailed')<{
  readonly code: 'CreateRefused';
  readonly detail: string;
}> {}

class TestLifecycleRuntimeError extends Data.TaggedError('TestLifecycleRuntimeError')<{
  readonly code: 'UnexpectedMachineFailure';
}> {}

export async function typedTaskFailureIsObserved() {
  const failure = new TestTaskFailed({ code: 'CreateRefused', detail: 'private driver detail' });
  const failedTask = fromEffect(Effect.fail(failure));
  function* scenario() {
    const actor = yield* createEffectActor(failedTask);
    const observed = yield* join(actor).pipe(Effect.flip);
    expect(observed).toBe(failure);
    expect(actor.getSnapshot().status).toBe('error');
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  await Effect.runPromise(scoped);
}

test('exact_cohort_exposes_the_original_typed_task_failure', typedTaskFailureIsObserved);

export async function machineFailureIsSanitized() {
  const failure = new TestTaskFailed({ code: 'CreateRefused', detail: 'private machine detail' });
  const failedTask = fromEffect(Effect.fail(failure));
  const machine = setupEffect({ actors: { failedTask } }).createMachine({
    initial: 'pending',
    states: { pending: { invoke: { src: 'failedTask' } } },
  });
  function* scenario() {
    const actor = yield* createEffectActor(machine);
    const observed = yield* join(actor).pipe(
      Effect.mapError(() => new TestLifecycleRuntimeError({ code: 'UnexpectedMachineFailure' })),
      Effect.flip,
    );
    expect(actor.getSnapshot().status).toBe('error');
    expect(observed).toEqual(new TestLifecycleRuntimeError({ code: 'UnexpectedMachineFailure' }));
    expect(observed).not.toHaveProperty('detail');
    expect(observed).not.toHaveProperty('cause');
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  await Effect.runPromise(scoped);
}

test('exact_cohort_maps_unknown_machine_failure_to_a_sanitized_tag', machineFailureIsSanitized);
