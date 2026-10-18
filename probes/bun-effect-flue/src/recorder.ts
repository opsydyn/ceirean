import { Context, Effect } from 'effect';

export class ProbeRecorder extends Context.Service<ProbeRecorder, {
  readonly record: (token: string) => Effect.Effect<number>;
  readonly count: Effect.Effect<number>;
}>()('leviathan/probe/Recorder') {}
