import { providers } from 'alchemy/Cloudflare';
import { Config, ConfigProvider, Effect, Layer, Match, Redacted } from 'effect';

const invalidToken = new ConfigProvider.SourceError({
  message: 'CF_TOKEN must be non-empty and contain no whitespace.',
});

function isValidToken(token: Redacted.Redacted<string>) {
  const value = Redacted.value(token);
  return value.length > 0 && !/\s/.test(value);
}

function validateToken(token: Redacted.Redacted<string>) {
  return Match.value(token).pipe(
    Match.when(isValidToken, () => Config.succeed(token)),
    Match.orElse(() => Config.fail(invalidToken)),
  );
}

export const cloudflareToken = Config.Redacted('CF_TOKEN').pipe(Config.mapEffect(validateToken));

function* makeCloudflareConfigProvider() {
  const base = yield* ConfigProvider.ConfigProvider;
  const token = yield* cloudflareToken;
  // Alchemy reads its standard environment contract through Effect Config.
  const aliases = ConfigProvider.fromUnknown({
    CLOUDFLARE_API_TOKEN: Redacted.value(token),
    CLOUDFLARE_ACCOUNT_ID: 'd95812af050c2e549a3296899b7b43b3',
  });
  return ConfigProvider.orElse(base)(aliases);
}

export const cloudflareConfigProvider = Effect.gen(makeCloudflareConfigProvider);
const cloudflareConfigLayer = ConfigProvider.layer(cloudflareConfigProvider);
export const cloudflareProviders = providers().pipe(
  Layer.provide(cloudflareConfigLayer),
  Layer.orDie,
);
