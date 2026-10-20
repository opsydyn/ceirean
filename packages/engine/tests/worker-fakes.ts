import type { WorkerObservation } from '@leviathan/domain';
import { Array, Clock, Context, Deferred, Effect, Layer, Option, Queue, Ref } from 'effect';
import { TestClock } from 'effect/testing';

import type {
  WorkerExecutionRequest,
  WorkerMutationRequest,
  WorkerObservationRequest,
  WorkerJournalSnapshot,
  WorkerJournalEdit,
} from '../src/worker-contracts.ts';
import type { WorkerMechanismError } from '../src/worker-errors.ts';
import { WorkerJournal, WorkerMechanism } from '../src/worker-ports.ts';
import { makeWorkerCase } from './worker-fixtures.ts';
import { makeMemoryWorkerJournal } from './worker-memory-journal.ts';

function makeBarrier<Request>(request: Request) {
  function* acquireBarrier() {
    const reply = yield* Deferred.make<unknown, WorkerMechanismError>();
    const interrupted = yield* Deferred.make<void>();
    const finished = yield* Deferred.make<void>();
    return { request, reply, interrupted, finished };
  }
  const acquisition = Effect.gen(acquireBarrier);
  return acquisition;
}

export type MutationBarrier = Effect.Success<ReturnType<typeof makeBarrier<WorkerMutationRequest>>>;
export type ObservationBarrier = Effect.Success<
  ReturnType<typeof makeBarrier<WorkerObservationRequest>>
>;
export type ExecutionBarrier = Effect.Success<
  ReturnType<typeof makeBarrier<WorkerExecutionRequest>>
>;

export type Audit =
  | { readonly kind: 'mutate'; readonly request: WorkerMutationRequest }
  | { readonly kind: 'observe'; readonly request: WorkerObservationRequest }
  | { readonly kind: 'execute'; readonly request: WorkerExecutionRequest };

export function makeControlledWorkerMechanism(initial: WorkerObservation) {
  function* acquireMechanism() {
    const external = yield* Ref.make(initial);
    const calls = yield* Ref.make<readonly Audit[]>([]);
    const mutations = yield* Queue.bounded<MutationBarrier>(16);
    const observations = yield* Queue.bounded<ObservationBarrier>(16);
    const executions = yield* Queue.bounded<ExecutionBarrier>(16);
    const service = WorkerMechanism.of({
      mutate: (request) =>
        waitCall(request, { kind: 'mutate', request: structuredClone(request) }, calls, mutations),
      observe: (request) => waitCall(request, observationAudit(request), calls, observations),
      execute: (request) =>
        waitCall(
          request,
          { kind: 'execute', request: structuredClone(request) },
          calls,
          executions,
        ),
    });
    // External acceptance is service-owned, not a child of the interrupted actor task.
    const materialize = (observation: WorkerObservation) => Ref.set(external, observation);
    function readback(barrier: ObservationBarrier) {
      function* answerReadback() {
        const observation = yield* Ref.get(external);
        const atMs = yield* Clock.currentTimeMillis;
        yield* Deferred.succeed(barrier.reply, { ...observation, atMs });
      }
      const program = Effect.gen(answerReadback);
      return program;
    }
    return {
      service,
      calls,
      external,
      materialize,
      readback,
      barriers: { mutations, observations, executions },
    };
  }
  const acquisition = Effect.gen(acquireMechanism);
  return acquisition;
}

function observationAudit(request: WorkerObservationRequest): Audit {
  return {
    kind: 'observe',
    request: {
      operation: structuredClone(request.operation),
      containerId: Option.map(request.containerId, (containerId) => containerId),
    },
  };
}

function waitCall<Request>(
  request: Request,
  entry: Audit,
  calls: Ref.Ref<readonly Audit[]>,
  queue: Queue.Queue<Effect.Success<ReturnType<typeof makeBarrier<Request>>>>,
) {
  function* controlledCall() {
    const barrier = yield* makeBarrier(request);
    yield* Ref.update(calls, (entries) => Array.append(entries, entry));
    yield* Queue.offer(queue, barrier);
    const pending = Deferred.await(barrier.reply).pipe(
      Effect.onInterrupt(() => Deferred.succeed(barrier.interrupted, undefined)),
      Effect.ensuring(Deferred.succeed(barrier.finished, undefined)),
    );
    return yield* pending;
  }
  const program = Effect.gen(controlledCall);
  return program;
}

interface JournalGate {
  readonly point: string;
  readonly entered: Deferred.Deferred<void>;
  readonly resume: Deferred.Deferred<void>;
}

function pauseJournal(gates: Ref.Ref<Option.Option<JournalGate>>, point: string) {
  function* pauseAtBarrier() {
    const configured = yield* Ref.get(gates);
    const selected = Option.filter(configured, (gate) => gate.point === point);
    const pause = Option.match(selected, {
      onNone: () => Effect.void,
      onSome: (gate) => waitJournalGate(gates, gate),
    });
    yield* pause;
  }
  const program = Effect.gen(pauseAtBarrier);
  return program;
}
function waitJournalGate(gates: Ref.Ref<Option.Option<JournalGate>>, gate: JournalGate) {
  function* waitForRelease() {
    yield* Ref.set(gates, Option.none());
    yield* Deferred.succeed(gate.entered, undefined);
    yield* Deferred.await(gate.resume);
  }
  const program = Effect.gen(waitForRelease);
  return program;
}

function acquireHarness(seed: WorkerJournalSnapshot, peers: readonly WorkerJournalSnapshot[]) {
  function* acquireServices() {
    const c = makeWorkerCase();
    const journal = yield* makeMemoryWorkerJournal([seed, ...peers]);
    const fake = yield* makeControlledWorkerMechanism({
      ...c.observation,
      atMs: 950,
      resources: [],
    });
    const gate = yield* Ref.make<Option.Option<JournalGate>>(Option.none());
    const edits = yield* Ref.make<readonly WorkerJournalEdit[]>([]);
    function load(id: typeof c.operation.operationId) {
      function* readThroughGate() {
        yield* pauseJournal(gate, 'before-load');
        return yield* journal.service.load(id);
      }
      const program = Effect.gen(readThroughGate);
      return program;
    }
    function commit(edit: WorkerJournalEdit) {
      function* commitThroughGate() {
        yield* pauseJournal(gate, `before-${edit._tag}`);
        yield* pauseJournal(gate, `before-${edit._tag}:${edit.operationId}`);
        const result = yield* journal.service.commit(edit);
        yield* Ref.update(edits, (previous) => Array.append(previous, edit));
        yield* pauseJournal(gate, `after-${edit._tag}`);
        return result;
      }
      const program = Effect.gen(commitThroughGate);
      return program;
    }
    return { journal, fake, gate, edits, service: WorkerJournal.of({ load, commit }) };
  }
  const acquisition = Effect.gen(acquireServices);
  return acquisition;
}

export class LifecycleHarness extends Context.Service<
  LifecycleHarness,
  Effect.Success<ReturnType<typeof acquireHarness>>
>()('@leviathan/test/LifecycleHarness') {}

export function lifecycleTestLayer(
  seed: WorkerJournalSnapshot,
  peers: readonly WorkerJournalSnapshot[] = [],
) {
  function* assemble() {
    const harness = yield* acquireHarness(seed, peers);
    return Layer.mergeAll(
      Layer.succeed(LifecycleHarness, harness),
      Layer.succeed(WorkerJournal, harness.service),
      Layer.succeed(WorkerMechanism, harness.fake.service),
      TestClock.layer(),
    );
  }
  const services = Effect.gen(assemble);
  return Layer.unwrap(services);
}

export function journalGate(
  harness: Effect.Success<ReturnType<typeof acquireHarness>>,
  point: string,
) {
  function* installGate() {
    const entered = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const gate = { point, entered, resume };
    yield* Ref.set(harness.gate, Option.some(gate));
    return gate;
  }
  const acquisition = Effect.gen(installGate);
  return acquisition;
}
