import { expect, test } from 'bun:test';

import { Deferred, Effect, Fiber, Stream } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { TestClock } from 'effect/testing';

import { observeCurrentPreview, probeCurrentPreview } from '../src/current-worker.ts';

async function abortsStalledReadiness() {
  let observed: RequestInit | undefined;
  const started = Deferred.makeUnsafe<void>();
  function request(_url: string, init: RequestInit) {
    observed = init;
    Deferred.doneUnsafe(started, Effect.void);
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(null)), 200);
      init.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  }
  function* check() {
    const probing = probeCurrentPreview('http://127.0.0.1:4321', request);
    const fiber = yield* probing.pipe(Effect.forkChild);
    yield* Deferred.await(started).pipe(Effect.timeout(100));
    yield* TestClock.adjust(1001);
    expect(observed?.signal?.aborted).toBe(true);
    const result = yield* Fiber.join(fiber).pipe(Effect.result);
    expect(result._tag).toBe('Failure');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, TestClock.layer());
  await Effect.runPromise(provided);
}
test(
  'stalled readiness headers remain abortable at their one-second deadline',
  abortsStalledReadiness,
);

async function noticesLeaderExitWithoutEof() {
  const lifetime = Effect.sleep('1 hour');
  const held = lifetime.pipe(Effect.map(() => new Uint8Array()));
  const child = {
    stdout: Stream.fromEffect(held),
    stderr: Stream.fromEffect(held),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
  };
  const result = await Effect.runPromise(
    observeCurrentPreview(child).pipe(Effect.timeout(25), Effect.result),
  );
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'ServerUnavailable' } });
}
test(
  'zero-exit preview leader fails immediately even when descendants retain both log pipes',
  noticesLeaderExitWithoutEof,
);
