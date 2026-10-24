import { expect, test } from 'bun:test';

import { Effect, Option, Schema } from 'effect';

import { dryRun } from '../src/offline-runner.ts';
import { inspectPrivateMessage } from '../src/private-invocation.ts';
import { fixture } from './approval-fixtures.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
async function signedMessage() {
  const f = await fixture();
  const signed = await f.sign(f.original);
  const input = {
    schemaVersion: 1,
    purpose: 'InspectOfflineApproval',
    worksheet: signed.text,
    approval: signed.approval,
  };
  return { f, input };
}
async function acceptsOnlyOfflineEvidence() {
  const { f, input } = await signedMessage();
  const operation = inspectPrivateMessage(input, f.policy, 0);
  const first = await Effect.runPromise(operation);
  const duplicate = await Effect.runPromise(inspectPrivateMessage(input, f.policy, 0));
  expect(first).toMatchObject({ activation: 'Blocked', approval: 'Matched' });
  expect(duplicate).toEqual(first);
  const report = await Effect.runPromise(
    dryRun(input.worksheet, encode(input.approval), Option.some(f.policy), 0),
  );
  expect(report).toEqual(first);
}
test(
  'private Queue envelope and runner share verification but duplicates never grant execution',
  acceptsOnlyOfflineEvidence,
);

async function rejectsMessages() {
  const { f, input } = await signedMessage();
  for (const mutation of [
    { ...input, purpose: 'Start' },
    { ...input, argv: ['true'] },
    { ...input, signature: 'outside' },
    { ...input, worksheet: input.worksheet + ' ' },
    { ...input, approval: { ...input.approval, keyId: 'other' } },
    { ...input, worksheet: 'x'.repeat(65537) },
  ]) {
    const operation = inspectPrivateMessage(mutation, f.policy, 0);
    expect((await Effect.runPromise(operation.pipe(Effect.result)))._tag).toBe('Failure');
  }
  const expired = inspectPrivateMessage(input, f.policy, 2700000);
  expect((await Effect.runPromise(expired.pipe(Effect.result)))._tag).toBe('Failure');
}
test(
  'Queue envelopes reject execution verbs unknown fields tampering and delayed expired delivery',
  rejectsMessages,
);
