import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect, Match, Schema } from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import { text } from 'effect/http/HttpServerResponse';

import { Ledger } from './object.ts';

const failureCodec = Schema.fromJsonString(
  Schema.Struct({ _tag: Schema.Literal('ProbeFailure'), code: Schema.String }),
);
const encodeFailure = Schema.encodeUnknownSync(failureCodec);
function failureResponse(error: { readonly code: string }) {
  return text(encodeFailure({ _tag: 'ProbeFailure', code: error.code }), {
    status: 422,
    contentType: 'application/json',
  });
}
function* constructProbe() {
  const objects = yield* Ledger;
  function* handleProbe() {
    const request = yield* HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const object = objects.getByName(url.searchParams.get('name') ?? 'default');
    const body = yield* request.text;
    const action = Match.value(url.pathname).pipe(
      Match.when('/commit', () => object.commit(body)),
      Match.when('/fault', () => object.commit(body, true)),
      Match.when('/read', () => object.read()),
      Match.when('/recover', () => object.recover()),
      Match.when('/audit', () => object.audit()),
      Match.when('/corrupt', () => object.corrupt()),
      Match.orElse(() => Effect.fail({ _tag: 'ProbeStorageError' as const, code: 'InvalidRoute' })),
    );
    const encoded = yield* action;
    return text(encoded, { contentType: 'application/json' });
  }
  const handling = Effect.gen(handleProbe);
  const handlers = {
    fetch: handling.pipe(
      Effect.catchTag('ProbeStorageError', (error) => Effect.succeed(failureResponse(error))),
    ),
  };
  return handlers;
}
export default class Probe extends Cloudflare.Worker<Probe>()(
  'LedgerProbe',
  {
    main: import.meta.url,
    dev: { host: '127.0.0.1', port: 0 },
  },
  Effect.gen(constructProbe),
) {}
