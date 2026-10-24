import { Config, Effect, Match } from 'effect';

import { local } from './harness.ts';
import { seedRuntime, verifyRuntime } from './restart-child.ts';

function* restartCase() {
  const phase = yield* Config.String('CEIREAN_DO_PHASE');
  const work = Match.value(phase).pipe(
    Match.when('Seed', () => Effect.gen(seedRuntime)),
    Match.when('Verify', () => Effect.gen(verifyRuntime)),
    Match.orElse(() => Effect.die('Invalid local restart phase')),
  );
  yield* work;
}
local.test(
  'same DO recovers state and events after a complete runtime restart',
  Effect.gen(restartCase),
);
