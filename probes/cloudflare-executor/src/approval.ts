import { Data, Effect, Result, Schema } from 'effect';
import { decode as decodeHex } from 'effect/encoding/Hex';

import { SessionConfig } from './admission.ts';
import { Identity, limits, ProbeRequest, strict, Timestamp } from './contract.ts';
import { reviewedInputs } from './pins.ts';
import { sha256 } from './preparation.ts';

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Account = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/));
const Image = Schema.String.check(
  Schema.isPattern(/^registry\.cloudflare\.com\/[a-z0-9][a-z0-9/_-]{0,180}@sha256:[a-f0-9]{64}$/),
);
const Money = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }));
const Inputs = Schema.Struct({
  sourceSha: ProbeRequest.fields.sourceSha,
  recipeSha256: Schema.Literal(reviewedInputs.recipeSha256),
  image: Image,
  toolchainSha256: Digest,
  harnessSha256: Digest,
  payloads: Schema.Struct({
    source: Digest,
    bunCache: Digest,
    npmCache: Digest,
    browserHarness: Digest,
  }),
});
const commands = Schema.Tuple(
  ['install', 'check', 'typecheck', 'test', 'build', 'storybook'].map((id) => Schema.Literal(id)),
);
const Worksheet = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  purpose: Schema.Literal('HostedSession'),
  accountId: Account,
  stage: Identity,
  operatorId: Identity,
  session: SessionConfig,
  request: ProbeRequest,
  approvedAtMs: Timestamp,
  approvalExpiresAtMs: Timestamp,
  inputs: Inputs,
  commands,
  resources: Schema.Struct({
    instance: Schema.Literal('standard-3'),
    vcpu: Schema.Literal(2),
    memoryBytes: Schema.Literal(8589934592),
    diskBytes: Schema.Literal(16000000000),
    maxActive: Schema.Literal(1),
  }),
  cost: Schema.Struct({
    currency: Schema.Literal('USD'),
    allowanceCents: Money,
    projectedCents: Money,
    enforcement: Schema.Literal('OperatorStop'),
  }),
  cleanup: Schema.Struct({ ownerId: Identity, previous: Schema.Literal('Confirmed') }),
});
type Worksheet = typeof Worksheet.Type;
const Policy = Schema.Struct({
  accountId: Account,
  stage: Identity,
  operatorId: Identity,
  sessionId: Identity,
  keyId: Identity,
  publicKey: Digest,
  inputs: Inputs,
  maximumAllowanceCents: Money,
});
type Policy = typeof Policy.Type;
export const ApprovalReceipt = Schema.Struct({
  keyId: Identity,
  signature: Schema.String.check(Schema.isPattern(/^[a-f0-9]{128}$/)),
});
const decodeWorksheet = Schema.decodeUnknownEffect(Schema.fromJsonString(Worksheet), strict);
const sameInputs = Schema.toEquivalence(Inputs);
export class ApprovalError extends Data.TaggedError('ApprovalError')<{
  readonly code: 'InputTooLarge' | 'PolicyMismatch' | 'InvalidWindow' | 'SignatureInvalid';
}> {}
function requireCondition(valid: boolean, code: ApprovalError['code']) {
  return Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new ApprovalError({ code }),
    ),
  );
}
function matchesPolicy(worksheet: Worksheet, policy: Policy) {
  const knownInput = Object.values(reviewedInputs.images).some((image) =>
    worksheet.inputs.image.endsWith(image.slice(-64)),
  );
  return [
    worksheet.accountId === policy.accountId,
    worksheet.stage === policy.stage,
    worksheet.operatorId === policy.operatorId,
    worksheet.session.sessionId === policy.sessionId,
    worksheet.request.sessionId === policy.sessionId,
    worksheet.cleanup.ownerId === policy.operatorId,
    sameInputs(worksheet.inputs, policy.inputs),
    !knownInput,
    worksheet.cost.allowanceCents <= policy.maximumAllowanceCents,
    worksheet.cost.projectedCents <= worksheet.cost.allowanceCents,
  ].every(Boolean);
}
function fitsWindow(worksheet: Worksheet, nowMs: number) {
  const { session, request } = worksheet;
  return [
    Number.isSafeInteger(nowMs),
    nowMs >= session.startsAtMs,
    nowMs >= worksheet.approvedAtMs,
    worksheet.approvedAtMs <= session.startsAtMs,
    nowMs < worksheet.approvalExpiresAtMs,
    worksheet.approvalExpiresAtMs <= session.executionDeadlineMs,
    worksheet.approvalExpiresAtMs - worksheet.approvedAtMs <= limits.sessionMs,
    session.executionDeadlineMs > session.startsAtMs,
    session.executionDeadlineMs - session.startsAtMs <= limits.executionMs,
    session.endsAtMs - session.startsAtMs <= limits.sessionMs,
    session.endsAtMs - session.executionDeadlineMs >= limits.cleanupMs,
    request.durationMs <= session.executionDeadlineMs - nowMs,
    request.durationMs <= session.endsAtMs - nowMs - limits.cleanupMs,
  ].every(Boolean);
}

/** Verifies metadata and an exact-byte signature only; never allocates or invokes. */
export function inspectApproval(
  text: string,
  rawApproval: unknown,
  rawPolicy: unknown,
  nowMs: number,
) {
  function* inspect() {
    yield* Effect.fromResult(requireCondition(text.length <= 65536, 'InputTooLarge'));
    yield* Effect.fromResult(
      requireCondition(new TextEncoder().encode(text).byteLength <= 65536, 'InputTooLarge'),
    );
    const decoded = yield* decodeWorksheet(text);
    const worksheet = structuredClone(decoded);
    const policy = yield* Schema.decodeUnknownEffect(Policy, strict)(rawPolicy);
    const approval = yield* Schema.decodeUnknownEffect(ApprovalReceipt, strict)(rawApproval);
    yield* Effect.fromResult(requireCondition(matchesPolicy(worksheet, policy), 'PolicyMismatch'));
    yield* Effect.fromResult(requireCondition(fitsWindow(worksheet, nowMs), 'InvalidWindow'));
    yield* Effect.fromResult(requireCondition(approval.keyId === policy.keyId, 'PolicyMismatch'));
    const publicKey = new Uint8Array(yield* Effect.fromResult(decodeHex(policy.publicKey)));
    const signature = new Uint8Array(yield* Effect.fromResult(decodeHex(approval.signature)));
    const content = new TextEncoder().encode('ceirean.hosted-executor.approval.v1\n' + text);
    function verify() {
      return crypto.subtle
        .importKey('raw', publicKey, 'Ed25519', false, ['verify'])
        .then((key) => crypto.subtle.verify('Ed25519', key, signature, content));
    }
    const verified = yield* Effect.tryPromise({
      try: verify,
      catch: () => new ApprovalError({ code: 'SignatureInvalid' }),
    });
    yield* Effect.fromResult(requireCondition(verified, 'SignatureInvalid'));
    const worksheetSha256 = yield* sha256(text);
    return {
      _tag: 'OfflinePlan' as const,
      activation: 'Blocked' as const,
      approval: 'Matched' as const,
      worksheetSha256,
      operation: worksheet.request.kind,
      blockers: [
        'HostedActivationDisabled',
        'PrivateInvocationUnverified',
        'HostedInputsUnverified',
        'ProviderLimitsUnverified',
      ],
    };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
