import { expect, spyOn, test } from 'bun:test';

import { createGitHubChannel, type GitHubWebhookDelivery } from '@flue/github';

const fixture = {
  secret: 'synthetic-offline-github-fixture-only',
  body: '{"action":"created","comment":{"id":505,"body":"/leviathan assess"}}',
};

interface SignedFixtureOptions {
  readonly bodyBytes?: Uint8Array;
  readonly eventName?: string;
  readonly deliveryId?: string;
  readonly signature?: 'valid' | 'invalid' | 'missing';
}

async function signedFixture(options: SignedFixtureOptions = {}) {
  const body = new Uint8Array(options.bodyBytes ?? new TextEncoder().encode(fixture.body));
  const headers = new Headers({
    'content-type': 'application/json',
    'x-github-event': options.eventName ?? 'issue_comment',
    'x-github-delivery': options.deliveryId ?? 'synthetic-delivery-1',
  });
  if (options.signature !== 'missing') {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(fixture.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
    if (options.signature === 'invalid') digest[0] ^= 1;
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    headers.set('x-hub-signature-256', `sha256=${hex}`);
  }
  return new Request('http://leviathan.invalid/webhook', { method: 'POST', headers, body });
}

function recordingChannel() {
  const calls: GitHubWebhookDelivery[] = [];
  const channel = createGitHubChannel({
    webhookSecret: fixture.secret,
    bodyLimit: 65536,
    webhook: ({ delivery }) => {
      calls.push(delivery);
      return { recorded: true };
    },
  });
  return { channel, calls };
}

test('signed request reaches the real channel callback once', async () => {
  const { channel, calls } = recordingChannel();
  const response = await channel.route().fetch(await signedFixture());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ recorded: true });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    name: 'issue_comment',
    deliveryId: 'synthetic-delivery-1',
    payload: { action: 'created', comment: { id: 505, body: '/leviathan assess' } },
  });
});

test('invalid and missing signatures never reach the callback', async () => {
  const { channel, calls } = recordingChannel();
  for (const signature of ['invalid', 'missing'] as const) {
    const response = await channel.route().fetch(await signedFixture({ signature }));
    expect(response.status).toBe(401);
  }
  expect(calls).toHaveLength(0);
});

test('byte tampering fails verification', async () => {
  const { channel, calls } = recordingChannel();
  const signed = await signedFixture();
  const bytes = new Uint8Array(await signed.arrayBuffer());
  bytes[bytes.length - 1] ^= 1;
  const tampered = new Request(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: bytes,
  });
  expect((await channel.route().fetch(tampered)).status).toBe(401);
  expect(calls).toHaveLength(0);
});

test('ping is handled internally', async () => {
  const { channel, calls } = recordingChannel();
  const response = await channel.route().fetch(await signedFixture({ eventName: 'ping' }));
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(0);
});

test.each(['throw', 'reject'] as const)(
  'callback %s does not become accepted application success',
  async (mode) => {
    let calls = 0;
    const failure = new Error('Synthetic recording failure');
    const entered = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<{ recorded: boolean }>();
    const channel = createGitHubChannel({
      webhookSecret: fixture.secret,
      bodyLimit: 65536,
      webhook:
        mode === 'throw'
          ? () => {
              calls++;
              throw failure;
            }
          : () =>
              Promise.resolve()
                .then(() => {
                  calls++;
                  entered.resolve();
                })
                .then(() => completion.promise),
    });
    const diagnostic = spyOn(console, 'error').mockImplementation(() => {});
    await Promise.resolve()
      .then(async () => {
        const pending = channel.route().fetch(await signedFixture());
        if (mode === 'reject') {
          await entered.promise;
          completion.reject(failure);
        }
        const response = await pending;
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: { type: 'internal_error' } });
        expect(calls).toBe(1);
        expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining(failure.message));
      })
      .finally(() => {
        diagnostic.mockRestore();
      });
  },
);

test('whitespace-bearing signed bytes preserve parsed payload and metadata', async () => {
  const { channel, calls } = recordingChannel();
  const response = await channel.route().fetch(
    await signedFixture({
      bodyBytes: new TextEncoder().encode('{ "synthetic": true }\n'),
      eventName: 'issues',
      deliveryId: 'synthetic-delivery-2',
    }),
  );
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    name: 'issues',
    deliveryId: 'synthetic-delivery-2',
    payload: { synthetic: true },
  });
});

test('body limit refuses oversized signed bytes before the callback', async () => {
  const { channel, calls } = recordingChannel();
  const response = await channel
    .route()
    .fetch(await signedFixture({ bodyBytes: new Uint8Array(65537) }));
  expect(response.status).toBe(413);
  expect(calls).toHaveLength(0);
});
