import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';

import { frozenMetadata } from '../src/cache-metadata.ts';

async function pinnedMetadata() {
  const workflow = Effect.provide(frozenMetadata(), BunServices.layer);
  const metadata = await Effect.runPromise(workflow);
  expect(metadata.length).toBeGreaterThan(20);
  const isVite = Schema.is(Schema.Literal('vite'));
  const vite = metadata.find((entry) => isVite(entry.name));
  expect(vite?.text).toContain('"8.3.1"');
  expect(vite?.text).not.toContain('"8.0.13"');
  expect(metadata.every((entry) => entry.bytes <= 2097152 && entry.sha256.length === 64)).toBe(
    true,
  );
  expect(metadata.every((entry) => !entry.text.includes('"scripts"'))).toBe(true);
  expect(metadata.every((entry) => entry.url.startsWith('https://registry.npmjs.org/'))).toBe(true);
  const repeated = await Effect.runPromise(workflow);
  expect(repeated).toEqual(metadata);
}
test(
  'minimal replay packuments derive deterministically from the pinned npm locks',
  pinnedMetadata,
);
