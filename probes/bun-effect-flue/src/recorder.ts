import { Context, Ref } from 'effect';

export function makeRecorder() {
  const count = Ref.makeUnsafe(0);
  return {
    record: (_token: string) => Ref.updateAndGet(count, (current) => current + 1),
    count: Ref.get(count),
  };
}

export class ProbeRecorder extends Context.Service<
  ProbeRecorder,
  ReturnType<typeof makeRecorder>
>()('leviathan/probe/Recorder') {}
