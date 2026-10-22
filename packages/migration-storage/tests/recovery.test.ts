import { expect, test } from 'bun:test';

import {
  WorkerIssuerId,
  WorkerOperationId,
  type WorkerObservation,
  type WorkerOperation,
} from '@ceirean/domain';
import { Effect, Match, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import type { WorkerMutationRequest } from '../../engine/src/worker-contracts.ts';
import { WorkerMechanismError } from '../../engine/src/worker-errors.ts';
import { WorkerMechanism } from '../../engine/src/worker-ports.ts';
import { makeCancelledChange, makeSnapshot } from '../../engine/tests/fixtures.ts';
import { makeWorkerCase } from '../../engine/tests/worker-fixtures.ts';
import * as Ledger from '../src/index.ts';
import { ownedConfig, platform, childInput, type ChildInput } from './fixtures.ts';
import { ownChild, waitReady, awaitChild } from './readiness.ts';
import { reconstructController } from './recovery-controller.ts';

type Fixture = Effect.Success<ReturnType<typeof ownedConfig>>;
function seedLedger(config: Ledger.MigrationLedgerConfig, operations: readonly WorkerOperation[]) {
  function* seed() {
    const ledger = yield* Ledger.openMigrationLedger(config);
    const initial = makeSnapshot();
    expect(
      yield* ledger.registerRun({ state: initial.state, contract: initial.contract }),
    ).toMatchObject({ _tag: 'Registered' });
    for (const operation of operations) {
      expect(
        yield* ledger.workerJournal.commit({
          _tag: 'Register',
          operationId: operation.operationId,
          operation,
          atMs: 900,
          createdAtMs: 900,
        }),
      ).toMatchObject({ _tag: 'Committed' });
    }
    return yield* ledger.readRecovery();
  }
  const program = Effect.gen(seed);
  return program.pipe(Effect.scoped);
}
function killChild(child: Effect.Success<ReturnType<typeof ownChild>>) {
  function* terminate() {
    child.kill('SIGKILL');
    yield* awaitChild(child);
  }
  const program = Effect.gen(terminate);
  return program;
}

async function unknownFallback() {
  function* scenario() {
    const fixture = yield* ownedConfig();
    yield* Ledger.initializeMigrationLedger(fixture.config);
    const c = makeWorkerCase();
    yield* seedLedger(fixture.config, [c.operation]);
    yield* TestClock.setTime(950);
    let mutations = 0;
    function failMutation() {
      mutations += 1;
      const failure = Effect.fail(
        new WorkerMechanismError({ operation: 'mutate', code: 'Unavailable' }),
      );
      return failure;
    }
    const mechanism = WorkerMechanism.of({
      mutate: () => Effect.suspend(failMutation),
      observe: () =>
        Effect.succeed({ ...c.observation, atMs: 950, resources: [], staging: 'Absent' }),
      execute: () => Effect.die('Execution is not authorized'),
    });
    function* failAndRead() {
      const controller = yield* reconstructController(
        fixture.config,
        WorkerIssuerId.make('unknown-owner'),
        mechanism,
      );
      yield* controller.lifecycle.reconcile(c.operation.operationId).pipe(Effect.result);
      return yield* controller.ledger.readRecovery();
    }
    const failing = Effect.gen(failAndRead);
    const before = yield* Effect.scoped(failing);
    const reopened = yield* Ledger.openMigrationLedger(fixture.config);
    expect(yield* reopened.readRecovery()).toEqual(before);
    const stored = Option.getOrThrow(yield* reopened.workerJournal.load(c.operation.operationId));
    expect(stored.intents).toHaveLength(1);
    expect(stored.intents[0]).toMatchObject({
      kind: 'Create',
      intentId: 'worker-1:Create:slot-1',
      issuerId: 'unknown-owner',
      claimedAtMs: 950,
      resource: c.operation.custody.containerSlot,
      outcome: { _tag: 'Unknown' },
    });
    expect(stored.operation).toEqual(c.operation);
    expect(mutations).toBe(1);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const dependencies = platform;
  const clock = TestClock.layer();
  const provided = Effect.provide(scoped, dependencies);
  const withClock = Effect.provide(provided, clock);
  await Effect.runPromise(withClock);
}
test(
  'failed mutation persists a strict native Unknown reply with the original intent and issuer',
  unknownFallback,
  30000,
);

for (const point of [
  'BeforeTransaction',
  'AfterRunWrite',
  'AfterWorkerWrite',
  'AfterEventWrite',
  'AfterCommit',
] as const) {
  async function crashRecovery() {
    function* scenario() {
      const fixture = yield* ownedConfig();
      yield* Ledger.initializeMigrationLedger(fixture.config);
      const operation = makeWorkerCase().operation;
      const before = yield* seedLedger(fixture.config, [
        operation,
        { ...operation, operationId: WorkerOperationId.make('peer') },
      ]);
      const child = yield* ownChild({
        root: fixture.root,
        ownerUid: fixture.config.pathPolicy.ownerUid,
        mode: 'Crash',
        point,
      });
      yield* waitReady(child, 'PAUSED');
      expect(
        yield* Effect.scoped(Ledger.openMigrationLedger(fixture.config)).pipe(Effect.result),
      ).toMatchObject({ _tag: 'Failure', failure: { code: 'OwnershipBusy' } });
      yield* killChild(child);
      const probe = yield* ownChild({
        root: fixture.root,
        ownerUid: fixture.config.pathPolicy.ownerUid,
        mode: 'Probe',
        point,
      });
      const phase = Match.value(point).pipe(
        Match.when('AfterCommit', () => 'POST'),
        Match.orElse(() => 'PRE'),
      );
      yield* waitReady(probe, phase);
      expect(yield* awaitChild(probe)).toBe(0);
      const reopened = yield* Ledger.openMigrationLedger(fixture.config);
      const after = yield* reopened.readRecovery();
      function* postCommit() {
        expect(after.sequence).toBe(4);
        expect(after.runs[0]?.state._tag).toBe('Cancelled');
        expect(after.workers.map(({ snapshot }) => snapshot.revision)).toEqual([1, 1]);
        expect(
          after.workers.every(({ snapshot }) =>
            Option.contains(snapshot.authority.cancelledAtMs, 999),
          ),
        ).toBe(true);
        expect(
          yield* reopened.runRepository.commit({ ...makeCancelledChange(), expectedRevision: 0 }),
        ).toMatchObject({ _tag: 'Conflict' });
        expect(yield* reopened.readRecovery()).toEqual(after);
      }
      const committed = Effect.gen(postCommit);
      function unchanged() {
        expect(after).toEqual(before);
      }
      const verifying = Match.value(point).pipe(
        Match.when('AfterCommit', () => committed),
        Match.orElse(() => Effect.sync(unchanged)),
      );
      yield* verifying;
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    const provided = Effect.provide(scoped, platform);
    const withClock = Effect.provide(provided, TestClock.layer());
    await Effect.runPromise(withClock);
  }
  test(
    `SIGKILL ${point}: fresh process sees one whole transaction and no replay`,
    crashRecovery,
    30000,
  );
}

test('child protocol rejects arbitrary paths, commands, faults and extra fields', function rejectedProtocol() {
  const decode = Schema.decodeUnknownResult(childInput, { onExcessProperty: 'error' });
  for (const input of [
    { root: '/tmp/elsewhere', ownerUid: 1, mode: 'Crash', point: 'AfterCommit' },
    {
      root: '/private/tmp/migration-task3-valid',
      ownerUid: 1,
      mode: 'shell',
      point: 'AfterCommit',
    },
    { root: '/private/tmp/migration-task3-valid', ownerUid: 1, mode: 'Crash', point: 'arbitrary' },
    {
      root: '/private/tmp/migration-task3-valid',
      ownerUid: 1,
      mode: 'Crash',
      point: 'AfterCommit',
      command: 'anything',
    },
    {
      root: '/private/tmp/migration-task3-valid/../other',
      ownerUid: 1,
      mode: 'Crash',
      point: 'AfterCommit',
    },
  ])
    expect(decode(input)._tag).toBe('Failure');
});

function persistWindow(fixture: Fixture, mode: ChildInput['mode']) {
  function* inspect() {
    const ledger = yield* Ledger.openMigrationLedger(fixture.config);
    const c = makeWorkerCase();
    const snapshot = Option.getOrThrow(yield* ledger.workerJournal.load(c.operation.operationId));
    const kind = Match.value(mode).pipe(
      Match.when('UnknownCreate', () => 'Create'),
      Match.when('UnknownStart', () => 'Start'),
      Match.orElse((value) => value),
    );
    const outcome = Match.value(mode).pipe(
      Match.whenOr('UnknownCreate', 'UnknownStart', () => 'Unknown'),
      Match.orElse(() => 'Claimed'),
    );
    const checked = Match.value(mode).pipe(
      Match.when('Execution', () =>
        expect(Option.isSome(snapshot.executionAuthorizedAtMs)).toBe(true),
      ),
      Match.orElse(() =>
        expect(snapshot.intents.find((intent) => intent.kind === kind)).toMatchObject({
          outcome: { _tag: outcome },
          issuerId: 'child-controller-1',
        }),
      ),
    );
    void checked;
    expect(
      yield* ledger.workerJournal.commit({
        _tag: 'RequestCleanup',
        operationId: c.operation.operationId,
        expectedRevision: snapshot.revision,
        atMs: 960,
        cleanupWindowMs: 40,
      }),
    ).toMatchObject({ _tag: 'Committed' });
    return snapshot;
  }
  const program = Effect.gen(inspect);
  return program.pipe(Effect.scoped);
}

for (const mode of ['Create', 'Start', 'Execution', 'UnknownCreate', 'UnknownStart'] as const) {
  for (const readback of ['Absent', 'Ambiguous', 'Matching'] as const) {
    for (const nowMs of [970, 1000]) {
      async function recoveredController() {
        function* scenario() {
          const fixture = yield* ownedConfig();
          yield* Ledger.initializeMigrationLedger(fixture.config);
          const base = makeWorkerCase();
          const retained = `${fixture.root}/retained-evidence.json`;
          const operation = {
            ...base.operation,
            custody: { ...base.operation.custody, retainedArtifacts: [retained] },
          };
          yield* fixture.fs.writeFileString(retained, 'retained synthetic evidence');
          const retainedStat = yield* fixture.fs.stat(retained);
          yield* seedLedger(fixture.config, [operation]);
          const child = yield* ownChild({
            root: fixture.root,
            ownerUid: fixture.config.pathPolicy.ownerUid,
            mode,
            point: 'AfterCommit',
          });
          yield* waitReady(child, 'PAUSED');
          yield* killChild(child);
          const original = yield* persistWindow(fixture, mode);
          yield* TestClock.setTime(nowMs);
          const calls: WorkerMutationRequest[] = [];
          const executions: string[] = [];
          const resources = Match.value(readback).pipe(
            Match.when('Absent', () => []),
            Match.when('Ambiguous', () => [base.resource, base.resource]),
            Match.when('Matching', () => [base.resource]),
            Match.exhaustive,
          );
          let observation: WorkerObservation = {
            ...base.observation,
            atMs: nowMs,
            resources,
            staging: 'Absent',
          };
          function mutate(request: WorkerMutationRequest) {
            function deliver() {
              calls.push(request);
              const resources = Match.value(request.intent.kind).pipe(
                Match.when('Remove', () => []),
                Match.orElse(() => [{ ...base.resource, running: false }]),
              );
              const staging = Match.value(request.intent.kind).pipe(
                Match.when('Remove', () => 'Absent' as const),
                Match.orElse(() => 'Present' as const),
              );
              observation = { ...observation, resources, staging };
              return {
                ...base.reply,
                intentId: request.intent.intentId,
                issuerId: request.intent.issuerId,
                atMs: nowMs,
                outcome: { _tag: 'Completed' as const, observation },
              };
            }
            const mutation = Effect.sync(deliver);
            return mutation;
          }
          function forbiddenExecution() {
            executions.push('Execute');
            return {
              operationId: operation.operationId,
              identity: operation.identity,
              completedAtMs: nowMs,
            };
          }
          const mechanism = WorkerMechanism.of({
            observe: () => Effect.sync(() => observation),
            mutate,
            execute: () => Effect.sync(forbiddenExecution),
          });
          const issuer = WorkerIssuerId.make('parent-controller-2');
          const controller = yield* reconstructController(fixture.config, issuer, mechanism);
          expect(controller.recovery.workers[0]?.snapshot.operation).toEqual(operation);
          yield* controller.lifecycle.reconcile(operation.operationId);
          const materializingKind = Schema.is(Schema.Literals(['Create', 'Start']));
          const materializing = calls.filter((call) => materializingKind(call.intent.kind));
          expect(materializing).toEqual([]);
          expect(executions).toEqual([]);
          const loaded = yield* controller.ledger.workerJournal.load(operation.operationId);
          const final = Option.getOrThrow(loaded);
          const cleanup = Option.getOrThrow(final.cleanup);
          expect(cleanup.deadlineMs).toBe(1000);
          expect(cleanup.requestedAtMs).toBe(960);
          expect(final.operation).toEqual(operation);
          for (const old of original.intents) {
            const sameIntents = final.intents.filter((intent) => intent.intentId === old.intentId);
            expect(sameIntents).toHaveLength(1);
            const currentIntent = final.intents.find((intent) => intent.intentId === old.intentId);
            expect(currentIntent).toMatchObject({
              issuerId: old.issuerId,
              claimedAtMs: old.claimedAtMs,
              resource: old.resource,
            });
          }
          function positiveCleanup() {
            expect(cleanup._tag).toBe('CleanupConfirmed');
            expect(calls.map((call) => call.intent.kind)).toEqual(['Stop', 'Remove']);
            expect(calls.every((call) => call.intent.issuerId === issuer)).toBe(true);
          }
          function blockedCleanup() {
            expect(cleanup._tag).not.toBe('CleanupConfirmed');
            expect(calls).toEqual([]);
          }
          const checked = Match.value({ readback, nowMs, mode }).pipe(
            Match.when({ readback: 'Matching', nowMs: 970 }, positiveCleanup),
            Match.when({ readback: 'Absent', nowMs: 970, mode: 'Execution' }, () =>
              expect(cleanup._tag).toBe('CleanupConfirmed'),
            ),
            Match.orElse(blockedCleanup),
          );
          void checked;
          expect(
            calls.every(
              (call) => !operation.custody.retainedArtifacts.includes(call.intent.resource),
            ),
          ).toBe(true);
          expect(yield* fixture.fs.readFileString(retained)).toBe('retained synthetic evidence');
          const afterStat = yield* fixture.fs.stat(retained);
          expect([afterStat.dev, afterStat.ino, afterStat.size]).toEqual([
            retainedStat.dev,
            retainedStat.ino,
            retainedStat.size,
          ]);
        }
        const program = Effect.gen(scenario);
        const scoped = Effect.scoped(program);
        const clock = TestClock.layer();
        const provided = Effect.provide(scoped, platform);
        const withClock = Effect.provide(provided, clock);
        await Effect.runPromise(withClock);
      }
      test(
        `killed ${mode} controller / ${readback} at ${nowMs}: no replay or renewed cleanup`,
        recoveredController,
        30000,
      );
    }
  }
}
