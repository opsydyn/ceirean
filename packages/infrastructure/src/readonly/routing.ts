import { Config, Effect, Match, Schema } from 'effect';

const Ingress = Schema.Literals(['Private', 'Rehearsal']);
const decode = Schema.decodeUnknownEffect(Ingress);
function configuredIngress(value: string) {
  return decode(value).pipe(Effect.mapError((error) => new Config.ConfigError(error)));
}
export const ingressConfiguration = Config.String('CEIREAN_READONLY_INGRESS').pipe(
  Config.withDefault('Private'),
  Config.mapEffect(configuredIngress),
);

export function readOnlyRoutes(mode: typeof Ingress.Type) {
  return Match.value(mode).pipe(
    Match.when('Private', () => []),
    Match.when('Rehearsal', () => [
      {
        zoneId: '65de6815d54763e90ebf4e5df3a7030c',
        pattern: 'ceirean-hooks.opsydyn.xyz/webhook',
      },
    ]),
    Match.exhaustive,
  );
}
