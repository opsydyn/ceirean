import { Data, Result, Schema } from 'effect';

import fixture from '../fixtures/current-baseline.json' with { type: 'json' };

const packages = [
  '@opsydyn/effect-three',
  '@opsydyn/effect-three-foldkit',
  '@opsydyn/effect-three-rapier',
  '@opsydyn/effect-three-troika',
] as const;
const packageIds = ['Core', 'Foldkit', 'Rapier', 'Troika'] as const;
const checkPlan = [
  { id: 'Install', cwd: '.', argv: ['bun', 'install', '--frozen-lockfile'] },
  { id: 'Check', cwd: '.', argv: ['bun', 'run', 'check'] },
  { id: 'Typecheck', cwd: '.', argv: ['bun', 'typecheck'] },
  { id: 'Test', cwd: '.', argv: ['bun', 'run', 'test'] },
  { id: 'Build', cwd: '.', argv: ['bun', 'run', 'build'] },
  { id: 'Storybook', cwd: 'apps/web', argv: ['bun', 'run', 'build-storybook'] },
  ...packages.map((name, index) => ({
    id: `Pack${packageIds[index]}`,
    cwd: '.',
    argv: ['bun', 'run', '--filter', name, 'pack:check'],
  })),
  ...packages.map((name, index) => ({
    id: `Api${packageIds[index]}`,
    cwd: '.',
    argv: ['bun', 'run', '--filter', name, 'api:check'],
  })),
  {
    id: 'ThreeBrowser',
    cwd: '.',
    argv: ['bun', 'run', '--filter', '@opsydyn/effect-three-foldkit', 'test:e2e'],
  },
  {
    id: 'BrowserJourneys',
    cwd: '/opt/ceirean/browser-harness',
    argv: [
      'bun',
      '--no-env-file',
      '--no-install',
      'x',
      '--no-install',
      'playwright',
      'test',
      '--config',
      'playwright.config.ts',
    ],
  },
] as const;
const serverPlan = [
  {
    id: 'Web',
    cwd: 'apps/web',
    origin: 'http://127.0.0.1:4321',
    argv: [
      'bun',
      '--no-env-file',
      '--no-install',
      'x',
      '--no-install',
      'astro',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4321',
    ],
  },
  {
    id: 'Promo',
    cwd: 'apps/promo',
    origin: 'http://127.0.0.1:4322',
    argv: [
      'bun',
      '--no-env-file',
      '--no-install',
      'x',
      '--no-install',
      'astro',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4322',
    ],
  },
] as const;
const Command = Schema.Struct({
  id: Schema.String,
  cwd: Schema.String,
  argv: Schema.Array(Schema.String),
});
const Server = Schema.Struct({ ...Command.fields, origin: Schema.String });
const Commands = Schema.Array(Command);
const Servers = Schema.Array(Server);
const sameCommands = Schema.toEquivalence(Commands);
const sameServers = Schema.toEquivalence(Servers);
const sameCases = Schema.toEquivalence(Schema.Array(Schema.String));
const casePlan = ['desktop/carousel', 'desktop/line', 'mobile/carousel', 'mobile/line'] as const;
export const CurrentBaseline = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  profileId: Schema.Literal('foldkit-0170-baseline'),
  source: Schema.Struct({
    repository: Schema.Literal('opsydyn/fold-kit-experiments'),
    sha: Schema.Literal('1183e3c067f873fdd29f14f06030515929c1b956'),
    lockSha256: Schema.Literal('9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89'),
  }),
  platform: Schema.Literal('linux/amd64'),
  execution: Schema.Literal('Blocked'),
  image: Schema.Literal('Unbuilt'),
  toolchain: Schema.Struct({
    bun: Schema.Literal('1.4.3'),
    node: Schema.Literal('22.23.4'),
    npm: Schema.Literal('10.9.9'),
    git: Schema.Literal('2.43.0'),
    playwright: Schema.Literal('1.64.1'),
    chromium: Schema.Literal('156.0.8078.4'),
    chromiumRevision: Schema.Literal('1248'),
  }),
  checks: Commands.check(Schema.makeFilter((checks) => sameCommands(checks, checkPlan))),
  servers: Servers.check(Schema.makeFilter((servers) => sameServers(servers, serverPlan))),
  browserCases: Schema.Array(Schema.String).check(
    Schema.makeFilter((cases) => sameCases(cases, casePlan)),
  ),
  browserPolicy: Schema.Struct({
    chromiumSandbox: Schema.Literal(true),
    externalNetwork: Schema.Literal('Denied'),
    desktop: Schema.Struct({ width: Schema.Literal(1440), height: Schema.Literal(900) }),
    mobile: Schema.Struct({ width: Schema.Literal(390), height: Schema.Literal(844) }),
  }),
  limits: Schema.Struct({
    admissionMs: Schema.Literal(300000),
    executionMs: Schema.Literal(2700000),
    cleanupMs: Schema.Literal(900000),
    commandOutputBytes: Schema.Literal(10485760),
    artifactBytes: Schema.Literal(536870912),
    artifactCount: Schema.Literal(64),
  }),
});
export type CurrentBaseline = typeof CurrentBaseline.Type;
export class CurrentBaselineError extends Data.TaggedError('CurrentBaselineError')<{
  readonly code: 'InvalidContract';
}> {}
const decode = Schema.decodeUnknownResult(CurrentBaseline, { onExcessProperty: 'error' });
export function decodeCurrentBaseline(input: unknown) {
  return decode(input).pipe(
    Result.mapError(() => new CurrentBaselineError({ code: 'InvalidContract' })),
  );
}
export function currentBaseline() {
  return decodeCurrentBaseline(fixture).pipe(Result.getOrThrow);
}
