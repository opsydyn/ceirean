import { expect, test } from 'bun:test';

import * as Runtime from '@alchemy.run/cloudflare-runtime/core/Runtime';
import * as RuntimeServices from '@alchemy.run/cloudflare-runtime/core/RuntimeServices';
import { layer as bunServices } from '@effect/platform-bun/BunServices';
import { Credentials } from 'alchemy/Cloudflare';
import { ConfigProvider, Effect, FileSystem, Layer, Schema } from 'effect';
import { layer as httpClient } from 'effect/http/FetchHttpClient';

import { probeLocalReadOnlyOperator } from '../src/readonly/operator-transport.ts';
import { describeReadiness } from '../src/readonly/readiness.ts';

const policy = {
  sessionId: 'native-operator',
  installationId: 10,
  ownerId: 20,
  repositoryId: 30,
  issueNumber: 40,
  operatorId: 50,
  opensAtMs: 1000,
  closesAtMs: 301000,
};

const encodeString = Schema.encodeSync(Schema.fromJsonString(Schema.String));
const source = `
import { WorkerEntrypoint } from 'cloudflare:workers';
export default class Fixture extends WorkerEntrypoint {
  readiness() { return ${encodeString(describeReadiness(policy))}; }
  status() { return 'null'; }
  enqueueReadyV1() { throw new Error('Forbidden admission'); }
  fetch() { return new Response('Forbidden HTTP', { status: 500 }); }
}
`;

function* temporaryConfig() {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-operator-test-' });
  return ConfigProvider.fromUnknown({
    XDG_CACHE_HOME: directory,
    XDG_CONFIG_HOME: directory,
    XDG_STATE_HOME: directory,
    XDG_DATA_HOME: directory,
  });
}
const configLayer = ConfigProvider.layer(Effect.gen(temporaryConfig));
const platformLayer = Layer.mergeAll(bunServices, httpClient);
const noCredentials = Layer.succeed(
  Credentials,
  Effect.die('Remote credentials forbidden in local tests'),
);
const nativeLayer = RuntimeServices.layerRuntime({ api: { accountId: 'unused-local-test' } }).pipe(
  Layer.provide(noCredentials),
  Layer.provide(configLayer),
  Layer.provide(platformLayer),
);
const withNative = Effect.provide(nativeLayer);

async function nativeRpc() {
  function* scenario() {
    const runtime = yield* Runtime.Runtime;
    const url = yield* runtime.start({
      name: 'ceirean-operator-fixture',
      compatibilityDate: '2026-08-31',
      compatibilityFlags: [],
      bindings: [],
      modules: [{ name: 'fixture.mjs', type: 'ESModule', content: source }],
    });
    const result = yield* probeLocalReadOnlyOperator('ceirean-operator-fixture', policy);
    expect(result).toEqual({ protocol: 'readonly-policy-v1', policy, job: null });
    return url;
  }
  const closed = await Effect.runPromise(Effect.gen(scenario).pipe(Effect.scoped, withNative));
  await expect(fetch(closed)).rejects.toBeDefined();
}
test(
  'native workerd service-binding RPC reads readiness and status without HTTP',
  nativeRpc,
  30000,
);
