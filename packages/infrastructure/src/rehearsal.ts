import { adopt } from 'alchemy/AdoptPolicy';
import { CloudflareEnvironment, DNS, Tunnel } from 'alchemy/Cloudflare';
import { interpolate } from 'alchemy/Output';
import { Config, ConfigProvider, Effect, Match } from 'effect';

import { operationalContext } from './operational.ts';

const approved = { accountId: 'd95812af050c2e549a3296899b7b43b3' };
function* declareRehearsalInfrastructure() {
  const { accountId } = yield* yield* CloudflareEnvironment;
  const wrongAccount = new ConfigProvider.SourceError({
    message: 'Ceirean rehearsal requires the verified opsydyn.xyz Cloudflare account.',
  });
  yield* Match.value(accountId).pipe(
    Match.when(approved.accountId, () => Effect.void),
    Match.orElse(() => Config.fail(wrongAccount)),
  );
  const tunnel = yield* Tunnel.Tunnel('RehearsalTunnel', {
    name: 'ceirean-rehearsal-bcea4099a8934e32',
    configSrc: 'cloudflare',
    adopt: false,
  }).pipe(adopt(false));
  yield* Tunnel.Configuration('RehearsalIngress', {
    tunnelId: tunnel.tunnelId,
    ingress: [
      {
        hostname: 'ceirean-hooks.opsydyn.xyz',
        path: '^/webhook$',
        service: 'http://127.0.0.1:8787',
      },
    ],
    catchAllService: 'http_status:404',
  }).pipe(adopt(false));
  yield* DNS.Record('RehearsalHostname', {
    zoneId: '65de6815d54763e90ebf4e5df3a7030c',
    name: 'ceirean-hooks.opsydyn.xyz',
    type: 'CNAME',
    content: interpolate`${tunnel.tunnelId}.cfargotunnel.com`,
    proxied: true,
  }).pipe(adopt(false));
  return {
    tunnelId: tunnel.tunnelId,
    endpoint: 'https://ceirean-hooks.opsydyn.xyz/webhook',
  };
}
export const declareRehearsal = Effect.gen(declareRehearsalInfrastructure);

export const prepareRehearsal = operationalContext.pipe(Effect.andThen(declareRehearsal));
