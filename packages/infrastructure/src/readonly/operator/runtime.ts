import * as Service from '@alchemy.run/cloudflare-runtime/core/bindings/Service';
import * as PlatformProxy from '@alchemy.run/cloudflare-runtime/core/platform-proxy/PlatformProxy';
import * as Runtime from '@alchemy.run/cloudflare-runtime/core/Runtime';
import * as RuntimeServices from '@alchemy.run/cloudflare-runtime/core/RuntimeServices';
import { layer as bunServices } from '@effect/platform-bun/BunServices';
import { Credentials } from 'alchemy/Cloudflare';
import { Config, ConfigProvider, Effect, FileSystem, Layer, Schema } from 'effect';
import { layer as httpClient } from 'effect/http/FetchHttpClient';

import { cloudflareToken } from '../../config.ts';
import { Policy } from '../job.ts';
import type { NativeReads } from '../operator-transport.ts';
import { qualifyReadOnlyOperator } from '../operator.ts';

export const operatorTarget = {
  accountId: 'd95812af050c2e549a3296899b7b43b3',
  worker: 'ceireanreadonly-readonlyworker56trhdak554hd5gd7mzqrci7',
};
const platform = Layer.mergeAll(bunServices, httpClient);
const recipe = cloudflareToken.pipe(
  Effect.map((token) =>
    Effect.succeed({
      type: 'apiToken' as const,
      apiToken: token,
      apiBaseUrl: 'https://api.cloudflare.com/client/v4',
    }),
  ),
);
const credentials = Layer.effect(Credentials, recipe);

function* temporaryConfiguration() {
  const fs = yield* FileSystem.FileSystem;
  const base = yield* ConfigProvider.ConfigProvider;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-private-operator-' });
  yield* fs.chmod(directory, 0o700);
  const local = ConfigProvider.fromUnknown({
    XDG_CACHE_HOME: directory,
    XDG_CONFIG_HOME: directory,
    XDG_STATE_HOME: directory,
    XDG_DATA_HOME: directory,
  });
  return ConfigProvider.orElse(base)(local);
}
const configuration = ConfigProvider.layer(Effect.gen(temporaryConfiguration));
function* ownSilentRuntime() {
  const original = yield* Runtime.Runtime;
  return Runtime.Runtime.of({
    start: (worker) => original.start({ ...worker, logging: { onOutput: () => undefined } }),
  });
}
export const silentOperatorRuntime = Layer.effect(Runtime.Runtime, Effect.gen(ownSilentRuntime));
const baseRuntime = RuntimeServices.layerRuntime({ api: operatorTarget }).pipe(
  Layer.provide(credentials),
  Layer.provide(configuration),
  Layer.provide(platform),
);
const runtime = silentOperatorRuntime.pipe(Layer.provideMerge(baseRuntime));

function observeRemoteOperator(policy: Policy) {
  function* inspect() {
    const binding = Service.remote('TARGET', operatorTarget.worker);
    const proxy = yield* PlatformProxy.open<ReadonlyArray<typeof binding>, NativeReads>({
      name: 'ceirean-private-operator',
      bindings: [binding],
    });
    const client = {
      readiness: () => Promise.resolve(proxy.env.TARGET.readiness()),
      status: () => Promise.resolve(proxy.env.TARGET.status()),
    };
    return yield* qualifyReadOnlyOperator(client, policy);
  }
  const inspecting = Effect.gen(inspect);
  const scoped = Effect.scoped(inspecting);
  const provided = Effect.provide(scoped, runtime);
  return provided;
}

const boundedText = Schema.String.check(Schema.isMaxLength(16384));
const decodeText = Schema.decodeUnknownEffect(boundedText);
const decodePolicy = Schema.decodeUnknownEffect(Schema.fromJsonString(Policy), {
  onExcessProperty: 'error',
});
function invalidConfiguration() {
  return new Config.ConfigError(
    new ConfigProvider.SourceError({ message: 'Operator policy is unavailable or invalid.' }),
  );
}
function* loadPolicy() {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* Config.String('CEIREAN_OPERATOR_POLICY_FILE');
  const raw = yield* fs.readFileString(file);
  const bounded = yield* decodeText(raw);
  return yield* decodePolicy(bounded);
}
const loadingPolicy = Effect.gen(loadPolicy);
export const operatorPolicy = loadingPolicy.pipe(Effect.mapError(invalidConfiguration));
function* prepare() {
  const policy = yield* operatorPolicy;
  return yield* observeRemoteOperator(policy);
}
const preparing = Effect.gen(prepare);
export const privateOperatorProbe = Effect.provide(preparing, bunServices);
