import { Identity } from '@ceirean/cloudflare-executor-probe/contract';
import { authenticatePrivateMessage } from '@ceirean/cloudflare-executor-probe/invocation';
import { ReplayDecision } from '@ceirean/cloudflare-executor-probe/replay';
import * as Cloudflare from 'alchemy/Cloudflare';
import {
  Clock,
  Config,
  Data,
  Effect,
  Layer,
  Match,
  Ref,
  Result,
  Schema,
  Stream,
  Struct,
} from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import { text } from 'effect/http/HttpServerResponse';

import { InspectionReplay } from './object.ts';

export const InspectionIngress = Cloudflare.Queues.Queue('InspectionIngress');
export const InspectionDeadLetters = Cloudflare.Queues.Queue('InspectionDeadLetters');
const json = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const scopeSchema = Schema.Struct({ sessionId: Identity });
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
class LocalInvocationError extends Data.TaggedError('LocalInvocationError')<{
  readonly code: 'InputRejected' | 'AckLost';
}> {}
function append(bytes: Uint8Array, chunk: Uint8Array) {
  const allowed = bytes.length + chunk.length <= 131072;
  const checked = Result.succeed(chunk).pipe(
    Result.filterOrFail(
      () => allowed,
      () => new LocalInvocationError({ code: 'InputRejected' }),
    ),
  );
  function join(next: Uint8Array) {
    const result = new Uint8Array(bytes.length + next.length);
    result.set(bytes);
    result.set(next, bytes.length);
    return result;
  }
  return checked.pipe(Result.map(join));
}
const decodeDecision = Schema.decodeUnknownEffect(Schema.fromJsonString(ReplayDecision));
function* construct() {
  const configured = yield* Config.String('CEIREAN_INVOCATION_POLICY');
  const policy = yield* json(configured);
  const scope = yield* Schema.decodeUnknownEffect(scopeSchema)(policy);
  const ingress = yield* InspectionIngress;
  const deadLetters = yield* InspectionDeadLetters;
  const deadLetterQueue = yield* yield* deadLetters.queueName;
  const queue = yield* Cloudflare.Queues.WriteQueue(ingress);
  const objects = yield* InspectionReplay;
  const stats = yield* Ref.make({ verifiedCalls: 0, recorded: 0, replayed: 0, refused: 0 });
  const failAck = yield* Ref.make(true);
  function process(body: unknown) {
    function* consume() {
      const now = yield* Clock.currentTimeMillis;
      const checking = authenticatePrivateMessage(body, policy, now);
      const authenticated = yield* checking.pipe(Effect.result);
      function* verified() {
        const value = Result.getOrThrow(authenticated);
        yield* Ref.update(stats, Struct.evolve({ verifiedCalls: (count) => count + 1 }));
        const object = objects.getByName(value.receipt.sessionId);
        const response = yield* object.accept(encode(body));
        const decision = yield* decodeDecision(response);
        function* newlyRecorded() {
          yield* Ref.update(stats, Struct.evolve({ recorded: (count) => count + 1 }));
          const lost = yield* Ref.getAndSet(failAck, false);
          const acknowledged = Result.succeed(true).pipe(
            Result.filterOrFail(
              () => !lost,
              () => new LocalInvocationError({ code: 'AckLost' }),
            ),
          );
          yield* Effect.fromResult(acknowledged);
        }
        const counted = Match.value(decision.disposition).pipe(
          Match.when('Recorded', () => Effect.gen(newlyRecorded)),
          Match.when('Replay', () =>
            Ref.update(stats, Struct.evolve({ replayed: (count) => count + 1 })),
          ),
          Match.orElse(() => Ref.update(stats, Struct.evolve({ refused: (count) => count + 1 }))),
        );
        yield* counted;
      }
      function* rejected() {
        yield* Ref.update(stats, Struct.evolve({ refused: (count) => count + 1 }));
      }
      yield* Result.match(authenticated, {
        onSuccess: () => Effect.gen(verified),
        onFailure: () => Effect.gen(rejected),
      });
    }
    const workflow = Effect.gen(consume);
    return workflow;
  }
  yield* Cloudflare.Queues.consumeQueueMessages(
    ingress,
    {
      batchSize: 1,
      maxConcurrency: 1,
      maxRetries: 2,
      retryDelay: '1 second',
      maxWaitTime: '1 millis',
      deadLetterQueue,
    },
    (stream) => Stream.runForEach(stream, (message) => process(message.body)),
  );
  function* request() {
    const incoming = yield* HttpServerRequest;
    const url = new URL(incoming.url, 'http://localhost');
    const body = yield* Stream.runFoldEffect(
      incoming.stream,
      () => new Uint8Array(),
      (bytes, chunk) => Effect.fromResult(append(bytes, chunk)),
    );
    const content = yield* Effect.try({
      try: () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body),
      catch: () => new LocalInvocationError({ code: 'InputRejected' }),
    });
    const object = objects.getByName(scope.sessionId);
    function* publish() {
      const packet = yield* json(content);
      yield* queue.send(packet);
      return encode({ _tag: 'PublishedLocally', activation: 'Blocked' });
    }
    const readingStats = Ref.get(stats).pipe(Effect.map(encode));
    const missing = Effect.succeed(encode({ _tag: 'NotFound', activation: 'Blocked' }));
    const action = Match.value(url.pathname).pipe(
      Match.when('/publish', () => Effect.gen(publish)),
      Match.when('/state', () => object.read()),
      Match.when('/stats', () => readingStats),
      Match.when('/fault', () => object.accept(content, true)),
      Match.when('/corrupt', () => object.corrupt()),
      Match.orElse(() => missing),
    );
    return text(yield* action, { contentType: 'application/json' });
  }
  function refusal(_error: unknown) {
    function* refuse() {
      yield* Effect.logInfo('Local inspection bridge refusal', {
        code: 'InputRejected',
        activation: 'Blocked',
      });
      return text(encode({ _tag: 'LocalRefusal', activation: 'Blocked' }), { status: 422 });
    }
    const workflow = Effect.gen(refuse);
    return workflow;
  }
  const handling = Effect.gen(request);
  return { fetch: handling.pipe(Effect.catch(refusal)) };
}
const runtime = Layer.mergeAll(
  Cloudflare.Queues.WriteQueueBinding,
  Cloudflare.Queues.EventSourceLive,
);
const initialization = Effect.gen(construct);
const constructing = initialization.pipe(
  Effect.catchTag('SchemaError', (error) => Effect.fail(new Config.ConfigError(error))),
);
const implementation = Effect.provide(constructing, runtime);
export default class InvocationWorker extends Cloudflare.Worker<InvocationWorker>()(
  'LocalInspectionWorker',
  {
    main: import.meta.url,
    workersDev: false,
    dev: { host: '127.0.0.1', port: 0 },
    compatibility: { date: '2026-10-09' },
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true },
    },
  },
  implementation,
) {}
