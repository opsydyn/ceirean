import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { BunChildProcessSpawner, BunFileSystem, BunPath } from '@effect/platform-bun';
import { defineTool, init, useModel, useTool } from '@flue/runtime';
import { sqlite, start } from '@flue/runtime/node';
import { Layer, ManagedRuntime, Match } from 'effect';
import * as v from 'valibot';

import { MigrationToolError, type MigrationToolPolicy } from './policy.ts';
import { openToolSurface } from './tools.ts';

const services = Layer.merge(BunFileSystem.layer, BunPath.layer);
const platform = Layer.provideMerge(BunChildProcessSpawner.layer, services);

/**
 * A refusal the agent is allowed to see. It carries the policy's code and
 * nothing else — no path, no root, no errno, no host detail — so a refusal
 * cannot be used to map the filesystem outside the checkout by reading error
 * text. Flue serialises this message into the tool result the model reads, so
 * what it contains is exactly what the agent learns.
 */
export class ToolRefused extends Error {
  constructor(readonly code: string) {
    super(`Refused: ${code}`);
    this.name = 'ToolRefused';
  }
}

const contained = Match.instanceOf(MigrationToolError);
const codeOf = Match.type<unknown>().pipe(
  Match.when(contained, (error) => error.code),
  Match.orElse(() => 'Unavailable'),
);

export type AgentCall = Readonly<{
  tool: string;
  refused: string | undefined;
  /** The exact message handed to Flue, so a test can assert what leaked. */
  message: string | undefined;
}>;

export type FauxResponses = Parameters<ReturnType<typeof fauxProvider>['appendResponses']>[0];

export interface MigrationAgentHandle {
  /** Script the provider's turns before dispatching, as the faux provider requires. */
  script(responses: FauxResponses): void;
  dispatch(message: string): Promise<string>;
  calls(): ReadonlyArray<AgentCall>;
  providerCalls(): number;
  stop(): Promise<void>;
}

/**
 * The slice-1 agent: the four tools bound to one policy, driven by the faux
 * provider.
 *
 * `providers` holds only the faux provider and `env` is empty, so there is no
 * credential to read and no provider that could reach the network. The caller
 * supplies the scripted responses; this slice spends nothing and proves the
 * tools, their bounds and their refusals as an agent actually reaches them.
 *
 * This module is a runtime boundary. Flue's tools return promises, so the tool
 * effects are executed here rather than returned, and the platform layer is
 * provided at this one place.
 */
export async function openMigrationAgent(options: {
  stateDir: string;
  instanceId: string;
  policy: MigrationToolPolicy;
}): Promise<MigrationAgentHandle> {
  const faux = fauxProvider({ provider: 'ceirean-migration', models: [{ id: 'fixture' }] });
  const surface = openToolSurface(options.policy);
  // One runtime for this agent, built from the layer once rather than provided
  // per tool call. It is disposed with the agent, in `stop`.
  const runtime = ManagedRuntime.make(platform);
  const calls: AgentCall[] = [];

  function served<A>(tool: string, output: A) {
    calls.push({ tool, refused: undefined, message: undefined });
    return { output };
  }

  function refused(tool: string, cause: unknown): never {
    const failure = new ToolRefused(codeOf(cause));
    calls.push({ tool, refused: failure.code, message: failure.message });
    throw failure;
  }

  function readOne({ data }: { data: { path: string } }) {
    const effect = surface.readFile(data.path);
    const executed = runtime.runPromise(effect);
    return executed.then(
      (output) => served('read_file', output),
      (cause: unknown) => refused('read_file', cause),
    );
  }

  function writeOne({ data }: { data: { path: string; content: string } }) {
    const effect = surface.writeFile(data.path, data.content);
    const executed = runtime.runPromise(effect);
    return executed.then(
      (output) => served('write_file', output),
      (cause: unknown) => refused('write_file', cause),
    );
  }

  function searchAll({ data }: { data: { query: string } }) {
    const effect = surface.searchFiles(data.query);
    const executed = runtime.runPromise(effect);
    return executed.then(
      (output) => served('search_files', output),
      (cause: unknown) => refused('search_files', cause),
    );
  }

  function checkOne({ data }: { data: { name: string } }) {
    const effect = surface.runCheck(data.name);
    const executed = runtime.runPromise(effect);
    return executed.then(
      (output) => served('run_check', output),
      (cause: unknown) => refused('run_check', cause),
    );
  }

  const readFile = defineTool({
    name: 'read_file',
    description: 'Read one UTF-8 text file from the checkout, by a path relative to its root.',
    input: v.object({ path: v.string() }),
    run: readOne,
  });

  const writeFile = defineTool({
    name: 'write_file',
    description: 'Replace one file under a writable prefix of the checkout with the given text.',
    input: v.object({ path: v.string(), content: v.string() }),
    run: writeOne,
  });

  const searchFiles = defineTool({
    name: 'search_files',
    description:
      'Find lines in the checkout containing a literal substring. The query is not a pattern.',
    input: v.object({ query: v.string() }),
    run: searchAll,
  });

  const runCheck = defineTool({
    name: 'run_check',
    description:
      'Run one named check from the policy and return its exit code. Output is not available.',
    input: v.object({ name: v.string() }),
    run: checkOne,
  });

  function MigrationAgent() {
    useModel('ceirean-migration/fixture');
    useTool(readFile);
    useTool(writeFile);
    useTool(searchFiles);
    useTool(runCheck);
    return [
      'Apply the requested change to the checkout using the tools provided.',
      'Paths are relative to the checkout root. A refusal is final: do not retry it',
      'with a different spelling of the same path.',
      'run_check reports an exit code only. It cannot tell you why a check failed.',
    ].join(' ');
  }

  const flue = await start({
    agents: [MigrationAgent],
    db: sqlite(`${options.stateDir}/flue.db`),
    env: {},
    providers: [faux.provider],
  });
  const agent = init(MigrationAgent, { id: options.instanceId });
  let stopping: Promise<void> | undefined;
  return {
    script: (responses) => faux.appendResponses(responses),
    async dispatch(message) {
      const receipt = await agent.dispatch(message);
      const reply = await agent.read(receipt.submissionId);
      return reply.text;
    },
    calls: () => calls,
    providerCalls: () => faux.state.callCount,
    stop: () => (stopping ??= flue.stop().finally(() => runtime.dispose())),
  };
}
