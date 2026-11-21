/**
 * The seam between the migration capability and whatever actually runs
 * commands: a prepared checkout that executes one bounded command at a time
 * and is always torn down.
 *
 * Deliberately narrower than the vendored sandbox module it will be
 * implemented over. The capability needs a checkout, bounded commands and
 * teardown; it does not need the agent tools, the skill mount, the push path
 * or the branch handling, so none of those appear here. A port that mirrored
 * its implementation would make the fake as complicated as the real thing and
 * prove nothing.
 */

import { NonNegativeSafeInteger, type RunId } from '@ceirean/domain';
import { Context, Data, Effect, Schema } from 'effect';

/**
 * `timeout` reports a killed command this way, and the vendored sandbox wraps
 * every command in `timeout -k 5`. Reading the code here, rather than letting
 * each driver decide, keeps the interpretation in one testable place.
 */
export const TIMEOUT_EXIT_CODE = 124;

export const SandboxCommand = Schema.Struct({
  command: Schema.String.check(Schema.isMinLength(1)),
  timeoutSeconds: NonNegativeSafeInteger.check(Schema.isGreaterThan(0)),
});
export type SandboxCommand = typeof SandboxCommand.Type;

export const SandboxExecution = Schema.Struct({ exitCode: NonNegativeSafeInteger });
export type SandboxExecution = typeof SandboxExecution.Type;

/**
 * Carries the run it was serving: a sandbox instance belongs to one candidate,
 * and the capability has to name that run when it reports a failure upward.
 */
export class MigrationSandboxError extends Data.TaggedError('MigrationSandboxError')<{
  readonly runId: RunId;
  readonly operation: 'prepare' | 'exec';
  readonly code: 'Unavailable' | 'PrepareFailed' | 'ExecFailed';
}> {}

export interface MigrationSandboxDriver {
  readonly runId: RunId;
  readonly prepare: () => Promise<void>;
  /**
   * Whether the checkout the plan runs in still exists.
   *
   * A durable run outlives its container: the platform may replace the one
   * underneath it between steps, and the new one has no checkout. The
   * capability asks before each step rather than assuming `prepare` happened
   * once, which is what the upstream factory learned to do — see
   * `ensureTriageWorkspace` in the vendored sandbox module, which tests for
   * `/repo/.git` and re-clones.
   */
  readonly isPrepared: () => Promise<boolean>;
  readonly exec: (command: SandboxCommand, signal: AbortSignal) => Promise<SandboxExecution>;
  readonly release: () => Promise<void>;
}

export function makeMigrationSandbox(driver: MigrationSandboxDriver) {
  return {
    prepare: Effect.tryPromise({
      try: () => driver.prepare(),
      catch: () =>
        new MigrationSandboxError({
          runId: driver.runId,
          operation: 'prepare',
          code: 'PrepareFailed',
        }),
    }).pipe(Effect.withSpan('MigrationSandbox.prepare')),
    isPrepared: Effect.tryPromise({
      try: () => driver.isPrepared(),
      catch: () =>
        new MigrationSandboxError({
          runId: driver.runId,
          operation: 'prepare',
          code: 'Unavailable',
        }),
    }).pipe(Effect.withSpan('MigrationSandbox.isPrepared')),
    /** A non-zero exit is a result, not a failure: the plan interprets it. */
    exec: (command: SandboxCommand) =>
      Effect.tryPromise({
        try: (signal) => driver.exec(command, signal),
        catch: () =>
          new MigrationSandboxError({
            runId: driver.runId,
            operation: 'exec',
            code: 'ExecFailed',
          }),
      }).pipe(Effect.withSpan('MigrationSandbox.exec')),
    /**
     * Teardown never fails. Teardown that can fail is teardown that gets
     * skipped, and the vendored implementation already races its own destroy
     * against a timer and swallows the error.
     */
    release: Effect.promise(() => driver.release()).pipe(
      Effect.catchCause(() => Effect.void),
      Effect.withSpan('MigrationSandbox.release'),
    ),
  } as const;
}

export class MigrationSandbox extends Context.Service<
  MigrationSandbox,
  ReturnType<typeof makeMigrationSandbox>
>()('@ceirean/engine/MigrationSandbox') {}
