import {
  WorkerContainerId,
  WorkerIssuerId,
  WorkerOperationId,
  type WorkerOperation,
  type WorkerObservation,
} from '@ceirean/domain';
import {
  Array,
  Clock,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Match,
  Option,
  Queue,
  Ref,
} from 'effect';
import { TestClock } from 'effect/testing';

import type {
  WorkerJournalEdit,
  WorkerJournalResult,
  WorkerJournalSnapshot,
} from '../src/worker-contracts.ts';
import { makeWorkerLifecycle } from '../src/worker-lifecycle-service.ts';
import { WorkerJournal, WorkerMechanism } from '../src/worker-ports.ts';
import { makeControlledWorkerMechanism, type Audit, type MutationBarrier } from './worker-fakes.ts';
import { makeWorkerCase, makeWorkerSnapshot } from './worker-fixtures.ts';
import { makeMemoryWorkerJournal } from './worker-memory-journal.ts';

type Readback =
  | 'Valid'
  | 'Absent'
  | 'NotRunning'
  | 'Foreign'
  | 'Replacement'
  | 'Retained'
  | 'Mismatch'
  | 'Malformed'
  | 'StagingPresent';
type Outcome = 'Completed' | 'Failed' | 'Unknown' | 'Lost' | 'FailedStart';
export type Evidence =
  | {
      readonly _tag: 'Commit';
      readonly before: WorkerJournalSnapshot;
      readonly edit: WorkerJournalEdit;
      readonly result: WorkerJournalResult;
    }
  | {
      readonly _tag: 'Call';
      readonly before: WorkerJournalSnapshot;
      readonly call: Audit;
      readonly external: WorkerObservation;
    }
  | { readonly _tag: 'Readback'; readonly value: unknown }
  | { readonly _tag: 'PublicFailure'; readonly error: unknown }
  | {
      readonly _tag: 'Snapshot';
      readonly snapshot: WorkerJournalSnapshot;
      readonly rebuilt: boolean;
    };

function selectedReadback(observation: WorkerObservation, mode: Readback, atMs: number): unknown {
  const c = makeWorkerCase();
  const current = { ...observation, atMs };
  return Match.value(mode).pipe(
    Match.when('Valid', () => current),
    Match.when('Absent', () => ({ ...current, resources: [], staging: 'Absent' })),
    Match.when('NotRunning', () => ({
      ...current,
      resources: current.resources.map((resource) => ({ ...resource, running: false })),
    })),
    Match.when('Foreign', () => ({
      ...current,
      resources: [
        {
          ...c.resource,
          operationId: WorkerOperationId.make('foreign-worker'),
          containerId: WorkerContainerId.make('foreign-container'),
        },
      ],
    })),
    Match.when('Replacement', () => ({
      ...current,
      resources: [
        {
          ...c.resource,
          identity: { ...c.resource.identity, generation: c.resource.identity.generation + 1 },
        },
      ],
    })),
    Match.when('Retained', () => ({
      ...current,
      resources: [
        {
          ...c.resource,
          configuration: {
            ...c.resource.configuration,
            mounts: [
              {
                source: c.operation.custody.retainedArtifacts[0]!,
                target: '/workspace',
                readOnly: false,
              },
            ],
          },
        },
      ],
    })),
    Match.when('Mismatch', () => ({
      ...current,
      resources: [
        { ...c.resource, configuration: { ...c.resource.configuration, network: 'foreign' } },
      ],
    })),
    Match.when('Malformed', () => ({ ...current, resources: 'invalid' })),
    Match.when('StagingPresent', () => ({ ...current, resources: [], staging: 'Present' })),
    Match.exhaustive,
  );
}

function makePropertyFixture(operation: WorkerOperation) {
  function* acquireFixture() {
    const c = makeWorkerCase();
    const journal = yield* makeMemoryWorkerJournal([{ ...makeWorkerSnapshot(), operation }]);
    const fake = yield* makeControlledWorkerMechanism({
      ...c.observation,
      atMs: 950,
      resources: [],
    });
    const evidence = yield* Ref.make<readonly Evidence[]>([]);
    const committed = yield* Queue.bounded<WorkerJournalEdit>(1024);
    const readback = yield* Ref.make<Readback>('Valid');
    const outcome = yield* Ref.make<Outcome>('Completed');
    const ownerNumber = yield* Ref.make(0);
    const rootFault = yield* Ref.make(false);
    const readSnapshot = journal
      .inspect(c.operation.operationId)
      .pipe(Effect.map(Option.getOrThrow));
    function append(entry: Evidence) {
      const program = Ref.update(evidence, (entries) => Array.append(entries, entry));
      return program;
    }
    function commit(edit: WorkerJournalEdit) {
      function* recordCommit() {
        const before = yield* readSnapshot;
        const result = yield* journal.service.commit(edit);
        yield* append({ _tag: 'Commit', before, edit, result });
        yield* Queue.offer(committed, edit);
        const broken = yield* Ref.get(rootFault);
        // Adversarial journal return only; the authoritative stored Claim stays intact.
        return Match.value({ broken, tag: edit._tag, result }).pipe(
          Match.when(
            { broken: true, tag: 'Claim', result: { _tag: 'Committed' } },
            ({ result }) => ({
              ...result,
              snapshot: { ...result.snapshot, intents: [] },
            }),
          ),
          Match.orElse(() => result),
        );
      }
      const program = Effect.gen(recordCommit);
      return program;
    }
    function recordCall(call: Audit) {
      function* inspectAtDispatch() {
        const before = yield* readSnapshot;
        const external = yield* Ref.get(fake.external);
        yield* append({ _tag: 'Call', before, call, external });
      }
      const program = Effect.gen(inspectAtDispatch);
      return program;
    }
    const mechanism = WorkerMechanism.of({
      mutate: (request) =>
        recordCall({ kind: 'mutate', request }).pipe(Effect.andThen(fake.service.mutate(request))),
      observe: (request) =>
        recordCall({ kind: 'observe', request }).pipe(
          Effect.andThen(fake.service.observe(request)),
        ),
      execute: (request) =>
        recordCall({ kind: 'execute', request }).pipe(
          Effect.andThen(fake.service.execute(request)),
        ),
    });
    function answerMutation(barrier: MutationBarrier) {
      function* deliverOutcome() {
        const selected = yield* Ref.get(outcome);
        const mode = Match.value({ selected, kind: barrier.request.intent.kind }).pipe(
          Match.when({ selected: 'FailedStart', kind: 'Start' }, () => 'Failed' as const),
          Match.when({ selected: 'FailedStart' }, () => 'Completed' as const),
          Match.orElse(({ selected }) => selected),
        );
        const atMs = yield* Clock.currentTimeMillis;
        const current = yield* Ref.get(fake.external);
        const resources = Match.value(barrier.request.intent.kind).pipe(
          Match.when('Create', () => [{ ...c.resource, running: false }]),
          Match.when('Start', () => [{ ...c.resource, running: true }]),
          Match.when('Stop', () => [{ ...c.resource, running: false }]),
          Match.when('Remove', () => []),
          Match.exhaustive,
        );
        const staging = Match.value(resources.length).pipe(
          Match.when(0, () => 'Absent' as const),
          Match.orElse(() => 'Present' as const),
        );
        const observation: WorkerObservation = {
          ...current,
          atMs,
          resources,
          staging,
        };
        const isCompleted = Match.value(mode).pipe(
          Match.when('Completed', () => true),
          Match.orElse(() => false),
        );
        const completed = Effect.sync(() => isCompleted);
        yield* fake.materialize(observation).pipe(Effect.when(completed));
        const result = Match.value(mode).pipe(
          Match.when('Completed', () => ({ _tag: 'Completed' as const, observation })),
          Match.when('Failed', () => ({
            _tag: 'Failed' as const,
            reason: { _tag: 'ReadinessMismatch' as const, operationId: c.operation.operationId },
          })),
          Match.orElse(() => ({
            _tag: 'Unknown' as const,
            reason: { _tag: 'UnresolvedIntent' as const, operationId: c.operation.operationId },
          })),
        );
        const reply = Deferred.succeed(barrier.reply, {
          ...barrier.request.operation,
          intentId: barrier.request.intent.intentId,
          issuerId: barrier.request.intent.issuerId,
          atMs,
          outcome: result,
        });
        const shouldDeliver = Match.value(mode).pipe(
          Match.when('Lost', () => false),
          Match.orElse(() => true),
        );
        const deliver = Effect.sync(() => shouldDeliver);
        yield* reply.pipe(Effect.when(deliver));
      }
      const program = Effect.gen(deliverOutcome);
      return program;
    }
    function* mutationResponder() {
      const barrier = yield* Queue.take(fake.barriers.mutations);
      yield* answerMutation(barrier);
    }
    function* observationResponder() {
      const barrier = yield* Queue.take(fake.barriers.observations);
      const current = yield* Ref.get(fake.external);
      const mode = yield* Ref.get(readback);
      const atMs = yield* Clock.currentTimeMillis;
      const value = selectedReadback(current, mode, atMs);
      yield* append({ _tag: 'Readback', value });
      yield* Deferred.succeed(barrier.reply, value);
    }
    function* executionResponder() {
      const barrier = yield* Queue.take(fake.barriers.executions);
      const completedAtMs = yield* Clock.currentTimeMillis;
      yield* Deferred.succeed(barrier.reply, {
        operationId: c.operation.operationId,
        identity: c.operation.identity,
        completedAtMs,
      });
    }
    const respondMutations = Effect.gen(mutationResponder);
    const respondObservations = Effect.gen(observationResponder);
    const respondExecutions = Effect.gen(executionResponder);
    const startResponders = Effect.all([
      respondMutations.pipe(Effect.forever, Effect.forkScoped),
      respondObservations.pipe(Effect.forever, Effect.forkScoped),
      respondExecutions.pipe(Effect.forever, Effect.forkScoped),
    ]);
    function checkpoint(rebuilt = false) {
      return readSnapshot.pipe(
        Effect.flatMap((snapshot) => append({ _tag: 'Snapshot', snapshot, rebuilt })),
      );
    }
    function recordSnapshot(snapshot: WorkerJournalSnapshot, rebuilt: boolean) {
      const program = append({ _tag: 'Snapshot', snapshot, rebuilt });
      return program;
    }
    function recordFailure(error: unknown) {
      const program = append({ _tag: 'PublicFailure', error });
      return program;
    }
    return {
      journal,
      fake,
      evidence,
      committed,
      readback,
      outcome,
      ownerNumber,
      rootFault,
      readSnapshot,
      checkpoint,
      recordSnapshot,
      recordFailure,
      startResponders,
      journalService: WorkerJournal.of({ load: journal.service.load, commit }),
      mechanism,
    };
  }
  const acquisition = Effect.gen(acquireFixture);
  return acquisition;
}

export class PropertyFixture extends Context.Service<
  PropertyFixture,
  Effect.Success<ReturnType<typeof makePropertyFixture>>
>()('@ceirean/test/PropertyFixture') {}

export function propertyFixtureLayer(operation: WorkerOperation = makeWorkerCase().operation) {
  function* assemble() {
    const fixture = yield* makePropertyFixture(operation);
    return Layer.mergeAll(
      Layer.succeed(PropertyFixture, fixture),
      Layer.succeed(WorkerJournal, fixture.journalService),
      Layer.succeed(WorkerMechanism, fixture.mechanism),
      TestClock.layer(),
    );
  }
  const acquisition = Effect.gen(assemble);
  return Layer.unwrap(acquisition);
}

export function openPropertyOwner() {
  function* open() {
    const fixture = yield* PropertyFixture;
    const generation = yield* Ref.updateAndGet(fixture.ownerNumber, (number) => number + 1);
    const ready = yield* Deferred.make<Effect.Success<ReturnType<typeof makeWorkerLifecycle>>>();
    const stop = yield* Deferred.make<void>();
    function* ownService() {
      yield* Effect.addFinalizer(() => Deferred.succeed(stop, undefined));
      const service = yield* makeWorkerLifecycle(WorkerIssuerId.make(`controller-${generation}`));
      yield* Deferred.succeed(ready, service);
      yield* Deferred.await(stop);
    }
    const program = Effect.gen(ownService);
    const fiber = yield* program.pipe(Effect.scoped, Effect.forkScoped);
    const ended = Fiber.await(fiber).pipe(Effect.andThen(Effect.interrupt));
    const service = yield* Deferred.await(ready).pipe(Effect.raceFirst(ended), Effect.scoped);
    return { service, fiber, stop };
  }
  const acquisition = Effect.gen(open);
  return acquisition;
}

export function closePropertyOwner(owner: Effect.Success<ReturnType<typeof openPropertyOwner>>) {
  const closing = Deferred.succeed(owner.stop, undefined).pipe(
    Effect.andThen(Fiber.join(owner.fiber)),
  );
  return closing;
}

export function waitForPropertyEdit(tag: WorkerJournalEdit['_tag']) {
  function* waitForEdit() {
    const fixture = yield* PropertyFixture;
    yield* Queue.take(fixture.committed).pipe(
      Effect.repeat({ until: (edit) => edit._tag === tag }),
    );
  }
  const program = Effect.gen(waitForEdit);
  return program;
}
