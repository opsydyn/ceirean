/**
 * Behaviour of the per-entity workflow queue: start, queue one, coalesce the
 * rest, dedup redeliveries, and self-heal from a crashed workflow.
 *
 * Upstream exercises this through `ReviewCoordinator` and the review params
 * schema. Neither is vendored, so the subject here is a local subclass with a
 * minimal schema of the same shape — one required id, one field derived from
 * another when absent, which is what the last case needs. Every upstream case
 * is kept.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as v from 'valibot';

// Upstream uses the vitest helper of that name. Bun does not hoist
// `mock.module`, so the platform stub is registered before the module under
// test is imported.
mock.module('cloudflare:workers', () => ({
	DurableObject: class {
		protected ctx: unknown;
		protected env: unknown;

		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

const { QueueCoordinator } = await import(
	'../src/coordination/queue-coordinator.ts'
);

const shaSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/));

const testParamsSchema = v.pipe(
	v.object({
		deliveryId: v.pipe(v.string(), v.minLength(1)),
		repositoryId: v.pipe(v.number(), v.integer(), v.minValue(1)),
		baseSha: shaSchema,
		configurationSha: v.optional(shaSchema),
	}),
	v.transform((params) => ({
		...params,
		configurationSha: params.configurationSha ?? params.baseSha,
	})),
);

type TestParams = v.InferOutput<typeof testParamsSchema>;

interface TestCoordinatorEnv {
	TEST_WORKFLOW: Workflow<TestParams>;
}

class TestCoordinator extends QueueCoordinator<TestParams, TestCoordinatorEnv> {
	protected parseParams(input: unknown): TestParams {
		return v.parse(testParamsSchema, input);
	}

	protected workflowBinding(): Workflow<TestParams> {
		return this.env.TEST_WORKFLOW;
	}
}

type WorkflowStatus =
	| 'queued'
	| 'running'
	| 'paused'
	| 'errored'
	| 'terminated'
	| 'complete'
	| 'waiting'
	| 'waitingForPause'
	| 'unknown';

function params(deliveryId: string): TestParams {
	return {
		deliveryId,
		repositoryId: 456,
		baseSha: 'a'.repeat(40),
		configurationSha: 'c'.repeat(40),
	};
}

function createHarness() {
	const statuses = new Map<string, WorkflowStatus>();
	const values = new Map<string, unknown>();
	let alarm: number | null = null;
	const create = mock(async ({ id }: { id?: string }) => {
		if (!id) throw new Error('Expected a workflow id.');
		if (statuses.has(id)) throw new Error(`Workflow ${id} already exists.`);
		statuses.set(id, 'running');
		return { id };
	});
	const get = mock(async (id: string) => ({
		status: async () => ({ status: statuses.get(id) ?? 'unknown' }),
	}));
	const storage = {
		get: mock(async (key: string) => {
			const value = values.get(key);
			return value === undefined ? undefined : structuredClone(value);
		}),
		put: mock(async (key: string, value: unknown) => {
			values.set(key, structuredClone(value));
		}),
		delete: mock(async (key: string) => values.delete(key)),
		setAlarm: mock(async (time: number) => {
			alarm = time;
		}),
		deleteAlarm: mock(async () => {
			alarm = null;
		}),
	};
	const coordinator = new TestCoordinator(
		{ storage } as unknown as DurableObjectState,
		{
			TEST_WORKFLOW: {
				create,
				get,
			} as unknown as Workflow<TestParams>,
		},
	);
	return {
		coordinator,
		create,
		statuses,
		getAlarm: () => alarm,
		seedState: (state: unknown) => values.set('queue', structuredClone(state)),
	};
}

describe('queue coordinator', () => {
	let harness: ReturnType<typeof createHarness>;

	beforeEach(() => {
		harness = createHarness();
	});

	it('starts the first workflow immediately', async () => {
		const { coordinator, create } = harness;

		await expect(coordinator.enqueue(params('delivery-1'))).resolves.toEqual({
			disposition: 'started',
			workflowId: 'delivery-1',
		});
		expect(create).toHaveBeenCalledWith({
			id: 'delivery-1',
			params: params('delivery-1'),
		});
	});

	it('queues one workflow while another is active', async () => {
		const { coordinator, create, getAlarm } = harness;
		await coordinator.enqueue(params('delivery-1'));

		await expect(coordinator.enqueue(params('delivery-2'))).resolves.toEqual({
			disposition: 'queued',
			workflowId: 'delivery-2',
			activeWorkflowId: 'delivery-1',
		});
		expect(create).toHaveBeenCalledTimes(1);
		expect(getAlarm()).not.toBeNull();
	});

	it('starts the pending workflow when the active one completes', async () => {
		const { coordinator, create } = harness;
		await coordinator.enqueue(params('delivery-1'));
		await coordinator.enqueue(params('delivery-2'));

		await expect(coordinator.complete('delivery-1')).resolves.toEqual({
			completed: true,
			nextWorkflowId: 'delivery-2',
		});
		expect(create.mock.calls.map(([request]) => request.id)).toEqual([
			'delivery-1',
			'delivery-2',
		]);
	});

	it('coalesces repeated pending triggers to the latest delivery', async () => {
		const { coordinator, create } = harness;
		await coordinator.enqueue(params('delivery-1'));
		await coordinator.enqueue(params('delivery-2'));
		await coordinator.enqueue(params('delivery-3'));

		await coordinator.complete('delivery-1');
		expect(create.mock.calls.map(([request]) => request.id)).toEqual([
			'delivery-1',
			'delivery-3',
		]);
	});

	it('deduplicates repeated deliveries', async () => {
		const { coordinator, create } = harness;
		await coordinator.enqueue(params('delivery-1'));

		await expect(coordinator.enqueue(params('delivery-1'))).resolves.toEqual({
			disposition: 'deduplicated',
			workflowId: 'delivery-1',
		});
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('recovers a pending workflow after an active workflow errors', async () => {
		const { coordinator, create, statuses } = harness;
		await coordinator.enqueue(params('delivery-1'));
		await coordinator.enqueue(params('delivery-2'));
		statuses.set('delivery-1', 'errored');

		await coordinator.alarm();
		expect(create.mock.calls.map(([request]) => request.id)).toEqual([
			'delivery-1',
			'delivery-2',
		]);
	});

	it('normalizes queued records through the params schema on load', async () => {
		const { coordinator, create, seedState, statuses } = harness;
		const { configurationSha: _activeSha, ...active } = params('delivery-1');
		const { configurationSha: _pendingSha, ...pending } = params('delivery-2');
		seedState({ active: { params: active, phase: 'running' }, pending });
		statuses.set('delivery-1', 'errored');

		await coordinator.alarm();
		expect(create).toHaveBeenCalledWith({
			id: 'delivery-2',
			params: { ...pending, configurationSha: pending.baseSha },
		});
	});
});
