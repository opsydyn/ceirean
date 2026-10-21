import { deepStrictEqual, strictEqual } from 'node:assert';
import { test } from 'node:test';
import { inspect } from 'node:util';

import { AlchemyContext } from 'alchemy/AlchemyContext';
import { CloudflareEnvironment, Providers } from 'alchemy/Cloudflare';
import { Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { defaultState } from 'alchemy/Test/TestState';
import {
  Arbitrary,
  ByteSize,
  ConfigProvider,
  Context,
  Effect,
  FileSystem,
  Layer,
  Match,
  Option,
  Redacted,
  Result,
  Schema,
} from 'effect';

import { AlchemyAuthHome } from '../src/operational.ts';
import { prepareRehearsal } from '../src/rehearsal.ts';

const paths = {
  root: '/Users/alancurrie/Library/Application Support/Ceirean/infrastructure',
  cwd: '.',
};
const directories = [
  paths.root,
  `${paths.root}/.alchemy`,
  `${paths.root}/.alchemy/state`,
  `${paths.root}/auth`,
];
interface Scenario {
  readonly accountId?: string;
  readonly stage?: string;
  readonly dev?: boolean;
  readonly adopt?: boolean;
  readonly cwd?: string;
  readonly dotAlchemy?: string;
  readonly auth?: string;
  readonly actualAuth?: string;
  readonly missingAuth?: boolean;
  readonly token?: string;
  readonly directory?: string;
  readonly mode?: number;
  readonly uid?: Option.Option<number>;
  readonly type?: FileSystem.File.Info['type'];
  readonly resolved?: string;
  readonly unavailable?: boolean;
  readonly statUnavailable?: boolean;
  readonly missingToken?: boolean;
}

function graph() {
  return Stack.of({
    name: 'CeireanHooks',
    stage: 'rehearsal',
    resources: {},
    bindings: {},
    actions: {},
  });
}

function fixture(options: Scenario = {}) {
  function metadata(path: string) {
    const targeted = path === options.directory;
    const base: FileSystem.File.Info = {
      type: 'Directory',
      mtime: Option.none(),
      atime: Option.none(),
      birthtime: Option.none(),
      dev: 1n,
      ino: Option.some(1n),
      mode: 0o40700,
      nlink: Option.some(1n),
      uid: Option.some(501),
      gid: Option.none(),
      rdev: Option.none(),
      size: ByteSize.bytes(0),
      blksize: Option.none(),
      blocks: Option.none(),
    };
    return Match.value(targeted).pipe(
      Match.when(true, () => ({
        ...base,
        mode: options.mode ?? base.mode,
        uid: options.uid ?? base.uid,
        type: options.type ?? base.type,
      })),
      Match.orElse(() => base),
    );
  }
  function resolvePath(path: string) {
    return Match.value(path).pipe(
      Match.when(paths.cwd, () => options.cwd ?? paths.root),
      Match.when(
        (value) => value === options.directory,
        () => options.resolved ?? path,
      ),
      Match.orElse(() => path),
    );
  }
  const readStat = Match.value(options.statUnavailable).pipe(
    Match.when(true, () => FileSystem.makeNoop({}).stat),
    Match.orElse(() => (path: string) => Effect.succeed(metadata(path))),
  );
  const capabilities = Match.value(options.unavailable).pipe(
    Match.when(true, () => ({})),
    Match.orElse(() => ({
      stat: readStat,
      realPath: (path: string) => Effect.succeed(resolvePath(path)),
    })),
  );
  const filesystem = FileSystem.layerNoop(capabilities);
  const values = Match.value(options.missingToken).pipe(
    Match.when(true, () => ({})),
    Match.orElse(() => ({ CF_TOKEN: options.token ?? 'synthetic-secret' })),
  );
  const authValues = Match.value(options.missingAuth).pipe(
    Match.when(true, () => ({})),
    Match.orElse(() => ({ ALCHEMY_HOME: options.auth ?? `${paths.root}/auth` })),
  );
  const config = ConfigProvider.fromUnknown({ ...values, ...authValues });
  const account = Effect.succeed({
    type: 'apiToken' as const,
    apiToken: Redacted.make('synthetic-secret'),
    accountId: options.accountId ?? 'd95812af050c2e549a3296899b7b43b3',
    source: { type: 'env' as const },
  });
  return Layer.mergeAll(
    filesystem,
    defaultState(),
    ConfigProvider.layer(config),
    Layer.sync(Stack, graph),
    Layer.succeed(Providers, { kind: 'ProviderCollection', providers: {}, get: () => undefined }),
    Layer.succeed(CloudflareEnvironment, account),
    Layer.succeed(Stage, options.stage ?? 'rehearsal'),
    Layer.succeed(AlchemyAuthHome, options.actualAuth ?? `${paths.root}/auth`),
    Layer.succeed(AlchemyContext, {
      dotAlchemy: options.dotAlchemy ?? `${paths.root}/.alchemy`,
      dev: options.dev ?? false,
      adopt: options.adopt ?? false,
    }),
  );
}

function* runPreparation() {
  const result = yield* Effect.result(prepareRehearsal);
  const stack = yield* Stack;
  return { result, resources: Object.keys(stack.resources) };
}

const preparation = Effect.gen(runPreparation);
class ScenarioContext extends Context.Service<ScenarioContext, Scenario>()(
  'test/OperationalScenario',
) {}
const scenarioLayer = Layer.unwrap(ScenarioContext.pipe(Effect.map(fixture)));
export const preparationBoundary = Effect.provide(preparation, scenarioLayer);
export const exercise = (options: Scenario = {}) => {
  const scenario = ScenarioContext.of(options);
  const provided = preparationBoundary.pipe(Effect.provideService(ScenarioContext, scenario));
  return provided;
};

async function acceptsProtectedContext() {
  const observed = await Effect.runPromise(exercise());
  strictEqual(observed.result._tag, 'Success');
  deepStrictEqual(observed.resources, ['RehearsalTunnel', 'RehearsalIngress', 'RehearsalHostname']);
}
test(
  'protected operational context exposes only the three approved declarations',
  acceptsProtectedContext,
);

async function rejectsUnsafeContext() {
  const cases: Scenario[] = [
    { accountId: '00000000000000000000000000000000' },
    { stage: 'live' },
    { dev: true },
    { adopt: true },
    { cwd: '/private/tmp/checkout' },
    { dotAlchemy: '/private/tmp/.alchemy' },
    { auth: '/private/tmp/auth' },
    { actualAuth: '/private/tmp/actual-auth' },
    { missingAuth: true },
    { token: '' },
    { token: ' synthetic-secret' },
    { unavailable: true },
    { statUnavailable: true },
    { missingToken: true },
  ];
  for (const directory of directories) {
    cases.push(
      { directory, mode: 0o755 },
      { directory, uid: Option.some(502) },
      { directory, uid: Option.none() },
      { directory, type: 'File' },
      { directory, resolved: '/private/tmp/redirected' },
    );
  }
  for (const scenario of cases) {
    const observed = await Effect.runPromise(exercise(scenario));
    strictEqual(observed.result._tag, 'Failure', inspect(scenario));
    deepStrictEqual(observed.resources, []);
    strictEqual(inspect(observed.result).includes('synthetic-secret'), false);
  }
}
test(
  'unsafe contexts and filesystem failures register nothing and expose no token',
  rejectsUnsafeContext,
);

const modeSchema = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0o7777 }));
const modes = Arbitrary.schema(modeSchema);
function modeLaw(mode: number) {
  return exercise({ directory: `${paths.root}/.alchemy/state`, mode }).pipe(
    Effect.map((observed) => Result.isSuccess(observed.result) === (mode === 0o700)),
  );
}
async function permissionLaw() {
  for (const seed of [0, 1, 163]) {
    const checked = Arbitrary.checkEffect(modes, modeLaw, { seed, runs: 100, maxShrinks: 100 });
    const observed = await Effect.runPromise(checked);
    strictEqual(observed._tag, 'Passed');
  }
}
test('property: only owner-rwx permission bits pass across generated Unix modes', permissionLaw);
