import { Arbitrary, Schema } from 'effect';

import {
  Digest,
  WorkerContainerId,
  WorkerDaemonId,
  WorkerHostId,
  WorkerIntentId,
  WorkerIssuerId,
  WorkerMutationReply,
  WorkerObservation,
  WorkerOperation,
  WorkerOperationId,
} from '../src/index.ts';
import { makeEvidenceCase } from './fixtures.ts';

export function makeWorkerCase() {
  const operation = WorkerOperation.make({
    operationId: WorkerOperationId.make('worker-1'),
    identity: makeEvidenceCase().identity,
    purpose: 'Candidate',
    hostId: WorkerHostId.make('host-1'),
    daemonId: WorkerDaemonId.make('daemon-1'),
    imageDigest: Digest.make('d'.repeat(64)),
    sourceDigest: Digest.make('e'.repeat(64)),
    policyDigest: Digest.make('f'.repeat(64)),
    configDigest: Digest.make('b'.repeat(64)),
    configuration: {
      mounts: [{ source: '/synthetic/ceirean/worker-1', target: '/workspace', readOnly: false }],
      network: 'synthetic-isolated',
      security: { user: '1000:1000', droppedCapabilities: ['ALL'], noNewPrivileges: true },
    },
    custody: {
      controllerRoot: '/synthetic/ceirean',
      stagingDirectory: '/synthetic/ceirean/worker-1',
      containerSlot: 'slot-1',
      retainedArtifacts: ['/synthetic/evidence/worker-1.json'],
    },
    limits: { deadlineMs: 1000, spentMicros: 17, repairs: 1 },
  });
  const containerId = WorkerContainerId.make('container-1');
  const resource = {
    containerId,
    operationId: operation.operationId,
    identity: operation.identity,
    imageDigest: operation.imageDigest,
    sourceDigest: operation.sourceDigest,
    policyDigest: operation.policyDigest,
    configDigest: operation.configDigest,
    configuration: operation.configuration,
    running: true,
  };
  const observation = WorkerObservation.make({
    operationId: operation.operationId,
    identity: operation.identity,
    hostId: operation.hostId,
    daemonId: operation.daemonId,
    atMs: 999,
    resources: [resource],
    staging: 'Present',
  });
  const reply = WorkerMutationReply.make({
    operationId: operation.operationId,
    identity: operation.identity,
    hostId: operation.hostId,
    daemonId: operation.daemonId,
    intentId: WorkerIntentId.make('intent-1'),
    issuerId: WorkerIssuerId.make('controller-1'),
    atMs: 999,
    outcome: { _tag: 'Completed', observation },
  });
  return { operation, observation, resource, containerId, reply, createdAtMs: 900, nowMs: 999 };
}

const boundedTime = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }));
const generatedInput = Arbitrary.all({
  operation: Arbitrary.schema(WorkerOperation),
  createdAtMs: Arbitrary.schema(boundedTime),
  interval: Arbitrary.schema(boundedTime),
});

type GeneratedInput = typeof generatedInput extends Arbitrary.Arbitrary<infer A> ? A : never;

function seedWorker(input: GeneratedInput) {
  const c = makeWorkerCase();
  const nowMs = input.createdAtMs + input.interval;
  const operation = WorkerOperation.make({
    ...input.operation,
    configuration: {
      ...c.operation.configuration,
      mounts: [
        ...c.operation.configuration.mounts,
        { source: '/synthetic/tools', target: '/tools', readOnly: true },
      ],
      security: { ...c.operation.configuration.security, droppedCapabilities: ['ALL', 'CHOWN'] },
    },
    custody: c.operation.custody,
    limits: { ...input.operation.limits, deadlineMs: nowMs + 1 },
  });
  const resource = {
    ...c.resource,
    operationId: operation.operationId,
    identity: operation.identity,
    imageDigest: operation.imageDigest,
    sourceDigest: operation.sourceDigest,
    policyDigest: operation.policyDigest,
    configDigest: operation.configDigest,
    configuration: operation.configuration,
  };
  const observation = WorkerObservation.make({
    ...c.observation,
    operationId: operation.operationId,
    identity: operation.identity,
    hostId: operation.hostId,
    daemonId: operation.daemonId,
    atMs: nowMs,
    resources: [resource],
  });
  return { ...c, operation, resource, observation, createdAtMs: input.createdAtMs, nowMs };
}

export const workerCaseArbitrary = Arbitrary.map(generatedInput, seedWorker);

export type WorkerCase = ReturnType<typeof makeWorkerCase>;
