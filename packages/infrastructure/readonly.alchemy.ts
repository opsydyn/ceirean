import { Stack } from 'alchemy/Stack';
import { localState } from 'alchemy/State/LocalState';
import { Config, Effect, Schema } from 'effect';

import { cloudflareProviders } from './src/config.ts';
import { ingressConfiguration } from './src/readonly/routing.ts';
import ReadOnlyWorker from './src/readonly/worker.ts';

const decodeApproval = Schema.decodeUnknownEffect(Schema.Literal('approved'));
function* prepareReadOnly() {
  const approval = yield* Config.String('CEIREAN_PREPARE_READONLY');
  yield* decodeApproval(approval).pipe(Effect.mapError((error) => new Config.ConfigError(error)));
  const ingress = yield* ingressConfiguration;
  const worker = yield* ReadOnlyWorker;
  return { workerId: worker.workerId, ingress };
}

export default Stack(
  'CeireanReadOnly',
  {
    providers: cloudflareProviders,
    state: localState(),
  },
  Effect.gen(prepareReadOnly),
);
