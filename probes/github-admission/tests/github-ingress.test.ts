import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';

import { AdmissionReply, AuthorityState } from '@leviathan/domain';
import * as Engine from '@leviathan/engine';
import { Effect, ManagedRuntime, Match, Result, Schema, Struct } from 'effect';

import { openAdmissionProbe, type ProbeConfig } from '../src/composition.ts';
import { authorityFixture } from '../src/fixture.ts';
import { cleanFiles, fileFixture } from './native-files.test.ts';

const fixture = { secret: 'synthetic-task5-secret' };
const apps: Array<{ dispose(): Promise<void> }> = [];
const networkSpies: Array<{ mockRestore(): void; mock: { calls: unknown[] } }> = [];
function forbidNetwork() {
  const forbiddenFetch = Object.assign(
    () => {
      throw new TypeError('outbound fetch forbidden');
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  networkSpies.push(spyOn(globalThis, 'fetch').mockImplementation(forbiddenFetch));
  networkSpies.push(
    spyOn(Bun, 'serve').mockImplementation(() => {
      throw new TypeError('listener forbidden');
    }),
  );
}
beforeEach(forbidNetwork);
async function cleanupApps() {
  for (const app of apps.splice(0)) await app.dispose();
}
function restoreSpies() {
  const counts = networkSpies.map((spy) => spy.mock.calls.length);
  for (const spy of networkSpies.splice(0)) spy.mockRestore();
  mock.restore();
  cleanFiles();
  expect(counts).toEqual([0, 0]);
}
afterEach(() => cleanupApps().finally(restoreSpies));

function payload() {
  return {
    action: 'created',
    installation: { id: 11 },
    repository: { id: 22, name: 'repository', owner: { id: 33, login: 'owner' } },
    issue: { id: 44, number: 1 },
    comment: { id: 55, body: '/leviathan assess', user: { id: 66, type: 'User' } },
    sender: { id: 66, type: 'User' },
  };
}
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function encodedPayload() {
  return encode(payload());
}
async function signed(
  body: string | Uint8Array = encodedPayload(),
  deliveryId = 'delivery-1',
  eventName = 'issue_comment',
) {
  const bytes = Match.value(body).pipe(
    Match.when(Match.string, (value) => new TextEncoder().encode(value)),
    Match.orElse((value) => new Uint8Array(value)),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(fixture.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return new Request('http://leviathan.invalid/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': eventName,
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body: bytes,
  });
}
async function opened(
  initialAuthority = authorityFixture().state,
  overrides: Partial<ProbeConfig> = {},
) {
  const file = fileFixture();
  const app = await openAdmissionProbe({
    file,
    create: true,
    ingressScopeId: 'fixture-app',
    initialAuthority,
    secret: fixture.secret,
    limits: { decisions: 256, receipts: 1024, authorityRevisions: 256 },
    nowMs: () => 1000,
    ...overrides,
  });
  apps.push(app);
  return { app, file };
}
function counts(file: string) {
  const db = new Database(file, { readonly: true });
  const read = Result.try(() =>
    ['decisions', 'receipts'].map((table) => db.query(`SELECT count(*) AS n FROM ${table}`).get()),
  );
  db.close();
  return Result.getOrThrow(read);
}
async function authorised() {
  const runtime = spyOn(ManagedRuntime, 'make');
  const close = spyOn(Database.prototype, 'close');
  const { app, file } = await opened();
  const response = await app.fetch(await signed());
  expect(response.status).toBe(200);
  const reply = Schema.decodeUnknownSync(AdmissionReply)(await response.json());
  expect(reply).toMatchObject({
    _tag: 'Recorded',
    record: { decision: { _tag: 'AdmittedPreview' } },
  });
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
  await app.dispose();
  await app.dispose();
  expect(runtime).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(2);
}
test('signed authorised command persists one preview', authorised);
async function tampered() {
  let admissionCallCount = 0;
  const makeAdmission = Engine.makeCommandAdmission;
  const admissionSpy = spyOn(Engine, 'makeCommandAdmission').mockImplementation(() =>
    makeAdmission().pipe(
      Effect.map((service) => ({
        admit: (command: unknown) => {
          admissionCallCount++;
          return service.admit(command);
        },
      })),
    ),
  );
  const { app, file } = await opened();
  const request = await signed();
  const bytes = new Uint8Array(await request.arrayBuffer());
  bytes[bytes.length - 1] ^= 1;
  const response = await app.fetch(
    new Request(request.url, { method: 'POST', headers: request.headers, body: bytes }),
  );
  expect(response.status).toBe(401);
  expect(admissionCallCount).toBe(0);
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
  admissionSpy.mockRestore();
}
test('tampered bytes never call admission', tampered);
async function renamedReplay() {
  const { app, file } = await opened();
  const original = await (await app.fetch(await signed())).json();
  const renamed = payload();
  renamed.repository.name = 'renamed';
  const response = await app.fetch(await signed(encode(renamed), 'delivery-2'));
  expect(await response.json()).toMatchObject({ _tag: 'Duplicate', record: original.record });
  expect(counts(file)).toEqual([{ n: 1 }, { n: 2 }]);
}
test('renamed replay is historical', renamedReplay);
async function revoked() {
  const authority = authorityFixture().state;
  const revokedAuthority = Struct.evolve(authority, { access: () => 'Revoked' as const });
  const { app, file } = await opened(revokedAuthority);
  const response = await app.fetch(await signed());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    _tag: 'Recorded',
    record: { decision: { _tag: 'Rejected', reason: 'AccessRevoked' } },
  });
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
}
test('revoked new comment cannot admit', revoked);

const payloadCases: Array<{
  name: string;
  change(value: ReturnType<typeof payload>): void;
  status: number;
  reason: string;
}> = [
  {
    name: 'unsafe id',
    change: (v) => {
      v.comment.id = Number.MAX_SAFE_INTEGER + 1;
    },
    status: 400,
    reason: 'MalformedInput',
  },
  {
    name: 'zero id',
    change: (v) => {
      v.installation.id = 0;
    },
    status: 400,
    reason: 'MalformedInput',
  },
  {
    name: 'author mismatch',
    change: (v) => {
      v.sender.id = 67;
    },
    status: 400,
    reason: 'MalformedInput',
  },
  {
    name: 'bot sender',
    change: (v) => {
      v.sender.type = 'Bot';
    },
    status: 200,
    reason: 'BotActor',
  },
  {
    name: 'bot author',
    change: (v) => {
      v.comment.user.type = 'Bot';
    },
    status: 200,
    reason: 'BotActor',
  },
  {
    name: 'edited action',
    change: (v) => {
      v.action = 'edited';
    },
    status: 200,
    reason: 'UnsupportedAction',
  },
  {
    name: 'oversize comment',
    change: (v) => {
      v.comment.body = 'x'.repeat(4097);
    },
    status: 413,
    reason: 'FieldTooLarge',
  },
  {
    name: 'oversize display',
    change: (v) => {
      v.repository.name = 'x'.repeat(256);
    },
    status: 413,
    reason: 'FieldTooLarge',
  },
  {
    name: 'control display',
    change: (v) => {
      v.repository.name = 'bad\nname';
    },
    status: 400,
    reason: 'MalformedInput',
  },
];
async function payloadCase({ change, status, reason }: (typeof payloadCases)[number]) {
  const { app, file } = await opened();
  const value = payload();
  change(value);
  const response = await app.fetch(await signed(encode(value)));
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ _tag: 'Unrecorded', decision: { reason } });
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test.each(payloadCases)('$name cannot reach admission', payloadCase);

async function exactVariant(body: string) {
  const { app, file } = await opened();
  const value = payload();
  value.comment.body = body;
  const response = await app.fetch(await signed(encode(value)));
  expect(await response.json()).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'NotCommand' },
  });
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test.each([
  ' /leviathan assess',
  '/leviathan assess\n',
  '/leviathan assess extra',
  '/Leviathan assess',
  '`/leviathan assess`',
  '> /leviathan assess',
  'private ordinary conversation',
])('exact command variant %s is ignored', exactVariant);

const headerCases = [
  { header: 'x-hub-signature-256', value: '', status: 401 },
  { header: 'x-hub-signature-256', value: 'sha256=00', status: 401 },
  { header: 'x-github-delivery', value: '', status: 400 },
  { header: 'x-github-event', value: '', status: 400 },
  { header: 'x-github-delivery', value: 'x'.repeat(129), status: 413 },
  { header: 'x-github-event', value: 'x'.repeat(129), status: 413 },
  { header: 'content-type', value: 'text/plain', status: 415 },
  { header: 'content-length', value: 'not-numeric', status: 400 },
  { header: 'content-length', value: '65537', status: 413 },
];
async function headerCase({ header, value, status }: (typeof headerCases)[number]) {
  const { app, file } = await opened();
  const request = await signed();
  request.headers.set(header, value);
  const response = await app.fetch(request);
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ _tag: 'IngressFailure' });
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test.each(headerCases)('header $header=$value returns $status', headerCase);
async function unsupportedEvent(event: string) {
  const { app, file } = await opened();
  const response = await app.fetch(await signed('{}', 'delivery-1', event));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    _tag: 'Unrecorded',
    decision: { _tag: 'Ignored', reason: 'UnsupportedEvent' },
  });
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test.each(['ping', 'issues', 'push'])(
  'unsupported event %s is explicitly ignored',
  unsupportedEvent,
);
async function malformedJson(body: string) {
  const { app, file } = await opened();
  const response = await app.fetch(await signed(body));
  expect(response.status).toBe(400);
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test.each(['{', 'null', '[]', '42', '{}'])('malformed native payload %s', malformedJson);
async function invalidUtf8() {
  const { app, file } = await opened();
  const bytes = new TextEncoder().encode(encodedPayload().replace('repository', 'repositXry'));
  bytes[bytes.indexOf(88)] = 255;
  expect((await app.fetch(await signed(bytes))).status).toBe(400);
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test('invalid UTF8 cannot be repaired by SDK replacement decoding', invalidUtf8);
async function pullRequestComment() {
  const { app, file } = await opened();
  const value = payload();
  const issue = { ...value.issue, pull_request: {} };
  const response = await app.fetch(await signed(encode({ ...value, issue })));
  expect(await response.json()).toMatchObject({ decision: { reason: 'PullRequestComment' } });
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test('ordinary issue gate excludes pull request comments', pullRequestComment);
async function transportConflict() {
  const { app, file } = await opened();
  expect((await app.fetch(await signed())).status).toBe(200);
  const response = await app.fetch(await signed(`${encodedPayload()} `));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'DeliveryConflict' },
  });
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
}
test('same delivery with changed bytes conflicts without overwrite', transportConflict);
async function capacity() {
  const { app, file } = await opened(authorityFixture().state, {
    limits: { decisions: 1, receipts: 1, authorityRevisions: 1 },
  });
  const first = await (await app.fetch(await signed())).json();
  expect((await app.fetch(await signed())).status).toBe(200);
  const changed = payload();
  changed.comment.id++;
  const response = await app.fetch(await signed(encode(changed), 'delivery-2'));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ decision: { reason: 'CapacityExceeded' } });
  expect(first).toMatchObject({ _tag: 'Recorded' });
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
}
test('capacity refuses new work while identical delivery remains historical', capacity);
async function storageFailure() {
  const fault = () => {
    throw new TypeError('private storage exception');
  };
  function inject(point: string) {
    return Match.value(point).pipe(
      Match.when('AfterDecision', fault),
      Match.orElse(() => undefined),
    );
  }
  const { app, file } = await opened(authorityFixture().state, { fault: inject });
  const response = await app.fetch(await signed());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private storage exception');
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test('native transaction failure never acknowledges partial recording', storageFailure);
async function expiry() {
  const { app, file } = await opened(authorityFixture().state, { nowMs: () => 2000 });
  const response = await app.fetch(await signed());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    record: { decision: { reason: 'AuthorityExpired' } },
  });
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
}
test('exclusive authority expiry records refusal rather than admission', expiry);

async function heldRequest(original: Request) {
  const bytes = new Uint8Array(await original.arrayBuffer());
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      entered.resolve();
      await release.promise;
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    request: new Request(original.url, { method: 'POST', headers: original.headers, body }),
    bytes,
    entered: entered.promise,
    release: () => release.resolve(),
  };
}
async function overlappingRequests() {
  const { app, file } = await opened();
  const secondPayload = payload();
  secondPayload.comment.id = 56;
  const first = await heldRequest(await signed());
  const second = await heldRequest(await signed(encode(secondPayload), 'delivery-2'));
  const firstResponse = app.fetch(first.request);
  const secondResponse = app.fetch(second.request);
  await first.entered;
  await second.entered;
  second.release();
  expect((await secondResponse).status).toBe(200);
  first.release();
  expect((await firstResponse).status).toBe(200);
  const db = new Database(file, { readonly: true });
  const rows = db
    .query<{ verified: string }, []>('SELECT verified FROM receipts ORDER BY decision_id')
    .all();
  db.close();
  const stored = Schema.Struct({
    receipt: Schema.Struct({ deliveryId: Schema.String, rawBodyDigest: Schema.String }),
    candidate: Schema.Struct({ commentId: Schema.Number }),
  });
  const storedJson = Schema.fromJsonString(stored);
  const decode = Schema.decodeUnknownSync(storedJson);
  const decoded = rows.map((row) => decode(row.verified));
  for (const [held, delivery, comment] of [
    [first, 'delivery-1', 55],
    [second, 'delivery-2', 56],
  ] as const) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', held.bytes));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(decoded).toContainEqual({
      receipt: { deliveryId: delivery, rawBodyDigest: hex },
      candidate: { commentId: comment },
    });
  }
  expect(counts(file)).toEqual([{ n: 2 }, { n: 2 }]);
}
test(
  'interleaved captured bodies keep delivery digest and command identity request-local',
  overlappingRequests,
);
async function abortAfterCommit() {
  const abort = new AbortController();
  function fault(point: string) {
    return Match.value(point).pipe(
      Match.when('AfterCommit', () => abort.abort()),
      Match.orElse(() => undefined),
    );
  }
  const { app, file } = await opened(authorityFixture().state, { fault });
  const original = await signed();
  const request = new Request(original, { signal: abort.signal });
  const response = await app.fetch(request);
  expect(abort.signal.aborted).toBe(true);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ _tag: 'Recorded' });
  expect(await (await app.fetch(await signed())).json()).toMatchObject({ _tag: 'Duplicate' });
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
}
test('abort after synchronous commit cannot undo or deny the committed request', abortAfterCommit);
async function abortedIngress() {
  const { app, file } = await opened();
  const abort = new AbortController();
  const entered = Promise.withResolvers<void>();
  let cancelled = 0;
  const original = await signed();
  const body = new ReadableStream<Uint8Array>({
    pull() {
      entered.resolve();
    },
    cancel() {
      cancelled++;
    },
  });
  const request = new Request(original.url, {
    method: 'POST',
    headers: original.headers,
    body,
    signal: abort.signal,
  });
  const response = app.fetch(request);
  await entered.promise;
  abort.abort();
  expect((await response).status).toBe(400);
  expect(cancelled).toBe(1);
  expect(body.locked).toBe(false);
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test('abort during ingress capture cancels without admission', abortedIngress);
async function streamedOverflow() {
  const { app, file } = await opened();
  let cancelled = 0;
  const original = await signed();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(65536));
      c.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled++;
    },
  });
  const response = await app.fetch(
    new Request(original.url, { method: 'POST', headers: original.headers, body }),
  );
  expect(response.status).toBe(413);
  expect(cancelled).toBe(1);
  expect(body.locked).toBe(false);
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test('streamed overflow through application never enters admission', streamedOverflow);
async function callbackThrows() {
  const original = Engine.makeCommandAdmission;
  function malicious(): never {
    throw new TypeError('private callback exception');
  }
  spyOn(Engine, 'makeCommandAdmission').mockImplementation(() =>
    original().pipe(Effect.map(() => ({ admit: malicious }))),
  );
  const diagnostic = spyOn(console, 'error');
  const { app, file } = await opened();
  const response = await app.fetch(await signed());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private callback exception');
  expect(diagnostic).not.toHaveBeenCalled();
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test('thrown admission callback yields sanitized 503 without SDK error logging', callbackThrows);
async function persistedRedaction() {
  const diagnostic = spyOn(console, 'error');
  const { app, file } = await opened();
  const ordinary = payload();
  ordinary.comment.body = 'private ordinary conversation';
  const ignored = await app.fetch(await signed(encode(ordinary)));
  const acceptedRequest = await signed(encodedPayload(), 'delivery-2');
  const signature = acceptedRequest.headers.get('x-hub-signature-256')!;
  const accepted = await app.fetch(acceptedRequest);
  const responses = (await ignored.text()) + (await accepted.text());
  const db = new Database(file, { readonly: true });
  const content = encode(
    ['decisions', 'receipts', 'authority'].map((table) => db.query(`SELECT * FROM ${table}`).all()),
  );
  db.close();
  for (const forbidden of [
    fixture.secret,
    signature,
    ordinary.comment.body,
    'private callback exception',
    'private storage exception',
  ]) {
    expect(content).not.toContain(forbidden);
    expect(responses).not.toContain(forbidden);
  }
  expect(diagnostic).not.toHaveBeenCalled();
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
}
test(
  'rows responses and logs omit secrets signatures raw conversation and exception text',
  persistedRedaction,
);

const authorityCases = [
  {
    name: 'denied operator',
    change: (a: ReturnType<typeof authorityFixture>['state']) =>
      Struct.evolve(a, { allowedOperatorIds: () => [77] }),
    reason: 'OperatorDenied',
  },
  {
    name: 'wrong repository',
    change: (a: ReturnType<typeof authorityFixture>['state']) =>
      Struct.evolve(a, { repositoryId: () => 23 }),
    reason: 'IdentityMismatch',
  },
  {
    name: 'wrong owner',
    change: (a: ReturnType<typeof authorityFixture>['state']) =>
      Struct.evolve(a, { ownerId: () => 34 }),
    reason: 'IdentityMismatch',
  },
  {
    name: 'wrong installation',
    change: (a: ReturnType<typeof authorityFixture>['state']) =>
      Struct.evolve(a, { installationId: () => 12 }),
    reason: 'IdentityMismatch',
  },
  {
    name: 'future authority',
    change: (a: ReturnType<typeof authorityFixture>['state']) =>
      Struct.evolve(a, { observedAtMs: () => 1001 }),
    reason: 'InvalidAuthority',
  },
];
async function authorityCase({ change, reason }: (typeof authorityCases)[number]) {
  const { app, file } = await opened(change(authorityFixture().state));
  const response = await app.fetch(await signed());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    _tag: 'Recorded',
    record: { decision: { _tag: 'Rejected', reason } },
  });
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
}
test.each(authorityCases)('$name records business refusal', authorityCase);
async function unavailableAuthority() {
  const { app } = await opened(authorityFixture().state, {
    initialAuthority: { _tag: 'Unavailable', revision: 'unavailable-1' },
  });
  const response = await app.fetch(await signed());
  expect(await response.json()).toMatchObject({
    record: { decision: { reason: 'AuthorityUnavailable' } },
  });
}
test('unavailable trusted authority cannot admit', unavailableAuthority);
async function profileUnavailable(tag: 'Disabled' | 'Unknown') {
  const authority = Struct.evolve(authorityFixture().state, { profile: () => ({ _tag: tag }) });
  const { app } = await opened(authorityFixture().state, { initialAuthority: authority });
  expect(await (await app.fetch(await signed())).json()).toMatchObject({
    record: { decision: { reason: 'ProfileUnavailable' } },
  });
}
test.each(['Disabled', 'Unknown'] as const)('profile %s cannot admit', profileUnavailable);
async function authorityRevisionRace() {
  const file = fileFixture();
  let changed = false;
  const next = Struct.evolve(authorityFixture().state, { revision: () => 'authority-2' });
  const authorityJson = Schema.fromJsonString(AuthorityState);
  const encodeAuthority = Schema.encodeSync(authorityJson);
  function changeAuthority() {
    const admin = new Database(file, { readwrite: true });
    function install() {
      admin
        .query('INSERT INTO authority_revisions(scope,revision) VALUES (?,?)')
        .run('fixture-app', next.revision);
      admin
        .query('UPDATE authority SET revision=?, snapshot=? WHERE scope=?')
        .run(next.revision, encodeAuthority(next), 'fixture-app');
    }
    admin.transaction(install).immediate();
    admin.close();
    changed = true;
    return 1000;
  }
  function nowMs() {
    return Match.value(changed).pipe(
      Match.when(false, changeAuthority),
      Match.orElse(() => 1000),
    );
  }
  const { app } = await opened(authorityFixture().state, { file, nowMs });
  const response = await app.fetch(await signed());
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    _tag: 'Unrecorded',
    decision: { reason: 'AuthorityChanged' },
  });
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test(
  'authority revision changed between observation and commit refuses stale preview',
  authorityRevisionRace,
);
async function exactBodyLimit() {
  const { app, file } = await opened();
  const body = encodedPayload();
  const padded = body + ' '.repeat(65536 - new TextEncoder().encode(body).length);
  expect((await app.fetch(await signed(padded))).status).toBe(200);
  expect(counts(file)).toEqual([{ n: 1 }, { n: 1 }]);
}
test('signed exact 65536-byte original body remains admissible', exactBodyLimit);
async function streamReadFailure() {
  const { app, file } = await opened();
  const original = await signed();
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      c.error(new TypeError('private stream exception'));
    },
  });
  const response = await app.fetch(
    new Request(original.url, { method: 'POST', headers: original.headers, body }),
  );
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain('private stream exception');
  expect(body.locked).toBe(false);
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test(
  'stream read rejection through application does not admit or leak raw exception',
  streamReadFailure,
);
async function disposePendingCapture() {
  const { app, file } = await opened();
  const original = await signed();
  const entered = Promise.withResolvers<void>();
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      entered.resolve();
    },
    cancel() {
      cancelled++;
    },
  });
  const pending = app.fetch(
    new Request(original.url, { method: 'POST', headers: original.headers, body }),
  );
  await entered.promise;
  await app.dispose();
  expect((await pending).status).toBe(503);
  expect(cancelled).toBe(1);
  expect(body.locked).toBe(false);
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test(
  'application disposal interrupts pending capture and releases owned reader',
  disposePendingCapture,
);
async function disposeHeldCancellation({
  settlement,
  status,
  code,
}: {
  settlement: 'resolve' | 'reject';
  status: number;
  code: string;
}) {
  const { app, file } = await opened();
  const original = await signed();
  const pulled = Promise.withResolvers<void>();
  const cancellationEntered = Promise.withResolvers<void>();
  const cancellation = Promise.withResolvers<void>();
  let cancellations = 0;
  let disposed = false;
  let responseSettled = false;
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
  function finishResponse(response: Response) {
    responseSettled = true;
    return response;
  }
  const pending = app
    .fetch(new Request(original.url, { method: 'POST', headers: original.headers, body }))
    .then(finishResponse);
  await pulled.promise;
  const disposal = app.dispose().then(() => {
    disposed = true;
  });
  await cancellationEntered.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const beforeRelease = { disposed, responseSettled, locked: body.locked, cancellations };
  function settleCancellation() {
    return Match.value(settlement).pipe(
      Match.when('reject', () => cancellation.reject(new TypeError('private held cancel failure'))),
      Match.orElse(() => cancellation.resolve()),
    );
  }
  settleCancellation();
  const response = await pending;
  await disposal;
  expect(beforeRelease).toEqual({
    disposed: false,
    responseSettled: false,
    locked: true,
    cancellations: 1,
  });
  expect(body.locked).toBe(false);
  expect(disposed).toBe(true);
  expect(response.status).toBe(status);
  const responseBody = await response.text();
  expect(responseBody).not.toContain('private held cancel failure');
  expect(responseBody).toContain(code);
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test.each([
  { settlement: 'resolve' as const, status: 503, code: 'OperationalFailure' },
  { settlement: 'reject' as const, status: 400, code: 'ReadFailed' },
])(
  'disposal owns reader until held asynchronous cancellation settles: $settlement',
  disposeHeldCancellation,
);
async function sdkOperationalFailure() {
  const { app, file } = await opened();
  const request = await signed();
  const diagnostic = spyOn(console, 'error').mockImplementation(() => undefined);
  spyOn(crypto.subtle, 'importKey').mockImplementation(() =>
    Promise.reject(new TypeError('private SDK key exception')),
  );
  const response = await app.fetch(request);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private SDK key exception');
  expect(diagnostic).not.toHaveBeenCalled();
  expect(counts(file)).toEqual([{ n: 0 }, { n: 0 }]);
}
test('SDK operational exception is sanitized without default error logging', sdkOperationalFailure);
async function constructionSnapshot() {
  const options: ProbeConfig = {
    file: fileFixture(),
    create: true,
    secret: fixture.secret,
    ingressScopeId: 'fixture-app',
    initialAuthority: authorityFixture().state,
    limits: { decisions: 256, receipts: 1024, authorityRevisions: 256 },
    nowMs: () => 1000,
  };
  const app = await openAdmissionProbe(options);
  apps.push(app);
  Reflect.set(options, 'secret', 'mutated-secret');
  Reflect.set(options, 'ingressScopeId', 'mutated-scope');
  Reflect.set(options, 'nowMs', () => 9999);
  Reflect.set(options.limits, 'decisions', 0);
  Reflect.set(options.initialAuthority!, 'access', 'Revoked');
  const response = await app.fetch(await signed());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    record: { decision: { _tag: 'AdmittedPreview' } },
  });
}
test(
  'application snapshots trusted config and callable identities at construction',
  constructionSnapshot,
);
