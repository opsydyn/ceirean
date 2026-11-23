import { expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Result, Schema } from 'effect';

import {
  currentSourcePins,
  inspectCurrentSourceFiles,
  prepareCurrentPayloadInputs,
} from '../src/current-inputs.ts';
import { prepareHarnessSource } from '../src/payload-preparer.ts';
import { runPreparationProcess } from '../src/preparation-process.ts';
import { readSourceAt } from '../src/source-payload.ts';

const withPlatform = Effect.provide(BunServices.layer);
async function refusesMissingSource() {
  const reading = prepareCurrentPayloadInputs('/tmp');
  const result = await Effect.runPromise(reading.pipe(Effect.result, withPlatform));
  expect(result._tag).toBe('Failure');
}
test('missing fixed Git source refuses before creating current input output', refusesMissingSource);

async function preparesHarnessLayout() {
  const harness = await Effect.runPromise(prepareHarnessSource().pipe(Effect.scoped, withPlatform));
  const entries = await new Bun.Archive(harness.bytes).files();
  expect([...entries.keys()].sort()).toEqual([
    'browser/activation-block.ts',
    'browser/journeys.hosted.test.ts',
    'browser/playwright.config.ts',
    'package.json',
    'src/browser-policy.ts',
  ]);
  expect(harness.activation).toBe('Blocked');
  expect(harness.inventory.map(({ path }) => path).sort()).toEqual([...entries.keys()].sort());
}
test(
  'prepared harness source retains its real config, policy and activation guard layout',
  preparesHarnessLayout,
);

// Explicit opt-in uses local Git objects only, never installs or repository scripts.
const localRepository = process.env.CEIREAN_CURRENT_SOURCE_REPOSITORY;
const localTest = test.skipIf(localRepository === undefined);
async function currentSourceReadback() {
  const report = await Effect.runPromise(
    prepareCurrentPayloadInputs(localRepository ?? '').pipe(withPlatform),
  );
  const source = Bun.file(`${report.directory}/source.tar`);
  const bytes = await source.bytes();
  const entries = await new Bun.Archive(bytes).files();
  const inventory: { files: ReadonlyArray<{ path: string; sha256: string; size: number }> } =
    await Bun.file(`${report.directory}/source-inventory.json`).json();
  expect(report.source.revision).toBe('be0427e2aba2cf951ef4dbbbe9296e307ed41ad3');
  expect(report.source.files).toBe(2107);
  expect(Bun.SHA256.hash(bytes, 'hex')).toBe(report.source.sha256);
  expect([...entries.keys()].sort()).toEqual(inventory.files.map(({ path }) => path).sort());
  for (const file of inventory.files) {
    const content = await entries.get(file.path)?.bytes();
    expect(content?.length).toBe(file.size);
    expect(Bun.SHA256.hash(content ?? new Uint8Array(), 'hex')).toBe(file.sha256);
  }
  expect(entries.has('apps/docs/package.json')).toBe(false);
  expect(entries.has('packages/effect-three-foldkit/test/browser-launch.test.ts')).toBe(true);
  expect(
    await entries.get('packages/effect-three-foldkit/e2e/support/server.ts')?.text(),
  ).toContain('chromiumSandbox: true');
  expect(Bun.SHA256.hash((await entries.get('bun.lock')?.bytes()) ?? new Uint8Array(), 'hex')).toBe(
    '9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89',
  );
  await Effect.runPromise(
    FileSystem.FileSystem.use((fs) => fs.remove(report.directory, { recursive: true })).pipe(
      withPlatform,
    ),
  );
}
localTest(
  'local current preparation ignores newer HEAD and independently rehashes every archived blob',
  currentSourceReadback,
  120000,
);

function corruptedCurrentSource(path: string, content: string, kind: 'commit' | 'blob') {
  function* corrupt() {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-current-forgery-' });
    yield* fs.makeDirectory(`${home}/objects/info`, { recursive: true });
    yield* fs.makeDirectory(`${home}/refs`);
    yield* fs.writeFileString(`${home}/HEAD`, 'ref: refs/heads/main\n');
    yield* fs.writeFileString(
      `${home}/config`,
      '[core]\nrepositoryformatversion = 0\nbare = true\n',
    );
    const objects = yield* runPreparationProcess(
      '/usr/bin/git',
      ['-C', localRepository ?? '', 'rev-parse', '--path-format=absolute', '--git-path', 'objects'],
      home,
      home,
    );
    yield* fs.writeFileString(`${home}/objects/info/alternates`, new TextDecoder().decode(objects));
    const control = yield* readSourceAt(home, currentSourcePins);
    expect(control.length).toBe(2107);
    const oidBytes = yield* runPreparationProcess(
      '/usr/bin/git',
      ['-C', localRepository ?? '', 'rev-parse', `${currentSourcePins.revision}:${path}`],
      home,
      home,
    );
    const oid = new TextDecoder().decode(oidBytes).trim();
    const target = { commit: currentSourcePins.revision, blob: oid }[kind];
    const bytes = Buffer.from(content);
    const raw = Buffer.concat([Buffer.from(`${kind} ${bytes.length}\0`), bytes]);
    yield* fs.makeDirectory(`${home}/objects/${target.slice(0, 2)}`, { recursive: true });
    yield* fs.writeFile(
      `${home}/objects/${target.slice(0, 2)}/${target.slice(2)}`,
      deflateSync(raw),
    );
    const Path = Schema.Literal(path);
    const isPath = Schema.is(Path);
    const index = control.findIndex((file) => isPath(file.path));
    expect(index).toBeGreaterThanOrEqual(0);
    const changed = control.with(index, { ...control[index]!, bytes, size: bytes.length });
    const inspection = {
      blob: () =>
        inspectCurrentSourceFiles(changed).pipe(Effect.result, Effect.map(Result.isFailure)),
      commit: () =>
        prepareCurrentPayloadInputs(home).pipe(Effect.result, Effect.map(Result.isFailure)),
    }[kind]();
    const refused = yield* inspection;
    expect(refused).toBe(true);
  }
  const workflow = Effect.gen(corrupt);
  return workflow.pipe(Effect.scoped, withPlatform);
}
async function refusesCurrentLockCorruption() {
  await Effect.runPromise(corruptedCurrentSource('bun.lock', 'changed lock\n', 'blob'));
}
async function refusesCurrentBlobCorruption() {
  await Effect.runPromise(corruptedCurrentSource('package.json', '{}\n', 'blob'));
}
async function refusesCurrentTreeSubstitution() {
  await Effect.runPromise(
    corruptedCurrentSource(
      'bun.lock',
      'tree f7ec536070fd08e8a8f9a8c9fac4ab9220082e8a\nauthor Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nforged\n',
      'commit',
    ),
  );
}
localTest(
  'local current source inspection refuses changed lock bytes under the pinned blob name',
  refusesCurrentLockCorruption,
  120000,
);
localTest(
  'local current source inspection refuses tampered non-lock blobs',
  refusesCurrentBlobCorruption,
  120000,
);
localTest(
  'local current mode refuses a substituted tree under the pinned commit name',
  refusesCurrentTreeSubstitution,
  120000,
);
