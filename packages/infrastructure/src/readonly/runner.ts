import { Effect, Exit } from 'effect';

import type { makeSmokeContainer } from './container.ts';
import type { Outcome } from './job.ts';

export function cleanupSmoke(container: ReturnType<typeof makeSmokeContainer>) {
  function* clean() {
    const destroyed = yield* Effect.suspend(container.destroy).pipe(Effect.exit);
    const stopped = yield* container.stopped.pipe(Effect.exit);
    return Exit.isSuccess(destroyed) && Exit.isSuccess(stopped) && stopped.value;
  }
  const cleaning = Effect.gen(clean);
  return cleaning.pipe(
    Effect.interruptible,
    Effect.timeout('15 seconds'),
    Effect.exit,
    Effect.map(Exit.match({ onFailure: () => false, onSuccess: (cleaned) => cleaned })),
  );
}

export function runSmoke(container: ReturnType<typeof makeSmokeContainer>) {
  function* execute() {
    yield* container.start();
    return yield* container.execute();
  }
  function completed(runtime: string): Outcome {
    return { _tag: 'Completed', runtime };
  }
  function failed(): Outcome {
    return { _tag: 'Failed', code: 'CommandFailed' };
  }
  function owned(restore: Parameters<Parameters<typeof Effect.uninterruptibleMask>[0]>[0]) {
    function* run() {
      const execution = Effect.gen(execute);
      const executed = yield* restore(execution).pipe(Effect.timeout('60 seconds'), Effect.exit);
      const cleaned = yield* cleanupSmoke(container);
      const outcome = Exit.match(executed, { onSuccess: completed, onFailure: failed });
      return { outcome, cleaned };
    }
    const running = Effect.gen(run);
    return running;
  }
  const running = Effect.uninterruptibleMask(owned);
  return running;
}
