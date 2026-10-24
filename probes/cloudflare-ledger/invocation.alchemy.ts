import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Cloudflare from 'alchemy/Cloudflare';
import { Stack } from 'alchemy/Stack';
import { localState } from 'alchemy/State/LocalState';
import { Config, Effect, Schema } from 'effect';

import Worker from './src/invocation/worker.ts';

const decodeLocal = Schema.decodeUnknownEffect(Schema.Literal(true));
const decodeIsolated = Schema.decodeUnknownEffect(Schema.Literal('1'));

function* localInvocation() {
  const context = yield* AlchemyContext;
  const local = decodeLocal(context.dev);
  yield* local.pipe(Effect.mapError((error) => new Config.ConfigError(error)));
  const isolated = yield* Config.String('CEIREAN_LOCAL_DO');
  const allowed = decodeIsolated(isolated);
  yield* allowed.pipe(Effect.mapError((error) => new Config.ConfigError(error)));
  const worker = yield* Worker;
  return { url: worker.url };
}
export default Stack(
  'CeireanLocalInvocation',
  { providers: Cloudflare.providers(), state: localState() },
  Effect.gen(localInvocation),
);
