import { afterEach, beforeAll, expect, test } from 'bun:test';

import { AuthorityQuery, Digest, LiveEvidenceLease } from '@leviathan/domain';
import { makeLiveAuthority } from '@leviathan/engine';
import { Effect, Match, Option, Result, Schema } from 'effect';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';

import { makeGitHubAuthorityDriver } from '../src/github-authority.ts';
import { githubRequest } from '../src/github-http.ts';

const wall = Date.parse('2026-10-21T12:00:00Z');
const jsonBoundary = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownSync(jsonBoundary);
const encodeJson = Schema.encodeSync(jsonBoundary);
let privateKey: string;
let publicKey: CryptoKey;
async function generateSyntheticKey() {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
}
beforeAll(generateSyntheticKey);
const disposals = new Set<() => Promise<void>>();
async function disposeTestResources() {
  await Promise.all(Array.from(disposals, (dispose) => dispose()));
  disposals.clear();
}
afterEach(disposeTestResources);

function query() {
  return AuthorityQuery.make({
    verified: {
      receipt: {
        ingressScopeId: 'fixture-app',
        deliveryId: 'delivery-1',
        eventName: 'issue_comment',
        rawBodyDigest: Digest.make('a'.repeat(64)),
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
        ownerLogin: 'old-owner',
        repositoryName: 'old-repo',
      },
    },
    policy: {
      revision: 'local-1',
      ingressScopeId: 'fixture-app',
      appId: 77,
      installationId: 11,
      ownerId: 33,
      repositoryId: 22,
      profile: { _tag: 'Enabled', profileId: 'foldkit', profileRevision: 'profile-1' },
      policyRevision: 'policy-1',
      allowedOperatorIds: [66],
    },
  });
}
function replies(): unknown[] {
  return [
    { id: 11, app_id: 77, account: { id: 33 }, suspended_at: null },
    {
      token: 'synthetic-token',
      expires_at: new Date(wall + 3600000).toISOString(),
      permissions: { metadata: 'read' },
      repository_selection: 'selected',
      repositories: [{ id: 22 }],
    },
    {
      id: 22,
      owner: { id: 33, login: 'canonical-owner' },
      name: 'canonical-repo',
      archived: false,
      disabled: false,
    },
    { id: 66, login: 'renamed-human', type: 'User' },
    {
      permission: 'write',
      role_name: 'custom-admin',
      user: { id: 66, login: 'renamed-human', type: 'User' },
    },
  ];
}
type Fetch = Parameters<typeof makeGitHubAuthorityDriver>[0]['fetch'];
function harness(values = replies()) {
  const calls: { url: string; init: RequestInit }[] = [];
  let reading = { wallMs: wall, monotonicMs: 100 };
  let respond = (index: number): Response | Promise<Response> =>
    Response.json(values[index], { status: [200, 201, 200, 200, 200][index] });
  const fetch: Fetch = (url, init) => {
    const index = calls.length;
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(respond(index));
  };
  const options = { appId: 77, privateKey, fetch, clock: () => ({ ...reading }) };
  const owned: (() => Promise<void>)[] = [];
  async function acquireResource() {
    const resource = Result.getOrThrow(await makeGitHubAuthorityDriver(options));
    owned.push(resource.dispose);
    disposals.add(resource.dispose);
    return resource;
  }
  async function acquire() {
    return (await acquireResource()).driver;
  }
  async function dispose() {
    await Promise.all(owned.map((close) => close()));
  }
  return {
    calls,
    options,
    acquire,
    acquireResource,
    dispose,
    setClock: (value: typeof reading) => {
      reading = value;
    },
    setResponse: (value: typeof respond) => {
      respond = value;
    },
  };
}
function expectFailure(result: unknown, code: string, phase?: string) {
  expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'LiveAuthorityError', code } });
  Option.match(Option.fromNullishOr(phase), {
    onNone: () => undefined,
    onSome: (phase) => expect(result).toMatchObject({ failure: { phase } }),
  });
  const serialized = encodeJson(result);
  expect(serialized).not.toContain('synthetic-token');
  expect(serialized).not.toContain('PRIVATE KEY');
  expect(serialized).not.toContain('secret-native');
}

async function protocolCase() {
  const h = harness();
  const driver = await h.acquire();
  const first = await driver(query(), new AbortController().signal);
  const lease = Result.getOrThrow(first);
  const isLease = Schema.is(LiveEvidenceLease);
  expect(isLease(lease)).toBe(true);
  expect(lease).toMatchObject({
    startedMonotonicMs: 100,
    evidence: {
      appId: 77,
      installationId: 11,
      ownerId: 33,
      repositoryId: 22,
      operatorId: 66,
      localPolicyRevision: 'local-1',
      policyRevision: 'policy-1',
      profileId: 'foldkit',
      profileRevision: 'profile-1',
      basePermission: 'write',
      observedAtMs: wall,
      checkedAtMs: wall,
      validUntilMs: wall + 6000,
    },
  });
  expect(h.calls.map(({ url, init }) => [url, init.method])).toEqual([
    ['https://api.github.com/app/installations/11', 'GET'],
    ['https://api.github.com/app/installations/11/access_tokens', 'POST'],
    ['https://api.github.com/repositories/22', 'GET'],
    ['https://api.github.com/user/66', 'GET'],
    [
      'https://api.github.com/repos/canonical-owner/canonical-repo/collaborators/renamed-human/permission',
      'GET',
    ],
  ]);
  for (const { init } of h.calls) {
    const headers = new Headers(init.headers);
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
    expect(headers.get('X-GitHub-Api-Version')).toBe('2026-03-10');
    expect(headers.get('User-Agent')).toBe('Leviathan-Local-GitHub-Ingress');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  }
  const authorization = new Headers(h.calls[0]?.init.headers).get('authorization') ?? '';
  const jwt = authorization.slice('Bearer '.length);
  const checked = await jwtVerify(jwt, publicKey, {
    algorithms: ['RS256'],
    issuer: '77',
    currentDate: new Date(wall),
  });
  expect(checked.payload.iat).toBe(wall / 1000 - 60);
  expect(checked.payload.exp).toBe(wall / 1000 + 540);
  expect(new Headers(h.calls[1]?.init.headers).get('authorization')).toBe(authorization);
  const body = String(h.calls[1]?.init.body);
  const parsedBody = decodeJson(body);
  expect(parsedBody).toEqual({ repository_ids: [22], permissions: { metadata: 'read' } });
  for (const { init } of h.calls.slice(2))
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-token');
  h.setResponse((index) =>
    Response.json(replies()[index % 5], { status: [200, 201, 200, 200, 200][index % 5] }),
  );
  const second = Result.getOrThrow(await driver(query(), new AbortController().signal));
  expect(h.calls).toHaveLength(10);
  expect(second.evidence.evidenceId).not.toBe(lease.evidence.evidenceId);
}
test(
  'exact bounded protocol uses App JWT then a fresh metadata-only repository token and canonical names',
  protocolCase,
);

for (const permission of ['write', 'admin', 'read', 'none'] as const) {
  async function permissionCase() {
    const values = replies();
    values[4] = { permission, role_name: 'admin', user: { id: 66 } };
    const h = harness(values);
    const result = await (await h.acquire())(query(), new AbortController().signal);
    expect(Result.getOrThrow(result).evidence.basePermission).toBe(permission);
  }
  test(
    `base permission ${permission} is evidence, independent of custom role_name`,
    permissionCase,
  );
}
for (const permission of ['maintain', 'triage', 'push', 'pull', 'owner', '', undefined]) {
  async function invalidPermissionCase() {
    const values = replies();
    values[4] = { permission, role_name: 'admin', user: { id: 66 } };
    const h = harness(values);
    expectFailure(
      await (
        await h.acquire()
      )(query(), new AbortController().signal),
      'InvalidResponse',
      'permission',
    );
    expect(h.calls).toHaveLength(5);
  }
  test(
    `unknown or missing base permission ${String(permission)} never borrows role_name`,
    invalidPermissionCase,
  );
}

const identityCases: readonly [string, number, unknown][] = [
  ['changed installation', 0, { id: 12, app_id: 77, account: { id: 33 }, suspended_at: null }],
  ['changed App', 0, { id: 11, app_id: 78, account: { id: 33 }, suspended_at: null }],
  [
    'changed installation owner',
    0,
    { id: 11, app_id: 77, account: { id: 34 }, suspended_at: null },
  ],
  [
    'suspended installation',
    0,
    { id: 11, app_id: 77, account: { id: 33 }, suspended_at: '2026-10-21T00:00:00Z' },
  ],
  [
    'transferred repository',
    2,
    {
      id: 22,
      owner: { id: 34, login: 'new-owner' },
      name: 'repo',
      archived: false,
      disabled: false,
    },
  ],
  [
    'reassigned repository',
    2,
    { id: 23, owner: { id: 33, login: 'owner' }, name: 'repo', archived: false, disabled: false },
  ],
  [
    'archived repository',
    2,
    { id: 22, owner: { id: 33, login: 'owner' }, name: 'repo', archived: true, disabled: false },
  ],
  [
    'disabled repository',
    2,
    { id: 22, owner: { id: 33, login: 'owner' }, name: 'repo', archived: false, disabled: true },
  ],
  ['reassigned login', 3, { id: 67, login: 'renamed-human', type: 'User' }],
  ['bot', 3, { id: 66, login: 'bot', type: 'Bot' }],
  ['permission response for another user', 4, { permission: 'admin', user: { id: 67 } }],
];
for (const [name, index, replacement] of identityCases) {
  async function identityCase() {
    const values = replies();
    values[index] = replacement;
    const h = harness(values);
    expectFailure(
      await (
        await h.acquire()
      )(query(), new AbortController().signal),
      'IdentityMismatch',
    );
    expect(h.calls).toHaveLength(index + 1);
  }
  test(`${name} fails closed without a follow-up request`, identityCase);
}
for (let index = 0; index < 5; index += 1) {
  async function missingFieldsCase() {
    const values = replies();
    values[index] = {};
    const h = harness(values);
    expectFailure(
      await (
        await h.acquire()
      )(query(), new AbortController().signal),
      'InvalidResponse',
    );
    expect(h.calls).toHaveLength(index + 1);
  }
  test(`required response fields are not defaulted at phase ${index}`, missingFieldsCase);
}

test('unsupported synthetic PKCS#1 and malformed keys fail acquisition without fetch', async () => {
  for (const key of [
    '-----BEGIN RSA PRIVATE KEY-----\nsynthetic\n-----END RSA PRIVATE KEY-----',
    'secret-native-invalid',
  ]) {
    const h = harness();
    h.options.privateKey = key;
    expectFailure(await makeGitHubAuthorityDriver(h.options), 'InvalidKey', 'signing');
    expect(h.calls).toHaveLength(0);
  }
});

for (const [status, code] of [
  [301, 'InvalidResponse'],
  [302, 'InvalidResponse'],
  [307, 'InvalidResponse'],
  [401, 'Denied'],
  [403, 'Denied'],
  [404, 'Denied'],
  [429, 'RateLimited'],
  [500, 'Unavailable'],
  [503, 'Unavailable'],
] as const) {
  for (let index = 0; index < 5; index += 1) {
    async function statusCase() {
      const h = harness();
      let response: Response | undefined;
      function respond(at: number) {
        response = Match.value(at === index).pipe(
          Match.when(
            true,
            () =>
              new Response('secret-native-body', {
                status,
                headers: { location: 'https://secret-native.example/redirect' },
              }),
          ),
          Match.orElse(() =>
            Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] }),
          ),
        );
        return response;
      }
      h.setResponse(respond);
      expectFailure(await (await h.acquire())(query(), new AbortController().signal), code);
      expect(h.calls).toHaveLength(index + 1);
      expect(response?.body?.locked).toBe(false);
    }
    test(`HTTP ${status} at phase ${index} releases body with no retries or redirect`, statusCase);
  }
}

const tokenCases: readonly [string, unknown, string][] = [
  [
    'expired',
    {
      token: 'synthetic-token',
      expires_at: new Date(wall).toISOString(),
      permissions: { metadata: 'read' },
      repository_selection: 'selected',
      repositories: [{ id: 22 }],
    },
    'InvalidResponse',
  ],
  [
    'invalid expiry',
    {
      token: 'synthetic-token',
      expires_at: 'not-a-date',
      permissions: { metadata: 'read' },
      repository_selection: 'selected',
      repositories: [{ id: 22 }],
    },
    'InvalidResponse',
  ],
  [
    'broad repository selection',
    {
      token: 'synthetic-token',
      expires_at: new Date(wall + 60000).toISOString(),
      permissions: { metadata: 'read' },
      repository_selection: 'all',
      repositories: [{ id: 22 }],
    },
    'IdentityMismatch',
  ],
  [
    'wrong repository',
    {
      token: 'synthetic-token',
      expires_at: new Date(wall + 60000).toISOString(),
      permissions: { metadata: 'read' },
      repository_selection: 'selected',
      repositories: [{ id: 23 }],
    },
    'IdentityMismatch',
  ],
  [
    'multiple repositories',
    {
      token: 'synthetic-token',
      expires_at: new Date(wall + 60000).toISOString(),
      permissions: { metadata: 'read' },
      repository_selection: 'selected',
      repositories: [{ id: 22 }, { id: 23 }],
    },
    'IdentityMismatch',
  ],
  [
    'write grant',
    {
      token: 'synthetic-token',
      expires_at: new Date(wall + 60000).toISOString(),
      permissions: { metadata: 'write' },
      repository_selection: 'selected',
      repositories: [{ id: 22 }],
    },
    'IdentityMismatch',
  ],
  [
    'extra grant',
    {
      token: 'synthetic-token',
      expires_at: new Date(wall + 60000).toISOString(),
      permissions: { metadata: 'read', contents: 'read' },
      repository_selection: 'selected',
      repositories: [{ id: 22 }],
    },
    'IdentityMismatch',
  ],
];
for (const [name, token, code] of tokenCases) {
  async function tokenCase() {
    const values = replies();
    values[1] = token;
    const h = harness(values);
    expectFailure(await (await h.acquire())(query(), new AbortController().signal), code, 'token');
    expect(h.calls).toHaveLength(2);
  }
  test(`${name} token is rejected without repository lookup`, tokenCase);
}

for (const [name, response, code] of [
  ['malformed JSON', () => new Response('{secret-native'), 'InvalidResponse'],
  ['invalid UTF8', () => new Response(new Uint8Array([0xff, 0xfe])), 'InvalidResponse'],
  [
    'advertised oversized',
    () => new Response('{}', { headers: { 'content-length': '1048577' } }),
    'TooLarge',
  ],
  [
    'invalid content length',
    () => new Response('{}', { headers: { 'content-length': '-1' } }),
    'InvalidResponse',
  ],
  ['missing body', () => new Response(), 'InvalidResponse'],
  [
    'chunked oversized',
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(524288));
            controller.enqueue(new Uint8Array(524289));
          },
        }),
      ),
    'TooLarge',
  ],
  [
    'native body failure',
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('secret-native'));
          },
        }),
      ),
    'InvalidResponse',
  ],
] as const) {
  async function bodyCase() {
    const h = harness();
    const body = response();
    h.setResponse(() => body);
    expectFailure(await (await h.acquire())(query(), new AbortController().signal), code, 'body');
    expect(body.body?.locked ?? false).toBe(false);
    expect(h.calls).toHaveLength(1);
  }
  test(`${name} response is bounded and released`, bodyCase);
}

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function snapshotCase() {
  const h = harness();
  const acquisition = makeGitHubAuthorityDriver(h.options);
  h.options.appId = 99;
  h.options.privateKey = 'secret-native';
  h.options.fetch = () => Promise.reject(new Error('secret-native'));
  h.options.clock = () => ({ wallMs: 0, monotonicMs: 0 });
  const resource = Result.getOrThrow(await acquisition);
  disposals.add(resource.dispose);
  const driver = resource.driver;
  const input = structuredClone(query());
  const running = driver(input, new AbortController().signal);
  Reflect.set(input.policy, 'appId', 99);
  Reflect.set(input.policy.allowedOperatorIds, 'length', 0);
  Reflect.set(input.verified.candidate, 'commentId', 99);
  const result = Result.getOrThrow(await running);
  expect(result.evidence.appId).toBe(77);
  expect(result.evidence.commandKey).toContain('55');
  expect(h.calls).toHaveLength(5);
}
test(
  'construction dependencies and invocation facts are detached before the first await',
  snapshotCase,
);

for (let index = 0; index < 5; index += 1) {
  async function abortFetchCase() {
    const h = harness();
    const abort = new AbortController();
    const entered = deferred<void>();
    h.setResponse((at) =>
      Match.value(at === index).pipe(
        Match.when(
          true,
          () =>
            new Promise<Response>((_resolve, reject) => {
              h.calls[at]?.init.signal?.addEventListener(
                'abort',
                () => reject(new Error('secret-native')),
                { once: true },
              );
              entered.resolve();
            }),
        ),
        Match.orElse(() => Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] })),
      ),
    );
    const running = (await h.acquire())(query(), abort.signal);
    await entered.promise;
    abort.abort(new Error('secret-native'));
    expectFailure(await running, 'Aborted');
    expect(h.calls[index]?.init.signal?.aborted).toBe(true);
    expect(h.calls).toHaveLength(index + 1);
  }
  test(`caller abort reaches fetch phase ${index} without follow-up`, abortFetchCase);

  async function abortBodyCase() {
    const h = harness();
    const abort = new AbortController();
    const entered = deferred<void>();
    const cancelled = deferred<void>();
    const finishCancel = deferred<void>();
    let cancels = 0;
    const body = new Response(
      new ReadableStream({
        pull() {
          entered.resolve();
        },
        cancel() {
          cancels += 1;
          cancelled.resolve();
          return finishCancel.promise;
        },
      }),
      { status: [200, 201, 200, 200, 200][index] },
    );
    h.setResponse((at) =>
      Match.value(at === index).pipe(
        Match.when(true, () => body),
        Match.orElse(() => Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] })),
      ),
    );
    const running = (await h.acquire())(query(), abort.signal);
    await entered.promise;
    // pull may prefill before ownership, so wait until the actual request arrives.
    while (h.calls.length <= index) await Bun.sleep(1);
    abort.abort(new Error('secret-native'));
    await cancelled.promise;
    expectFailure(await within(running, 100), 'Aborted');
    let disposed = false;
    const disposing = h.dispose().finally(() => {
      disposed = true;
    });
    await Bun.sleep(5);
    expect(disposed).toBe(false);
    expect(body.body?.locked).toBe(true);
    finishCancel.resolve();
    await disposing;
    expectFailure(await running, 'Aborted');
    expect(cancels).toBe(1);
    expect(body.body?.locked).toBe(false);
    expect(h.calls).toHaveLength(index + 1);
  }
  test(
    `abort during body phase ${index} returns promptly while disposal awaits one cancellation and releases`,
    abortBodyCase,
  );
}

async function rejectedCancelCase() {
  const h = harness();
  const abort = new AbortController();
  const entered = deferred<void>();
  let cancels = 0;
  const body = new Response(
    new ReadableStream({
      pull() {
        entered.resolve();
      },
      cancel() {
        cancels += 1;
        return Promise.reject(new Error('secret-native'));
      },
    }),
  );
  h.setResponse(() => body);
  const running = (await h.acquire())(query(), abort.signal);
  await entered.promise;
  while (h.calls.length === 0) await Bun.sleep(1);
  abort.abort();
  expectFailure(await running, 'Aborted');
  await h.dispose();
  expect(cancels).toBe(1);
  expect(body.body?.locked).toBe(false);
  expect(h.calls).toHaveLength(1);
}
test(
  'rejecting reader cancellation is observed once and lock is released on abort',
  rejectedCancelCase,
);

async function preAbortCase() {
  const h = harness();
  const abort = new AbortController();
  abort.abort();
  expectFailure(await (await h.acquire())(query(), abort.signal), 'Aborted');
  expect(h.calls).toHaveLength(0);
}
test('already aborted request never fetches', preAbortCase);

for (let index = 0; index < 5; index += 1) {
  async function attemptTimeoutCase() {
    const h = harness();
    h.setResponse((at) =>
      Match.value(at === index).pipe(
        Match.when(
          true,
          () =>
            new Promise<Response>((_resolve, reject) => {
              h.calls[at]?.init.signal?.addEventListener(
                'abort',
                () => reject(new Error('secret-native')),
                { once: true },
              );
            }),
        ),
        Match.orElse(() => Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] })),
      ),
    );
    expectFailure(await (await h.acquire())(query(), new AbortController().signal), 'Timeout');
    expect(h.calls).toHaveLength(index + 1);
  }
  test(`two-second attempt deadline interrupts fetch phase ${index}`, attemptTimeoutCase, 5000);
  async function bodyTimeoutCase() {
    const h = harness();
    let cancels = 0;
    const body = new Response(
      new ReadableStream({
        cancel() {
          cancels += 1;
        },
      }),
      { status: [200, 201, 200, 200, 200][index] },
    );
    h.setResponse((at) =>
      Match.value(at === index).pipe(
        Match.when(true, () => body),
        Match.orElse(() => Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] })),
      ),
    );
    expectFailure(await (await h.acquire())(query(), new AbortController().signal), 'Timeout');
    expect(cancels).toBe(1);
    expect(body.body?.locked).toBe(false);
    expect(h.calls).toHaveLength(index + 1);
  }
  test(`two-second attempt deadline interrupts pending body phase ${index}`, bodyTimeoutCase, 5000);
}

for (const axis of ['wall', 'monotonic', 'backward-wall', 'backward-monotonic'] as const) {
  async function clockCase() {
    const h = harness();
    function respond(at: number) {
      const now = Match.value(axis).pipe(
        Match.when('wall', () => ({ wallMs: wall + 6000, monotonicMs: 101 })),
        Match.when('monotonic', () => ({ wallMs: wall + 1, monotonicMs: 6100 })),
        Match.when('backward-wall', () => ({ wallMs: wall - 1, monotonicMs: 101 })),
        Match.when('backward-monotonic', () => ({ wallMs: wall + 1, monotonicMs: 99 })),
        Match.exhaustive,
      );
      h.setClock(now);
      return Response.json(replies()[at]);
    }
    h.setResponse(respond);
    const result = await (await h.acquire())(query(), new AbortController().signal);
    const code = Match.value(axis).pipe(
      Match.when('wall', () => 'Timeout'),
      Match.when('monotonic', () => 'Timeout'),
      Match.orElse(() => 'InvalidResponse'),
    );
    expectFailure(result, code);
    expect(h.calls).toHaveLength(1);
  }
  test(`${axis} clock boundary prevents follow-up requests`, clockCase);
}

async function totalTimeoutCase() {
  const h = harness();
  async function respond(at: number) {
    await Bun.sleep(1300);
    return Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] });
  }
  h.setResponse(respond);
  expectFailure(await (await h.acquire())(query(), new AbortController().signal), 'Timeout');
  expect(h.calls).toHaveLength(5);
}
test(
  'six-second total deadline spans individually sub-two-second requests with no late success',
  totalTimeoutCase,
  10000,
);

async function tokenExpiryDuringLookupCase() {
  const values = replies();
  values[1] = {
    token: 'synthetic-token',
    expires_at: new Date(wall + 1000).toISOString(),
    permissions: { metadata: 'read' },
    repository_selection: 'selected',
    repositories: [{ id: 22 }],
  };
  const h = harness(values);
  function respond(at: number) {
    const nextClock = Match.value(at).pipe(
      Match.when(2, () => ({ wallMs: wall + 1000, monotonicMs: 1100 })),
      Match.orElse(() => ({ wallMs: wall, monotonicMs: 100 })),
    );
    h.setClock(nextClock);
    return Response.json(values[at], { status: [200, 201, 200, 200, 200][at] });
  }
  h.setResponse(respond);
  expectFailure(
    await (
      await h.acquire()
    )(query(), new AbortController().signal),
    'Timeout',
    'token',
  );
  expect(h.calls).toHaveLength(3);
}
test('expiry during repository lookup prevents the next user lookup', tokenExpiryDuringLookupCase);

async function shortLeaseCase() {
  const values = replies();
  values[1] = {
    token: 'synthetic-token',
    expires_at: new Date(wall + 1000).toISOString(),
    permissions: { metadata: 'read' },
    repository_selection: 'selected',
    repositories: [{ id: 22 }],
  };
  const h = harness(values);
  const lease = Result.getOrThrow(await (await h.acquire())(query(), new AbortController().signal));
  expect(lease.evidence.validUntilMs).toBe(wall + 1000);
}
test('token expiry caps the evidence lifetime below six seconds', shortLeaseCase);

async function chunkedSuccessCase() {
  const h = harness();
  const responses: Response[] = [];
  function respond(at: number) {
    const json = encodeJson(replies()[at]);
    const bytes = new TextEncoder().encode(json);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    const response = new Response(body, { status: [200, 201, 200, 200, 200][at] });
    responses.push(response);
    return response;
  }
  h.setResponse(respond);
  expect(Result.isSuccess(await (await h.acquire())(query(), new AbortController().signal))).toBe(
    true,
  );
  for (const response of responses) expect(response.body?.locked).toBe(false);
}
test('valid chunked JSON decodes and releases all five success readers', chunkedSuccessCase);

async function capCase() {
  const h = harness();
  const json = encodeJson(replies()[0]);
  const bytes = new TextEncoder().encode(json.padEnd(1048576, ' '));
  const response = new Response(bytes);
  function respond(at: number) {
    return Match.value(at).pipe(
      Match.when(0, () => response),
      Match.orElse(() => Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] })),
    );
  }
  h.setResponse(respond);
  expect(Result.isSuccess(await (await h.acquire())(query(), new AbortController().signal))).toBe(
    true,
  );
  expect(response.body?.locked).toBe(false);
}
test('exactly one MiB is accepted, not mistaken for oversize', capCase);

for (const [index, field] of [
  [0, 'suspended_at'],
  [0, 'app_id'],
  [0, 'account'],
  [1, 'expires_at'],
  [1, 'permissions'],
  [1, 'repositories'],
  [1, 'repository_selection'],
  [2, 'archived'],
  [2, 'disabled'],
  [2, 'owner'],
  [2, 'name'],
  [3, 'type'],
  [3, 'login'],
  [4, 'user'],
] as const) {
  async function fieldCase() {
    const values = replies();
    const value = values[index];
    const objectSchema = Schema.Record(Schema.String, Schema.Unknown);
    const object = Schema.decodeUnknownSync(objectSchema)(value);
    Reflect.deleteProperty(object, field);
    values[index] = object;
    const h = harness(values);
    expectFailure(
      await (
        await h.acquire()
      )(query(), new AbortController().signal),
      'InvalidResponse',
    );
    expect(h.calls).toHaveLength(index + 1);
  }
  test(`missing ${field} at phase ${index} is invalid, never defaulted`, fieldCase);
}

for (const name of [
  '../escape',
  'https://secret-native.example',
  'a/b',
  'a?token=secret-native',
  '..',
  '%2f',
]) {
  async function unsafeNameCase() {
    const values = replies();
    values[2] = {
      id: 22,
      owner: { id: 33, login: name },
      name: 'repo',
      archived: false,
      disabled: false,
    };
    const h = harness(values);
    expectFailure(
      await (
        await h.acquire()
      )(query(), new AbortController().signal),
      'InvalidResponse',
      'repository',
    );
    expect(h.calls).toHaveLength(3);
  }
  test(`canonical name ${name} cannot alter fixed URL paths`, unsafeNameCase);
}

async function failedCancelAfterLimitCase() {
  const h = harness();
  let cancels = 0;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1048577));
      },
      cancel() {
        cancels += 1;
        return Promise.reject(new Error('secret-native'));
      },
    }),
  );
  h.setResponse(() => response);
  expectFailure(
    await (
      await h.acquire()
    )(query(), new AbortController().signal),
    'TooLarge',
    'body',
  );
  expect(cancels).toBe(1);
  expect(response.body?.locked).toBe(false);
  expect(h.calls).toHaveLength(1);
}
test(
  'rejecting cancellation is awaited without replacing the primary oversize error',
  failedCancelAfterLimitCase,
);

async function finalAbortCase() {
  const h = harness();
  const abort = new AbortController();
  function respond(at: number) {
    const abortNow = Match.value(at).pipe(
      Match.when(4, () => true),
      Match.orElse(() => false),
    );
    const action = Match.value(abortNow).pipe(
      Match.when(true, () => () => abort.abort()),
      Match.orElse(() => () => undefined),
    );
    action();
    return Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] });
  }
  h.setResponse(respond);
  expectFailure(await (await h.acquire())(query(), abort.signal), 'Aborted');
  expect(h.calls).toHaveLength(5);
}
test('abort after final headers cannot produce late successful evidence', finalAbortCase);

async function localBindingCase() {
  for (const field of ['appId', 'installationId', 'ownerId', 'repositoryId']) {
    const input = structuredClone(query());
    Reflect.set(input.policy, field, 999);
    const h = harness();
    expectFailure(
      await (
        await h.acquire()
      )(input, new AbortController().signal),
      'IdentityMismatch',
    );
    expect(h.calls).toHaveLength(0);
  }
}
test('query policy and configured App identities are checked before HTTP', localBindingCase);

async function observationCase() {
  const h = harness();
  function respond(at: number) {
    h.setClock({ wallMs: wall + (at + 1) * 100, monotonicMs: 100 + (at + 1) * 100 });
    return Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] });
  }
  h.setResponse(respond);
  const lease = Result.getOrThrow(await (await h.acquire())(query(), new AbortController().signal));
  expect(lease.startedMonotonicMs).toBe(100);
  expect(lease.evidence.observedAtMs).toBe(wall);
  expect(lease.evidence.checkedAtMs).toBe(wall + 500);
  expect(lease.evidence.validUntilMs).toBe(wall + 6000);
}
test(
  'evidence lifetime starts before installation lookup, not after permission lookup',
  observationCase,
);

async function engineContractCase() {
  const h = harness();
  const service = makeLiveAuthority(await h.acquire());
  const lease = await Effect.runPromise(service.check(query()));
  expect(lease.evidence.basePermission).toBe('write');
  expect(h.calls).toHaveLength(5);
}
test('native adapter lease is accepted by the real engine authority boundary', engineContractCase);

function within<A>(promise: Promise<A>, milliseconds: number) {
  return Promise.race([
    promise,
    Bun.sleep(milliseconds).then(() => ({ _tag: 'StillPending' as const })),
  ]);
}
function installationRequest() {
  return {
    phase: 'installation' as const,
    path: '/app/installations/11',
    token: 'synthetic-token',
  };
}
async function pendingCancelDeadlineCase() {
  const cancellation = deferred<void>();
  const startedCancel = deferred<void>();
  const owned: Promise<void>[] = [];
  let cancels = 0;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancels += 1;
        startedCancel.resolve();
        return cancellation.promise;
      },
    }),
  );
  const running = githubRequest(
    () => Promise.resolve(response),
    new AbortController().signal,
    installationRequest(),
    (settlement) => {
      owned.push(settlement);
    },
  ).then(Result.succeed, Result.fail);
  await startedCancel.promise;
  const atDeadline = await within(running, 200);
  const lockedAtDeadline = response.body?.locked;
  const trackedAtDeadline = owned.length;
  cancellation.resolve();
  await running;
  await Promise.all(owned);
  expectFailure(atDeadline, 'Timeout', 'installation');
  expect(lockedAtDeadline).toBe(true);
  expect(trackedAtDeadline).toBe(1);
  expect(cancels).toBe(1);
  expect(response.body?.locked).toBe(false);
}
test(
  'round1 deadline returns while native reader cancellation is still pending and owned',
  pendingCancelDeadlineCase,
  5000,
);

async function ignoringFetchDeadlineCase() {
  const fetchResult = deferred<Response>();
  const cancellation = deferred<void>();
  const startedCancel = deferred<void>();
  const owned: Promise<void>[] = [];
  let nativeSettled = false;
  let cancels = 0;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancels += 1;
        startedCancel.resolve();
        return cancellation.promise;
      },
    }),
  );
  function own(settlement: Promise<void>) {
    owned.push(
      settlement.finally(() => {
        nativeSettled = true;
      }),
    );
  }
  const running = githubRequest(
    () => fetchResult.promise,
    new AbortController().signal,
    installationRequest(),
    own,
  ).then(Result.succeed, Result.fail);
  const atDeadline = await within(running, 2300);
  const trackedBeforeFetchSettles = owned.length;
  fetchResult.resolve(response);
  await startedCancel.promise;
  const pendingLateCleanup = !nativeSettled && response.body?.locked;
  cancellation.resolve();
  await running;
  await Promise.all(owned);
  expectFailure(atDeadline, 'Timeout', 'installation');
  expect(trackedBeforeFetchSettles).toBe(1);
  expect(pendingLateCleanup).toBe(true);
  expect(nativeSettled).toBe(true);
  expect(cancels).toBe(1);
  expect(response.body?.locked).toBe(false);
}
test(
  'round1 ignoring-abort fetch has finite outcome and its late response cleanup stays owned',
  ignoringFetchDeadlineCase,
  5000,
);

async function pendingCleanupPrimaryCase() {
  const cancellation = deferred<void>();
  const startedCancel = deferred<void>();
  const owned: Promise<void>[] = [];
  const response = new Response(
    new ReadableStream({
      cancel() {
        startedCancel.resolve();
        return cancellation.promise;
      },
    }),
    { status: 403 },
  );
  const running = githubRequest(
    () => Promise.resolve(response),
    new AbortController().signal,
    installationRequest(),
    (settlement) => {
      owned.push(settlement);
    },
  ).then(Result.succeed, Result.fail);
  await startedCancel.promise;
  const beforeCleanup = await within(running, 100);
  cancellation.resolve();
  const final = await running;
  await Promise.all(owned);
  expectFailure(beforeCleanup, 'Denied', 'installation');
  expectFailure(final, 'Denied', 'installation');
  expect(response.body?.locked).toBe(false);
}
test(
  'round1 known primary failure returns without waiting for cancellation settlement',
  pendingCleanupPrimaryCase,
);

async function ownedResourceCase() {
  const h = harness();
  let clockReads = 0;
  const clock = h.options.clock;
  function trackedClock() {
    clockReads += 1;
    return clock();
  }
  h.options.clock = trackedClock;
  const resource = Result.getOrThrow(await makeGitHubAuthorityDriver(h.options));
  expect(typeof resource.driver).toBe('function');
  expect(typeof resource.dispose).toBe('function');
  const fetches: ReturnType<typeof deferred<Response>>[] = [];
  const cancellations: ReturnType<typeof deferred<void>>[] = [];
  const responses: Response[] = [];
  let cancels = 0;
  function respond() {
    const fetched = deferred<Response>();
    fetches.push(fetched);
    return fetched.promise;
  }
  h.setResponse(respond);
  const results = Array.from({ length: 4 }, () =>
    resource.driver(query(), new AbortController().signal),
  );
  const outcomes = await within(Promise.all(results), 2400);
  const callsAtDeadline = h.calls.length;
  const readsAtDeadline = clockReads;
  const signal = new AbortController().signal;
  const saturated = resource.driver(query(), signal);
  const refused = await within(saturated, 100);
  const callsAfterRefusal = h.calls.length;
  let disposed = false;
  const disposing = resource.dispose().finally(() => {
    disposed = true;
  });
  const sameDisposal = resource.dispose();
  const closedCall = resource.driver(query(), signal);
  const afterClose = await within(closedCall, 100);
  for (const fetched of fetches) {
    const cancellation = deferred<void>();
    cancellations.push(cancellation);
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancels += 1;
          return cancellation.promise;
        },
      }),
    );
    responses.push(response);
    fetched.resolve(response);
  }
  while (cancels < 4) await Bun.sleep(1);
  const disposalDuringLateCleanup = disposed;
  const lateLocks = responses.map((response) => response.body?.locked);
  for (const cancellation of cancellations) cancellation.resolve();
  await disposing;
  await sameDisposal;
  expect(Array.isArray(outcomes)).toBe(true);
  for (const outcome of await Promise.all(results)) expectFailure(outcome, 'Timeout');
  expectFailure(refused, 'Unavailable');
  expectFailure(afterClose, 'Aborted');
  expect(callsAtDeadline).toBe(4);
  expect(callsAfterRefusal).toBe(4);
  expect(clockReads).toBe(readsAtDeadline);
  expect(h.calls).toHaveLength(4);
  expect(disposalDuringLateCleanup).toBe(false);
  expect(lateLocks).toEqual([true, true, true, true]);
  expect(cancels).toBe(4);
  for (const response of responses) expect(response.body?.locked).toBe(false);
  expect(disposed).toBe(true);
  expect(resource.dispose()).toBe(sameDisposal);
}
test(
  'round1 owned resource retains four timed-out native slots, refuses new work, and drains late cleanup on disposal',
  ownedResourceCase,
  5000,
);

async function disposalBeforeDeadlineCase() {
  const h = harness();
  const fetched = deferred<Response>();
  const entered = deferred<void>();
  function respond() {
    entered.resolve();
    return fetched.promise;
  }
  h.setResponse(respond);
  const resource = await h.acquireResource();
  const running = resource.driver(query(), new AbortController().signal);
  await entered.promise;
  let disposed = false;
  const disposing = resource.dispose().finally(() => {
    disposed = true;
  });
  const outcome = await within(running, 100);
  const stillOwned = !disposed;
  const stopped = h.calls[0]?.init.signal?.aborted;
  fetched.resolve(Response.json(replies()[0]));
  await disposing;
  expectFailure(outcome, 'Aborted');
  expect(stillOwned).toBe(true);
  expect(stopped).toBe(true);
  expect(h.calls).toHaveLength(1);
}
test(
  'round1 disposal aborts active work promptly but awaits an ignoring fetch until actual settlement',
  disposalBeforeDeadlineCase,
);

async function slotRecoveryCase() {
  const h = harness();
  const pending = Array.from({ length: 4 }, () => deferred<Response>());
  h.setResponse((at) => pending[at]!.promise);
  const resource = await h.acquireResource();
  const attempts = Array.from({ length: 4 }, () =>
    resource.driver(query(), new AbortController().signal),
  );
  const outcomes = await within(Promise.all(attempts), 2400);
  const saturated = resource.driver(query(), new AbortController().signal);
  const rejected = await within(saturated, 100);
  function respondLate(fetched: (typeof pending)[number]) {
    const response = Response.json(replies()[0]);
    fetched.resolve(response);
    return response;
  }
  const lateResponses = pending.map(respondLate);
  while (lateResponses.some((response) => response.body?.locked)) await Bun.sleep(1);
  // The late native chains release their ownership in subsequent microtasks.
  await Bun.sleep(1);
  h.setResponse((at) =>
    Response.json(replies()[(at - 4) % 5], { status: [200, 201, 200, 200, 200][(at - 4) % 5] }),
  );
  const recovered = await resource.driver(query(), new AbortController().signal);
  await resource.dispose();
  expect(Array.isArray(outcomes)).toBe(true);
  expectFailure(rejected, 'Unavailable');
  expect(Result.isSuccess(recovered)).toBe(true);
  expect(h.calls).toHaveLength(9);
}
test(
  'round1 settled native cleanup restores capacity without a cache or permanently closed resource',
  slotRecoveryCase,
  5000,
);

async function totalOutcomeDeadlineCase() {
  const h = harness();
  const finalFetch = deferred<Response>();
  const finalCancel = deferred<void>();
  const lateCancelled = deferred<void>();
  let cancels = 0;
  async function respond(at: number) {
    async function earlierResponse() {
      await Bun.sleep(1100);
      return Response.json(replies()[at], { status: [200, 201, 200, 200, 200][at] });
    }
    return Match.value(at).pipe(
      Match.when(4, () => finalFetch.promise),
      Match.orElse(earlierResponse),
    );
  }
  h.setResponse(respond);
  const resource = await h.acquireResource();
  const started = performance.now();
  const running = resource.driver(query(), new AbortController().signal);
  const outcome = await within(running, 6250);
  const elapsed = performance.now() - started;
  let disposed = false;
  const disposing = resource.dispose().finally(() => {
    disposed = true;
  });
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancels += 1;
        lateCancelled.resolve();
        return finalCancel.promise;
      },
    }),
  );
  finalFetch.resolve(response);
  await lateCancelled.promise;
  const awaitingLateCleanup = !disposed;
  finalCancel.resolve();
  await disposing;
  expectFailure(outcome, 'Timeout');
  expect(elapsed).toBeGreaterThanOrEqual(5900);
  expect(elapsed).toBeLessThan(6250);
  expect(awaitingLateCleanup).toBe(true);
  expect(cancels).toBe(1);
  expect(response.body?.locked).toBe(false);
  expect(h.calls).toHaveLength(5);
}
test(
  'round1 total six-second outcome precedes a still-pending final fetch and late cleanup',
  totalOutcomeDeadlineCase,
  9000,
);
