import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { WorkerBundle } from 'alchemy/Cloudflare/Workers/Sources/Rolldown';
import { Context, Effect } from 'effect';

import { SmokeError } from '../src/readonly/container.ts';

const platform = Effect.provide(BunServices.layer);

async function bundlesWorker() {
  function* bundle() {
    const bundler = yield* WorkerBundle;
    return yield* bundler.build({
      id: 'ReadOnlyWorker',
      main: new URL('../src/readonly/worker.ts', import.meta.url).pathname,
      compatibility: { date: '2026-10-28', flags: ['nodejs_compat'] },
      // The bundler needs export names only; constructing a resource here is forbidden.
      entry: {
        kind: 'effect',
        exports: {
          ReadOnlyJob: {
            kind: 'durableObject',
            services: Context.empty(),
            constructor: Effect.die(new SmokeError({ code: 'ContainerFailed' })),
          },
        },
      },
      stack: { name: 'CeireanReadOnly', stage: 'test' },
      extraOptions: undefined,
    });
  }
  const bundling = Effect.gen(bundle);
  const result = await Effect.runPromise(bundling.pipe(platform));
  expect(result.files.length).toBeGreaterThan(0);
}
test(
  'Alchemy compiles the prepared Worker and DO export without provisioning',
  bundlesWorker,
  60000,
);
