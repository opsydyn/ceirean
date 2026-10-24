import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Option, Path, Schema } from 'effect';

import { dryRun } from '../src/offline-runner.ts';
import { readBounded } from '../src/runner-input.ts';
import { fixture } from './approval-fixtures.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function* verifyBom() {
  const f = yield* Effect.promise(fixture);
  const signed = yield* Effect.promise(() => f.sign(f.original));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-runner-bom-' });
  const input = path.join(cwd, 'worksheet.json');
  yield* fs.writeFileString(input, signed.text);
  const original = yield* readBounded(input);
  expect(yield* dryRun(original, encode(signed.approval), Option.some(f.policy), 0)).toMatchObject({
    _tag: 'OfflinePlan',
  });
  const text = new TextEncoder().encode(signed.text);
  const withBom = new Uint8Array(text.length + 3);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(text, 3);
  yield* fs.writeFile(input, withBom);
  const loaded = yield* readBounded(input);
  expect(yield* dryRun(loaded, encode(signed.approval), Option.some(f.policy), 0)).toMatchObject({
    _tag: 'DryRunRefused',
    activation: 'Blocked',
  });
}
async function bom() {
  const workflow = Effect.gen(verifyBom);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, BunServices.layer);
  await Effect.runPromise(provided);
}
test('a file BOM cannot disappear before exact-byte signature and digest verification', bom);

function* verifyDirectBounds() {
  const oversized = encode({ padding: 'x'.repeat(70000) });
  const multibyte = encode({ padding: '\u00e9'.repeat(32768) });
  for (const [text, receipt] of [
    [oversized, '{}'],
    ['{}', oversized],
    [multibyte, '{}'],
    ['{}', multibyte],
  ]) {
    expect(yield* dryRun(text!, receipt!, Option.none(), 0)).toMatchObject({
      _tag: 'DryRunRefused',
      activation: 'Blocked',
    });
  }
}
async function directBounds() {
  const workflow = Effect.gen(verifyDirectBounds);
  await Effect.runPromise(workflow);
}
test(
  'direct dry-run callers cannot bypass worksheet or receipt byte bounds with unconfigured trust',
  directBounds,
);
