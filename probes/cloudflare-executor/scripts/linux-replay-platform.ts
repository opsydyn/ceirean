import { createServer, type RequestListener } from 'node:http';

import { Data, Effect, Match, Schema } from 'effect';

export class ReplayPlatformError extends Data.TaggedError('ReplayPlatformError')<{
  readonly code: 'ListenFailed' | 'StopFailed';
}> {}
type Request = { readonly method: string; readonly path: string };
type Response = { readonly status: number; readonly body: Uint8Array };
type Respond = (request: Request) => Response;
type StopCallback = Parameters<typeof Effect.callback<void>>[0];
type ListenCallback = Parameters<typeof Effect.callback<void, ReplayPlatformError>>[0];
const isAddress = Schema.is(
  Schema.Struct({ address: Schema.String, port: Schema.Number, family: Schema.String }),
);
const isLoopback = Schema.is(Schema.Literal('127.0.0.1'));
function handler(respond: Respond): RequestListener {
  function handle(
    request: Parameters<RequestListener>[0],
    response: Parameters<RequestListener>[1],
  ) {
    const result = respond({ method: request.method ?? '', path: request.url ?? '' });
    response.writeHead(result.status, {
      'content-type': 'application/octet-stream',
      'content-length': String(result.body.length),
      connection: 'close',
    });
    response.end(result.body);
  }
  return handle;
}
function stopServer(server: ReturnType<typeof createServer>) {
  const awaitShutdown: StopCallback = (resume) => {
    function closed(error?: Error) {
      const result = Match.value(error).pipe(
        Match.when(undefined, () => Effect.void),
        Match.orElse(() => Effect.die(new ReplayPlatformError({ code: 'StopFailed' }))),
      );
      resume(result);
    }
    server.close(closed);
    server.closeAllConnections();
  };
  const closing = Effect.callback<void>(awaitShutdown);
  const isListening = Effect.sync(() => server.listening);
  const stopping = closing.pipe(Effect.when(isListening));
  return stopping;
}
// Private adapter seam permits ephemeral test ports, never a configurable host.
export function makeLoopbackListener(port: number) {
  function listen(respond: Respond) {
    function* start() {
      const creating = Effect.try({
        try: () =>
          createServer(
            { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 },
            handler(respond),
          ),
        catch: () => new ReplayPlatformError({ code: 'ListenFailed' }),
      });
      const server = yield* Effect.acquireRelease(creating, stopServer);
      const awaitListening: ListenCallback = (resume) => {
        const onError = () =>
          resume(Effect.fail(new ReplayPlatformError({ code: 'ListenFailed' })));
        function listening() {
          server.off('error', onError);
          resume(Effect.void);
        }
        server.once('error', onError);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, listening);
      };
      const opening = Effect.callback<void, ReplayPlatformError>(awaitListening);
      // Drain native listen acknowledgement before interruption can run release.
      yield* Effect.uninterruptible(opening);
      const address = server.address();
      const bound = Match.value(address).pipe(
        Match.when(isAddress, (value) => value),
        Match.orElse(() => undefined),
      );
      const selection = Effect.fromNullishOr(bound);
      const selecting = selection.pipe(
        Effect.filterOrFail(
          (value) => isLoopback(value.address),
          () => new ReplayPlatformError({ code: 'ListenFailed' }),
        ),
      );
      const selected = yield* selecting;
      return { host: '127.0.0.1' as const, port: selected.port };
    }
    const workflow = Effect.gen(start);
    return workflow;
  }
  return listen;
}
export const productionListener = makeLoopbackListener(4873);
