import * as Cloudflare from 'alchemy/Cloudflare';
import { Config, ConfigProvider, Effect, Match, Redacted } from 'effect';
import { HttpServerRequest, toWeb } from 'effect/http/HttpServerRequest';
import { fromWeb, text } from 'effect/http/HttpServerResponse';

import { handleReadOnlyRequest } from './ingress.ts';
import type { Candidate, Policy } from './job.ts';
import { ReadOnlyJob, policyConfiguration } from './object.ts';

type Namespace = Effect.Success<typeof ReadOnlyJob>;
function validateSigningSecret(secret: Redacted.Redacted<string>) {
  const valid = Redacted.value(secret).length >= 32;
  return Match.value(valid).pipe(
    Match.when(true, () => Config.succeed(secret)),
    Match.orElse(() =>
      Config.fail(
        new ConfigProvider.SourceError({
          message: 'The read-only webhook signing secret must contain at least 32 characters.',
        }),
      ),
    ),
  );
}
export const webhookSecretConfiguration = Config.Redacted('CEIREAN_READONLY_WEBHOOK_SECRET').pipe(
  Config.mapEffect(validateSigningSecret),
);
export function makeReadOnlyHandlers(
  objects: Pick<Namespace, 'getByName'>,
  policy: Policy,
  secret: Redacted.Redacted<string>,
) {
  function* request() {
    const incoming = yield* HttpServerRequest;
    const web = yield* toWeb(incoming);
    const enqueue = (candidate: Candidate) =>
      objects.getByName(policy.sessionId).enqueue(candidate);
    const response = yield* handleReadOnlyRequest(web, policy, secret, enqueue);
    return fromWeb(response);
  }
  function* conversionFailure() {
    yield* Effect.logWarning('Ceirean read-only request conversion failed');
    return text('Request unavailable', { status: 503 });
  }
  const handling = Effect.gen(request);
  return {
    fetch: handling.pipe(Effect.catch(() => Effect.gen(conversionFailure))),
    status: () => objects.getByName(policy.sessionId).status(),
  };
}

function* construct() {
  const objects = yield* ReadOnlyJob;
  const policy = yield* policyConfiguration;
  const secret = yield* webhookSecretConfiguration;
  return makeReadOnlyHandlers(objects, policy, secret);
}

export default class ReadOnlyWorker extends Cloudflare.Worker<ReadOnlyWorker>()(
  'ReadOnlyWorker',
  {
    main: import.meta.url,
    workersDev: false,
    dev: { host: '127.0.0.1', port: 0 },
    compatibility: { date: '2026-10-28', flags: ['nodejs_compat'] },
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true },
    },
  },
  Effect.gen(construct),
) {}
