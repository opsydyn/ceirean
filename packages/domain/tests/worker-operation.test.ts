import { expect, test } from 'bun:test';

import { Result, Schema } from 'effect';

import {
  WorkerCleanup,
  WorkerIntent,
  WorkerRefusal,
  decodeWorkerMutationReply,
  decodeWorkerObservation,
  decodeWorkerOperation,
} from '../src/index.ts';
import { makeWorkerCase } from './worker-fixtures.ts';

function canonical() {
  const c = makeWorkerCase();
  expect(decodeWorkerOperation(c.operation)).toEqual(Result.succeed(c.operation));
  expect(decodeWorkerObservation(c.observation)).toEqual(Result.succeed(c.observation));
  expect(decodeWorkerMutationReply(c.reply)).toEqual(Result.succeed(c.reply));
}
test('decodes the canonical operation, observation and completed mutation reply', canonical);

const malformedInputs = [null, {}, [], 'worker', { running: true }].map((input) => ({ input }));
function malformed({ input }: { readonly input: unknown }) {
  expect(decodeWorkerOperation(input)).toEqual(Result.fail({ _tag: 'InvalidInput' }));
  expect(decodeWorkerObservation(input)).toEqual(Result.fail({ _tag: 'InvalidInput' }));
  expect(decodeWorkerMutationReply(input)).toEqual(Result.fail({ _tag: 'InvalidInput' }));
}
test.each(malformedInputs)('rejects malformed input %j', malformed);

function blank(value: string) {
  const c = makeWorkerCase();
  for (const field of ['operationId', 'hostId', 'daemonId'] as const) {
    expect(decodeWorkerOperation({ ...c.operation, [field]: value })._tag).toBe('Failure');
    expect(decodeWorkerObservation({ ...c.observation, [field]: value })._tag).toBe('Failure');
  }
  for (const field of ['intentId', 'issuerId'] as const) {
    expect(decodeWorkerMutationReply({ ...c.reply, [field]: value })._tag).toBe('Failure');
  }
}
test.each(['', ' ', '\t\n'])('rejects blank worker identifiers %j', blank);

function invalidNumbers(value: number) {
  const c = makeWorkerCase();
  for (const field of ['deadlineMs', 'spentMicros', 'repairs'] as const) {
    expect(
      decodeWorkerOperation({ ...c.operation, limits: { ...c.operation.limits, [field]: value } })
        ._tag,
    ).toBe('Failure');
  }
  expect(decodeWorkerObservation({ ...c.observation, atMs: value })._tag).toBe('Failure');
  expect(decodeWorkerMutationReply({ ...c.reply, atMs: value })._tag).toBe('Failure');
}
test.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid numeric data %s',
  invalidNumbers,
);

function invalidConfiguration() {
  const c = makeWorkerCase();
  for (const field of ['imageDigest', 'sourceDigest', 'policyDigest', 'configDigest'] as const) {
    expect(decodeWorkerOperation({ ...c.operation, [field]: 'A'.repeat(64) })._tag).toBe('Failure');
    expect(
      decodeWorkerObservation({ ...c.observation, resources: [{ ...c.resource, [field]: 'bad' }] })
        ._tag,
    ).toBe('Failure');
  }
  const configurations = [
    {
      ...c.operation.configuration,
      mounts: [
        ...c.operation.configuration.mounts,
        { source: '/other', target: '/workspace', readOnly: true },
      ],
    },
    {
      ...c.operation.configuration,
      security: { ...c.operation.configuration.security, droppedCapabilities: ['ALL', 'ALL'] },
    },
  ];
  for (const configuration of configurations) {
    expect(decodeWorkerOperation({ ...c.operation, configuration })._tag).toBe('Failure');
    expect(
      decodeWorkerObservation({ ...c.observation, resources: [{ ...c.resource, configuration }] })
        ._tag,
    ).toBe('Failure');
  }
}
test('rejects malformed digests and duplicate mount targets or capabilities', invalidConfiguration);

function completionEvidence() {
  const c = makeWorkerCase();
  for (const observation of [
    { ...c.observation, resources: [] },
    { ...c.observation, resources: [c.resource, c.resource] },
    { ...c.observation, hostId: 'foreign' },
    { ...c.observation, resources: [{ ...c.resource, operationId: 'foreign' }] },
    {
      ...c.observation,
      resources: [{ ...c.resource, identity: { ...c.resource.identity, generation: 4 } }],
    },
    { ...c.observation, atMs: 1000 },
  ]) {
    expect(
      decodeWorkerMutationReply({ ...c.reply, outcome: { _tag: 'Completed', observation } })._tag,
    ).toBe('Failure');
  }
  expect(decodeWorkerMutationReply({ ...c.reply, outcome: { _tag: 'Claimed' } })._tag).toBe(
    'Failure',
  );
}
test('completion requires nonempty unambiguous matching controller evidence', completionEvidence);

function sanitizedReasons() {
  const c = makeWorkerCase();
  for (const tag of ['Failed', 'Unknown'] as const) {
    const reply = {
      ...c.reply,
      outcome: {
        _tag: tag,
        reason: { _tag: 'UnresolvedIntent', operationId: c.operation.operationId },
      },
    };
    expect(decodeWorkerMutationReply(reply)._tag).toBe('Success');
    expect(
      decodeWorkerMutationReply({ ...reply, outcome: { _tag: tag, reason: 'raw driver secret' } })
        ._tag,
    ).toBe('Failure');
  }
  expect(
    Schema.decodeUnknownResult(WorkerRefusal)({ _tag: 'InvalidInput', operationId: '' })._tag,
  ).toBe('Failure');
}
test(
  'unknown and failed outcomes retain sanitized tagged reasons, never driver strings',
  sanitizedReasons,
);

function sharedData() {
  const c = makeWorkerCase();
  for (const kind of ['Create', 'Start', 'Stop', 'Remove'] as const) {
    const intent = {
      intentId: c.reply.intentId,
      operationId: c.operation.operationId,
      issuerId: c.reply.issuerId,
      kind,
      resource: 'slot-1',
      claimedAtMs: 900,
      outcome: { _tag: 'Claimed' },
    };
    expect(Schema.decodeUnknownResult(WorkerIntent)(intent)._tag).toBe('Success');
    expect(Schema.decodeUnknownResult(WorkerIntent)({ ...intent, claimedAtMs: -1 })._tag).toBe(
      'Failure',
    );
  }
  for (const cleanup of [
    { _tag: 'CleanupPending', requestedAtMs: 1000, deadlineMs: 1100 },
    {
      _tag: 'CleanupUnknown',
      requestedAtMs: 1000,
      deadlineMs: 1100,
      reason: { _tag: 'UnresolvedIntent' },
    },
    { _tag: 'CleanupConfirmed', requestedAtMs: 1000, deadlineMs: 1100, observedAtMs: 1099 },
  ]) {
    expect(Schema.decodeUnknownResult(WorkerCleanup)(cleanup)._tag).toBe('Success');
    expect(
      Schema.decodeUnknownResult(WorkerCleanup)({ ...cleanup, deadlineMs: Infinity })._tag,
    ).toBe('Failure');
  }
}
test('intent and cleanup data preserve explicit outcomes and separate deadlines', sharedData);

function missingCustody() {
  const c = makeWorkerCase();
  const { custody: _custody, ...withoutCustody } = c.operation;
  expect(decodeWorkerOperation(withoutCustody)).toEqual(Result.fail({ _tag: 'InvalidInput' }));
  expect(decodeWorkerOperation({ ...c.operation, custody: null })).toEqual(
    Result.fail({ _tag: 'InvalidInput' }),
  );
  expect(
    decodeWorkerOperation({
      ...c.operation,
      custody: { ...c.operation.custody, retainedArtifacts: undefined },
    }),
  ).toEqual(Result.fail({ _tag: 'InvalidInput' }));
}
test('missing or malformed custody never decodes as an owned operation', missingCustody);

function immutableDecoding() {
  const c = makeWorkerCase();
  const before = structuredClone(c);
  decodeWorkerOperation(c.operation);
  decodeWorkerObservation(c.observation);
  decodeWorkerMutationReply(c.reply);
  decodeWorkerMutationReply({
    ...c.reply,
    outcome: { _tag: 'Completed', observation: { ...c.observation, resources: [] } },
  });
  expect(c).toEqual(before);
}
test('decoding and refused completion leave caller inputs unchanged', immutableDecoding);
