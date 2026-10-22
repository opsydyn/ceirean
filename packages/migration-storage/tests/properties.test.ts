import { expect, test } from 'bun:test';

import { AttemptId, FrozenRun, decideCancellation } from '@ceirean/domain';
import {
  decideMigrationLedger,
  recoverMigrationLedger,
  type MigrationLedgerCommand,
  type MigrationLedgerState,
  type MigrationLedgerReply,
} from '@ceirean/engine/journal-policy';
import { Arbitrary, Effect, Match, Option, Result, Schema } from 'effect';

import { validateCheckResult } from '../../domain/tests/properties.ts';
import { makeCancelledChange, makeSnapshot } from '../../engine/tests/fixtures.ts';
import { makeWorkerCase } from '../../engine/tests/worker-fixtures.ts';
import * as Ledger from '../src/index.ts';
import { ownedConfig, platform } from './fixtures.ts';

const arbitrary = Arbitrary.all({
  replace: Arbitrary.schema(Schema.Boolean),
  window: Arbitrary.schema(Schema.Literals([0, 1, 10, 100])),
  purpose: Arbitrary.schema(Schema.Literals(['Baseline', 'Candidate', 'Verification'])),
});
type Input = typeof arbitrary extends Arbitrary.Arbitrary<infer A> ? A : never;

function mutateReturned(reply: MigrationLedgerReply) {
  function worker({ result }: Extract<MigrationLedgerReply, { readonly _tag: 'WorkerResult' }>) {
    return Match.value(result).pipe(
      Match.tag('Committed', ({ snapshot }) => {
        Reflect.set(snapshot.operation.limits, 'spentMicros', -1);
        Option.map(snapshot.cleanup, (cleanup) => Reflect.set(cleanup, 'deadlineMs', -1));
      }),
      Match.orElse(() => undefined),
    );
  }
  return Match.value(reply).pipe(
    Match.tag('Registered', ({ snapshot }) => Reflect.set(snapshot.state, 'deadlineMs', -1)),
    Match.tag('WorkerResult', worker),
    Match.orElse(() => undefined),
  );
}

function refinement(input: Input) {
  function* scenario() {
    const fixture = yield* ownedConfig();
    yield* Ledger.initializeMigrationLedger(fixture.config);
    let expected: MigrationLedgerState = { runs: [], workers: [], sequence: 0 };
    let commands = 0;
    let commits = 0;
    const c = makeWorkerCase();
    const initial = makeSnapshot();
    const seed = { ...initial, state: Schema.decodeUnknownSync(FrozenRun)(initial.state) };
    const operation = { ...c.operation, purpose: input.purpose };
    function* writeSession() {
      const ledger = yield* Ledger.openMigrationLedger(fixture.config);
      function actual(command: MigrationLedgerCommand) {
        function run({ change }: Extract<MigrationLedgerCommand, { readonly _tag: 'ChangeRun' }>) {
          return ledger.runRepository
            .commit(change)
            .pipe(Effect.map((result): MigrationLedgerReply => ({ _tag: 'RunResult', result })));
        }
        function worker({
          edit,
        }: Extract<MigrationLedgerCommand, { readonly _tag: 'EditWorker' }>) {
          return ledger.workerJournal
            .commit(edit)
            .pipe(Effect.map((result): MigrationLedgerReply => ({ _tag: 'WorkerResult', result })));
        }
        return Match.value(command).pipe(
          Match.tag('RegisterRun', ({ state, contract }) =>
            ledger.registerRun({ state, contract }),
          ),
          Match.tag('ChangeRun', run),
          Match.tag('EditWorker', worker),
          Match.exhaustive,
        );
      }
      function execute(command: MigrationLedgerCommand) {
        function* compareCommand() {
          const decision = Result.getOrThrow(decideMigrationLedger(expected, command));
          const reply = yield* actual(command);
          expect(reply).toEqual(decision.reply);
          commands += 1;
          commits += Option.match(decision.event, { onNone: () => 0, onSome: () => 1 });
          expected = decision.next;
          // Returned records are adversarially modified, never the pure oracle.
          mutateReturned(reply);
          const recovery = yield* ledger.readRecovery();
          const recovered = recoverMigrationLedger(expected);
          const oracle = Result.getOrThrow(recovered);
          expect(recovery).toEqual(oracle);
          const first = Option.fromUndefinedOr(recovery.workers[0]);
          Option.map(first, ({ snapshot }) =>
            Reflect.set(snapshot.operation.identity, 'generation', -1),
          );
          expect(yield* ledger.readRecovery()).toEqual(
            Result.getOrThrow(recoverMigrationLedger(expected)),
          );
        }
        const step = Effect.gen(compareCommand);
        return step;
      }
      yield* execute({ _tag: 'RegisterRun', state: seed.state, contract: seed.contract });
      yield* execute({
        _tag: 'EditWorker',
        edit: {
          _tag: 'Register',
          operationId: operation.operationId,
          operation,
          atMs: 900,
          createdAtMs: 900,
        },
      });
      yield* execute({
        _tag: 'EditWorker',
        edit: {
          _tag: 'AuthorizeExecution',
          operationId: operation.operationId,
          expectedRevision: 0,
          atMs: 950,
        },
      });
      yield* execute({
        _tag: 'EditWorker',
        edit: {
          _tag: 'RequestCleanup',
          operationId: operation.operationId,
          expectedRevision: 0,
          atMs: 950,
          cleanupWindowMs: input.window,
        },
      });
      yield* execute({
        _tag: 'EditWorker',
        edit: {
          _tag: 'RequestCleanup',
          operationId: operation.operationId,
          expectedRevision: 1,
          atMs: 951,
          cleanupWindowMs: 1000,
        },
      });
      const state = {
        ...seed.state,
        generation: seed.state.generation + 1,
        attemptId: AttemptId.make('native-replacement'),
      };
      const expectedRevision = Match.value(input.replace).pipe(
        Match.when(true, () => 0),
        Match.orElse(() => 1),
      );
      yield* execute({
        _tag: 'ChangeRun',
        change: { runId: seed.state.runId, expectedRevision, state, facts: [] },
      });
      const worker = expected.workers[0]!;
      yield* execute({
        _tag: 'EditWorker',
        edit: {
          _tag: 'RequestCancellation',
          operationId: operation.operationId,
          expectedRevision: worker.revision,
          atMs: 960,
          cleanupWindowMs: 100,
        },
      });
      const run = expected.runs[0]!;
      const cancelled = decideCancellation(run.state, 970);
      const change = Match.value(cancelled).pipe(
        Match.tag('Accepted', ({ state, facts }) => ({
          runId: run.state.runId,
          expectedRevision: run.revision,
          state,
          facts,
        })),
        Match.orElse(() => ({ ...makeCancelledChange(), expectedRevision: 0 })),
      );
      yield* execute({ _tag: 'ChangeRun', change });
    }
    const session = Effect.gen(writeSession);
    yield* Effect.scoped(session);
    function* reopen() {
      const ledger = yield* Ledger.openMigrationLedger(fixture.config);
      expect(yield* ledger.readRecovery()).toEqual(
        Result.getOrThrow(recoverMigrationLedger(expected)),
      );
      const worker = Option.getOrThrow(yield* ledger.workerJournal.load(operation.operationId));
      expect(worker.operation.limits).toEqual(operation.limits);
      expect(Option.getOrThrow(worker.cleanup).deadlineMs).toBe(950 + input.window);
      expect(Option.isNone(worker.readiness)).toBe(true);
      expect(Option.isSome(worker.authority.cancelledAtMs)).toBe(true);
    }
    const reopened = Effect.gen(reopen);
    yield* Effect.scoped(reopened);
    return [commands <= 8, commands === 8, commits >= 4, expected.sequence === commits].every(
      Boolean,
    );
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  return scoped;
}

async function nativeLaw() {
  const started = performance.now();
  for (const seed of [0, 1, 163]) {
    const checking = Arbitrary.checkEffect(arbitrary, refinement, {
      seed,
      runs: 1000,
      size: 50,
      maxShrinks: 1000,
      maxDiscards: 10000,
    });
    function verify(value: Arbitrary.CheckResult<unknown, unknown>) {
      const validation = validateCheckResult('native refinement', seed, value, 1000);
      const program = Effect.fromResult(validation);
      return program;
    }
    const verified = checking.pipe(Effect.tap(verify));
    const provided = Effect.provide(verified, platform);
    const result = await Effect.runPromise(provided);
    expect(result).toMatchObject({ _tag: 'Passed', runs: 1000 });
    console.log(
      `native refinement seed=${seed} runs=1000 elapsedMs=${Math.round(performance.now() - started)}`,
    );
  }
}
test(
  'native refinement; seeds 0/1/163 x 1000 fresh databases; eight commands; 180s total',
  nativeLaw,
  180000,
);
