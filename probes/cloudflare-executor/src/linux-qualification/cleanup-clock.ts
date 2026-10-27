import { Context } from 'effect';

export const CleanupMonotonicClock = Context.Reference<() => number>(
  'ceirean/LinuxCleanupMonotonicClock',
  { defaultValue: () => () => performance.now() },
);
