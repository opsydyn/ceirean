import { Effect, Layer, ManagedRuntime } from 'effect';
import { ProbeRecorder } from './recorder.ts';

export function createRecorderBridge() {
  let acquired = 0;
  let released = 0;
  const live = Layer.effect(ProbeRecorder, Effect.acquireRelease(
    Effect.sync(() => {
      acquired++;
      let count = 0;
      return {
        record: (_token: string) => Effect.sync(() => ++count),
        count: Effect.sync(() => count),
      };
    }),
    () => Effect.sync(() => { released++; }),
  ));
  const runtime = ManagedRuntime.make(live);
  return {
    record: (token: string) => runtime.runPromise(ProbeRecorder.use((service) => service.record(token))),
    count: () => runtime.runPromise(ProbeRecorder.use((service) => service.count)),
    dispose: () => runtime.dispose(),
    lifecycle: () => ({ acquired, released }),
  };
}
