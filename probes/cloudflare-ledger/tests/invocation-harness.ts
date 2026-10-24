import * as Cloudflare from 'alchemy/Cloudflare';
import * as Test from 'alchemy/Test/Bun';
import { Config, Data, Effect, FileSystem, Match, Result, Schedule, Schema } from 'effect';

import Stack from '../invocation.alchemy.ts';
import { decodeInvocationFixture } from './invocation-fixtures.ts';
import { recordOwnedProcesses } from './process-tree.test.ts';

export const invocation = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: 'test_ceirean_local_invocation',
});
export const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const Stats = Schema.Struct({
  verifiedCalls: Schema.Int,
  recorded: Schema.Int,
  replayed: Schema.Int,
  refused: Schema.Int,
});
const assertStats = Schema.decodeUnknownSync(Schema.fromJsonString(Stats));
const decodeUrl = Schema.decodeUnknownEffect(Schema.String);
const decodeIsolated = Schema.decodeUnknownEffect(Schema.Literal('1'));
const decodeLoopback = Schema.decodeUnknownEffect(
  Schema.Literals(['localhost', '127.0.0.1', '[::1]']),
);
class PendingInspection extends Data.TaggedError('PendingInspection')<{
  readonly code: 'NotObserved';
}> {}
export const fixtureData = invocation.beforeAll(
  Effect.gen(function* readFixture() {
    const fs = yield* FileSystem.FileSystem;
    return decodeInvocationFixture(yield* fs.readFileString('invocation-fixture.json'));
  }),
);
function* start() {
  const phase = yield* Config.String('CEIREAN_LOCAL_DO');
  yield* decodeIsolated(phase);
  const result = yield* invocation.deploy(Stack);
  const url = yield* decodeUrl(result.url);
  yield* decodeLoopback(new URL(url).hostname);
  yield* recordOwnedProcesses();
  return result;
}
const deployed = invocation.beforeAll(Effect.gen(start));
invocation.afterEach(Effect.gen(recordOwnedProcesses));
invocation.afterAll(
  Effect.gen(function* stop() {
    const phase = yield* Config.String('CEIREAN_DO_PHASE');
    yield* Match.value(phase).pipe(
      Match.when('InvocationSeed', () => Effect.void),
      Match.orElse(() => invocation.destroy(Stack)),
    );
  }),
);
export function request(route: string, body?: string | Uint8Array<ArrayBuffer>) {
  function* send() {
    const { url } = yield* deployed;
    const response = yield* Effect.tryPromise((signal) =>
      fetch(`${url}/${route}`, { method: 'POST', body, signal }),
    );
    const content = yield* Effect.tryPromise(() => response.text());
    return { status: response.status, content };
  }
  const workflow = Effect.gen(send);
  return workflow.pipe(Effect.timeout('10 seconds'));
}
export function waitFor(field: 'recorded' | 'replayed' | 'refused', minimum: number) {
  function* inspect() {
    const response = yield* request('stats');
    const stats = assertStats(response.content);
    const checked = Result.succeed(stats).pipe(
      Result.filterOrFail(
        (value) => value[field] >= minimum,
        () => new PendingInspection({ code: 'NotObserved' }),
      ),
    );
    return yield* Effect.fromResult(checked);
  }
  const workflow = Effect.gen(inspect);
  return workflow.pipe(Effect.retry({ times: 150, schedule: Schedule.spaced('100 millis') }));
}
