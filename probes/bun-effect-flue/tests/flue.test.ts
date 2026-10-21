import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { AgentRunError, init, useModel } from '@flue/runtime';
import { start, sqlite } from '@flue/runtime/node';

import { createRecorderBridge } from '../src/composition.ts';
import { openFlueProbe, ProbeError, type ProbeHandle } from '../src/flue-probe.ts';
import { withStateDirectory } from './process.ts';

function UnknownProviderProbe() {
  useModel('ceirean-missing-provider/fixture');
  return 'Do not use any fallback provider.';
}

async function withProbe(
  body: (probe: ProbeHandle, bridge: ReturnType<typeof createRecorderBridge>) => Promise<void>,
  record?: (token: string) => Promise<number>,
) {
  const stateDir = await mkdtemp(join(tmpdir(), 'ceirean-flue-'));
  await chmod(stateDir, 0o700);
  const bridge = createRecorderBridge();
  let probe: ProbeHandle | undefined;
  await Promise.resolve()
    .then(async () => {
      probe = await openFlueProbe({
        stateDir,
        instanceId: 'tool-fixture',
        mode: 'tool',
        record: record ?? bridge.record,
      });
      await body(probe, bridge);
    })
    .finally(() =>
      Promise.resolve()
        .then(() => probe?.stop())
        .finally(() => bridge.dispose())
        .finally(() => rm(stateDir, { recursive: true, force: true })),
    );
  expect(bridge.lifecycle()).toEqual({ acquired: 1, released: 1 });
}

test('two tool calls share one recorder', async () => {
  await withProbe(async (probe, bridge) => {
    for (const expected of [1, 2]) {
      const receipt = await probe.dispatch(`record-${expected}`);
      expect(await probe.read(receipt)).toEqual({
        text: 'probe-complete',
        submissionId: receipt.submissionId,
      });
      expect(await bridge.count()).toBe(expected);
    }
    expect(probe.toolCalls()).toBe(2);
    expect(probe.providerCalls()).toBe(4);
    expect(bridge.lifecycle()).toEqual({ acquired: 1, released: 0 });
  });
});

test('faux-only startup ignores ambient credentials', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  process.env.OPENAI_API_KEY = 'synthetic-not-a-real-key';
  globalThis.fetch = Object.assign(
    async () => {
      fetches++;
      throw new Error('Outbound fetch forbidden');
    },
    { preconnect: previousFetch.preconnect },
  );
  await Promise.resolve()
    .then(async () => {
      await withProbe(async (probe) => {
        expect((await probe.read(await probe.dispatch('record'))).text).toBe('probe-complete');
        expect(fetches).toBe(0);
      });
    })
    .finally(() => {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    });
});

test('unknown provider fails closed', async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const diagnostics: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    diagnostics.push(args);
  };
  let fetches = 0;
  globalThis.fetch = Object.assign(
    async () => {
      fetches++;
      throw new Error('Outbound fetch forbidden');
    },
    { preconnect: previousFetch.preconnect },
  );
  const faux = fauxProvider({ provider: 'ceirean-probe', models: [{ id: 'fixture' }] });
  let runtime: Awaited<ReturnType<typeof start>> | undefined;
  await Promise.resolve()
    .then(async () => {
      const result = await (async () => {
        runtime = await start({
          agents: [UnknownProviderProbe],
          db: sqlite(':memory:'),
          env: {},
          providers: [faux.provider],
        });
        const agent = init(UnknownProviderProbe, { id: 'unknown-provider' });
        await agent.read(await agent.dispatch('record'));
      })().then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(result).toBeInstanceOf(AgentRunError);
      if (result instanceof AgentRunError) expect(result.outcome).toBe('failed');
      await runtime?.stop();
      runtime = undefined;
      expect(
        diagnostics
          .flat()
          .some(
            (value) =>
              value instanceof Error &&
              value.message.includes('Unknown provider "ceirean-missing-provider"'),
          ),
      ).toBe(true);
      expect(fetches).toBe(0);
      expect(faux.state.callCount).toBe(0);
    })
    .finally(() =>
      Promise.resolve()
        .then(() => runtime?.stop())
        .finally(() => {
          globalThis.fetch = previousFetch;
          console.error = previousError;
        }),
    );
});

test('stop then restart releases singleton ownership', async () => {
  for (let i = 0; i < 2; i++) {
    await withProbe(async (probe) => {
      expect((await probe.read(await probe.dispatch('record'))).text).toBe('probe-complete');
    });
  }
});

test('tool failure is observed', async () => {
  await withProbe(
    async (probe, bridge) => {
      const reply = await probe.read(await probe.dispatch('record'));
      expect(reply.text).toBe('probe-tool-error');
      expect(await bridge.count()).toBe(0);
      expect(probe.toolCalls()).toBe(1);
    },
    async () => {
      throw new Error('synthetic recorder failure');
    },
  );
});

test('callback after bridge disposal fails', async () => {
  const bridge = createRecorderBridge();
  expect(await bridge.record('first')).toBe(1);
  await bridge.dispose();
  await expect(bridge.record('late')).rejects.toThrow();
  expect(bridge.lifecycle()).toEqual({ acquired: 1, released: 1 });
});

test('startup failure remains visible with a sanitized cause', async () => {
  await withStateDirectory(async (directory) => {
    const notDirectory = join(directory, 'not-a-directory');
    await writeFile(notDirectory, 'synthetic fixture');
    const result = await openFlueProbe({
      stateDir: notDirectory,
      instanceId: 'startup-failure',
      mode: 'tool',
      record: async () => 0,
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(result).toBeInstanceOf(ProbeError);
    if (result instanceof ProbeError) {
      expect(result.code).toBe('runtime');
      expect(result.cause).toEqual({ name: 'Error' });
      expect(result.message).not.toContain(directory);
    }
    await withProbe(async (probe) => {
      expect((await probe.read(await probe.dispatch('after-failed-start'))).text).toBe(
        'probe-complete',
      );
    });
  });
});
