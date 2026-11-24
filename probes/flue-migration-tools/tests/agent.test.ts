import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

import { type MigrationAgentHandle, openMigrationAgent } from '../src/agent.ts';
import type { MigrationToolPolicy } from '../src/policy.ts';
import { withCheckout, withStateDirectory } from './checkout.ts';

type Transcript = { messages: ReadonlyArray<{ role: string; isError?: boolean }> };

/** Report `refused` when the last tool result was an error, `done` otherwise. */
function settled(context: Transcript) {
  const last = context.messages.findLast((entry) => entry.role === 'toolResult');
  const failed = last?.role === 'toolResult' && last.isError === true;
  return fauxAssistantMessage(failed ? 'refused' : 'done');
}

/** Records the whole transcript Flue hands the model, then ends the turn. */
function capturing(seen: string[]) {
  function capture(context: Transcript) {
    seen.push(Bun.inspect(context.messages));
    return fauxAssistantMessage('read');
  }
  return capture;
}

async function withAgent(
  policy: MigrationToolPolicy,
  body: (agent: MigrationAgentHandle) => Promise<void>,
) {
  await withStateDirectory(async (stateDir) => {
    let agent: MigrationAgentHandle | undefined;
    await Promise.resolve()
      .then(async () => {
        agent = await openMigrationAgent({ stateDir, instanceId: 'slice-one', policy });
        await body(agent);
      })
      .finally(() => agent?.stop());
  });
}

test('the agent reads a file and writes a change through the tools', async () => {
  await withCheckout(async ({ root, policy }) => {
    await withAgent(policy, async (agent) => {
      agent.script([
        fauxAssistantMessage(fauxToolCall('read_file', { path: 'src/index.ts' }), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage(
          fauxToolCall('write_file', {
            path: 'src/index.ts',
            content: 'export const value = 2;\n',
          }),
          { stopReason: 'toolUse' },
        ),
        settled,
      ]);
      expect(await agent.dispatch('bump the value')).toBe('done');
      expect(agent.calls()).toEqual([
        { tool: 'read_file', refused: undefined, message: undefined },
        { tool: 'write_file', refused: undefined, message: undefined },
      ]);
    });
    expect(await readFile(join(root, 'src', 'index.ts'), 'utf8')).toBe('export const value = 2;\n');
  });
});

test('a refusal reaches the agent as a tool error carrying only its code', async () => {
  await withCheckout(async ({ root, policy }) => {
    await withAgent(policy, async (agent) => {
      agent.script([
        fauxAssistantMessage(
          fauxToolCall('write_file', { path: '../escaped.ts', content: 'escaped' }),
          { stopReason: 'toolUse' },
        ),
        settled,
      ]);
      expect(await agent.dispatch('write outside the checkout')).toBe('refused');
      // `message` is exactly what Flue serialises into the tool result the model
      // reads. A refusal that named the resolved path would let an agent map the
      // filesystem outside the checkout by reading error text.
      expect(agent.calls()).toEqual([
        { tool: 'write_file', refused: 'UnsafePath', message: 'Refused: UnsafePath' },
      ]);
    });
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# fixture\n');
  });
});

test('the agent reaches run_check and an unknown name is refused', async () => {
  await withCheckout(async ({ policy }) => {
    const checks = [{ name: 'suite', executable: '/usr/bin/false', args: [], timeoutSeconds: 5 }];
    await withAgent({ ...policy, checks }, async (agent) => {
      agent.script([
        fauxAssistantMessage(fauxToolCall('run_check', { name: 'suite' }), {
          stopReason: 'toolUse',
        }),
        settled,
      ]);
      expect(await agent.dispatch('run the suite')).toBe('done');
      agent.script([
        fauxAssistantMessage(fauxToolCall('run_check', { name: 'make install' }), {
          stopReason: 'toolUse',
        }),
        settled,
      ]);
      expect(await agent.dispatch('run something else')).toBe('refused');
      expect(agent.calls()).toEqual([
        { tool: 'run_check', refused: undefined, message: undefined },
        { tool: 'run_check', refused: 'UnknownCheck', message: 'Refused: UnknownCheck' },
      ]);
    });
  });
});

test('nothing in the transcript the model reads carries an absolute path', async () => {
  await withCheckout(async ({ root, policy }) => {
    const checks = [
      {
        name: 'noisy',
        executable: '/bin/sh',
        args: [
          '-c',
          `echo "${root}/src/a.ts:1:1 broken"; echo "/etc/shadow unreadable" >&2; exit 1`,
        ],
        timeoutSeconds: 5,
      },
    ];
    await withAgent({ ...policy, checks }, async (agent) => {
      // Whatever Flue put in front of the model, in full. ADR-0003's rules are
      // about this text, not about the tool's return value alone.
      const seen: string[] = [];
      agent.script([
        fauxAssistantMessage(fauxToolCall('run_check', { name: 'noisy' }), {
          stopReason: 'toolUse',
        }),
        capturing(seen),
      ]);
      expect(await agent.dispatch('run the noisy check')).toBe('read');
      const transcript = seen.join('');
      expect(transcript).toContain('src/a.ts:1:1 broken');
      expect(transcript).toContain('<path> unreadable');
      expect(transcript).not.toContain(root);
      expect(transcript).not.toContain('/etc/shadow');
    });
  });
});

test('the agent runs with no credential and makes no outbound request', async () => {
  await withCheckout(async ({ policy }) => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    const previousFetch = globalThis.fetch;
    let fetches = 0;
    process.env.ANTHROPIC_API_KEY = 'synthetic-not-a-real-key';
    globalThis.fetch = Object.assign(
      async () => {
        fetches++;
        throw new Error('Outbound fetch forbidden');
      },
      { preconnect: previousFetch.preconnect },
    );
    await Promise.resolve()
      .then(() =>
        withAgent(policy, async (agent) => {
          agent.script([
            fauxAssistantMessage(fauxToolCall('search_files', { query: 'export const value' }), {
              stopReason: 'toolUse',
            }),
            settled,
          ]);
          expect(await agent.dispatch('find the value')).toBe('done');
          expect(agent.providerCalls()).toBe(2);
          expect(fetches).toBe(0);
        }),
      )
      .finally(() => {
        globalThis.fetch = previousFetch;
        if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = previousKey;
      });
  });
});
