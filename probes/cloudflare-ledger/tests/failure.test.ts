import { expect } from 'bun:test';

import { Config, Data, Effect, FileSystem, Match } from 'effect';

import { local, request } from './harness.ts';
import { recordOwnedProcesses } from './process-tree.test.ts';

class StartupFixtureError extends Data.TaggedError('StartupFixtureError')<{
  readonly phase: 'BeforeRequests';
}> {}

function* startupFailure() {
  const fs = yield* FileSystem.FileSystem;
  yield* recordOwnedProcesses();
  yield* fs.writeFileString('expected-failure.txt', 'FailStartup');
  return yield* Effect.fail(new StartupFixtureError({ phase: 'BeforeRequests' }));
}

function* failBeforeRequests() {
  const phase = yield* Config.String('CEIREAN_DO_PHASE');
  const startup = Match.value(phase).pipe(
    Match.when('FailStartup', () => Effect.gen(startupFailure)),
    Match.orElse(() => Effect.logInfo('Running intentional assertion-failure fixture')),
  );
  yield* startup;
}
local.beforeAll(Effect.gen(failBeforeRequests));

function* failAfterRequests() {
  const state = yield* request('read', 'failure');
  const fs = yield* FileSystem.FileSystem;
  yield* recordOwnedProcesses();
  yield* fs.writeFileString('expected-failure.txt', 'FailAssertion');
  expect(state).toBe('intentional mismatch after workerd starts');
}
local.test(
  'intentional child failure; parent must verify nonzero exit and process cleanup',
  Effect.gen(failAfterRequests),
);
