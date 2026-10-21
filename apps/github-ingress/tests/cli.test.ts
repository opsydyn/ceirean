import { expect, spyOn, test } from 'bun:test';

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { ConfigProvider, Effect, FileSystem, Layer, Option, Schema } from 'effect';

import { runCli } from '../src/cli.ts';
import { nativeHostContext } from '../src/composition.ts';
import { argv, initialize, withFixture, type Fixture } from './fixtures.ts';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const json = Schema.fromJsonString(Schema.Unknown);
const encode = Schema.encodeSync(json);
function* exercise() {
  const fs = yield* FileSystem.FileSystem;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'leviathan-cli-' });
  const root = yield* fs.realPath(temporary);
  yield* fs.chmod(root, 0o700);
  const uid = Option.getOrThrow((yield* fs.stat(root)).uid);
  const host = {
    ownerUid: uid,
    homeDirectory: root,
    cwd: root,
    temporaryRoots: [],
    repositoryRoots: [],
    buildRoots: [],
    syncedRoots: [],
    ownedTemporaryRoot: root,
  };
  const file = `${root}/config.json`;
  const policy = {
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
  const config = {
    policy,
    stateRoot: root,
    webhookSecretFile: `${root}/missing-secret`,
    privateKeyFile: `${root}/missing-key`,
  };
  async function nativeInvoke(command: string, extra: string[] = []) {
    return runCli([command, '--config', file, ...extra], { host, silent: true });
  }
  yield* fs.writeFileString(file, encode(config));
  expect((yield* Effect.promise(() => nativeInvoke('init'))).output).toEqual({
    _tag: 'Initialized',
  });
  const status = yield* Effect.promise(() => nativeInvoke('status'));
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0, revision: 'local-1' });
  const next = { ...config, policy: { ...policy, revision: 'local-2' } };
  yield* fs.writeFileString(file, encode(next));
  expect(
    (yield* Effect.promise(() => nativeInvoke('configure', ['--expected-revision', 'wrong'])))
      .output,
  ).toEqual({ _tag: 'Refused', reason: 'AuthorityChanged' });
  expect(
    (yield* Effect.promise(() => nativeInvoke('configure', ['--expected-revision', 'local-1'])))
      .output,
  ).toEqual({ _tag: 'Installed' });
  expect((yield* Effect.promise(() => nativeInvoke('status'))).output).toMatchObject({
    decisions: 0,
    receipts: 0,
    revision: 'local-2',
  });
  yield* Effect.promise(async () => {
    await expect(runCli(['start', '--config', file], { host, silent: true })).rejects.toBeDefined();
  });
  const mode = (yield* fs.stat(`${root}/github-admission.sqlite`)).mode & 0o777;
  expect(mode).toBe(0o600);
}
const workflow = Effect.gen(exercise);
const scoped = workflow.pipe(Effect.scoped);
const program = Effect.provide(scoped, platform);
test('init/status/configure use only config and state; configure is revision-checked', async () => {
  await Effect.runPromise(program);
});

async function paths(fixture: Fixture) {
  const alternate = `${fixture.root}/custom.sqlite`;
  const initialized = await runCli([...argv(fixture, 'init'), '--database', alternate], {
    host: fixture.host,
    silent: true,
  });
  expect(initialized.output).toEqual({ _tag: 'Initialized' });
  const status = await runCli([...argv(fixture, 'status'), '--database', alternate], {
    host: fixture.host,
    silent: true,
  });
  expect(status.output).toMatchObject({ revision: 'local-1', decisions: 0, receipts: 0 });
  const missing = runCli(argv(fixture, 'start'), { host: fixture.host, silent: true });
  await expect(missing).rejects.toBeDefined();
  expect(
    await Effect.runPromise(fixture.fs.exists(`${fixture.root}/github-admission.sqlite`)),
  ).toBe(false);
  const outside = runCli(
    [...argv(fixture, 'init'), '--database', `${fixture.root}-outside.sqlite`],
    { host: fixture.host, silent: true },
  );
  await expect(outside).rejects.toBeDefined();
  const empty = `${fixture.root}/empty.sqlite`;
  await Effect.runPromise(fixture.fs.writeFileString(empty, '', { mode: 0o600 }));
  const incompatible = runCli([...argv(fixture, 'start'), '--database', empty], {
    host: fixture.host,
    silent: true,
  });
  await expect(incompatible).rejects.toBeDefined();
  const emptyText = await Effect.runPromise(fixture.fs.readFileString(empty));
  expect(emptyText).toBe('');
  const { ownedTemporaryRoot: _testOnly, ...productionHost } = fixture.host;
  const production = runCli([...argv(fixture, 'status'), '--database', alternate], {
    host: productionHost,
    silent: true,
  });
  await expect(production).rejects.toBeDefined();
}
async function pathQualification() {
  const program = withFixture(paths);
  await Effect.runPromise(program);
}
test(
  'database override is contained, missing/empty ledgers never initialize on start, production cannot select temporary bypass',
  pathQualification,
);

async function symlinks(fixture: Fixture) {
  await initialize(fixture);
  const link = `${fixture.root}/key-link`;
  const create = fixture.fs.symlink(fixture.config.privateKeyFile, link);
  await Effect.runPromise(create);
  const linked = { ...fixture.config, privateKeyFile: link };
  const text = encode(linked);
  const write = fixture.fs.writeFileString(fixture.configFile, text);
  await Effect.runPromise(write);
  const opening = runCli(argv(fixture, 'start'), { host: fixture.host, silent: true });
  await expect(opening).rejects.toBeDefined();
  const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  expect(status.output).toMatchObject({ decisions: 0, receipts: 0 });
  const parentLink = `${fixture.root}/linked-parent`;
  await Effect.runPromise(fixture.fs.symlink(fixture.root, parentLink));
  const parent = { ...fixture.config, stateRoot: parentLink };
  const parentText = encode(parent);
  await Effect.runPromise(fixture.fs.writeFileString(fixture.configFile, parentText));
  const unsafe = runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
  await expect(unsafe).rejects.toBeDefined();
}
async function symlinkQualification() {
  const program = withFixture(symlinks);
  await Effect.runPromise(program);
}
test(
  'credential and state-root symlinks are refused without mutating replay state',
  symlinkQualification,
);

async function hostPaths(fixture: Fixture) {
  const cwd = spyOn(process, 'cwd').mockReturnValue(fixture.root);
  const environment = ConfigProvider.fromUnknown({ HOME: fixture.root, TMPDIR: fixture.root });
  const hostPlatform = Layer.merge(platform, ConfigProvider.layer(environment));
  const acquisition = nativeHostContext();
  const provided = Effect.provide(acquisition, hostPlatform);
  async function exercise() {
    const homeInvocation = await Effect.runPromise(provided);
    expect(homeInvocation.repositoryRoots).toEqual([]);
    expect(homeInvocation.buildRoots).toContain(`${fixture.root}/dist`);
    expect(homeInvocation.temporaryRoots).toContain(fixture.root);
    const createMarker = fixture.fs.makeDirectory(`${fixture.root}/.git`);
    await Effect.runPromise(createMarker);
    const projectInvocation = await Effect.runPromise(provided);
    expect(projectInvocation.repositoryRoots).toEqual([fixture.root]);
    expect(projectInvocation.ownerUid).toBe(fixture.host.ownerUid);
  }
  await exercise().finally(() => cwd.mockRestore());
}
async function hostQualification() {
  const program = withFixture(hostPaths);
  await Effect.runPromise(program);
}
test(
  'native host does not misclassify HOME as a repository; a cwd git marker is excluded',
  hostQualification,
);
