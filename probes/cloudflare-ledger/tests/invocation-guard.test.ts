import { expect } from 'bun:test';

import * as Cloudflare from 'alchemy/Cloudflare';
import { Stage } from 'alchemy/Stage';
import * as Test from 'alchemy/Test/Bun';
import { Effect } from 'effect';

import Stack from '../invocation.alchemy.ts';
import { recordOwnedProcesses } from './process-tree.test.ts';

const forbidden = Test.make({
  providers: Cloudflare.providers(),
  dev: false,
  stage: 'test_ceirean_invocation_forbidden',
});
function* rejectLiveAssembly() {
  const checking = Stack.pipe(
    Effect.provideService(Stage, 'test_ceirean_invocation_forbidden'),
    Effect.flip,
  );
  const error = yield* checking;
  expect(error).toMatchObject({ _tag: 'ConfigError' });
  expect(error.message).toContain('Expected true');
  yield* recordOwnedProcesses();
}
forbidden.test(
  'invocation stack rejects non-local assembly before queues or Workers',
  Effect.gen(rejectLiveAssembly),
);
