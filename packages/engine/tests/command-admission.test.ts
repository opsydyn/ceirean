import { expect, test } from 'bun:test';

import { Deferred, Effect, Fiber, Layer, Match, Result } from 'effect';

import {
  CommandAdmission,
  CommandInboxError,
  makeCommandAdmission,
  makeCommandInbox,
} from '../src/index.ts';
import {
  verifiedCommandFixture,
  acquireCommandAdmission,
  acquireCommandAdmissionFromInbox,
  authorityFixture,
} from './command-fixtures.ts';
import { makeMemoryCommandInbox } from './memory-command-inbox.ts';

export async function exactCandidate() {
  const memory = makeMemoryCommandInbox();
  const service = await Effect.runPromise(acquireCommandAdmission(memory.driver));
  function* scenario() {
    const first = yield* service.admit(verifiedCommandFixture());
    const second = yield* service.admit(verifiedCommandFixture());
    expect(first).toMatchObject({
      _tag: 'Recorded',
      record: { decision: { _tag: 'AdmittedPreview' } },
    });
    expect(second).toMatchObject({
      _tag: 'Duplicate',
      record: { decision: { _tag: 'AdmittedPreview' } },
    });
    expect(memory.records()).toHaveLength(1);
    expect(memory.calls()).toEqual({ load: 2, commit: 2 });
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('one exact candidate records one preview; same command is not admitted twice', exactCandidate);

export async function operationalFailure() {
  const memory = makeMemoryCommandInbox();
  const driver = {
    ...memory.driver,
    commit: () => Result.fail(new CommandInboxError({ operation: 'commit', code: 'CommitFailed' })),
  };
  const service = await Effect.runPromise(acquireCommandAdmission(driver));
  function* scenario() {
    const result = yield* service.admit(verifiedCommandFixture()).pipe(Effect.result);
    expect(Result.isFailure(result)).toBe(true);
    expect(memory.records()).toHaveLength(0);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('operational failure is not a decision', operationalFailure);

function* consumeAdmission() {
  const service = yield* CommandAdmission;
  return yield* service.admit(verifiedCommandFixture());
}
const consumer = Effect.gen(consumeAdmission);
export function admissionConsumerBoundary(
  service: Effect.Success<ReturnType<typeof makeCommandAdmission>>,
) {
  const onlyAdmission = Layer.succeed(CommandAdmission, service);
  const supplied = Effect.provide(consumer, onlyAdmission);
  return supplied;
}

async function retainedDependencies() {
  const memory = makeMemoryCommandInbox();
  const service = await Effect.runPromise(acquireCommandAdmission(memory.driver));
  // Running without a provider is also a strict consumer compilation proof.
  expect(await Effect.runPromise(service.admit(verifiedCommandFixture()))).toMatchObject({
    _tag: 'Recorded',
  });
  const consumerOnly = admissionConsumerBoundary(service);
  expect(await Effect.runPromise(consumerOnly)).toMatchObject({ _tag: 'Duplicate' });
}
test('service retains declared dependencies', retainedDependencies);

for (const change of ['replace', 'revoke', 'expire', 'rewind', 'mutate'] as const) {
  async function controlledRace() {
    const memory = makeMemoryCommandInbox();
    const input = verifiedCommandFixture();
    function* scenario() {
      const loaded = yield* Deferred.make<void>();
      const proceed = yield* Deferred.make<void>();
      const inbox = makeCommandInbox(memory.driver);
      function loadAuthority(scope: string) {
        function* loadPaused() {
          const observation = yield* inbox.loadAuthority(scope);
          yield* Deferred.succeed(loaded, undefined);
          yield* Deferred.await(proceed).pipe(Effect.timeout('2 seconds'));
          return observation;
        }
        const program = Effect.gen(loadPaused);
        return program.pipe(
          Effect.mapError(() => new CommandInboxError({ operation: 'load', code: 'ReadFailed' })),
        );
      }
      const service = yield* acquireCommandAdmissionFromInbox({ ...inbox, loadAuthority });
      const pending = yield* service.admit(input).pipe(Effect.forkScoped);
      yield* Deferred.await(loaded).pipe(Effect.timeout('2 seconds'));
      const observation = authorityFixture();
      const state = observation.state;
      const changed = {
        replace: { ...observation, state: { ...state, revision: 'authority-2' } },
        revoke: { ...observation, state: { _tag: 'Unavailable' as const, revision: 'revoked' } },
        expire: { ...observation, atMs: 2000 },
        rewind: { ...observation, atMs: 999 },
        mutate: observation,
      }[change];
      memory.setAuthority(changed);
      Object.assign(input.candidate, { operatorId: 999, commentId: 999 });
      yield* Deferred.succeed(proceed, undefined);
      const reply = yield* Fiber.join(pending);
      const expected = Match.value(change).pipe(
        Match.when('mutate', () => 'Recorded' as const),
        Match.orElse(() => 'Unrecorded' as const),
      );
      expect(reply._tag).toBe(expected);
      const operators = memory.records().map((record) => record.candidate.operatorId);
      const comments = memory.records().map((record) => record.candidate.commentId);
      const count = Match.value(change).pipe(
        Match.when('mutate', () => 1),
        Match.orElse(() => 0),
      );
      expect(memory.records()).toHaveLength(count);
      expect(operators.every((id) => id === 66)).toBe(true);
      expect(comments.every((id) => id === 55)).toBe(true);
      expect(memory.calls()).toEqual({ load: 1, commit: 1 });
    }
    const program = Effect.gen(scenario);
    const scoped = Effect.scoped(program);
    await Effect.runPromise(scoped);
  }
  test(`controlled authority-load/commit barrier: ${change}`, controlledRace);
}
