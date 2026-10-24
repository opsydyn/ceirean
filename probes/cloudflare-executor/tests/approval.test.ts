import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Result, Schema } from 'effect';

import { inspectApproval } from '../src/approval.ts';
import { reviewedInputs } from '../src/pins.ts';
import { fixture } from './approval-fixtures.ts';
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

async function validSignedPlan() {
  const f = await fixture();
  const signed = await f.sign(f.original);
  const operation = inspectApproval(signed.text, signed.approval, f.policy, 0);
  const result = await Effect.runPromise(operation);
  expect(result).toMatchObject({ _tag: 'OfflinePlan', activation: 'Blocked', approval: 'Matched' });
  expect(result.blockers).toContain('HostedActivationDisabled');
  expect(result.blockers).toContain('PrivateInvocationUnverified');
  expect(encode(result)).not.toContain(f.policy.publicKey);
  expect(encode(result)).not.toContain(signed.approval.signature);
}
test('signed identity-bound plan can match offline but never enables activation', validSignedPlan);

async function rejectUnsignedAndTampered() {
  const f = await fixture();
  const signed = await f.sign(f.original);
  for (const [text, approval, policy] of [
    [signed.text, {}, f.policy],
    [signed.text, { ...signed.approval, signature: '0'.repeat(128) }, f.policy],
    [signed.text, { ...signed.approval, keyId: 'foreign' }, f.policy],
    [signed.text + ' ', signed.approval, f.policy],
    [signed.text, signed.approval, { ...f.policy, publicKey: '0'.repeat(64) }],
    [signed.text, signed.approval, undefined],
  ] as const) {
    const operation = inspectApproval(text, approval, policy, 0);
    const checked = operation.pipe(Effect.result);
    expect((await Effect.runPromise(checked))._tag).toBe('Failure');
  }
}
test(
  'missing untrusted and tampered attestations cannot bless a worksheet',
  rejectUnsignedAndTampered,
);

async function rejectEvenWhenSigned() {
  const f = await fixture();
  const base = f.original;
  const mutations = [
    { ...base, accountId: 'f'.repeat(32) },
    { ...base, stage: 'production' },
    { ...base, operatorId: 'other' },
    { ...base, session: { ...base.session, sessionId: 'other' } },
    { ...base, request: { ...base.request, sessionId: 'other' } },
    { ...base, request: { ...base.request, argv: ['true'] } },
    { ...base, inputs: { ...base.inputs, image: 'Unbuilt' } },
    { ...base, inputs: { ...base.inputs, harnessSha256: 'e'.repeat(64) } },
    { ...base, inputs: { ...base.inputs, toolchainSha256: 'e'.repeat(64) } },
    {
      ...base,
      inputs: { ...base.inputs, payloads: { ...base.inputs.payloads, source: 'e'.repeat(64) } },
    },
    { ...base, commands: ['test'] },
    { ...base, resources: { ...base.resources, memoryBytes: 17179869184 } },
    { ...base, cost: { ...base.cost, allowanceCents: 501 } },
    { ...base, cost: { ...base.cost, projectedCents: 501 } },
    { ...base, cost: { ...base.cost, enforcement: 'ProviderHardCap' } },
    { ...base, cleanup: { ...base.cleanup, previous: 'CleanupUnconfirmed' } },
    { ...base, cleanup: { ...base.cleanup, ownerId: 'foreign' } },
    { ...base, session: { ...base.session, endsAtMs: 3599999 } },
    { ...base, session: { ...base.session, endsAtMs: 3600001 } },
    { ...base, approvalExpiresAtMs: 3600001 },
    { ...base, approvedAtMs: 1 },
    { ...base, token: 'never-log-sentinel' },
  ];
  for (const mutation of mutations) {
    const signed = await f.sign(mutation);
    const operation = inspectApproval(signed.text, signed.approval, f.policy, 0);
    const checked = operation.pipe(Effect.result);
    expect((await Effect.runPromise(checked))._tag).toBe('Failure');
  }
}
test(
  'signature cannot override reviewed pins sessions commands caps cost or cleanup',
  rejectEvenWhenSigned,
);

async function rejectPromotedInputs() {
  const f = await fixture();
  for (const sourceImage of Object.values(reviewedInputs.images)) {
    const image = 'registry.cloudflare.com/test/ceirean-executor@sha256:' + sourceImage.slice(-64);
    const inputs = { ...f.original.inputs, image };
    const signed = await f.sign({ ...f.original, inputs });
    const operation = inspectApproval(signed.text, signed.approval, { ...f.policy, inputs }, 0);
    expect((await Effect.runPromise(operation.pipe(Effect.result)))._tag).toBe('Failure');
  }
}
test(
  'reviewed helper base and toolchain images cannot be promoted into the final executor identity',
  rejectPromotedInputs,
);

async function exactTimeBounds() {
  const f = await fixture();
  const signed = await f.sign(f.original);
  for (const now of [-1, NaN, Infinity, 0.5, 2699001, 2700000, 3600000]) {
    const operation = inspectApproval(signed.text, signed.approval, f.policy, now);
    expect((await Effect.runPromise(operation.pipe(Effect.result)))._tag).toBe('Failure');
  }
  const operation = inspectApproval(signed.text, signed.approval, f.policy, 2699000);
  expect(await Effect.runPromise(operation)).toMatchObject({
    activation: 'Blocked',
    approval: 'Matched',
  });
}
test(
  'approval expires exclusively and request must retain the full cleanup reserve',
  exactTimeBounds,
);

function signedMutationLaw(seed: number) {
  async function run() {
    const f = await fixture();
    const signed = await f.sign(f.original);
    const index = Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: signed.text.length - 1 }),
    );
    const changes = Arbitrary.schema(index);
    function law(index: number) {
      const changed = signed.text.slice(0, index) + 'X' + signed.text.slice(index + 1);
      const operation = inspectApproval(changed, signed.approval, f.policy, 0);
      return operation.pipe(Effect.result, Effect.map(Result.isFailure));
    }
    const checking = Arbitrary.checkEffect(changes, law, { seed, runs: 100, maxShrinks: 100 });
    const result = await Effect.runPromise(checking);
    expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
    expect(result).toMatchObject({ runs: 100 });
  }
  return run;
}
for (const seed of [0, 1, 163])
  test(`signed worksheet byte mutation law; seed ${seed}`, signedMutationLaw(seed));
