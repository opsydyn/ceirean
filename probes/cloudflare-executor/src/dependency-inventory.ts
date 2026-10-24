import { Data, Effect, Match, Option, Result, Schema } from 'effect';

export class InventoryError extends Data.TaggedError('InventoryError')<{
  readonly code: 'InvalidInventory' | 'InputChanged' | 'ResolutionRefused';
}> {}
export function requireInventory(
  valid: boolean,
  code: InventoryError['code'] = 'InvalidInventory',
) {
  return Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new InventoryError({ code }),
    ),
    Effect.fromResult,
  );
}
const identityPattern = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const Integrity = Schema.String.check(Schema.isPattern(/^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/));
const Constraint = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const Metadata = Schema.Struct({
  os: Schema.optionalKey(Constraint),
  cpu: Schema.optionalKey(Constraint),
  libc: Schema.optionalKey(Constraint),
});
const RegistryTuple = Schema.Tuple([Schema.String, Schema.Literal(''), Metadata, Integrity]);
const BunLock = Schema.Struct({
  lockfileVersion: Schema.Literal(1),
  configVersion: Schema.optionalKey(Schema.Literal(1)),
  workspaces: Schema.Record(Schema.String, Schema.Unknown),
  packages: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
});
const isString = Schema.is(Schema.String);
function constraints(input: string | readonly string[] | undefined) {
  function normalize(value: string | readonly string[]) {
    return Match.value(value).pipe(
      Match.when(isString, (part) => [part]),
      Match.orElse((parts) => parts),
    );
  }
  return Option.fromUndefinedOr(input).pipe(
    Option.match({ onNone: () => [] as readonly string[], onSome: normalize }),
  );
}
function matchesPlatform(parts: readonly string[], target: string) {
  const positive = parts.filter((part) => !part.startsWith('!'));
  return (
    !parts.includes(`!${target}`) &&
    (positive.length === 0 || positive.includes(target) || positive.includes('any'))
  );
}
export function registryIdentity(identity: string) {
  function* decode() {
    const split = identity.lastIndexOf('@');
    const name = identity.slice(0, split);
    const version = identity.slice(split + 1);
    yield* requireInventory(
      split > 0 && identityPattern.test(name) && versionPattern.test(version),
    );
    const basename = name.split('/').at(-1);
    const url = `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
    return { identity, name, version, url };
  }
  const workflow = Effect.gen(decode);
  return workflow;
}
function registryEntry(
  key: string,
  identity: string,
  metadata: typeof Metadata.Type,
  integrity: string,
) {
  function* read() {
    const parsed = yield* registryIdentity(identity);
    const os = constraints(metadata.os);
    const cpu = constraints(metadata.cpu);
    const libc = constraints(metadata.libc);
    const selected = [
      matchesPlatform(os, 'linux'),
      matchesPlatform(cpu, 'x64'),
      matchesPlatform(libc, 'glibc'),
    ].every(Boolean);
    return { key, ...parsed, integrity, constraints: { os, cpu, libc }, selected };
  }
  const workflow = Effect.gen(read);
  return workflow;
}
type RegistryEntry = Effect.Success<ReturnType<typeof registryEntry>>;
const sourceWorkspaces = new Map([
  ['@opsydyn/astro-foldkit', '@opsydyn/astro-foldkit@workspace:packages/astro-foldkit'],
  ['@opsydyn/foldkit-viz', '@opsydyn/foldkit-viz@workspace:packages/foldkit-viz'],
  ['@opsydyn/web', '@opsydyn/web@workspace:apps/web'],
  ['@opsydyn/promo', '@opsydyn/promo@workspace:apps/promo'],
]);
const WorkspaceTuple = Schema.Tuple([Schema.String]);
const NpmLock = Schema.Struct({
  lockfileVersion: Schema.Literal(3),
  packages: Schema.Record(Schema.String, Schema.Unknown),
});
export function fromBunLock(input: unknown) {
  function* read() {
    const lock = yield* Schema.decodeUnknownEffect(BunLock)(input);
    const keys = Object.keys(lock.packages).sort();
    yield* requireInventory(keys.length > 0 && keys.length <= 4096);
    const registry: RegistryEntry[] = [];
    const workspaces: { key: string; identity: string }[] = [];
    for (const key of keys) {
      const raw = lock.packages[key] ?? [];
      function* workspace() {
        const [identity] = yield* Schema.decodeUnknownEffect(WorkspaceTuple)(raw);
        yield* requireInventory(sourceWorkspaces.get(key) === identity);
        workspaces.push({ key, identity });
      }
      function* external() {
        const [identity, , metadata, integrity] =
          yield* Schema.decodeUnknownEffect(RegistryTuple)(raw);
        registry.push(yield* registryEntry(key, identity, metadata, integrity));
      }
      const action = Match.value(raw.length).pipe(
        Match.when(1, () => Effect.gen(workspace)),
        Match.orElse(() => Effect.gen(external)),
      );
      yield* action;
    }
    return {
      activation: 'Blocked' as const,
      selected: registry.filter((entry) => entry.selected),
      excluded: registry.filter((entry) => !entry.selected),
      workspaces,
    };
  }
  const workflow = Effect.gen(read);
  return workflow;
}
const NpmRecord = Schema.Struct({
  version: Schema.String,
  resolved: Schema.String,
  integrity: Integrity,
  name: Schema.optionalKey(Schema.String),
  os: Schema.optionalKey(Constraint),
  cpu: Schema.optionalKey(Constraint),
  libc: Schema.optionalKey(Constraint),
});
const localLink = Schema.Struct({
  link: Schema.Literal(true),
  resolved: Schema.Literal('vendor/foldkit-viz'),
});
const localPackage = Schema.Struct({
  name: Schema.Literal('@opsydyn/foldkit-viz'),
  version: Schema.Literals(['0.9.0', '0.10.0']),
});
export function fromNpmLock(input: unknown) {
  function* read() {
    const lock = yield* Schema.decodeUnknownEffect(NpmLock)(input);
    const keys = Object.keys(lock.packages).sort();
    yield* requireInventory(keys.length > 0 && keys.length <= 4096);
    const registry: RegistryEntry[] = [];
    const local: { key: string; kind: string }[] = [];
    for (const key of keys) {
      const raw = lock.packages[key];
      function* external() {
        const item = yield* Schema.decodeUnknownEffect(NpmRecord)(raw);
        const name = item.name ?? key.split('node_modules/').at(-1) ?? '';
        yield* requireInventory(key.startsWith('node_modules/'));
        const entry = yield* registryEntry(key, `${name}@${item.version}`, item, item.integrity);
        yield* requireInventory(entry.url === item.resolved);
        registry.push(entry);
      }
      function* root() {
        local.push({ key, kind: 'Root' });
        yield* Effect.void;
      }
      function* vendor() {
        yield* Schema.decodeUnknownEffect(localPackage)(raw);
        local.push({ key, kind: 'MetadataOnlyVendor' });
      }
      function* link() {
        yield* Schema.decodeUnknownEffect(localLink)(raw);
        local.push({ key, kind: 'MetadataOnlyLink' });
      }
      const action = Match.value(key).pipe(
        Match.when('', () => Effect.gen(root)),
        Match.when('vendor/foldkit-viz', () => Effect.gen(vendor)),
        Match.when('node_modules/@opsydyn/foldkit-viz', () => Effect.gen(link)),
        Match.orElse(() => Effect.gen(external)),
      );
      yield* action;
    }
    return {
      activation: 'Blocked' as const,
      selected: registry.filter((entry) => entry.selected),
      excluded: registry.filter((entry) => !entry.selected),
      local,
    };
  }
  const workflow = Effect.gen(read);
  return workflow;
}

const production = {
  name: '@opsydyn/foldkit-viz',
  version: '0.10.0',
  peerDependencies: { effect: '>=4.0.0 <5.0.0', foldkit: '>=0.165.0 <0.166.0' },
  peerDependenciesMeta: { effect: { optional: true }, foldkit: { optional: true } },
} as const;
export const npmProfiles = [
  {
    id: 'generated',
    vendor: { name: '@opsydyn/foldkit-viz', version: '0.9.0' },
    manifest: {
      name: 'foldkit-viz-live-line',
      private: true,
      type: 'module',
      dependencies: {
        '@opsydyn/foldkit-viz': 'file:./vendor/foldkit-viz',
        foldkit: '0.165.0',
        effect: '4.0.0',
        fflate: '0.8.3',
        '@stackblitz/sdk': '1.11.0',
      },
      devDependencies: { vite: '8.3.1', typescript: '6.0.3', '@foldkit/vite-plugin': '0.26.0' },
    },
  },
  {
    id: 'viz-pure',
    vendor: production,
    manifest: {
      name: 'ceirean-viz-pure-inventory',
      private: true,
      dependencies: { '@opsydyn/foldkit-viz': 'file:./vendor/foldkit-viz' },
    },
  },
  {
    id: 'viz-adapter',
    vendor: production,
    manifest: {
      name: 'ceirean-viz-adapter-inventory',
      private: true,
      dependencies: {
        '@opsydyn/foldkit-viz': 'file:./vendor/foldkit-viz',
        foldkit: '0.165.0',
        effect: '4.0.0',
      },
    },
  },
] as const;
