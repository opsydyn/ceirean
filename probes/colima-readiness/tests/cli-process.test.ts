import { afterEach, expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Schema } from 'effect';

import { PreflightReport } from '../src/contracts.ts';

const roots: string[] = [];
async function filesystem() {
  const provided = Effect.provide(FileSystem.FileSystem, BunServices.layer);
  return await Effect.runPromise(provided);
}
afterEach(async () => {
  const fs = await filesystem();
  for (const root of roots.splice(0))
    await Effect.runPromise(fs.remove(root, { recursive: true, force: true }));
});
async function ownedRoot() {
  const fs = await filesystem();
  const root = await Effect.runPromise(
    fs.makeTempDirectory({ directory: '/private/tmp', prefix: 'ceirean-cli-fixture-' }),
  );
  roots.push(root);
  await Effect.runPromise(fs.makeDirectory(`${root}/ceirean`));
  await Effect.runPromise(
    fs.writeFileString(
      `${root}/ceirean/colima.yaml`,
      'runtime: docker\nmounts: []\nforwardAgent: false\n',
    ),
  );
  await Effect.runPromise(fs.copyFile(`${import.meta.dir}/child.ts`, `${root}/client`));
  await Effect.runPromise(fs.chmod(`${root}/client`, 0o700));
  await Effect.runPromise(
    fs.writeFileString(
      `${root}/.env`,
      'SECRET_SENTINEL=private\nNODE_OPTIONS=--invalid-sentinel\n',
    ),
  );
  return { fs, root };
}
async function spawn(root: string, args: ReadonlyArray<string>) {
  const child = Bun.spawn([process.execPath, '--no-env-file', '--no-install', ...args], {
    cwd: root,
    env: {
      HOME: root,
      PATH: root,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
      DOCKER_HOST: 'PRIVATE_SENTINEL',
      COLIMA_HOME: 'PRIVATE_SENTINEL',
      CEIREAN_TEST_OVERRIDE: 'PRIVATE_SENTINEL',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  return { code: await child.exited, stdout, stderr };
}
const entrypoint = `${import.meta.dir}/../src/main.ts`;
const encodeString = Schema.encodeSync(Schema.fromJsonString(Schema.String));
const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(PreflightReport), {
  onExcessProperty: 'error',
});
async function importsAndUsage() {
  const { root, fs } = await ownedRoot();
  const before = await Effect.runPromise(fs.readDirectory(root));
  const imported = await spawn(root, ['--eval', `import ${encodeString(entrypoint)};`]);
  expect(imported).toEqual({ code: 0, stdout: '', stderr: '' });
  expect(await Effect.runPromise(fs.readDirectory(root))).toEqual(before);
  for (const args of [
    [],
    ['activate'],
    ['preflight', '--config', 'relative'],
    ['preflight', '--config', `${root}/ceirean/colima.yaml`, '--client', `${root}/client`],
  ]) {
    expect(await spawn(root, [entrypoint, ...args])).toEqual({
      code: 64,
      stdout: '',
      stderr: '{"_tag":"UsageError"}\n',
    });
  }
  expect(await Effect.runPromise(fs.readDirectory(root))).toEqual(before);
}
test(
  'production entrypoint imports quietly and rejects all nonpublic capabilities in hostile cwd/env',
  importsAndUsage,
);

async function syntheticProcess() {
  const { root, fs } = await ownedRoot();
  const before = await Effect.runPromise(fs.readFileString(`${root}/ceirean/colima.yaml`));
  const result = await spawn(root, [
    `${import.meta.dir}/cli-child.ts`,
    'preflight',
    '--config',
    `${root}/ceirean/colima.yaml`,
  ]);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe('');
  expect(decodeReport(result.stdout)).toMatchObject({
    nativeReadiness: 'Unqualified',
    canExecuteReplay: false,
    config: {
      mounts: 'Disabled',
      proposedEndpoint: { endpoint: `unix://${root}/ceirean/docker.sock` },
    },
    versions: [
      { tool: 'Colima', status: 'Available' },
      { tool: 'Docker', status: 'Invalid' },
    ],
  });
  expect(result.stdout).not.toContain('PRIVATE_SENTINEL');
  expect(await Effect.runPromise(fs.readFileString(`${root}/ceirean/colima.yaml`))).toBe(before);
  const home = await Effect.runPromise(fs.readFileString(`${root}/home-proof`));
  expect(await Effect.runPromise(fs.exists(home))).toBe(false);
}
test(
  'real main boundary composes only owned executable/config fixtures and removes isolated HOME',
  syntheticProcess,
);
