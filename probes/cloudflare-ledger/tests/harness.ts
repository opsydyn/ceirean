import {
  migrationLedgerEncoding,
  type MigrationLedgerCommand,
} from '@ceirean/engine/journal-policy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Test from 'alchemy/Test/Bun';
import { Config, Effect, Match, Result, Schema } from 'effect';

import Stack from '../alchemy.run.ts';
import { recordOwnedProcesses } from './process-tree.test.ts';

export const local = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: 'test_ceirean_local_do',
});
function* startLocal() {
  const isolated = yield* Config.String('CEIREAN_LOCAL_DO');
  yield* Match.value(isolated).pipe(
    Match.when('1', () => Effect.void),
    Match.orElse(() => Effect.die('Use the isolated test runner')),
  );
  const deployed = yield* local.deploy(Stack);
  yield* recordOwnedProcesses();
  return deployed;
}
export const deployed = local.beforeAll(Effect.gen(startLocal));
function* closeLocal() {
  const phase = yield* Config.String('CEIREAN_DO_PHASE');
  const teardown = Match.value(phase).pipe(
    Match.when('Seed', () =>
      Effect.logInfo('Preserving local deployment metadata for restart; test scopes still close'),
    ),
    Match.orElse(() => local.destroy(Stack)),
  );
  yield* teardown;
}
local.afterAll(Effect.gen(closeLocal));
local.afterEach(Effect.gen(recordOwnedProcesses));

export function request(path: string, name: string, body?: string) {
  function* sendRequest() {
    const { url } = yield* deployed;
    const endpoint = `${url}/${path}?name=${encodeURIComponent(name)}`;
    const method = Match.value(body).pipe(
      Match.when(undefined, () => 'GET'),
      Match.orElse(() => 'POST'),
    );
    const response = yield* Effect.tryPromise((signal) =>
      fetch(endpoint, { method, body, signal }),
    );
    return yield* Effect.tryPromise(() => response.text());
  }
  const sending = Effect.gen(sendRequest);
  return sending.pipe(Effect.timeout('10 seconds'));
}
export function commit(name: string, command: MigrationLedgerCommand) {
  const encoded = migrationLedgerEncoding.command(command);
  return request('commit', name, Result.getOrThrow(encoded));
}
export const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
