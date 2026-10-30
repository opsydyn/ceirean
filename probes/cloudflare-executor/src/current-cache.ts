import { Effect, Schema } from 'effect';

import { currentDependencyInventory, uniqueCurrentArtifacts } from './current-dependencies.ts';
import { currentNpmSnapshotPin, readCurrentNpmSnapshot } from './current-npm-frozen.ts';
import { currentNpmProfiles, fromCurrentNpmLock } from './current-npm-profiles.ts';
import { registryIdentity, requireInventory } from './dependency-inventory.ts';

export type CacheArtifact = {
  readonly identity: string;
  readonly url: string;
  readonly integrity: string;
};
const Integrity = Schema.String.check(Schema.isPattern(/^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/));
export function planCacheUnion(base: readonly CacheArtifact[], npm: readonly CacheArtifact[]) {
  function* plan() {
    const retained = yield* uniqueCurrentArtifacts(base);
    yield* requireInventory(retained.length > 0 && retained.length === base.length);
    const artifacts = yield* uniqueCurrentArtifacts([...base, ...npm]);
    yield* requireInventory(artifacts.length <= 1024);
    for (const artifact of artifacts) {
      const identity = yield* registryIdentity(artifact.identity);
      yield* requireInventory(identity.url === artifact.url);
      yield* Schema.decodeUnknownEffect(Integrity)(artifact.integrity);
    }
    const known = new Set(base.map(({ url }) => url));
    return {
      activation: 'Blocked' as const,
      artifacts,
      missing: artifacts.filter(({ url }) => !known.has(url)),
      reused: base.length,
    };
  }
  const workflow = Effect.gen(plan);
  return workflow;
}
export function currentOfflineCachePlan(repository: string) {
  function* inspect() {
    const base = yield* currentDependencyInventory(repository);
    const npm = yield* readCurrentNpmSnapshot();
    const selected = [];
    for (const [index, profile] of currentNpmProfiles.entries()) {
      const inventory = yield* fromCurrentNpmLock(npm.profiles[index]!.lock, profile);
      selected.push(...inventory.selected);
    }
    const union = yield* planCacheUnion(base.artifacts, selected);
    return {
      ...union,
      base,
      metadata: npm.metadata,
      npmSnapshotSha256: currentNpmSnapshotPin.sha256,
    };
  }
  const workflow = Effect.gen(inspect);
  return workflow.pipe(Effect.timeout('2 minutes'));
}
