import { deepStrictEqual, strictEqual } from 'node:assert';
import { test } from 'node:test';

import { CloudflareEnvironment, Providers } from 'alchemy/Cloudflare';
import { evaluate } from 'alchemy/Output';
import { Stack } from 'alchemy/Stack';
import { defaultState } from 'alchemy/Test/TestState';
import { Effect, Layer, Redacted } from 'effect';

import { declareRehearsal, prepareRehearsal } from '../src/rehearsal.ts';

function makeGraph() {
  return Stack.of({
    name: 'CeireanHooks',
    stage: 'rehearsal',
    resources: {},
    bindings: {},
    actions: {},
  });
}
function* compileRehearsalGraph() {
  const graph = yield* Stack;
  const output = yield* declareRehearsal;
  const upstream = {
    RehearsalTunnel: { tunnelId: 'test-tunnel-id', token: Redacted.make('must-not-escape') },
  };
  const resources = [];
  for (const resource of Object.values(graph.resources)) {
    const props = yield* evaluate(resource.Props, upstream);
    resources.push({ type: resource.Type, props, adopt: resource.Adopt });
  }
  const resolvedOutput: unknown = yield* evaluate(output, upstream);
  return { resources, output: resolvedOutput, actions: graph.actions };
}
const graphLayer = Layer.mergeAll(
  defaultState(),
  Layer.sync(Stack, makeGraph),
  Layer.succeed(Providers, { kind: 'ProviderCollection', providers: {}, get: () => undefined }),
);
const approvedCredentials = Effect.succeed({
  type: 'apiToken' as const,
  apiToken: Redacted.make('offline-test-only'),
  accountId: 'd95812af050c2e549a3296899b7b43b3',
  source: { type: 'env' as const },
});
const unapprovedCredentials = Effect.succeed({
  type: 'apiToken' as const,
  apiToken: Redacted.make('offline-test-only'),
  accountId: '00000000000000000000000000000000',
  source: { type: 'env' as const },
});
const declaration = Effect.gen(compileRehearsalGraph);
const approvedLayer = Layer.merge(
  graphLayer,
  Layer.succeed(CloudflareEnvironment, approvedCredentials),
);
const unapprovedLayer = Layer.merge(
  graphLayer,
  Layer.succeed(CloudflareEnvironment, unapprovedCredentials),
);
export const compiled = Effect.provide(declaration, approvedLayer);
export const unapproved = Effect.provide(declaration, unapprovedLayer);
const rejected = Effect.result(unapproved);

function* blockedPreparationGraph() {
  const result = yield* Effect.result(prepareRehearsal);
  const graph = yield* Stack;
  return { result, resources: Object.keys(graph.resources) };
}
const preparation = Effect.gen(blockedPreparationGraph);
export const blockedPreparation = Effect.provide(preparation, approvedLayer);

async function refusesPendingPreparation() {
  const result = await Effect.runPromise(blockedPreparation);
  strictEqual(result.result._tag, 'Failure');
  deepStrictEqual(result.resources, []);
}
test(
  'entrypoint refuses resource registration while operational preparation is pending',
  refusesPendingPreparation,
);

async function restrictedResources() {
  const result = await Effect.runPromise(compiled);
  deepStrictEqual(result.resources, [
    {
      type: 'Cloudflare.Tunnel.Tunnel',
      props: { name: 'ceirean-rehearsal-bcea4099a8934e32', configSrc: 'cloudflare', adopt: false },
      adopt: false,
    },
    {
      type: 'Cloudflare.Tunnel.Configuration',
      props: {
        tunnelId: 'test-tunnel-id',
        ingress: [
          {
            hostname: 'ceirean-hooks.opsydyn.xyz',
            path: '^/webhook$',
            service: 'http://127.0.0.1:8787',
          },
        ],
        catchAllService: 'http_status:404',
      },
      adopt: false,
    },
    {
      type: 'Cloudflare.DNS.Record',
      props: {
        zoneId: '65de6815d54763e90ebf4e5df3a7030c',
        name: 'ceirean-hooks.opsydyn.xyz',
        type: 'CNAME',
        content: 'test-tunnel-id.cfargotunnel.com',
        proxied: true,
      },
      adopt: false,
    },
  ]);
  deepStrictEqual(result.actions, {});
  deepStrictEqual(result.output, {
    tunnelId: 'test-tunnel-id',
    endpoint: 'https://ceirean-hooks.opsydyn.xyz/webhook',
  });
}
test(
  'declares only an exact webhook tunnel route and DNS, without processes or secret outputs',
  restrictedResources,
);

async function wrongAccount() {
  const result = await Effect.runPromise(rejected);
  strictEqual(result._tag, 'Failure');
}
test('rejects a provider profile for any other Cloudflare account', wrongAccount);
