import { expect } from 'bun:test';

import { Config, Effect, FileSystem, Option, Schema } from 'effect';

import { commands, encodeCommand } from './fixtures.ts';
import { commit, decodeJson, deployed, request } from './harness.ts';

const RestartEvidence = Schema.Struct({
  pid: Schema.Int,
  state: Schema.String,
  recovery: Schema.String,
  audit: Schema.String,
  command: Schema.String,
});
const evidenceCodec = Schema.fromJsonString(RestartEvidence);
const encodeEvidence = Schema.encodeUnknownSync(evidenceCodec);
const decodeEvidence = Schema.decodeUnknownSync(evidenceCodec);

export function* seedRuntime() {
  const fs = yield* FileSystem.FileSystem;
  const c = commands();
  yield* commit('restart', c.register);
  yield* commit('restart', c.worker);
  yield* discardReply();
  const state = yield* request('read', 'restart');
  expect(decodeJson(state)).toMatchObject({ sequence: 3 });
  const recovery = yield* request('recover', 'restart');
  const audit = yield* request('audit', 'restart');
  yield* fs.writeFileString(
    'restart-evidence.json',
    encodeEvidence({ pid: process.pid, state, recovery, audit, command: encodeCommand(c.cancel) }),
  );
}

export function* verifyRuntime() {
  const fs = yield* FileSystem.FileSystem;
  const evidence = decodeEvidence(yield* fs.readFileString('restart-evidence.json'));
  expect(process.pid).not.toBe(evidence.pid);
  expect(yield* request('read', 'restart')).toBe(evidence.state);
  expect(yield* request('recover', 'restart')).toBe(evidence.recovery);
  expect(yield* request('audit', 'restart')).toBe(evidence.audit);
  expect(decodeJson(yield* request('commit', 'restart', evidence.command))).toMatchObject({
    _tag: 'RunResult',
    result: { _tag: 'Conflict' },
  });
  expect(yield* request('read', 'restart')).toBe(evidence.state);
  expect(yield* request('audit', 'restart')).toBe(evidence.audit);
  const phase = yield* Config.String('CEIREAN_DO_PHASE');
  expect(phase).toBe('Verify');
  yield* Effect.logInfo('Local runtime restart verified', {
    beforePid: evidence.pid,
    afterPid: process.pid,
  });
}

function* discardReply() {
  const { url } = yield* deployed;
  const body = encodeCommand(commands().cancel);
  const response = yield* Effect.tryPromise((signal) =>
    fetch(`${url}/commit?name=restart`, { method: 'POST', body, signal }),
  );
  const stream = Option.getOrThrow(Option.fromNullishOr(response.body));
  // Discard the acknowledgement without interpreting the command's outcome.
  yield* Effect.tryPromise(() => stream.cancel());
  expect(response.status).toBe(200);
}
