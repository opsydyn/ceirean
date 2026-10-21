import { deepStrictEqual, strictEqual } from 'node:assert';
import { test } from 'node:test';

import { Unowned } from 'alchemy/AdoptPolicy';
import { CloudflareEnvironment, Credentials, Tunnel } from 'alchemy/Cloudflare';
import { noopSession } from 'alchemy/Report';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { Effect, Layer, Match, Redacted } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';

const foreign = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'ownership-repro',
  account_tag: '00000000000000000000000000000000',
  config_src: 'cloudflare',
  deleted_at: null,
  tun_type: 'cfd_tunnel',
};
const identity = { id: 'Tunnel', fqn: 'Tunnel', instanceId: 'new-instance' };
const props = {
  name: 'ownership-repro',
  configSrc: 'cloudflare' as const,
  adopt: false,
  ingress: [
    { hostname: 'repro.invalid', service: 'http://127.0.0.1:8787' },
    { service: 'http_status:404' },
  ],
};
const account = Effect.succeed({
  type: 'apiToken' as const,
  apiToken: Redacted.make('synthetic-only'),
  accountId: '00000000000000000000000000000000',
  source: { type: 'env' as const },
});
const credential = Effect.succeed({
  type: 'apiToken' as const,
  apiToken: Redacted.make('synthetic-only'),
  apiBaseUrl: 'https://cloudflare.invalid/client/v4',
});

function fixture(initialPages: ReadonlyArray<ReadonlyArray<typeof foreign>>) {
  const pages = [...initialPages];
  const calls: string[] = [];
  const targets: string[] = [];
  function response(request: HttpClientRequest.HttpClientRequest, url: URL) {
    strictEqual(url.hostname, 'cloudflare.invalid');
    const operation = `${request.method} ${url.pathname.split('/').at(-1)}`;
    calls.push(operation);
    targets.push(`${request.method} ${url.pathname}`);
    const body = Match.value(operation).pipe(
      Match.when('GET tunnels', () => ({
        success: true,
        errors: [],
        messages: [],
        result: pages.shift() ?? [foreign],
        result_info: { page: 1, per_page: 50, total_pages: 1 },
      })),
      Match.when('GET token', () => ({
        success: true,
        errors: [],
        messages: [],
        result: 'synthetic-connector-token',
      })),
      Match.when('PUT configurations', () => ({
        success: true,
        errors: [],
        messages: [],
        result: {},
      })),
      Match.orElse(() => ({
        success: false,
        errors: [{ code: 10000, message: `Unexpected fixture request: ${operation}` }],
        messages: [],
        result: null,
      })),
    );
    return HttpClientResponse.fromWeb(request, Response.json(body));
  }
  const client = HttpClient.make((request, url) => Effect.succeed(response(request, url)));
  const graph = Stack.of({
    name: 'OwnershipRepro',
    stage: 'offline',
    resources: {},
    bindings: {},
    actions: {},
  });
  const ambient = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(CloudflareEnvironment, account),
    Layer.succeed(Credentials, credential),
    Layer.succeed(Stage, 'offline'),
    Layer.succeed(Stack, graph),
  );
  const providers = Layer.provideMerge(Tunnel.TunnelProvider(), ambient);
  function reset() {
    calls.length = 0;
    targets.length = 0;
    pages.splice(0, pages.length, ...initialPages);
  }
  return { calls, targets, providers, reset };
}

function* readForeignTunnel() {
  const provider = yield* Tunnel.Tunnel.Provider;
  const read = yield* Effect.fromNullishOr(provider.read);
  const output = yield* read({ ...identity, olds: props, output: undefined });
  return { tunnelId: output?.tunnelId, markedUnowned: Unowned.is(output) };
}
const existing = fixture([[foreign]]);
const read = Effect.gen(readForeignTunnel);
export const readExisting = Effect.provide(read, existing.providers);

async function characterizesUnownedRead() {
  existing.reset();
  const output = await Effect.runPromise(readExisting);
  deepStrictEqual(output, {
    tunnelId: '11111111-1111-4111-8111-111111111111',
    markedUnowned: false,
  });
  deepStrictEqual(existing.calls, ['GET tunnels', 'GET token']);
  strictEqual(
    existing.targets[1],
    'GET /client/v4/accounts/00000000000000000000000000000000/cfd_tunnel/11111111-1111-4111-8111-111111111111/token',
  );
}
test(
  'beta.83 ownership blocker: foreign same-name read lacks the required Unowned marker',
  characterizesUnownedRead,
);

function* reconcileAfterCleanRead() {
  const provider = yield* Tunnel.Tunnel.Provider;
  const read = yield* Effect.fromNullishOr(provider.read);
  const absent = yield* read({ ...identity, olds: props, output: undefined });
  const output = yield* provider.reconcile({
    ...identity,
    news: props,
    olds: undefined,
    output: undefined,
    bindings: [],
    session: { ...noopSession, note: () => Effect.void },
  });
  return { absent, tunnelId: output.tunnelId };
}
const raced = fixture([[], [foreign]]);
const reconcile = Effect.gen(reconcileAfterCleanRead);
export const reconcileRace = Effect.provide(reconcile, raced.providers);

async function characterizesOwnershipRace() {
  raced.reset();
  const output = await Effect.runPromise(reconcileRace);
  deepStrictEqual(output, { absent: undefined, tunnelId: '11111111-1111-4111-8111-111111111111' });
  deepStrictEqual(raced.calls, ['GET tunnels', 'GET tunnels', 'PUT configurations', 'GET token']);
  strictEqual(
    raced.targets[2],
    'PUT /client/v4/accounts/00000000000000000000000000000000/cfd_tunnel/11111111-1111-4111-8111-111111111111/configurations',
  );
}
test(
  'beta.83 ownership blocker: reconcile mutates a tunnel appearing after clean preflight despite adopt false',
  characterizesOwnershipRace,
);
