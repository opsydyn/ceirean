import { Context } from 'effect';

import { makeLiveAuthority, makeLiveInbox } from './live-admission-factories.ts';

export class LiveInbox extends Context.Service<LiveInbox, ReturnType<typeof makeLiveInbox>>()(
  '@leviathan/engine/LiveInbox',
) {}
export class LiveAuthority extends Context.Service<
  LiveAuthority,
  ReturnType<typeof makeLiveAuthority>
>()('@leviathan/engine/LiveAuthority') {}
