import { expect } from 'bun:test';

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Layer, Option, Schema } from 'effect';

import { runCli } from '../src/cli.ts';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const json = Schema.fromJsonString(Schema.Unknown);
const encode = Schema.encodeSync(json);
export function webhookSecret() {
  return 'synthetic-webhook-secret-not-a-real-key';
}
export function policy() {
  return {
    revision: 'local-1',
    ingressScopeId: 'test-app',
    appId: 77,
    installationId: 11,
    ownerId: 33,
    repositoryId: 22,
    profile: { _tag: 'Enabled', profileId: 'foldkit', profileRevision: 'profile-1' },
    policyRevision: 'policy-1',
    allowedOperatorIds: [66],
  };
}
async function syntheticKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
}
function setup() {
  function* acquire() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'leviathan-app-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.chmod(root, 0o700);
    const ownerUid = Option.getOrThrow((yield* fs.stat(root)).uid);
    const host = {
      ownerUid,
      homeDirectory: root,
      cwd: root,
      temporaryRoots: [],
      repositoryRoots: [],
      buildRoots: [],
      syncedRoots: [],
      ownedTemporaryRoot: root,
    };
    const config = {
      policy: policy(),
      stateRoot: root,
      webhookSecretFile: `${root}/secret`,
      privateKeyFile: `${root}/key`,
    };
    const configFile = `${root}/config.json`;
    const privateKey = yield* Effect.promise(syntheticKey);
    yield* fs.writeFileString(configFile, encode(config));
    yield* fs.writeFileString(config.webhookSecretFile, webhookSecret(), { mode: 0o600 });
    yield* fs.writeFileString(config.privateKeyFile, privateKey, { mode: 0o600 });
    return { root, config, configFile, host, fs };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
export type Fixture = Effect.Success<ReturnType<typeof setup>>;
export function withFixture(run: (fixture: Fixture) => Promise<void>) {
  function* exercise() {
    const fixture = yield* setup();
    yield* Effect.promise(() => run(fixture));
  }
  const program = Effect.gen(exercise);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  return provided;
}
export function argv(fixture: Fixture, command: string) {
  return [command, '--config', fixture.configFile];
}
export async function initialize(fixture: Fixture) {
  await runCli(argv(fixture, 'init'), { host: fixture.host, silent: true });
}
export function payload(commentId = 55, operatorId = 66) {
  return {
    action: 'created',
    installation: { id: 11 },
    repository: { id: 22, name: 'repository', owner: { id: 33, login: 'owner' } },
    issue: { id: 44, number: 1 },
    comment: { id: commentId, body: '/leviathan assess', user: { id: operatorId, type: 'User' } },
    sender: { id: operatorId, type: 'User' },
  };
}
export async function webhook(
  body = payload(),
  delivery = 'delivery-55',
  event = 'issue_comment',
  signal?: AbortSignal,
) {
  const text = encode(body);
  const bytes = new TextEncoder().encode(text);
  const secretBytes = new TextEncoder().encode(webhookSecret());
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return new Request('http://127.0.0.1/webhook', {
    method: 'POST',
    body: text,
    signal,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': delivery,
      'x-hub-signature-256': `sha256=${signature}`,
    },
  });
}
export function api() {
  const calls: string[] = [];
  async function fetch(url: string, init: RequestInit) {
    calls.push(new URL(url).pathname);
    const responses = [
      { id: 11, app_id: 77, account: { id: 33 }, suspended_at: null },
      {
        token: 'synthetic-token',
        expires_at: '2100-01-01T00:00:00Z',
        permissions: { metadata: 'read' },
        repository_selection: 'selected',
        repositories: [{ id: 22 }],
      },
      {
        id: 22,
        owner: { id: 33, login: 'renamed-owner' },
        name: 'renamed-repo',
        archived: false,
        disabled: false,
      },
      { id: 66, login: 'renamed-human', type: 'User' },
      { permission: 'write', user: { id: 66 } },
    ];
    const index = (calls.length - 1) % 5;
    const status = [200, 201, 200, 200, 200][index];
    expect(init.signal).toBeDefined();
    expect(init.redirect).toBe('manual');
    return Response.json(responses[index], { status });
  }
  return { calls, fetch };
}
