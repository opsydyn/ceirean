/**
 * A migration coordinator built on the vendored queue, declared the way an
 * async (non-Effect) Worker declares a Durable Object: a plain class, exported
 * from the Worker's entry module, bound from the stack by class name.
 *
 * This is the shape the whole vendoring plan depends on. Our own Durable
 * Objects are written with Alchemy's Effect combinator
 * (`Cloudflare.DurableObject<Self>()(...)`, as in `probes/cloudflare-ledger`),
 * and the published Alchemy documentation shows only that form. If plain
 * classes could not be bound, every vendored coordinator would have to be
 * rewritten, and `@cloudflare/sandbox`'s own `Sandbox` class — which we do not
 * author and cannot rewrite — could not be hosted at all.
 */

import { QueueCoordinator } from '@ceirean/vendor-factory/coordination/queue-coordinator.ts';
import * as v from 'valibot';

export const migrationParamsSchema = v.object({
  deliveryId: v.pipe(v.string(), v.minLength(1)),
  repositoryId: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export type MigrationParams = v.InferOutput<typeof migrationParamsSchema>;

export interface MigrationCoordinatorEnv {
  MIGRATION_WORKFLOW: Workflow<MigrationParams>;
}

/** Serializes migration runs per repository; keyed by repository id. */
export class MigrationCoordinator extends QueueCoordinator<
  MigrationParams,
  MigrationCoordinatorEnv
> {
  protected parseParams(input: unknown): MigrationParams {
    return v.parse(migrationParamsSchema, input);
  }

  protected workflowBinding(): Workflow<MigrationParams> {
    return this.env.MIGRATION_WORKFLOW;
  }
}
