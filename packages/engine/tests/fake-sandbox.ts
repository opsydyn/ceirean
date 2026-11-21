/**
 * A scripted sandbox: it records what the capability asked it to do and
 * answers with the exit codes a test chose. It runs no commands, so a test can
 * state what a failing third check does to the second without owning a
 * container.
 */

import type { RunId } from '@ceirean/domain';
import { Array, Option } from 'effect';

import {
  makeMigrationSandbox,
  type MigrationSandboxDriver,
  type SandboxCommand,
  type SandboxExecution,
} from '../src/migration-sandbox-port.ts';

export interface FakeSandboxScript {
  readonly runId: RunId;
  /**
   * Commands, by zero-based index, after which the container is treated as
   * replaced: the next readiness check reports no checkout, so the capability
   * has to re-provision before it runs the following step.
   */
  readonly swapContainerAfter?: readonly number[];
  /**
   * How many of the first `exec` attempts throw before running anything.
   * Models a transient container failure: with 1, the first attempt fails and
   * a retry succeeds.
   */
  readonly failExecAttempts?: number;
  /** Exit codes answered in order. A command past the end answers zero. */
  readonly exitCodes?: readonly number[];
  readonly failPrepare?: boolean;
  readonly failExec?: boolean;
}

export interface FakeSandboxLog {
  readonly prepared: number;
  readonly released: number;
  readonly commands: readonly string[];
  readonly readinessChecks: number;
  /** Includes attempts that threw, so a retry is visible. */
  readonly execAttempts: number;
}

/**
 * Throw when the script asked this call to refuse. The zero-or-one list keeps
 * the decision data-shaped instead of branching.
 */
function refuseWhen(asked: boolean | undefined, message: string): void {
  const wanted = Number(Boolean(asked));
  const refusals = Array.take([message], wanted);
  Array.forEach(refusals, (text) => {
    throw new Error(text);
  });
}

export function makeFakeSandbox(script: FakeSandboxScript) {
  const commands: string[] = [];
  const counts = { prepared: 0, released: 0, readinessChecks: 0, execAttempts: 0 };
  const state = { hasCheckout: false };
  const codes = script.exitCodes ?? [];

  async function prepare(): Promise<void> {
    counts.prepared += 1;
    state.hasCheckout = true;
    refuseWhen(script.failPrepare, 'prepare refused');
  }

  async function isPrepared(): Promise<boolean> {
    counts.readinessChecks += 1;
    return state.hasCheckout;
  }

  async function exec(command: SandboxCommand): Promise<SandboxExecution> {
    counts.execAttempts += 1;
    const index = commands.length;
    refuseWhen(script.failExec, 'exec refused');
    const transient = counts.execAttempts <= (script.failExecAttempts ?? 0);
    refuseWhen(transient, `exec refused on attempt ${counts.execAttempts}`);
    commands.push(command.command);
    const swapped = Array.contains(script.swapContainerAfter ?? [], index);
    state.hasCheckout = !swapped;
    const scripted = Array.get(codes, index);
    return { exitCode: Option.getOrElse(scripted, () => 0) };
  }

  async function release(): Promise<void> {
    counts.released += 1;
  }

  const driver: MigrationSandboxDriver = {
    runId: script.runId,
    prepare,
    isPrepared,
    exec,
    release,
  };

  function log(): FakeSandboxLog {
    return {
      prepared: counts.prepared,
      released: counts.released,
      commands: [...commands],
      readinessChecks: counts.readinessChecks,
      execAttempts: counts.execAttempts,
    };
  }

  return { sandbox: makeMigrationSandbox(driver), log };
}
