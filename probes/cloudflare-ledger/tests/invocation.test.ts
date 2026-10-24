import { expect } from 'bun:test';

import { Config, Effect, FileSystem, Match, Schema } from 'effect';

import { decodeJson, fixtureData, invocation, request, waitFor } from './invocation-harness.ts';
const Restart = Schema.Struct({ pid: Schema.Int, state: Schema.String });
const decodeRestart = Schema.decodeUnknownSync(Schema.fromJsonString(Restart));

function* mainCases() {
  const f = yield* fixtureData;
  yield* request('publish', '{}');
  yield* request('publish', f.expired);
  const denied = yield* waitFor('refused', 2);
  expect(denied.verifiedCalls).toBe(0);
  expect(decodeJson((yield* request('state')).content)).toMatchObject({
    state: { _tag: 'Empty' },
    eventCount: 0,
  });
  expect((yield* request('fault', f.valid)).status).toBe(422);
  expect(decodeJson((yield* request('state')).content)).toMatchObject({
    state: { _tag: 'Empty' },
    eventCount: 0,
  });
  yield* Effect.all([request('publish', f.valid), request('publish', f.valid)], { concurrency: 2 });
  yield* waitFor('recorded', 1);
  yield* waitFor('replayed', 2);
  const committed = (yield* request('state')).content;
  expect(decodeJson(committed)).toMatchObject({
    state: { _tag: 'Recorded' },
    eventCount: 1,
    activation: 'Blocked',
  });
  yield* request('publish', f.conflict);
  yield* request('publish', f.busy);
  yield* waitFor('refused', 4);
  expect((yield* request('state')).content).toBe(committed);
  yield* request('corrupt');
  expect((yield* request('state')).status).toBe(422);
  expect((yield* request('fault', f.valid)).status).toBe(422);
}
function* seed() {
  const f = yield* fixtureData;
  yield* request('publish', f.valid);
  yield* waitFor('recorded', 1);
  yield* waitFor('replayed', 1);
  const state = (yield* request('state')).content;
  const fs = yield* FileSystem.FileSystem;
  const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
  yield* fs.writeFileString('invocation-restart.json', encode({ pid: process.pid, state }));
}
function* verify() {
  const fs = yield* FileSystem.FileSystem;
  const before = decodeRestart(yield* fs.readFileString('invocation-restart.json'));
  expect(before.pid).not.toBe(process.pid);
  expect((yield* request('state')).content).toBe(before.state);
  const f = yield* fixtureData;
  yield* request('publish', f.valid);
  const stats = yield* waitFor('replayed', 1);
  expect(stats.recorded).toBe(0);
  expect((yield* request('state')).content).toBe(before.state);
}
invocation.test(
  'local Queue delivery durably deduplicates inspections and fails closed',
  Effect.gen(function* run() {
    const phase = yield* Config.String('CEIREAN_DO_PHASE');
    yield* Match.value(phase).pipe(
      Match.when('InvocationSeed', () => Effect.gen(seed)),
      Match.when('InvocationVerify', () => Effect.gen(verify)),
      Match.orElse(() => Effect.gen(mainCases)),
    );
  }),
);
