import { Schema } from 'effect';

const Runtime = Schema.Struct({
  node: Schema.Literal('22.23.4'),
  bun: Schema.Literal('1.4.3'),
  npm: Schema.Literal('10.9.9'),
  os: Schema.Literal('linux'),
  arch: Schema.Literal('x64'),
});
export const validateCurrentLinuxRuntime = Schema.decodeUnknownEffect(Runtime);
export function currentLinuxCachePlan() {
  const install = [
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--backend=copyfile',
  ] as const;
  return {
    activation: 'Blocked' as const,
    scope: 'CacheOnly' as const,
    runtime: { node: '22.23.4', bun: '1.4.3', npm: '10.9.9', os: 'linux', arch: 'x64' } as const,
    warmup: {
      executable: '/usr/local/bin/bun',
      argv: [...install, '--registry=http://127.0.0.1:4873'],
    },
    fresh: { executable: '/usr/local/bin/bun', argv: [...install] },
  };
}
