import { Stack } from 'alchemy/Stack';
import { localState } from 'alchemy/State/LocalState';

import { cloudflareProviders } from './src/config.ts';
import { prepareRehearsal } from './src/rehearsal.ts';

export default Stack(
  'CeireanHooks',
  { providers: cloudflareProviders, state: localState() },
  prepareRehearsal,
);
