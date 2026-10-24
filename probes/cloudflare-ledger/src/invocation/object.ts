import { authenticatePrivateMessage } from '@ceirean/cloudflare-executor-probe/invocation';
import * as Cloudflare from 'alchemy/Cloudflare';
import { Clock, Config, Effect, Schema } from 'effect';

import { makeReplayStore } from './store.ts';

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
function* construct() {
  const state = yield* Cloudflare.DurableObjectState;
  const store = makeReplayStore(state.raw.storage);
  function accept(encoded: string, fault = false) {
    function* inspect() {
      const policy = yield* decode(yield* Config.String('CEIREAN_INVOCATION_POLICY'));
      const input = yield* decode(encoded);
      const now = yield* Clock.currentTimeMillis;
      const authenticated = yield* authenticatePrivateMessage(input, policy, now);
      return yield* store.record(authenticated.receipt, fault);
    }
    const workflow = Effect.gen(inspect);
    return workflow;
  }
  const service = Effect.succeed({ accept, read: store.read, corrupt: store.corrupt });
  return service;
}
export class InspectionReplay extends Cloudflare.DurableObject<InspectionReplay>()(
  'InspectionReplay',
  Effect.gen(construct),
) {}
