import { expect, test } from 'bun:test';

import { NodeServices } from '@effect/platform-node';
import { Arbitrary, Effect, FileSystem, Result, Schema } from 'effect';

import * as Inputs from '../src/current-ci-inputs.ts';
import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';

const withPlatform = Effect.provide(NodeServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());

async function fixedInventory() {
  expect(typeof Inputs.readCurrentCiInventory).toBe('function');
  const inventory = await Effect.runPromise(Inputs.readCurrentCiInventory().pipe(withPlatform));
  expect(inventory.artifacts.length).toBe(909);
  expect(inventory.metadata.length).toBe(71);
  expect(inventory.artifacts.reduce((sum, entry) => sum + entry.bytes, 0)).toBe(429561867);
  expect(inventory.source.revision).toBe('be0427e2aba2cf951ef4dbbbe9296e307ed41ad3');
  expect(Inputs.currentCiInputLimits.requiredFreeBytes).toBeGreaterThan(10737418240);
}
test(
  'CI uses the exact frozen portable inventory, not local receipts or moving metadata',
  fixedInventory,
);

async function refusesBeforeAcquisition() {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-ci-inputs-' });
    let calls = 0;
    const request = () => {
      calls++;
      return Promise.reject(new Error('must not fetch'));
    };
    for (const freeBytes of [0, Inputs.currentCiInputLimits.requiredFreeBytes]) {
      const result = yield* Inputs.prepareCurrentCiInputs(
        `${root}/missing`,
        `${root}/out`,
        request,
        freeBytes,
      ).pipe(Effect.result);
      expect(result._tag).toBe('Failure');
      expect(yield* fs.exists(`${root}/out`)).toBe(false);
    }
    expect(calls).toBe(0);
  }
  const workflow = Effect.gen(check);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
}
test(
  'insufficient capacity or missing pinned Git objects refuse before destination or requests',
  refusesBeforeAcquisition,
);

const localRepository = process.env.CEIREAN_CURRENT_SOURCE_REPOSITORY;
const localTest = test.skipIf(localRepository === undefined);
async function directSourceStaging() {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-ci-source-' });
    const root = yield* fs.realPath(temporary);
    const stage = yield* Inputs.stageCurrentCiSource(localRepository ?? '', `${root}/consumer`);
    expect(stage.files).toBe(2107);
    expect(Bun.SHA256.hash(stage.text, 'hex')).toBe(
      '3b2862214f45be2d0d4211acce1c7c81b0c717ac3b9487f139535239cc6a16df',
    );
    const overwrite = yield* Inputs.stageCurrentCiSource(
      localRepository ?? '',
      `${root}/consumer`,
    ).pipe(Effect.result);
    expect(overwrite._tag).toBe('Failure');
    expect(yield* fs.exists(`${root}/source.tar`)).toBe(false);
    const lock = yield* fs.readFile(`${root}/consumer/bun.lock`);
    expect(Bun.SHA256.hash(lock, 'hex')).toBe(
      '9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89',
    );
  }
  const workflow = Effect.gen(check);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withPlatform));
}
localTest(
  'Linux source staging matches the fixed inventory without archive extraction or overwrites',
  directSourceStaging,
  120000,
);

async function inventoryMutations() {
  const original = await Bun.file(
    new URL('../fixtures/current-cache-inventory.json', import.meta.url),
  ).text();
  function* check() {
    const Range = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000000 }));
    const ids = Arbitrary.schema(Range);
    function changed(id: number) {
      const validating = Inputs.validateCurrentCiInventory(`${original}${id}`).pipe(
        Effect.result,
        Effect.map(Result.isFailure),
      );
      return validating;
    }
    const report = yield* Arbitrary.checkEffect(ids, changed, {
      seed: 31,
      runs: 100,
      maxShrinks: 100,
    });
    expect(report).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  const workflow = Effect.gen(check);
  await Effect.runPromise(workflow);
}
test(
  '100 seeded manifest substitutions fail their independent frozen identity',
  inventoryMutations,
);
