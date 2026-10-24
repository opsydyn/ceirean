import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';

import { probeNpmVersion } from '../src/dependency-capture.ts';

async function versionIsolated() {
  const probing = probeNpmVersion(process.execPath);
  const provided = Effect.provide(probing, BunServices.layer);
  const version = await Effect.runPromise(provided);
  expect(version).toBe('10.9.9');
}
test(
  'isolated npm configuration is distinct, empty and does not block version probing',
  versionIsolated,
);
