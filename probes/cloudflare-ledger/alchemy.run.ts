import * as Cloudflare from 'alchemy/Cloudflare';
import { Stack } from 'alchemy/Stack';
import { localState } from 'alchemy/State/LocalState';
import { Effect } from 'effect';

import Probe from './src/worker.ts';

export default Stack(
  'CeireanLocalLedger',
  {
    providers: Cloudflare.providers(),
    state: localState(),
  },
  Probe.pipe(Effect.map((worker) => ({ url: worker.url }))),
);
