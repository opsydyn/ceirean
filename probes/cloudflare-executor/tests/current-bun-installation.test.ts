import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Arbitrary, Effect, FileSystem, Result, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

import {
  auditCurrentBunInstallation,
  currentLinuxWorkerCommands,
} from '../src/current-linux-worker.ts';
import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';

const withPlatform = Effect.provide(BunServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
const integrity = 'sha512-' + 'A'.repeat(86) + '==';
const lock = {
  lockfileVersion: 1,
  workspaces: {
    '': { dependencies: { foo: '1.0.0', '@opsydyn/foldkit-viz': 'workspace:*' } },
    'packages/foldkit-viz': { name: '@opsydyn/foldkit-viz', dependencies: { foo: '1.0.0' } },
  },
  packages: {
    foo: ['foo@1.0.0', '', {}, integrity],
    '@opsydyn/foldkit-viz': ['@opsydyn/foldkit-viz@workspace:packages/foldkit-viz'],
  },
};
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function setup() {
  function* stage() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const canonical = yield* fs.realPath(root);
    for (const path of ['node_modules/foo', 'node_modules/@opsydyn', 'packages/foldkit-viz'])
      yield* fs.makeDirectory(`${canonical}/${path}`, { recursive: true });
    yield* fs.writeFileString(
      `${canonical}/node_modules/foo/package.json`,
      encode({
        name: 'foo',
        version: '1.0.0',
        main: 'must-not-import.js',
      }),
    );
    yield* fs.writeFileString(
      `${canonical}/node_modules/foo/must-not-import.js`,
      'throw new Error("Do not execute package code")',
    );
    yield* fs.writeFileString(
      `${canonical}/packages/foldkit-viz/package.json`,
      encode({ name: '@opsydyn/foldkit-viz' }),
    );
    yield* fs.symlink(
      '../../packages/foldkit-viz',
      `${canonical}/node_modules/@opsydyn/foldkit-viz`,
    );
    return canonical;
  }
  const workflow = Effect.gen(stage);
  return workflow;
}
async function currentReadback() {
  function* run() {
    const root = yield* setup();
    const other = yield* setup();
    const actual = yield* auditCurrentBunInstallation(root, lock);
    expect(actual).toMatchObject({
      status: 'Checked',
      installedPackages: 1,
      directDependencies: 2,
      exclusions: 0,
    });
    expect(actual.identitiesSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(yield* auditCurrentBunInstallation(other, lock)).toEqual(actual);
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(
      `${root}/node_modules/foo/package.json`,
      encode({ name: 'foo', version: '2.0.0' }),
    );
    expect(yield* auditCurrentBunInstallation(root, lock).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
    });
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test(
  'current Bun readback audits real manifests without importing code and is location-independent',
  currentReadback,
);

async function rejectsMissingAndForeign() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* setup();
    yield* fs.remove(`${root}/node_modules/foo`, { recursive: true });
    const missing = yield* auditCurrentBunInstallation(root, lock).pipe(Effect.result);
    expect(missing).toMatchObject({ _tag: 'Failure' });
    const foreign = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${foreign}/package.json`, encode({ name: 'foo', version: '1.0.0' }));
    yield* fs.symlink(foreign, `${root}/node_modules/foo`);
    expect(yield* auditCurrentBunInstallation(root, lock).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
    });
    const swapped = { ...lock, workspaces: { ...lock.workspaces, '../foreign': {} } };
    expect(yield* auditCurrentBunInstallation(root, swapped).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
    });
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test(
  'current Bun readback refuses missing direct packages, external links and workspace substitution',
  rejectsMissingAndForeign,
);

async function identityMutationLaw() {
  function* run() {
    const root = yield* setup();
    const fs = yield* FileSystem.FileSystem;
    const idSchema = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 1000 }));
    const ids = Arbitrary.schema(idSchema);
    function wrongIdentity(id: number) {
      function* check() {
        yield* fs.writeFileString(
          `${root}/node_modules/foo/package.json`,
          encode({ name: 'foo', version: `${id}.0.0` }),
        );
        const result = yield* auditCurrentBunInstallation(root, lock).pipe(Effect.result);
        expect(result).toMatchObject({ _tag: 'Failure' });
        return Result.isFailure(result);
      }
      const workflow = Effect.gen(check);
      return workflow;
    }
    expect(
      yield* Arbitrary.checkEffect(ids, wrongIdentity, { seed: 169, runs: 100, maxShrinks: 100 }),
    ).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test(
  '100 seeded package identity substitutions cannot satisfy the current lock',
  identityMutationLaw,
);

async function ambientPreloadsAreDisabled() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const canonical = yield* fs.realPath(root);
    const config = `${canonical}/empty.bunfig.toml`;
    const home = `${canonical}/home`;
    const project = `${canonical}/warmup/source`;
    yield* fs.makeDirectory(home, { mode: 0o700 });
    yield* fs.makeDirectory(project, { recursive: true, mode: 0o700 });
    yield* fs.writeFileString(config, 'preload = []\n');
    const poison = `preload = ["${canonical}/ambient.ts"]\n`;
    yield* fs.writeFileString(`${project}/bunfig.toml`, poison);
    yield* fs.writeFileString(`${project}/.bunfig.toml`, poison);
    yield* fs.writeFileString(
      `${project}/bun.lock`,
      '{ // JSONC data, not code\n"parsed": true, }',
    );
    yield* fs.writeFileString(
      `${canonical}/ambient.ts`,
      'throw new Error("AmbientPreloadExecuted")',
    );
    const argv = currentLinuxWorkerCommands().lockReadback.argv.map((arg) =>
      arg.replaceAll('/work', canonical),
    );
    function invoke(cwd: string, args: readonly string[] = argv) {
      function* execute() {
        const child = yield* ChildProcess.make(process.execPath, args, {
          cwd,
          env: { HOME: home, XDG_CONFIG_HOME: home, PATH: '/usr/bin:/bin' },
          extendEnv: false,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          killSignal: 'SIGKILL',
          forceKillAfter: 0,
        });
        const [output, errors, exit] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(child.stdout)),
            Stream.mkString(Stream.decodeText(child.stderr)),
            child.exitCode,
          ],
          { concurrency: 3 },
        );
        return { exit: Number(exit), output, errors };
      }
      const workflow = Effect.gen(execute);
      return workflow.pipe(Effect.scoped);
    }
    const withoutConfig = argv.filter((arg) => !arg.startsWith('--config='));
    const control = yield* invoke(project, withoutConfig);
    expect(control.exit).toBe(1);
    expect(control.errors).toContain('AmbientPreloadExecuted');
    expect(yield* invoke(canonical)).toEqual({ exit: 0, output: '{"parsed":true}\n', errors: '' });
    expect(yield* invoke(project)).toEqual({ exit: 0, output: '{"parsed":true}\n', errors: '' });
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.timeout('10 seconds'), Effect.scoped, withPlatform));
}
test(
  'fixed parser reads lock data outside hostile project configuration with a private HOME',
  ambientPreloadsAreDisabled,
);
