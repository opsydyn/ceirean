import { Effect, Layer, ManagedRuntime } from 'effect';

import { makeRecorder, ProbeRecorder } from './recorder.ts';

export function createRecorderBridge() {
  let acquired = 0;
  let released = 0;
  function acquireRecorder() {
    acquired++;
    return makeRecorder();
  }
  const acquire = Effect.sync(acquireRecorder);
  const release = Effect.sync(() => {
    released++;
  });
  const recorder = Effect.acquireRelease(acquire, () => release);
  const live = Layer.effect(ProbeRecorder, recorder);
  const runtime = ManagedRuntime.make(live);
  return {
    record: (token: string) =>
      runtime.runPromise(ProbeRecorder.use((service) => service.record(token))),
    count: () => runtime.runPromise(ProbeRecorder.use((service) => service.count)),
    dispose: () => runtime.dispose(),
    lifecycle: () => ({ acquired, released }),
  };
}
