import { join } from 'node:path';
import { AgentRunError, defineTool, init, useModel, useTool } from '@flue/runtime';
import { sqlite, start } from '@flue/runtime/node';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import * as v from 'valibot';

export type ProbeReceipt = Readonly<{ submissionId: string; uid: string }>;
export type ProbeReply = Readonly<{ text: string; submissionId: string }>;
export interface ProbeHandle {
  dispatch(message: string): Promise<ProbeReceipt>;
  read(receipt: ProbeReceipt, signal?: AbortSignal): Promise<ProbeReply>;
  abort(): Promise<void>;
  stop(): Promise<void>;
  providerCalls(): number;
  toolCalls(): number;
  waitForBlockedResponse(): Promise<void>;
  releaseBlockedResponse(): void;
}

export class ProbeError extends Error {
  constructor(readonly code: 'runtime' | 'aborted' | 'read_cancelled', cause: unknown) {
    super(`Flue probe ${code}`, {
      cause: { name: cause instanceof Error ? cause.name : 'UnknownError' },
    });
    this.name = 'ProbeError';
  }
}

export async function openFlueProbe(options: {
  stateDir: string;
  instanceId: string;
  mode: 'tool' | 'blocked';
  record: (token: string) => Promise<number>;
}): Promise<ProbeHandle> {
  if (options.mode === 'blocked') throw new Error('Blocked mode is not implemented yet');
  const faux = fauxProvider({ provider: 'leviathan-probe', models: [{ id: 'fixture' }] });
  let toolCalls = 0;
  const recordToken = defineTool({
    name: 'record_token',
    description: 'Record one synthetic probe token and return its sequence number.',
    input: v.object({ token: v.string() }),
    async run({ data }) {
      toolCalls++;
      return { output: { count: await options.record(data.token) } };
    },
  });
  function LeviathanProbe() {
    useModel('leviathan-probe/fixture');
    useTool(recordToken);
    return 'Record the synthetic token once, then report completion.';
  }
  const runtime = await start({
    agents: [LeviathanProbe], db: sqlite(join(options.stateDir, 'flue.db')),
    env: {}, providers: [faux.provider],
  });
  const agent = init(LeviathanProbe, { id: options.instanceId });
  let stopping: Promise<void> | undefined;
  return {
    async dispatch(message) {
      faux.appendResponses([
        fauxAssistantMessage(fauxToolCall('record_token', { token: message }), { stopReason: 'toolUse' }),
        (context) => {
          const result = context.messages.findLast((entry) => entry.role === 'toolResult');
          return fauxAssistantMessage(result?.role === 'toolResult' && result.isError
            ? 'probe-tool-error' : 'probe-complete');
        },
      ]);
      try {
        const receipt = await agent.dispatch(message);
        return { submissionId: receipt.submissionId, uid: receipt.uid };
      } catch (cause) { throw new ProbeError('runtime', cause); }
    },
    async read(receipt, signal) {
      try {
        const reply = await agent.read(receipt.submissionId, { signal });
        return { text: reply.text, submissionId: reply.submissionId };
      } catch (cause) {
        throw new ProbeError(signal?.aborted ? 'read_cancelled'
          : cause instanceof AgentRunError && cause.outcome === 'aborted' ? 'aborted' : 'runtime', cause);
      }
    },
    async abort() {
      try { await agent.abort(); } catch (cause) { throw new ProbeError('runtime', cause); }
    },
    stop() { return stopping ??= runtime.stop(); },
    providerCalls: () => faux.state.callCount,
    toolCalls: () => toolCalls,
    waitForBlockedResponse: () => Promise.reject(new Error('Not a blocked probe')),
    releaseBlockedResponse() {},
  };
}
