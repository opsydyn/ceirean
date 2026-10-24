import { Schema } from 'effect';

import { reviewedInputs } from '../src/pins.ts';
import { request, sessionConfig } from './contracts-fixtures.ts';

function signedContent(text: string) {
  return new TextEncoder().encode('ceirean.hosted-executor.approval.v1\n' + text);
}
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function worksheet() {
  return {
    schemaVersion: 1,
    purpose: 'HostedSession',
    accountId: 'a'.repeat(32),
    stage: 'executor-probe',
    operatorId: 'operator-1',
    session: sessionConfig(),
    request: request(),
    approvedAtMs: 0,
    approvalExpiresAtMs: 2700000,
    inputs: {
      sourceSha: request().sourceSha,
      recipeSha256: reviewedInputs.recipeSha256,
      image: `registry.cloudflare.com/test/ceirean-executor@sha256:${'b'.repeat(64)}`,
      toolchainSha256: 'c'.repeat(64),
      harnessSha256: 'd'.repeat(64),
      payloads: {
        source: '1'.repeat(64),
        bunCache: '2'.repeat(64),
        npmCache: '3'.repeat(64),
        browserHarness: '4'.repeat(64),
      },
    },
    commands: ['install', 'check', 'typecheck', 'test', 'build', 'storybook'],
    resources: {
      instance: 'standard-3',
      vcpu: 2,
      memoryBytes: 8589934592,
      diskBytes: 16000000000,
      maxActive: 1,
    },
    cost: {
      currency: 'USD',
      allowanceCents: 500,
      projectedCents: 450,
      enforcement: 'OperatorStop',
    },
    cleanup: { ownerId: 'operator-1', previous: 'Confirmed' },
  };
}
/** Ephemeral synthetic keys only; no real operator trust or private key files. */
export async function fixture() {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKey = hex(await crypto.subtle.exportKey('raw', keys.publicKey));
  const original = worksheet();
  const policy = {
    accountId: original.accountId,
    stage: original.stage,
    operatorId: original.operatorId,
    sessionId: original.session.sessionId,
    keyId: 'operator-key-1',
    publicKey,
    inputs: original.inputs,
    maximumAllowanceCents: 500,
  };
  async function sign(value: unknown) {
    const text = encode(value);
    const signature = hex(
      await crypto.subtle.sign('Ed25519', keys.privateKey, signedContent(text)),
    );
    return { text, approval: { keyId: policy.keyId, signature } };
  }
  return { policy, sign, original };
}
