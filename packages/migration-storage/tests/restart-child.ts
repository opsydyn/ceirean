import { WorkerIssuerId, type WorkerObservation } from '@ceirean/domain';
import { BunRuntime } from '@effect/platform-bun';
import { Effect, Match, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import type { WorkerMutationRequest } from '../../engine/src/worker-contracts.ts';
import { WorkerMechanismError } from '../../engine/src/worker-errors.ts';
import { WorkerMechanism } from '../../engine/src/worker-ports.ts';
import { makeCancelledChange } from '../../engine/tests/fixtures.ts';
import { makeWorkerCase } from '../../engine/tests/worker-fixtures.ts';
import {
  openMigrationLedger,
  type MigrationLedgerConfig,
  type MigrationLedgerTestFaultPoint,
} from '../src/index.ts';
import { platform, childInput, ChildFixtureFailure } from './fixtures.ts';
import { reconstructController } from './recovery-controller.ts';

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(childInput), {
  onExcessProperty: 'error',
});
function announce(line: string) {
  const writer = Bun.stdout.writer();
  writer.write(`${line}\n`);
  writer.flush();
}
function pause() {
  announce('PAUSED');
  // Only this fixed child blocks synchronously, holding the exact SQL or mechanism boundary.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  throw new ChildFixtureFailure({ phase: 'Watchdog' });
}
function* fixture() {
  const input = yield* decode(Bun.argv[2]);
  const config: MigrationLedgerConfig = {
    ledgerId: 'test-ledger',
    pathPolicy: {
      _tag: 'TestOwnedTemporary',
      stateRoot: input.root,
      ownedTemporaryRoot: input.root,
      ownerUid: input.ownerUid,
    },
  };
  function fault(point: MigrationLedgerTestFaultPoint) {
    return Match.value({ mode: input.mode, selected: point === input.point }).pipe(
      Match.when({ mode: 'Crash', selected: true }, pause),
      Match.orElse(() => undefined),
    );
  }
  function* crashOrProbe() {
    const ledger = yield* openMigrationLedger({ ...config, testFault: fault });
    function* probe() {
      const recovered = yield* ledger.readRecovery();
      const phase = Match.value(recovered.sequence).pipe(
        Match.when(3, () => 'PRE'),
        Match.when(4, () => 'POST'),
        Match.orElse(() => {
          throw new ChildFixtureFailure({ phase: 'Readiness' });
        }),
      );
      announce(phase);
    }
    function* crash() {
      const paused = Match.value(input.point).pipe(
        Match.when('BeforeTransaction', pause),
        Match.orElse(() => undefined),
      );
      void paused;
      yield* ledger.runRepository.commit({ ...makeCancelledChange(), expectedRevision: 0 });
      return yield* Effect.fail(new ChildFixtureFailure({ phase: 'Watchdog' }));
    }
    return yield* Match.value(input.mode).pipe(
      Match.when('Probe', () => Effect.gen(probe)),
      Match.orElse(() => Effect.gen(crash)),
    );
  }
  function* controller() {
    yield* TestClock.setTime(950);
    const c = makeWorkerCase();
    let observation: WorkerObservation = { ...c.observation, atMs: 950, resources: [] };
    let failed = false;
    function observe() {
      function readback() {
        const paused = Match.value(failed).pipe(
          Match.when(true, pause),
          Match.orElse(() => undefined),
        );
        void paused;
        return observation;
      }
      const observing = Effect.sync(readback);
      return observing;
    }
    function mutate(request: WorkerMutationRequest) {
      function deliver() {
        const target = Match.value(input.mode).pipe(
          Match.when('UnknownCreate', () => 'Create'),
          Match.when('UnknownStart', () => 'Start'),
          Match.orElse((mode) => mode),
        );
        const selected = request.intent.kind === target;
        const unknownMode = Schema.Literals(['UnknownCreate', 'UnknownStart']);
        const unknown = Schema.is(unknownMode)(input.mode);
        const disposition = Match.value({ selected, unknown }).pipe(
          Match.when({ selected: true, unknown: true }, () => 'Fail' as const),
          Match.when({ selected: true }, () => 'Pause' as const),
          Match.orElse(() => 'Complete' as const),
        );
        function complete() {
          const start = Schema.Literal('Start');
          const running = Schema.is(start)(request.intent.kind);
          observation = { ...observation, resources: [{ ...c.resource, running }] };
          const reply = {
            ...c.reply,
            intentId: request.intent.intentId,
            issuerId: request.intent.issuerId,
            atMs: 950,
            outcome: { _tag: 'Completed' as const, observation },
          };
          const completed = Effect.sync(() => reply);
          return completed;
        }
        function failDelivery() {
          failed = true;
          const failure = Effect.fail(
            new WorkerMechanismError({ operation: 'mutate', code: 'Unavailable' }),
          );
          return failure;
        }
        return Match.value(disposition).pipe(
          Match.when('Fail', failDelivery),
          Match.when('Pause', () => Effect.sync(pause)),
          Match.when('Complete', complete),
          Match.exhaustive,
        );
      }
      const mutation = Effect.suspend(deliver);
      return mutation;
    }
    const mechanism = WorkerMechanism.of({ observe, mutate, execute: () => Effect.sync(pause) });
    const owned = yield* reconstructController(
      config,
      WorkerIssuerId.make('child-controller-1'),
      mechanism,
    );
    function* execute() {
      const reading = owned.ledger.workerJournal
        .load(c.operation.operationId)
        .pipe(Effect.tap(() => Effect.yieldNow));
      yield* reading.pipe(
        Effect.repeat({
          until: (value) => Option.exists(value, (snapshot) => Option.isSome(snapshot.readiness)),
        }),
      );
      yield* owned.lifecycle.requestExecution(c.operation.operationId);
    }
    const execution = Effect.gen(execute);
    const isExecution = Schema.is(Schema.Literal('Execution'));
    function executionSelected() {
      return isExecution(input.mode);
    }
    const selected = Effect.sync(executionSelected);
    yield* execution.pipe(Effect.when(selected));
    // Parent readiness watchdog kills stalled children; this secondary bound never renews business time.
    yield* Effect.promise(() => Bun.sleep(10000));
    return yield* Effect.fail(new ChildFixtureFailure({ phase: 'Watchdog' }));
  }
  const scenario = Match.value(input.mode).pipe(
    Match.whenOr('Crash', 'Probe', () => Effect.gen(crashOrProbe)),
    Match.orElse(() => Effect.gen(controller)),
  );
  return yield* scenario;
}
const program = Effect.gen(fixture);
function refused() {
  function emitRefusal() {
    announce('REFUSED');
    process.exitCode = 1;
  }
  const reporting = Effect.sync(emitRefusal);
  return reporting;
}
const clock = TestClock.layer();
const scoped = program.pipe(Effect.scoped, Effect.catchCause(refused));
const provided = Effect.provide(scoped, platform);
const withClock = Effect.provide(provided, clock);
BunRuntime.runMain(withClock);
