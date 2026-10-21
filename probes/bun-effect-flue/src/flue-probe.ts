import { join } from 'node:path';

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { AgentRunError, defineTool, init, useModel, useTool } from '@flue/runtime';
import { sqlite, start } from '@flue/runtime/node';
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
  constructor(
    readonly code: 'runtime' | 'aborted' | 'read_cancelled',
    cause: unknown,
  ) {
    super(`Flue probe ${code}`, {
      cause: { name: cause instanceof Error ? cause.name : 'UnknownError' },
    });
    this.name = 'ProbeError';
  }
}

function runtimeFailure(cause: unknown): never {
  throw new ProbeError('runtime', cause);
}

export async function openFlueProbe(options: {
  stateDir: string;
  instanceId: string;
  mode: 'tool' | 'blocked';
  record: (token: string) => Promise<number>;
}): Promise<ProbeHandle> {
  const faux = fauxProvider({ provider: 'ceirean-probe', models: [{ id: 'fixture' }] });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
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
  function CeireanProbe() {
    useModel('ceirean-probe/fixture');
    useTool(recordToken);
    return 'Record the synthetic token once, then report completion.';
  }
  const runtime = await start({
    agents: [CeireanProbe],
    db: sqlite(join(options.stateDir, 'flue.db')),
    env: {},
    providers: [faux.provider],
  }).catch(runtimeFailure);
  const agent = init(CeireanProbe, { id: options.instanceId });
  let stopping: Promise<void> | undefined;
  return {
    async dispatch(message) {
      if (options.mode === 'blocked') {
        faux.appendResponses([
          async (_context, providerOptions) => {
            const signal = providerOptions?.signal;
            if (!signal) throw new Error('Synthetic provider requires a cancellation signal');
            entered.resolve();
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                signal.removeEventListener('abort', onAbort);
                reject(new DOMException('Synthetic provider aborted', 'AbortError'));
              };
              if (signal.aborted) {
                onAbort();
                return;
              }
              signal.addEventListener('abort', onAbort, { once: true });
              void release.promise.then(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
              });
            });
            return fauxAssistantMessage('probe-complete');
          },
        ]);
      } else
        faux.appendResponses([
          fauxAssistantMessage(fauxToolCall('record_token', { token: message }), {
            stopReason: 'toolUse',
          }),
          (context) => {
            const result = context.messages.findLast((entry) => entry.role === 'toolResult');
            return fauxAssistantMessage(
              result?.role === 'toolResult' && result.isError
                ? 'probe-tool-error'
                : 'probe-complete',
            );
          },
        ]);
      const receipt = await agent.dispatch(message).catch(runtimeFailure);
      return { submissionId: receipt.submissionId, uid: receipt.uid };
    },
    async read(receipt, signal) {
      const reply = await agent.read(receipt.submissionId, { signal }).catch((cause: unknown) => {
        throw new ProbeError(
          signal?.aborted
            ? 'read_cancelled'
            : cause instanceof AgentRunError && cause.outcome === 'aborted'
              ? 'aborted'
              : 'runtime',
          cause,
        );
      });
      return { text: reply.text, submissionId: reply.submissionId };
    },
    async abort() {
      await agent.abort().catch(runtimeFailure);
    },
    stop() {
      release.resolve();
      return (stopping ??= runtime.stop());
    },
    providerCalls: () => faux.state.callCount,
    toolCalls: () => toolCalls,
    waitForBlockedResponse: () =>
      options.mode === 'blocked'
        ? entered.promise
        : Promise.reject(new Error('Not a blocked probe')),
    releaseBlockedResponse: () => release.resolve(),
  };
}
