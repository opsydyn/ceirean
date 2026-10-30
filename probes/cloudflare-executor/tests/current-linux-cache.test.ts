import { expect, test } from 'bun:test';

import { Effect } from 'effect';

import { currentLinuxCachePlan, validateCurrentLinuxRuntime } from '../src/current-linux-cache.ts';

function fixedPlan() {
  const plan = currentLinuxCachePlan();
  expect(plan.activation).toBe('Blocked');
  expect(plan.scope).toBe('CacheOnly');
  expect(plan.warmup.argv).toContain('--registry=http://127.0.0.1:4873');
  expect(plan.fresh.argv).not.toContain('--registry=http://127.0.0.1:4873');
  for (const command of [plan.warmup, plan.fresh]) {
    expect(command.argv).toContain('--ignore-scripts');
    expect(command.argv).toContain('--frozen-lockfile');
    expect(command.argv).toContain('--backend=copyfile');
  }
  expect(plan.runtime).toEqual({
    node: '22.23.4',
    bun: '1.4.3',
    npm: '10.9.9',
    os: 'linux',
    arch: 'x64',
  });
}
test(
  'Linux rehearsal is cache-only and tests default-registry compatibility after loopback warm-up',
  fixedPlan,
);

async function exactRuntimeOnly() {
  const exact = currentLinuxCachePlan().runtime;
  expect(await Effect.runPromise(validateCurrentLinuxRuntime(exact))).toEqual(exact);
  for (const changed of [
    { ...exact, bun: '1.3.11' },
    { ...exact, node: '24.15.0' },
    { ...exact, arch: 'arm64' },
    { ...exact, os: 'darwin' },
  ]) {
    const result = await Effect.runPromise(
      validateCurrentLinuxRuntime(changed).pipe(Effect.result),
    );
    expect(result._tag).toBe('Failure');
  }
}
test('cache rehearsal refuses historical or host-native runtime substitution', exactRuntimeOnly);
