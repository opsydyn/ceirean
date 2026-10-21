import { deepStrictEqual, strictEqual } from 'node:assert';
import { test } from 'node:test';
import { inspect } from 'node:util';

import { Config, ConfigProvider, Effect, Redacted, Result } from 'effect';

import { cloudflareConfigProvider, cloudflareToken } from '../src/config.ts';

async function rejectsInvalidConfig() {
  for (const input of [
    {},
    { CF_TOKEN: '' },
    { CF_TOKEN: ' ' },
    { CF_TOKEN: ' synthetic-secret' },
    { CF_TOKEN: 'synthetic-secret\n' },
  ]) {
    const provider = ConfigProvider.fromUnknown(input);
    const validation = cloudflareToken.parse(provider).pipe(Effect.result);
    const result = await Effect.runPromise(validation);
    strictEqual(Result.isFailure(result), true);
    strictEqual(inspect(result).includes('synthetic-secret'), false);
  }
}
test('CF_TOKEN is required and invalid values never appear in config errors', rejectsInvalidConfig);

async function keepsTokenRedacted() {
  const provider = ConfigProvider.fromUnknown({ CF_TOKEN: 'synthetic-secret' });
  const validation = cloudflareToken.parse(provider);
  const token = await Effect.runPromise(validation);
  strictEqual(Redacted.isRedacted(token), true);
  strictEqual(Redacted.value(token), 'synthetic-secret');
  strictEqual(inspect(token).includes('synthetic-secret'), false);
}
test('valid config keeps tokens redacted', keepsTokenRedacted);

async function aliasesAlchemyConfig() {
  const base = ConfigProvider.fromUnknown({
    CF_TOKEN: 'synthetic-secret',
    CLOUDFLARE_API_TOKEN: 'ignored-token',
    CLOUDFLARE_ACCOUNT_ID: 'wrong-account',
    UNRELATED: 'preserved',
  });
  const configured = cloudflareConfigProvider.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, base),
  );
  const provider = await Effect.runPromise(configured);
  const token = await Effect.runPromise(Config.Redacted('CLOUDFLARE_API_TOKEN').parse(provider));
  strictEqual(Redacted.value(token), 'synthetic-secret');
  const account = await Effect.runPromise(Config.String('CLOUDFLARE_ACCOUNT_ID').parse(provider));
  strictEqual(account, 'd95812af050c2e549a3296899b7b43b3');
  const unrelated = await Effect.runPromise(Config.String('UNRELATED').parse(provider));
  strictEqual(unrelated, 'preserved');
  const original = await Effect.runPromise(Config.String('CLOUDFLARE_API_TOKEN').parse(base));
  strictEqual(original, 'ignored-token');
  deepStrictEqual(inspect(provider).includes('synthetic-secret'), false);
}
test(
  'Alchemy aliases use validated CF_TOKEN and pinned account without mutating environment',
  aliasesAlchemyConfig,
);

async function refusesCredentialFallback() {
  const base = ConfigProvider.fromUnknown({ CLOUDFLARE_API_TOKEN: 'other-token' });
  const configured = cloudflareConfigProvider.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, base),
    Effect.result,
  );
  const result = await Effect.runPromise(configured);
  strictEqual(Result.isFailure(result), true);
}
test('missing CF_TOKEN cannot fall back to another Alchemy credential', refusesCredentialFallback);
