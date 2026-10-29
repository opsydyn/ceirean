import { deepStrictEqual, ok } from 'node:assert';
import { test } from 'node:test';

import * as Service from '@alchemy.run/cloudflare-runtime/core/bindings/Service';
import * as Loopback from '@alchemy.run/cloudflare-runtime/core/globals/Loopback';
import type {
  EffectHandler,
  RouteHandler,
} from '@alchemy.run/cloudflare-runtime/core/globals/LoopbackServer';
import * as PluginContext from '@alchemy.run/cloudflare-runtime/core/PluginContext';
import * as RemoteBindings from '@alchemy.run/cloudflare-runtime/core/remote-bindings/RemoteBindings';
import * as RemoteWorker from '@alchemy.run/cloudflare-runtime/core/remote-bindings/RemoteWorker';
import { Data, Deferred, Effect, Exit, Fiber, Layer, Logger, Result, Schema } from 'effect';
import { HttpServerRequest, fromWeb } from 'effect/http/HttpServerRequest';
import { toWeb } from 'effect/http/HttpServerResponse';
import { TestClock } from 'effect/testing';

const worker = {
  name: 'owned-operator-test',
  compatibilityDate: '2026-08-31',
  compatibilityFlags: [],
  modules: [],
  bindings: [],
};
const preview = {
  url: 'https://unused.invalid',
  headers: { 'cf-workers-preview-token': 'fake-test-capability' },
};
const configuration = {
  name: worker.name,
  bindings: [{ name: 'TARGET', type: 'service', service: 'unused-target' }],
};
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

class StartupFault extends Data.TaggedError('StartupFault')<{ readonly phase: 'BeforeServe' }> {}

type LoopbackApi = Extract<Loopback.Loopback['Service'], { readonly api: unknown }>['api'];
function makeLive(
  deploy: RemoteWorker.RemoteWorker['Service']['deploy'],
  route: LoopbackApi['route'],
) {
  const provider = Layer.succeed(RemoteWorker.RemoteWorker, { deploy });
  const loopback = Layer.succeed(Loopback.Loopback, { api: { route } });
  const logging = Logger.layer([]);
  return RemoteBindings.RemoteBindingsLive.pipe(
    Layer.provide(provider),
    Layer.provide(loopback),
    Layer.provideMerge(logging),
  );
}
const handlerSchema = Schema.declare((value: unknown): value is EffectHandler =>
  Effect.isEffect(value),
);
const decodeHandler = Schema.decodeUnknownEffect(handlerSchema);

async function makeHarness(cleanup = Effect.void) {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  const finalized = await Effect.runPromise(Deferred.make<void>());
  const routed = await Effect.runPromise(Deferred.make<RouteHandler>());
  let interrupted = false;
  let completed = false;
  let calls = 0;
  function* acquire() {
    calls += 1;
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    completed = true;
    return preview;
  }
  function finish<A, E>(exit: Exit.Exit<A, E>) {
    function* record() {
      interrupted = Exit.hasInterrupts(exit);
      yield* cleanup;
      yield* Deferred.succeed(finalized, undefined);
    }
    const recording = Effect.gen(record);
    return recording;
  }
  function route(_target: string, handler: RouteHandler) {
    const registering = Deferred.succeed(routed, handler).pipe(
      Effect.map(() => ({ name: 'unused-loopback' })),
    );
    return registering;
  }
  const live = makeLive(() => Effect.gen(acquire).pipe(Effect.onExit(finish)), route);
  const withLive = Effect.provide(live);
  function* prepare() {
    const context = yield* PluginContext.make(worker);
    const binding = Service.remote('TARGET', 'unused-target');
    yield* binding.pipe(Effect.provideService(PluginContext.PluginContext, context));
    const config = yield* context.config;
    yield* Deferred.await(entered);
    return config;
  }
  const preparation = Effect.gen(prepare);
  function snapshot() {
    return { interrupted, completed, calls };
  }
  async function settle() {
    // Drain an unpatched detached fiber too, so a RED regression leaves no task behind.
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Deferred.await(finalized).pipe(Effect.timeout('1 second')));
  }
  return { entered, release, routed, preparation, withLive, snapshot, settle };
}

async function scopeOwnsAcquisition() {
  const harness = await makeHarness();
  await Effect.runPromise(harness.preparation.pipe(harness.withLive));
  const observed = harness.snapshot();
  await harness.settle();
  deepStrictEqual(observed, { interrupted: true, completed: false, calls: 1 });
}
test(
  'real remote plugin cancels pending acquisition before owner scope returns',
  scopeOwnsAcquisition,
);

async function startupFailure() {
  const harness = await makeHarness();
  function* failBeforeServe() {
    yield* harness.preparation;
    return yield* Effect.fail(new StartupFault({ phase: 'BeforeServe' }));
  }
  const failure = await Effect.runPromise(
    Effect.gen(failBeforeServe).pipe(harness.withLive, Effect.result),
  );
  const observed = harness.snapshot();
  await harness.settle();
  ok(Result.isFailure(failure));
  deepStrictEqual(observed, { interrupted: true, completed: false, calls: 1 });
}
test('startup failure closes its runtime owner and joins acquisition cancellation', startupFailure);

async function operatorInterruption() {
  const harness = await makeHarness();
  function* keepOpen() {
    yield* harness.preparation;
    yield* Deferred.await(harness.release);
  }
  function* interrupt() {
    const fiber = yield* Effect.gen(keepOpen).pipe(harness.withLive, Effect.forkScoped);
    yield* Deferred.await(harness.entered);
    yield* Fiber.interrupt(fiber);
  }
  await Effect.runPromise(Effect.gen(interrupt).pipe(Effect.scoped));
  const observed = harness.snapshot();
  await harness.settle();
  deepStrictEqual(observed, { interrupted: true, completed: false, calls: 1 });
}
test('operator interruption joins pending acquisition before returning', operatorInterruption);

const withClock = Effect.provide(TestClock.layer());
async function operatorDeadline() {
  const harness = await makeHarness();
  function* keepOpen() {
    yield* harness.preparation;
    yield* Deferred.await(harness.release);
  }
  function* expire() {
    const fiber = yield* Effect.gen(keepOpen).pipe(
      harness.withLive,
      Effect.timeout('1 second'),
      Effect.result,
      Effect.forkScoped,
    );
    yield* Deferred.await(harness.entered);
    yield* TestClock.adjust(1001);
    return yield* Fiber.join(fiber);
  }
  const failure = await Effect.runPromise(Effect.gen(expire).pipe(Effect.scoped, withClock));
  const observed = harness.snapshot();
  await harness.settle();
  ok(Result.isFailure(failure));
  deepStrictEqual(observed, { interrupted: true, completed: false, calls: 1 });
}
test('deadline wraps the owning runtime layer and joins pending acquisition', operatorDeadline);

async function successfulBridge() {
  const harness = await makeHarness();
  function* resolve() {
    yield* harness.preparation;
    yield* Deferred.succeed(harness.release, undefined);
    const handler = yield* Deferred.await(harness.routed).pipe(Effect.flatMap(decodeHandler));
    const request = fromWeb(
      new Request('http://loopback.invalid', { method: 'POST', body: encode(configuration) }),
    );
    const response = yield* handler.pipe(Effect.provideService(HttpServerRequest, request));
    const web = toWeb(response);
    const result = yield* Effect.promise(() => web.json());
    deepStrictEqual(result, { ok: true, result: preview });
  }
  await Effect.runPromise(Effect.gen(resolve).pipe(harness.withLive));
  deepStrictEqual(harness.snapshot(), { interrupted: false, completed: true, calls: 1 });
  await harness.settle();
}
test(
  'successful prefetch reaches the real loopback bridge without another acquisition',
  successfulBridge,
);

async function fallbackOwnership() {
  const harness = await makeHarness();
  function* scenario() {
    const callerScope = yield* Effect.scope;
    function* ownRuntime() {
      yield* RemoteBindings.RemoteBindings;
      const handler = yield* Deferred.await(harness.routed).pipe(Effect.flatMap(decodeHandler));
      const request = fromWeb(
        new Request('http://loopback.invalid', { method: 'POST', body: encode(configuration) }),
      );
      const handling = handler.pipe(Effect.provideService(HttpServerRequest, request));
      // Model a loopback request whose caller outlives the runtime being disposed.
      const caller = yield* handling.pipe(Effect.forkIn(callerScope));
      yield* Deferred.await(harness.entered);
      return caller;
    }
    const caller = yield* Effect.gen(ownRuntime).pipe(harness.withLive);
    const observed = harness.snapshot();
    yield* Deferred.succeed(harness.release, undefined);
    yield* Fiber.await(caller);
    return observed;
  }
  const observed = await Effect.runPromise(Effect.gen(scenario).pipe(Effect.scoped));
  await harness.settle();
  deepStrictEqual(observed, { interrupted: true, completed: false, calls: 1 });
}
test(
  'fallback acquisition is owned by the runtime even when the loopback caller outlives it',
  fallbackOwnership,
);

async function fallbackCallerCancellation() {
  const harness = await makeHarness();
  function* cancelCaller() {
    yield* RemoteBindings.RemoteBindings;
    const handler = yield* Deferred.await(harness.routed).pipe(Effect.flatMap(decodeHandler));
    const request = fromWeb(
      new Request('http://loopback.invalid', { method: 'POST', body: encode(configuration) }),
    );
    const handling = handler.pipe(Effect.provideService(HttpServerRequest, request));
    const caller = yield* handling.pipe(Effect.forkScoped);
    yield* Deferred.await(harness.entered);
    yield* Fiber.interrupt(caller);
    // Capture while the runtime remains open, not after its outer disposal fixes the leak.
    return harness.snapshot();
  }
  const observed = await Effect.runPromise(
    Effect.gen(cancelCaller).pipe(Effect.scoped, harness.withLive),
  );
  await harness.settle();
  deepStrictEqual(observed, { interrupted: true, completed: false, calls: 1 });
}
test(
  'canceling a fallback caller joins acquisition while its runtime stays open',
  fallbackCallerCancellation,
);

async function joinsDelayedFinalizer() {
  const cleanupEntered = await Effect.runPromise(Deferred.make<void>());
  const cleanupReleased = await Effect.runPromise(Deferred.make<void>());
  const waiting = Deferred.await(cleanupReleased);
  const cleanup = Deferred.succeed(cleanupEntered, undefined).pipe(Effect.andThen(waiting));
  const harness = await makeHarness(cleanup);
  function* scenario() {
    const owner = yield* harness.preparation.pipe(harness.withLive, Effect.forkScoped);
    yield* Deferred.await(cleanupEntered);
    const beforeCleanup = yield* Effect.sync(owner.pollUnsafe);
    yield* Deferred.succeed(cleanupReleased, undefined);
    yield* Fiber.join(owner);
    return beforeCleanup;
  }
  const beforeCleanup = await Effect.runPromise(Effect.gen(scenario).pipe(Effect.scoped));
  await harness.settle();
  deepStrictEqual(beforeCleanup, undefined);
  deepStrictEqual(harness.snapshot(), { interrupted: true, completed: false, calls: 1 });
}
test(
  'runtime disposal waits for delayed acquisition finalizers before returning',
  joinsDelayedFinalizer,
);

const silent = Effect.provide(Logger.layer([]));
async function fallbackAfterDisposal() {
  const harness = await makeHarness();
  function* initialize() {
    yield* RemoteBindings.RemoteBindings;
    return yield* Deferred.await(harness.routed).pipe(Effect.flatMap(decodeHandler));
  }
  const handler = await Effect.runPromise(Effect.gen(initialize).pipe(harness.withLive));
  const request = fromWeb(
    new Request('http://loopback.invalid', { method: 'POST', body: encode(configuration) }),
  );
  const handling = handler.pipe(
    Effect.provideService(HttpServerRequest, request),
    Effect.timeout('1 second'),
    silent,
  );
  const exit = await Effect.runPromiseExit(handling);
  ok(Exit.hasInterrupts(exit));
  deepStrictEqual(harness.snapshot(), { interrupted: false, completed: false, calls: 0 });
}
test('a fallback arriving after runtime disposal cannot begin acquisition', fallbackAfterDisposal);
