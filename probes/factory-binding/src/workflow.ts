/**
 * A placeholder Workflow, present only so the stack has a real class to bind
 * by name. It does no migration work: this probe typechecks bindings, it does
 * not run anything.
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { MigrationParams } from './coordinator.ts';

export class MigrationWorkflow extends WorkflowEntrypoint<unknown, MigrationParams> {
  override async run(
    event: Readonly<WorkflowEvent<MigrationParams>>,
    step: WorkflowStep,
  ): Promise<string> {
    return step.do('accept-delivery', async () => event.payload.deliveryId);
  }
}
