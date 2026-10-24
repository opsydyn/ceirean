import { Effect, Order, Schema } from 'effect';

import { fromNpmLock, npmProfiles, requireInventory } from './dependency-inventory.ts';
import { encodeInventory, readFrozenInputs } from './frozen-dependencies.ts';
import { sha256 } from './preparation.ts';

const strings = Schema.Record(Schema.String, Schema.String);
const platform = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const peerMetadata = Schema.Record(
  Schema.String,
  Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) }),
);
const Resolution = Schema.Struct({
  dependencies: Schema.optionalKey(strings),
  optionalDependencies: Schema.optionalKey(strings),
  peerDependencies: Schema.optionalKey(strings),
  peerDependenciesMeta: Schema.optionalKey(peerMetadata),
  engines: Schema.optionalKey(strings),
  os: Schema.optionalKey(platform),
  cpu: Schema.optionalKey(platform),
  libc: Schema.optionalKey(platform),
});
const Lock = Schema.fromJsonString(
  Schema.Struct({ packages: Schema.Record(Schema.String, Schema.Unknown) }),
);

export function frozenMetadata() {
  function* derive() {
    const inputs = yield* readFrozenInputs();
    const versions = new Map<string, Map<string, unknown>>();
    for (const profile of npmProfiles) {
      const lock = yield* Schema.decodeUnknownEffect(Lock)(
        inputs.get(`npm-${profile.id}.lock`) ?? '',
      );
      const inventory = yield* fromNpmLock({ ...lock, lockfileVersion: 3 });
      for (const entry of [...inventory.selected, ...inventory.excluded]) {
        const resolution = yield* Schema.decodeUnknownEffect(Resolution)(lock.packages[entry.key]);
        const version = {
          name: entry.name,
          version: entry.version,
          ...resolution,
          dist: { tarball: entry.url, integrity: entry.integrity },
        };
        const group = versions.get(entry.name) ?? new Map<string, unknown>();
        const existing = group.get(entry.version);
        yield* requireInventory(
          existing === undefined || encodeInventory(existing) === encodeInventory(version),
        );
        group.set(entry.version, version);
        versions.set(entry.name, group);
      }
    }
    const result = [];
    let total = 0;
    for (const name of [...versions.keys()].sort(Order.String)) {
      const group = versions.get(name) ?? new Map<string, unknown>();
      const entries = [...group.entries()].sort(([a], [b]) => Order.String(a, b));
      const text = encodeInventory({
        name,
        'dist-tags': {},
        versions: Object.fromEntries(entries),
      });
      const bytes = new TextEncoder().encode(text).length;
      total += bytes;
      yield* requireInventory(bytes <= 2097152 && total <= 16777216);
      result.push({
        name,
        url: `https://registry.npmjs.org/${name.replace('/', '%2f')}`,
        text,
        bytes,
        sha256: yield* sha256(text),
      });
    }
    return result;
  }
  const workflow = Effect.gen(derive);
  return workflow;
}
