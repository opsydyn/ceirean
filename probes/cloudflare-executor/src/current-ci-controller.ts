import { Effect, Exit, Match, Schema } from 'effect';

import type { makeCurrentCiPorts } from './current-ci-platform.ts';
import { requireSupervisor } from './linux-qualification/docker-process.ts';

export const currentCiBudgets = {
  acquisitionMs: 480000,
  workerMs: 960000,
  totalMs: 1560000,
  cleanupMs: 120000,
} as const;
export function currentCiCheck(argv: readonly string[]) {
  const Arguments = Schema.Union([Schema.Tuple([]), Schema.Tuple([Schema.Literal('--check')])]);
  const isCheck = Schema.is(Arguments);
  const check = isCheck(argv);
  return Match.value(check).pipe(
    Match.when(
      true,
      () =>
        ({
          code: 2,
          activation: 'Blocked',
          status: 'PreparedNotPublished',
          blockers: [
            'SourcePublication',
            'ImplementationPin',
            'ControllerToolPin',
            'OneRunApproval',
          ],
        }) as const,
    ),
    Match.orElse(() => ({ code: 64, activation: 'Blocked', status: 'UsageError' }) as const),
  );
}
export function runCurrentCiCache(owner: string, ports: ReturnType<typeof makeCurrentCiPorts>) {
  function* execute() {
    yield* ports.prepare(owner).pipe(Effect.timeout(currentCiBudgets.acquisitionMs));
    for (const kind of ['inputs', 'tools', 'work'] as const) yield* ports.createVolume(owner, kind);
    yield* ports.stage(owner);
    yield* ports.createConsumer(owner);
    yield* ports.start(owner);
    yield* ports.wait(owner).pipe(Effect.timeout(currentCiBudgets.workerMs));
    yield* ports.stop(owner);
    return yield* ports.export(owner);
  }
  function boundedExecution() {
    const workflow = Effect.gen(execute);
    return workflow.pipe(Effect.timeout(currentCiBudgets.totalMs), Effect.scoped);
  }
  function masked(restore: typeof Effect.interruptible) {
    function* owned() {
      yield* requireSupervisor(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(owner),
        'InputChanged',
      );
      const result = yield* restore(boundedExecution()).pipe(Effect.exit);
      const cleaning = ports
        .cleanup(owner)
        .pipe(Effect.timeout(currentCiBudgets.cleanupMs), Effect.scoped);
      const cleaned = yield* cleaning.pipe(Effect.exit);
      const success = Exit.isSuccess(result) && Exit.isSuccess(cleaned);
      const cleanup = Match.value(Exit.isSuccess(cleaned)).pipe(
        Match.when(true, () => 'Confirmed' as const),
        Match.orElse(() => 'Unknown' as const),
      );
      return Match.value(success).pipe(
        Match.when(true, () => ({
          status: 'CacheOnlyRetained' as const,
          activation: 'Blocked' as const,
          qualified: false,
          cleanup: 'Confirmed' as const,
          seed: Exit.getSuccess(result),
        })),
        Match.orElse(() => ({
          status: 'CacheOnlyFailed' as const,
          activation: 'Blocked' as const,
          qualified: false,
          cleanup,
          reason: 'ControllerRefused' as const,
        })),
      );
    }
    const workflow = Effect.gen(owned);
    return workflow;
  }
  const workflow = Effect.uninterruptibleMask(masked);
  return workflow;
}
