import { expect, test } from 'bun:test';

import { RuntimeContext } from 'alchemy/RuntimeContext';
import { ConfigProvider, Context, Data, Effect, Exit, Redacted, Result, Schema } from 'effect';

import { handleReadOnlyRequest } from '../src/readonly/ingress.ts';
import { describeReadiness } from '../src/readonly/readiness.ts';
import {
  makeReadOnlyAdmission,
  makeReadOnlyHandlers,
  webhookSecretConfiguration,
} from '../src/readonly/worker.ts';

const fixture = { secret: 'synthetic-readonly-signing-secret' };
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const run = Effect.runPromiseWith(
  Context.make(RuntimeContext, {
    Type: 'Test',
    id: 'ingress-test',
    env: {},
    get: () => Effect.sync(() => undefined),
    set: (key) => Effect.sync(() => key),
  }),
);
function payload(operator = 50) {
  return {
    action: 'created',
    installation: { id: 10 },
    repository: { id: 30, name: 'fold-kit-experiments', owner: { id: 20, login: 'opsydyn' } },
    issue: { id: 400, number: 40 },
    comment: { id: 55, body: '/ceirean assess', user: { id: operator, type: 'User' } },
    sender: { id: operator, type: 'User' },
  };
}
function policy() {
  const now = Date.now();
  return {
    sessionId: 'bridge-test',
    installationId: 10,
    ownerId: 20,
    repositoryId: 30,
    issueNumber: 40,
    operatorId: 50,
    opensAtMs: now - 1000,
    closesAtMs: now + 60000,
  };
}
async function signed(operator = 50) {
  const body = encode(payload(operator));
  const bytes = new TextEncoder().encode(body);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(fixture.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return new Request('https://ceirean.invalid/webhook', {
    method: 'POST',
    body: bytes,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'issue_comment',
      'x-github-delivery': 'delivery-1',
      'x-hub-signature-256': `sha256=${hex}`,
    },
  });
}
async function allowedAndReplay() {
  let enqueued = 0;
  const stored = { _tag: 'Queued', sessionId: 'bridge-test' };
  function record() {
    enqueued += 1;
    return encode(stored);
  }
  const store = { enqueue: () => Effect.sync(record) };
  const request = await signed();
  const replay = request.clone();
  const config = policy();
  const secret = Redacted.make(fixture.secret);
  const first = await run(handleReadOnlyRequest(request, config, secret, store.enqueue));
  const second = await run(handleReadOnlyRequest(replay, config, secret, store.enqueue));
  expect(first.status).toBe(202);
  expect(second.status).toBe(202);
  expect(await first.json()).toEqual(stored);
  expect(await second.json()).toEqual(stored);
  expect(enqueued).toBe(2); // The durable store, not the HTTP bridge, owns deduplication.
}
test(
  'signed delivery and replay return the durable job without inventing a new one',
  allowedAndReplay,
);

async function rejected() {
  let enqueued = 0;
  function record() {
    enqueued += 1;
    return encode({ _tag: 'Unexpected' });
  }
  const store = { enqueue: () => Effect.sync(record) };
  const secret = Redacted.make(fixture.secret);
  const config = policy();
  const wrongActor = await signed(999);
  const actorResult = await run(handleReadOnlyRequest(wrongActor, config, secret, store.enqueue));
  expect(actorResult.status).toBe(403);
  const badSignature = await signed();
  badSignature.headers.set('x-hub-signature-256', `sha256=${'0'.repeat(64)}`);
  const signatureResult = await run(
    handleReadOnlyRequest(badSignature, config, secret, store.enqueue),
  );
  expect(signatureResult.status).toBe(401);
  expect(enqueued).toBe(0);
}
test('wrong operator or invalid signature never reaches durable admission', rejected);

async function staleReadinessResponse() {
  let admissions = 0;
  const config = policy();
  const stale = { ...config, closesAtMs: config.closesAtMs - 1 };
  function recordUnexpectedAdmission() {
    admissions += 1;
    return encode({ _tag: 'Unexpected' });
  }
  const client = {
    readiness: () => Effect.succeed(describeReadiness(stale)),
    enqueueReadyV1: () => Effect.sync(recordUnexpectedAdmission),
  };
  const admission = makeReadOnlyAdmission({ getByName: () => client }, config);
  const response = await run(
    handleReadOnlyRequest(await signed(), config, Redacted.make(fixture.secret), admission.enqueue),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ _tag: 'NotReady' });
  expect(admissions).toBe(0);
}
test(
  'valid signed delivery during DO rollout skew returns 503 without admission or policy disclosure',
  staleReadinessResponse,
);

async function persistenceFailure() {
  const request = await signed();
  const store = { enqueue: () => Effect.die({ _tag: 'SyntheticStorageFault' }) };
  const config = policy();
  const secret = Redacted.make(fixture.secret);
  const handling = handleReadOnlyRequest(request, config, secret, store.enqueue);
  const result = await run(handling.pipe(Effect.exit));
  expect(Exit.isFailure(result)).toBe(true);
}
test('a persistence defect cannot acknowledge accepted durable work', persistenceFailure);

class PlanningLookup extends Data.TaggedError('PlanningLookup')<{
  readonly operation: 'getByName';
}> {}
function lazyNamespace() {
  let lookups = 0;
  function getByName(): never {
    lookups += 1;
    throw new PlanningLookup({ operation: 'getByName' });
  }
  const namespace = { getByName };
  const handlers = makeReadOnlyHandlers(namespace, policy(), Redacted.make(fixture.secret));
  expect(lookups).toBe(0);
  expect(Effect.isEffect(handlers.fetch)).toBe(true);
  expect(typeof handlers.readiness).toBe('function');
}
test('preparing handlers never dereferences a runtime-only DO namespace', lazyNamespace);

async function oversizedBody() {
  let enqueued = 0;
  function unexpected() {
    enqueued += 1;
    return encode({ _tag: 'Unexpected' });
  }
  const store = { enqueue: () => Effect.sync(unexpected) };
  const request = new Request('https://ceirean.invalid/webhook', {
    method: 'POST',
    body: 'x'.repeat(65537),
  });
  const config = policy();
  const secret = Redacted.make(fixture.secret);
  const response = await run(handleReadOnlyRequest(request, config, secret, store.enqueue));
  expect(response.status).toBe(413);
  expect(enqueued).toBe(0);
}
test('oversized raw bodies retain the protocol refusal without admission', oversizedBody);

async function signingConfiguration() {
  for (const value of ['', 'short-secret']) {
    const provider = ConfigProvider.fromUnknown({ CEIREAN_READONLY_WEBHOOK_SECRET: value });
    const checking = webhookSecretConfiguration.parse(provider).pipe(Effect.result);
    const result = await Effect.runPromise(checking);
    expect(Result.isFailure(result)).toBe(true);
  }
  const provider = ConfigProvider.fromUnknown({ CEIREAN_READONLY_WEBHOOK_SECRET: fixture.secret });
  const secret = await Effect.runPromise(webhookSecretConfiguration.parse(provider));
  expect(Redacted.isRedacted(secret)).toBe(true);
}
test(
  'runtime signing config rejects empty or weak secrets and retains redaction',
  signingConfiguration,
);
