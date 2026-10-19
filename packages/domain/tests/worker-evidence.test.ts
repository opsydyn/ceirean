import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Match, Result, Schema } from 'effect';

import {
  AttemptId,
  ContractId,
  Digest,
  RunId,
  WorkerContainerId,
  WorkerDaemonId,
  WorkerHostId,
  WorkerObservation,
  WorkerOperation,
  WorkerOperationId,
  decodeWorkerObservation,
  validateWorkerCustody,
  validateWorkerReadiness,
} from '../src/index.ts';
import type { WorkerConfiguration } from '../src/index.ts';
import { checkLaw } from './properties.ts';
import { makeWorkerCase, workerCaseArbitrary } from './worker-fixtures.ts';
import type { WorkerCase } from './worker-fixtures.ts';

function ready(
  c: WorkerCase,
  observation = c.observation,
  nowMs = c.nowMs,
  createdAtMs = c.createdAtMs,
) {
  return validateWorkerReadiness(c.operation, c.containerId, observation, createdAtMs, nowMs);
}

function matching() {
  const c = makeWorkerCase();
  expect(ready(c)._tag).toBe('Success');
  const receipt: unknown = Result.getOrThrow(ready(c));
  expect(receipt).toEqual({
    operationId: 'worker-1',
    identity: {
      runId: 'run-1',
      attemptId: 'attempt-1',
      generation: 3,
      candidateDigest: 'a'.repeat(64),
      contractId: 'contract-1',
      contractDigest: 'c'.repeat(64),
    },
    hostId: 'host-1',
    daemonId: 'daemon-1',
    containerId: 'container-1',
    imageDigest: 'd'.repeat(64),
    sourceDigest: 'e'.repeat(64),
    policyDigest: 'f'.repeat(64),
    configDigest: 'b'.repeat(64),
    configuration: {
      mounts: [{ source: '/synthetic/leviathan/worker-1', target: '/workspace', readOnly: false }],
      network: 'synthetic-isolated',
      security: { user: '1000:1000', droppedCapabilities: ['ALL'], noNewPrivileges: true },
    },
    observedAtMs: 999,
  });
  expect(validateWorkerCustody(c.operation, c.observation)).toEqual(Result.succeed(undefined));
}
test('matching_readback_is_ready_at_999', matching);

test('deadline_equality_refuses_at_1000', function expired() {
  const c = makeWorkerCase();
  expect(ready(c, c.observation, 1000)).toEqual(
    Result.fail({ _tag: 'DeadlineExpired', operationId: c.operation.operationId }),
  );
});

const identityChanges = [
  ['runId', 'run-other'],
  ['attemptId', 'attempt-other'],
  ['generation', 4],
  ['candidateDigest', 'b'.repeat(64)],
  ['contractId', 'contract-other'],
  ['contractDigest', 'd'.repeat(64)],
] as const;

function identity(field: (typeof identityChanges)[number][0], value: string | number) {
  const c = makeWorkerCase();
  const outer = Result.getOrThrow(
    decodeWorkerObservation({
      ...c.observation,
      identity: { ...c.observation.identity, [field]: value },
    }),
  );
  const inner = Result.getOrThrow(
    decodeWorkerObservation({
      ...c.observation,
      resources: [{ ...c.resource, identity: { ...c.resource.identity, [field]: value } }],
    }),
  );
  for (const observation of [outer, inner]) {
    expect(ready(c, observation)).toEqual(
      Result.fail({ _tag: 'IdentityMismatch', operationId: c.operation.operationId }),
    );
    expect(validateWorkerCustody(c.operation, observation)._tag).toBe('Failure');
  }
}
test.each(identityChanges)('refuses independently changed identity %s at both levels', identity);

function digest(field: 'imageDigest' | 'sourceDigest' | 'policyDigest' | 'configDigest') {
  const c = makeWorkerCase();
  const observation = {
    ...c.observation,
    resources: [{ ...c.resource, [field]: c.operation.identity.candidateDigest }],
  };
  expect(ready(c, observation)).toEqual(
    Result.fail({ _tag: 'ReadinessMismatch', operationId: c.operation.operationId }),
  );
}
test.each(['imageDigest', 'sourceDigest', 'policyDigest', 'configDigest'] as const)(
  'refuses independently changed %s',
  digest,
);

const configurationChanges: readonly (readonly [
  string,
  (configuration: WorkerConfiguration) => WorkerConfiguration,
])[] = [
  ['mount source', (c) => ({ ...c, mounts: c.mounts.map((m) => ({ ...m, source: '/foreign' })) })],
  ['mount target', (c) => ({ ...c, mounts: c.mounts.map((m) => ({ ...m, target: '/foreign' })) })],
  ['mount access', (c) => ({ ...c, mounts: c.mounts.map((m) => ({ ...m, readOnly: true })) })],
  ['missing mount', (c) => ({ ...c, mounts: [] })],
  ['network', (c) => ({ ...c, network: 'foreign' })],
  ['user', (c) => ({ ...c, security: { ...c.security, user: '0' } })],
  ['capabilities', (c) => ({ ...c, security: { ...c.security, droppedCapabilities: [] } })],
  ['privileges', (c) => ({ ...c, security: { ...c.security, noNewPrivileges: false } })],
];
test.each(configurationChanges)('refuses independently changed %s', function config(_name, mutate) {
  const c = makeWorkerCase();
  expect(
    ready(c, {
      ...c.observation,
      resources: [{ ...c.resource, configuration: mutate(c.resource.configuration) }],
    }),
  ).toEqual(Result.fail({ _tag: 'ReadinessMismatch', operationId: c.operation.operationId }));
});

function observations() {
  const c = makeWorkerCase();
  expect(ready(c, { ...c.observation, resources: [] })).toEqual(
    Result.fail({ _tag: 'NotFound', operationId: c.operation.operationId }),
  );
  expect(
    ready(c, {
      ...c.observation,
      resources: [c.resource, { ...c.resource, operationId: WorkerOperationId.make('foreign') }],
    }),
  ).toEqual(Result.fail({ _tag: 'AmbiguousObservation', operationId: c.operation.operationId }));
  for (const observation of [
    { ...c.observation, hostId: WorkerHostId.make('foreign') },
    { ...c.observation, daemonId: WorkerDaemonId.make('foreign') },
    { ...c.observation, operationId: WorkerOperationId.make('foreign') },
    {
      ...c.observation,
      resources: [{ ...c.resource, operationId: WorkerOperationId.make('foreign') }],
    },
    {
      ...c.observation,
      resources: [{ ...c.resource, containerId: WorkerContainerId.make('foreign') }],
    },
    { ...c.observation, resources: [{ ...c.resource, running: false }] },
    { ...c.observation, staging: 'Unknown' as const },
    { ...c.observation, staging: 'Absent' as const },
  ])
    expect(ready(c, observation)._tag).toBe('Failure');
  expect(decodeWorkerObservation({ ...c.observation, resources: [{ running: true }] })._tag).toBe(
    'Failure',
  );
}
test('refuses missing, multiple, foreign and running-only evidence', observations);

function absenceIsNotReadiness() {
  const c = makeWorkerCase();
  const absence = { ...c.observation, resources: [], staging: 'Absent' as const };
  expect(ready(c, absence)).toEqual(
    Result.fail({ _tag: 'NotFound', operationId: c.operation.operationId }),
  );
}
test(
  'absence representable in a completion envelope never establishes readiness',
  absenceIsNotReadiness,
);

function invalidTime(time: number) {
  const c = makeWorkerCase();
  expect(ready(c, c.observation, time)).toEqual(
    Result.fail({ _tag: 'InvalidTime', operationId: c.operation.operationId }),
  );
  expect(ready(c, c.observation, c.nowMs, time)).toEqual(
    Result.fail({ _tag: 'InvalidTime', operationId: c.operation.operationId }),
  );
  expect(ready(c, { ...c.observation, atMs: time })._tag).toBe('Failure');
}
test.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'invalid time never yields readiness %s',
  invalidTime,
);

function chronology() {
  const c = makeWorkerCase();
  expect(ready(c, { ...c.observation, atMs: 1000 })._tag).toBe('Failure');
  expect(ready(c, { ...c.observation, atMs: 899 })).toEqual(
    Result.fail({ _tag: 'StaleObservation', operationId: c.operation.operationId }),
  );
  expect(ready(c, c.observation, 899)._tag).toBe('Failure');
  expect(ready(c, c.observation, 999, 1000)._tag).toBe('Failure');
  expect(ready(c, { ...c.observation, atMs: 900 })._tag).toBe('Success');
}
test('rejects future, before-created and backward controller times', chronology);

function unsafePath(stagingDirectory: string) {
  const c = makeWorkerCase();
  const operation = { ...c.operation, custody: { ...c.operation.custody, stagingDirectory } };
  expect(validateWorkerCustody(operation, c.observation)).toEqual(
    Result.fail({ _tag: 'NoCustody', operationId: c.operation.operationId }),
  );
  expect(validateWorkerReadiness(operation, c.containerId, c.observation, 900, 999)._tag).toBe(
    'Failure',
  );
}
test.each([
  '/synthetic/leviathan-other/worker-1',
  '/synthetic/leviathan/../foreign',
  '/synthetic/leviathan/./worker-1',
  '/synthetic/leviathan',
  '/synthetic/leviathan//worker-1',
  '/synthetic/leviathan/worker-1/',
  'synthetic/leviathan/worker-1',
  '/synthetic/leviathan/worker\\1',
])('refuses unsafe custody staging %s', unsafePath);

function custody() {
  const c = makeWorkerCase();
  for (const retainedArtifacts of [
    ['/synthetic/leviathan/worker-1'],
    ['/synthetic/leviathan/worker-1/file'],
    ['/synthetic/leviathan'],
    ['/'],
  ]) {
    expect(
      validateWorkerCustody(
        { ...c.operation, custody: { ...c.operation.custody, retainedArtifacts } },
        c.observation,
      )._tag,
    ).toBe('Failure');
  }
  for (const controllerRoot of [
    '/',
    'relative',
    '/synthetic/../leviathan',
    '/synthetic//leviathan',
  ]) {
    expect(
      validateWorkerCustody(
        { ...c.operation, custody: { ...c.operation.custody, controllerRoot } },
        c.observation,
      )._tag,
    ).toBe('Failure');
  }
  expect(
    validateWorkerCustody(
      { ...c.operation, custody: { ...c.operation.custody, containerSlot: '' } },
      c.observation,
    )._tag,
  ).toBe('Failure');
  expect(
    validateWorkerCustody(c.operation, { ...c.observation, resources: [], staging: 'Absent' }),
  ).toEqual(Result.succeed(undefined));
  expect(
    validateWorkerCustody(c.operation, { ...c.observation, resources: [c.resource, c.resource] })
      ._tag,
  ).toBe('Failure');
}
test('refuses retained-artifact overlap, unsafe roots and missing custody', custody);

function immutableInputs() {
  const c = makeWorkerCase();
  const before = structuredClone(c);
  ready(c);
  validateWorkerCustody(c.operation, c.observation);
  expect(c).toEqual(before);
}
test('checks leave all caller data unchanged including set ordering', immutableInputs);

const sameOperation = Schema.toEquivalence(WorkerOperation);
const sameObservation = Schema.toEquivalence(WorkerObservation);
function coherentLaw(c: WorkerCase) {
  const before = structuredClone(c);
  return [
    Result.isSuccess(ready(c)),
    Result.isSuccess(validateWorkerCustody(c.operation, c.observation)),
    sameOperation(c.operation, before.operation),
    sameObservation(c.observation, before.observation),
  ].every(Boolean);
}
async function matchingLaw() {
  await Effect.runPromise(checkLaw('worker matching bindings', workerCaseArbitrary, coherentLaw));
}
test(
  'generated matching bindings succeed before the original deadline without mutation',
  matchingLaw,
);

function distinctBindingLaw(c: WorkerCase) {
  const identity = c.operation.identity;
  const identities = [
    { ...identity, runId: RunId.make(`${identity.runId}-foreign`) },
    { ...identity, attemptId: AttemptId.make(`${identity.attemptId}-foreign`) },
    { ...identity, generation: Number.MAX_SAFE_INTEGER - identity.generation },
    { ...identity, candidateDigest: distinctDigest(identity.candidateDigest) },
    { ...identity, contractId: ContractId.make(`${identity.contractId}-foreign`) },
    { ...identity, contractDigest: distinctDigest(identity.contractDigest) },
  ];
  const identityObservations = identities.flatMap((changed) => [
    { ...c.observation, identity: changed },
    { ...c.observation, resources: [{ ...c.resource, identity: changed }] },
  ]);
  const digestObservations = (
    ['imageDigest', 'sourceDigest', 'policyDigest', 'configDigest'] as const
  ).map((field) => ({
    ...c.observation,
    resources: [{ ...c.resource, [field]: distinctDigest(c.resource[field]) }],
  }));
  const configObservations = configurationChanges.map(([_name, mutate]) => ({
    ...c.observation,
    resources: [{ ...c.resource, configuration: mutate(c.resource.configuration) }],
  }));
  const observations = [
    ...identityObservations,
    ...digestObservations,
    ...configObservations,
    { ...c.observation, operationId: WorkerOperationId.make(`${c.operation.operationId}-foreign`) },
    { ...c.observation, hostId: WorkerHostId.make(`${c.operation.hostId}-foreign`) },
    { ...c.observation, daemonId: WorkerDaemonId.make(`${c.operation.daemonId}-foreign`) },
    {
      ...c.observation,
      resources: [
        {
          ...c.resource,
          operationId: WorkerOperationId.make(`${c.operation.operationId}-foreign`),
        },
      ],
    },
    {
      ...c.observation,
      resources: [
        { ...c.resource, containerId: WorkerContainerId.make(`${c.containerId}-foreign`) },
      ],
    },
  ];
  return observations.every((observation) => Result.isFailure(ready(c, observation)));
}

function distinctDigest(value: Digest): Digest {
  const zero = Digest.make('0'.repeat(64));
  const one = Digest.make('1'.repeat(64));
  return Match.value(value).pipe(
    Match.when(zero, () => one),
    Match.orElse(() => zero),
  );
}
async function mutationLaw() {
  await Effect.runPromise(
    checkLaw('worker one-field mutation', workerCaseArbitrary, distinctBindingLaw),
  );
}
test('generated one-field mutation refuses', mutationLaw);

function permutedLaw(c: WorkerCase) {
  const configuration = c.resource.configuration;
  const observation: WorkerObservation = {
    ...c.observation,
    resources: [
      {
        ...c.resource,
        configuration: {
          ...configuration,
          mounts: [...configuration.mounts].reverse(),
          security: {
            ...configuration.security,
            droppedCapabilities: [...configuration.security.droppedCapabilities].reverse(),
          },
        },
      },
    ],
  };
  const before = structuredClone(observation);
  return Result.isSuccess(ready(c, observation)) && sameObservation(before, observation);
}
async function orderingLaw() {
  await Effect.runPromise(checkLaw('worker set ordering', workerCaseArbitrary, permutedLaw));
}
test('generated equivalent set ordering is invariant and immutable', orderingLaw);

const pathInput = Arbitrary.all({
  worker: workerCaseArbitrary,
  suffix: Arbitrary.schema(Schema.Int),
});
type PathInput = typeof pathInput extends Arbitrary.Arbitrary<infer A> ? A : never;
function escapedPathLaw({ worker: c, suffix }: PathInput) {
  const root = c.operation.custody.controllerRoot;
  const paths = [
    `${root}-sibling/${suffix}`,
    `${root}/../${suffix}`,
    `${root}/./${suffix}`,
    `${root}//${suffix}`,
    `${root}/${suffix}/`,
    root,
  ];
  return paths.every((stagingDirectory) =>
    Result.isFailure(
      validateWorkerCustody(
        { ...c.operation, custody: { ...c.operation.custody, stagingDirectory } },
        c.observation,
      ),
    ),
  );
}
async function escapingLaw() {
  await Effect.runPromise(checkLaw('worker escaping custody', pathInput, escapedPathLaw));
}
test('custody never accepts generated escaping paths', escapingLaw);

function invalidLifetimeLaw(c: WorkerCase) {
  const invalidTimes = [
    NaN,
    Infinity,
    -Infinity,
    -c.createdAtMs,
    c.createdAtMs + 0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ];
  const invalidNumbersRefuse = invalidTimes.every((time) =>
    [
      ready(c, c.observation, time),
      ready(c, c.observation, c.nowMs, time),
      ready(c, { ...c.observation, atMs: time }),
    ].every(Result.isFailure),
  );
  const invalidChronology = [
    ready(c, c.observation, c.createdAtMs - 1),
    ready(c, c.observation, c.operation.limits.deadlineMs),
    ready(c, { ...c.observation, atMs: c.createdAtMs - 1 }),
    ready(c, { ...c.observation, atMs: c.nowMs + 1 }),
  ].every(Result.isFailure);
  return invalidNumbersRefuse && invalidChronology;
}
async function invalidTimeLaw() {
  await Effect.runPromise(
    checkLaw('worker invalid lifetime', workerCaseArbitrary, invalidLifetimeLaw),
  );
}
test('generated invalid lifetime times never yield a receipt', invalidTimeLaw);
