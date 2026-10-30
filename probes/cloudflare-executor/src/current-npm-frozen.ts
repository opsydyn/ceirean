import { Effect, Schema } from 'effect';

import { currentSourcePins } from './current-inputs.ts';
import { verifyCurrentNpmCache } from './current-npm-metadata.ts';
import { fromCurrentNpmLock, currentNpmProfiles } from './current-npm-profiles.ts';
import { resolveCurrentNpm } from './current-npm-resolver.ts';
import { requireInventory } from './dependency-inventory.ts';
import { encodeInventory } from './frozen-dependencies.ts';
import { sha256 } from './preparation.ts';
import { readBounded } from './runner-input.ts';

export const currentNpmSnapshotPin = {
  sha256: 'afbc49f88b06f39f1b64d321952cb0768e843b7fa57446c78d260f19993d496f',
  url: new URL('../fixtures/current-npm.json', import.meta.url),
} as const;
const lock = Schema.Struct({
  name: Schema.String,
  lockfileVersion: Schema.Literal(3),
  requires: Schema.Boolean,
  packages: Schema.Record(Schema.String, Schema.Unknown),
});
const profile = Schema.Struct({
  id: Schema.String,
  lock,
  selected: Schema.Number,
  excluded: Schema.Number,
});
const entry = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  text: Schema.String,
  bytes: Schema.Number,
  sha256: Schema.String,
});
const Snapshot = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  activation: Schema.Literal('Blocked'),
  source: Schema.Struct({
    revision: Schema.Literal(currentSourcePins.revision),
    tree: Schema.Literal(currentSourcePins.tree),
  }),
  sourceHashes: Schema.Record(Schema.String, Schema.String),
  selection: Schema.Literal('ReviewedVersionCohortNotMovingLatest'),
  resolver: Schema.Struct({
    npm: Schema.Literal('10.9.9'),
    host: Schema.Struct({ version: Schema.String, platform: Schema.String, arch: Schema.String }),
  }),
  profiles: Schema.Array(profile),
  metadata: Schema.Array(entry),
});
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Snapshot));
export function validateCurrentNpmSnapshot(text: string) {
  function* validate() {
    yield* requireInventory((yield* sha256(text)) === currentNpmSnapshotPin.sha256, 'InputChanged');
    const snapshot = yield* decode(text);
    yield* requireInventory(
      encodeInventory(snapshot.profiles.map(({ id }) => id)) ===
        encodeInventory(currentNpmProfiles.map(({ id }) => id)),
    );
    for (const [index, definition] of currentNpmProfiles.entries()) {
      const frozen = snapshot.profiles[index]!;
      const inventory = yield* fromCurrentNpmLock(frozen.lock, definition);
      yield* requireInventory(
        inventory.selected.length === frozen.selected &&
          inventory.excluded.length === frozen.excluded,
      );
    }
    for (const item of snapshot.metadata) {
      yield* requireInventory((yield* sha256(item.text)) === item.sha256, 'InputChanged');
      yield* requireInventory(new TextEncoder().encode(item.text).length === item.bytes);
    }
    return snapshot;
  }
  const workflow = Effect.gen(validate);
  return workflow;
}
export function readCurrentNpmSnapshot() {
  function* read() {
    const path = decodeURIComponent(currentNpmSnapshotPin.url.pathname);
    return yield* validateCurrentNpmSnapshot(yield* readBounded(path, 2097152));
  }
  const workflow = Effect.gen(read);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
export function replayCurrentNpm(cache: string, node: string) {
  function* replay() {
    const snapshot = yield* readCurrentNpmSnapshot();
    yield* verifyCurrentNpmCache(cache, snapshot.metadata);
    const actual = yield* resolveCurrentNpm(cache, node);
    yield* verifyCurrentNpmCache(cache, snapshot.metadata);
    yield* requireInventory(
      encodeInventory(actual.profiles) === encodeInventory(snapshot.profiles),
      'InputChanged',
    );
    return {
      activation: 'Blocked' as const,
      snapshotSha256: currentNpmSnapshotPin.sha256,
      network: actual.network,
      scripts: actual.scripts,
      acceptance: actual.acceptance,
      resolver: { npm: actual.npm, host: actual.host },
      profiles: actual.profiles.map(({ id, selected, excluded }) => ({ id, selected, excluded })),
    };
  }
  const workflow = Effect.gen(replay);
  return workflow.pipe(Effect.timeout('10 minutes'));
}
