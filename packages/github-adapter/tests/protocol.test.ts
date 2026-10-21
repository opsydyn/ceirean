import { expect, test } from 'bun:test';

import { Digest, type VerifiedCommand } from '@ceirean/domain';
import { captureRequestBody, makeVerifiedGitHubIngress } from '@ceirean/github-adapter/protocol';
import { Effect, Match, Schema, Struct } from 'effect';

const fixture = { secret: 'synthetic-protocol-secret' };
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function payload() {
  return {
    action: 'created',
    installation: { id: 11 },
    repository: { id: 22, name: 'repository', owner: { id: 33, login: 'owner' } },
    issue: { id: 44, number: 1 },
    comment: { id: 55, body: '/ceirean assess', user: { id: 66, type: 'User' } },
    sender: { id: 66, type: 'User' },
  };
}
async function signed(body = encode(payload()), eventName = 'issue_comment') {
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
  return new Request('http://ceirean.invalid/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': eventName,
      'x-github-delivery': 'delivery-1',
      'x-hub-signature-256': `sha256=${hex}`,
    },
    body: bytes,
  });
}
function opened() {
  const calls: VerifiedCommand[] = [];
  const app = makeVerifiedGitHubIngress({
    secret: fixture.secret,
    ingressScopeId: 'fixture-app',
    capture: (request: Request) => Effect.runPromise(captureRequestBody(request, 65536)),
    onVerified: async (command: VerifiedCommand) => {
      calls.push(command);
      return Response.json({ accepted: true }, { status: 202 });
    },
  });
  return { app, calls };
}
async function exactCommand() {
  const { app, calls } = opened();
  const request = await signed();
  const bytes = await request.clone().arrayBuffer();
  const hashed = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const digest = Array.from(hashed, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const response = await app.fetch(request);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: true });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({
    receipt: {
      ingressScopeId: 'fixture-app',
      deliveryId: 'delivery-1',
      eventName: 'issue_comment',
      rawBodyDigest: Digest.make(digest),
    },
    candidate: {
      ingressScopeId: 'fixture-app',
      installationId: 11,
      repositoryId: 22,
      ownerId: 33,
      issueId: 44,
      issueNumber: 1,
      commentId: 55,
      operatorId: 66,
      command: 'Assess',
      ownerLogin: 'owner',
      repositoryName: 'repository',
    },
  });
  expect(request.body?.locked).toBe(false);
}
test('verified callback sees exact normalised command once', exactCommand);

async function invalidSignature(kind: string) {
  const { app, calls } = opened();
  const request = await signed();
  function missing() {
    request.headers.delete('x-hub-signature-256');
    return request;
  }
  function invalid() {
    request.headers.set('x-hub-signature-256', `sha256=${'0'.repeat(64)}`);
    return request;
  }
  const input = Match.value(kind).pipe(
    Match.when('missing', missing),
    Match.when('invalid', invalid),
    Match.orElse(
      () =>
        new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: encode(payload()) + ' ',
        }),
    ),
  );
  expect((await app.fetch(input)).status).toBe(401);
  expect(calls).toHaveLength(0);
  expect(input.body?.locked).toBe(false);
}
test.each(['missing', 'invalid', 'tampered'])(
  'invalid signature never reaches callback: %s',
  invalidSignature,
);

async function conflictingDigest() {
  const { app, calls } = opened();
  const bodies = [encode(payload()), encode(payload()) + ' '];
  const digests: Digest[] = [];
  for (const body of bodies) {
    const hashed = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
    );
    const hex = Array.from(hashed, (byte) => byte.toString(16).padStart(2, '0')).join('');
    digests.push(Digest.make(hex));
    expect((await app.fetch(await signed(body))).status).toBe(202);
  }
  expect(calls).toHaveLength(2);
  expect(calls.map((command) => command.receipt.rawBodyDigest)).toEqual(digests);
  expect(digests[0]).not.toBe(digests[1]);
  expect(calls[0]?.candidate).toEqual(calls[1]?.candidate);
}
test('conflicting digest is not rewritten by transport', conflictingDigest);

const rejectedCases = [
  {
    name: 'retired product command',
    event: 'issue_comment',
    value: { ...payload(), comment: { ...payload().comment, body: '/leviathan assess' } },
    status: 200,
    reason: 'NotCommand',
  },
  {
    name: 'unsupported event',
    event: 'push',
    value: payload(),
    status: 200,
    reason: 'UnsupportedEvent',
  },
  { name: 'ping', event: 'ping', value: {}, status: 200, reason: 'UnsupportedEvent' },
  {
    name: 'unsupported action',
    event: 'issue_comment',
    value: Struct.evolve(payload(), { action: () => 'edited' }),
    status: 200,
    reason: 'UnsupportedAction',
  },
  {
    name: 'malformed identifier',
    event: 'issue_comment',
    value: Struct.evolve(payload(), { installation: () => ({ id: 0 }) }),
    status: 400,
    reason: 'MalformedInput',
  },
];
async function rejectedInput({ event, value, status, reason }: (typeof rejectedCases)[number]) {
  const { app, calls } = opened();
  const request = await signed(encode(value), event);
  const response = await app.fetch(request);
  const tag = Match.value(status).pipe(
    Match.when(400, () => 'Rejected'),
    Match.orElse(() => 'Ignored'),
  );
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    _tag: 'Unrecorded',
    decision: {
      _tag: tag,
      reason,
    },
  });
  expect(calls).toHaveLength(0);
  expect(request.body?.locked).toBe(false);
}
test.each(rejectedCases)('$name never reaches callback', rejectedInput);

async function unsupportedMedia() {
  const { app, calls } = opened();
  const request = await signed();
  request.headers.set('content-type', 'text/plain');
  const response = await app.fetch(request);
  expect(response.status).toBe(415);
  expect(await response.json()).toEqual({ _tag: 'IngressFailure', code: 'UnsupportedMediaType' });
  expect(calls).toHaveLength(0);
  expect(request.body?.locked).toBe(false);
}
test('unsupported media never reaches callback', unsupportedMedia);

async function abortSlowRead(settlement: 'resolve' | 'reject') {
  const { app, calls } = opened();
  const original = await signed();
  const pulled = Promise.withResolvers<void>();
  const cancellationEntered = Promise.withResolvers<void>();
  const cancellation = Promise.withResolvers<void>();
  const controller = new AbortController();
  let settled = false;
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      pulled.resolve();
    },
    cancel() {
      cancellations++;
      cancellationEntered.resolve();
      return cancellation.promise;
    },
  });
  const request = new Request(original.url, {
    method: 'POST',
    headers: original.headers,
    body,
    signal: controller.signal,
  });
  function finishResponse(response: Response) {
    settled = true;
    return response;
  }
  const pending = app.fetch(request).then(finishResponse);
  await pulled.promise;
  expect(calls).toHaveLength(0);
  controller.abort();
  await cancellationEntered.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const beforeRelease = { settled, locked: body.locked, cancellations };
  function settleCancellation() {
    return Match.value(settlement).pipe(
      Match.when('reject', () =>
        cancellation.reject(new TypeError('private cancellation failure')),
      ),
      Match.orElse(() => cancellation.resolve()),
    );
  }
  settleCancellation();
  const response = await pending;
  expect(beforeRelease).toEqual({ settled: false, locked: true, cancellations: 1 });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain('private cancellation failure');
  expect(calls).toHaveLength(0);
  expect(body.locked).toBe(false);
}
test.each(['resolve', 'reject'] as const)(
  'aborted slow read owns pending cancellation until %s',
  abortSlowRead,
);

async function overflow() {
  const { app, calls } = opened();
  const original = await signed();
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(65536));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancellations++;
    },
  });
  const response = await app.fetch(
    new Request(original.url, { method: 'POST', headers: original.headers, body }),
  );
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ _tag: 'IngressFailure', code: 'TooLarge' });
  expect(calls).toHaveLength(0);
  expect(cancellations).toBe(1);
  expect(body.locked).toBe(false);
}
test('overflowing read cancels without verifying or leaking reader', overflow);
