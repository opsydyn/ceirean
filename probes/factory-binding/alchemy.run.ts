/**
 * Typecheck-only binding probe. Nothing here is deployed: the stack body
 * refuses unless `CEIREAN_PREPARE_FACTORY_BINDING` is exactly `approved`, and
 * the probe's Moon project declares a `typecheck` task and no others.
 *
 * What it establishes, against the installed `alchemy@2.0.0-beta.83` rather
 * than the published documentation:
 *
 * 1. A plain `DurableObject` subclass — the vendored `QueueCoordinator` — can
 *    be bound to an async Worker by class name.
 * 2. A plain `WorkflowEntrypoint` subclass can be bound the same way.
 * 3. `@cloudflare/sandbox`'s own `Sandbox`, a class we do not author, can host
 *    a container declared from a pinned image.
 * 4. `InferEnv` resolves all three into the `env` of an ordinary
 *    `async fetch` handler.
 */

import * as Cloudflare from 'alchemy/Cloudflare';
import { Stack } from 'alchemy/Stack';
import { localState } from 'alchemy/State/LocalState';
import { Config, Effect, Schema } from 'effect';

import type { MigrationCoordinator, MigrationParams } from './src/coordinator.ts';

export const FactoryBinding = Cloudflare.Worker('FactoryBinding', {
  main: './src/worker.ts',
  env: {
    MIGRATION_COORDINATOR: Cloudflare.DurableObject<MigrationCoordinator>('MIGRATION_COORDINATOR', {
      className: 'MigrationCoordinator',
    }),
    MIGRATION_WORKFLOW: Cloudflare.Workflow<MigrationParams>('MIGRATION_WORKFLOW', {
      className: 'MigrationWorkflow',
    }),
    SANDBOX: Cloudflare.Container('SANDBOX', {
      // Pinned to the exact `@cloudflare/sandbox` version in `package.json`,
      // which is what the upstream factory's Dockerfile builds from too.
      // Taking the published image rather than building one keeps this probe
      // free of any image build.
      image: 'docker.io/cloudflare/sandbox:0.12.5',
      className: 'Sandbox',
      instanceType: 'standard-2',
      maxInstances: 1,
    }),
  },
});

export type WorkerEnv = Cloudflare.InferEnv<typeof FactoryBinding>;

const decodeApproval = Schema.decodeUnknownEffect(Schema.Literal('approved'));

function* prepareBindingProbe() {
  const approval = yield* Config.String('CEIREAN_PREPARE_FACTORY_BINDING');
  yield* decodeApproval(approval).pipe(Effect.mapError((error) => new Config.ConfigError(error)));
  const worker = yield* FactoryBinding;
  return { workerId: worker.workerId };
}

export default Stack(
  'CeireanFactoryBinding',
  { providers: Cloudflare.providers(), state: localState() },
  Effect.gen(prepareBindingProbe),
);
