/**
 * The async Worker entry module: a plain `fetch` handler plus the three
 * Durable Object and Workflow classes the stack binds by name. `Sandbox` is
 * re-exported unchanged from `@cloudflare/sandbox`, exactly as the upstream
 * factory does, which is the case that matters — it is a class we do not own.
 */

import { getSandbox } from '@cloudflare/sandbox';

import type { WorkerEnv } from '../alchemy.run.ts';

export { Sandbox } from '@cloudflare/sandbox';
export { MigrationCoordinator } from './coordinator.ts';
export { MigrationWorkflow } from './workflow.ts';

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/enqueue') {
      return new Response('Not found.', { status: 404 });
    }

    const deliveryId = request.headers.get('x-github-delivery');
    if (deliveryId === null) {
      return new Response('A delivery id is required.', { status: 400 });
    }

    const coordinator = env.MIGRATION_COORDINATOR.getByName('repository-1');
    const admission = await coordinator.enqueue({ deliveryId, repositoryId: 1 });

    // Reading the container-backed namespace is the point: it proves the
    // binding carries the Sandbox Durable Object, not merely that it exists.
    const sandbox = getSandbox(env.SANDBOX, `probe-${deliveryId}`, {
      sleepAfter: '1m',
      enableDefaultSession: false,
    });

    return Response.json({
      disposition: admission.disposition,
      workflowId: admission.workflowId,
      sandbox: sandbox.constructor.name,
    });
  },
};
