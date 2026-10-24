import { expect } from 'bun:test';

import * as Cloudflare from 'alchemy/Cloudflare';
import { Stage } from 'alchemy/Stage';
import * as Test from 'alchemy/Test/Bun';
import { Effect } from 'effect';

import Stack from '../alchemy.run.ts';
import { recordOwnedProcesses } from './process-tree.test.ts';

const offline = Test.make({
  providers: Cloudflare.providers(),
  dev: false,
  stage: 'test_ceirean_forbidden',
});
function* rejectNonlocal() {
  // Compile only: never call deploy on the non-local harness.
  const rejected = Stack.pipe(Effect.provideService(Stage, 'test_ceirean_forbidden'), Effect.flip);
  const error = yield* rejected;
  expect(error).toMatchObject({ _tag: 'ConfigError' });
  expect(error.message).toContain('Expected true');
  yield* recordOwnedProcesses();
}
offline.test(
  'the probe rejects non-local stack construction before resource assembly',
  Effect.gen(rejectNonlocal),
);
