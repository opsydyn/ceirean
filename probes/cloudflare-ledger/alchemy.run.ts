import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Cloudflare from 'alchemy/Cloudflare';
import { Stack } from 'alchemy/Stack';
import { localState } from 'alchemy/State/LocalState';
import { Config, Effect, Schema } from 'effect';

import Probe from './src/worker.ts';

function* buildLocalProbe() {
  const context = yield* AlchemyContext;
  const decodeLocal = Schema.decodeUnknownEffect(Schema.Literal(true));
  const admission = decodeLocal(context.dev).pipe(
    Effect.mapError((error) => new Config.ConfigError(error)),
  );
  yield* admission;
  const worker = yield* Probe;
  return { url: worker.url };
}
export default Stack(
  'CeireanLocalLedger',
  {
    providers: Cloudflare.providers(),
    state: localState(),
  },
  Effect.gen(buildLocalProbe),
);
