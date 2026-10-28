import { expect, test } from 'bun:test';

import { ConfigProvider, Context, Effect, Result } from 'effect';

import { ingressConfiguration, readOnlyRoutes } from '../src/readonly/routing.ts';
import { readOnlyWorkerProperties } from '../src/readonly/worker.ts';

async function defaultsPrivate() {
  const provider = ConfigProvider.fromUnknown({});
  const mode = await Effect.runPromise(ingressConfiguration.parse(provider));
  expect(mode).toBe('Private');
  expect(readOnlyRoutes(mode)).toEqual([]);
  const context = Context.make(ConfigProvider.ConfigProvider, provider);
  const properties = await Effect.runPromiseWith(context)(readOnlyWorkerProperties);
  expect(properties.workersDev).toBe(false);
  expect(properties.routes).toEqual([]);
}
test('default preparation declares no public URL or route', defaultsPrivate);

async function exactRehearsalRoute() {
  const provider = ConfigProvider.fromUnknown({ CEIREAN_READONLY_INGRESS: 'Rehearsal' });
  const mode = await Effect.runPromise(ingressConfiguration.parse(provider));
  expect(readOnlyRoutes(mode)).toEqual([
    {
      zoneId: '65de6815d54763e90ebf4e5df3a7030c',
      pattern: 'ceirean-hooks.opsydyn.xyz/webhook',
    },
  ]);
  const context = Context.make(ConfigProvider.ConfigProvider, provider);
  const properties = await Effect.runPromiseWith(context)(readOnlyWorkerProperties);
  expect(properties.workersDev).toBe(false);
  expect(properties.routes).toEqual(readOnlyRoutes(mode));
}
test('activation declares only the exact approved webhook route', exactRehearsalRoute);

async function unknownMode() {
  const provider = ConfigProvider.fromUnknown({
    CEIREAN_READONLY_INGRESS: 'https://other.invalid/*',
  });
  const checking = ingressConfiguration.parse(provider).pipe(Effect.result);
  const result = await Effect.runPromise(checking);
  expect(Result.isFailure(result)).toBe(true);
}
test('unrecognised ingress configuration cannot choose arbitrary routes', unknownMode);
