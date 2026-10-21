import { providers } from 'alchemy/Cloudflare';
import { Stack } from 'alchemy/Stack';
import { localState } from 'alchemy/State/LocalState';

import { prepareRehearsal } from './src/rehearsal.ts';

export default Stack(
  'CeireanHooks',
  { providers: providers(), state: localState() },
  prepareRehearsal,
);
