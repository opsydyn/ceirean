import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect } from 'effect';

import { makeLedger } from './ledger.ts';

export class Ledger extends Cloudflare.DurableObject<Ledger>()(
  'Ledger',
  Effect.gen(function* constructLedger() {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.succeed(makeLedger(state.raw.storage));
  }),
) {}
