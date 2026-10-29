import { expect, test } from 'bun:test';

import * as Runtime from '@alchemy.run/cloudflare-runtime/core/Runtime';
import { Effect, Layer } from 'effect';

import { silentOperatorRuntime } from '../src/readonly/operator/runtime.ts';

function recordingRuntime(leaked: string[]) {
  function start(worker: Parameters<Runtime.Runtime['Service']['start']>[0]) {
    function emit() {
      const fallback = (chunk: string) => {
        leaked.push(chunk);
      };
      const sink = worker.logging?.onOutput ?? fallback;
      sink('SECRET native stdout', 'stdout');
      sink('SECRET native stderr', 'stderr');
      return new URL('http://127.0.0.1:1');
    }
    const starting = Effect.sync(emit);
    return starting;
  }
  return Runtime.Runtime.of({ start });
}
function outputLayer(leaked: string[]) {
  const base = Layer.succeed(Runtime.Runtime, recordingRuntime(leaked));
  return silentOperatorRuntime.pipe(Layer.provideMerge(base));
}
async function nativeOutput() {
  const leaked: string[] = [];
  const wrapped = outputLayer(leaked);
  const withRuntime = Effect.provide(wrapped);
  function* scenario() {
    const runtime = yield* Runtime.Runtime;
    return yield* runtime.start({
      name: 'output-test',
      compatibilityDate: '2026-08-31',
      compatibilityFlags: [],
      modules: [],
      bindings: [],
    });
  }
  const url = await Effect.runPromise(Effect.gen(scenario).pipe(Effect.scoped, withRuntime));
  expect(url.href).toBe('http://127.0.0.1:1/');
  expect(leaked).toEqual([]);
}
test(
  'operator runtime discards native stdout and stderr before the SDK can forward them',
  nativeOutput,
);

async function workerdOutput() {
  const fixture = new URL('./readonly-operator-native.test.ts', import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '--no-env-file', '--no-install', 'test', fixture], {
    env: {},
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10000,
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exit = await child.exited;
  expect(exit).toBe(0);
  expect(stdout).not.toContain('operator-native-output-canary');
  expect(stderr).not.toContain('operator-native-output-canary');
}
test('actual native workerd output is discarded in the operator runtime', workerdOutput, 12000);
