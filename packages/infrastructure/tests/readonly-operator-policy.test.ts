import { expect, test } from 'bun:test';

import { ConfigProvider, Effect, FileSystem, Layer, Result, Schema } from 'effect';

import { operatorPolicy, operatorTarget } from '../src/readonly/operator/runtime.ts';

const policy = {
  sessionId: 'policy-test',
  installationId: 10,
  ownerId: 20,
  repositoryId: 30,
  issueNumber: 40,
  operatorId: 50,
  opensAtMs: 0,
  closesAtMs: 300000,
};
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function policyLayer(contents: string) {
  const fs = FileSystem.makeNoop({ readFileString: () => Effect.sync(() => contents) });
  const config = ConfigProvider.fromUnknown({
    CEIREAN_OPERATOR_POLICY_FILE: '/fake/desired-policy.json',
  });
  return Layer.mergeAll(Layer.succeed(FileSystem.FileSystem, fs), ConfigProvider.layer(config));
}
async function strictPolicy() {
  const valid = Effect.provide(operatorPolicy, policyLayer(encode(policy)));
  expect(await Effect.runPromise(valid)).toEqual(policy);
  for (const raw of [
    'SECRET bad policy',
    encode({ ...policy, secret: 'SECRET' }),
    'x'.repeat(16385),
  ]) {
    const invalid = Effect.provide(operatorPolicy, policyLayer(raw));
    const result = await Effect.runPromise(invalid.pipe(Effect.result));
    expect(Result.isFailure(result)).toBe(true);
    expect(encode(result)).not.toContain('SECRET');
  }
}
test('desired policy is strict and bounded before any runtime is constructed', strictPolicy);

test('operator target is pinned independently of user arguments and environment', () => {
  expect(operatorTarget).toEqual({
    accountId: 'd95812af050c2e549a3296899b7b43b3',
    worker: 'ceireanreadonly-readonlyworker56trhdak554hd5gd7mzqrci7',
  });
});
