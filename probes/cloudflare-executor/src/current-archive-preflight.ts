import { Effect, FileSystem, Match, Result, Schema } from 'effect';

import { readCacheBlob } from './cache-candidate.ts';
import { requireInventory } from './dependency-inventory.ts';
import { archiveLimits, inspectArchive } from './linux-qualification/archives.ts';
import { digestBytes } from './payload.ts';
import { sha256 } from './preparation.ts';
import { readBounded } from './runner-input.ts';

export const currentArchivePins = {
  inventorySha256: '940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed',
} as const;
const Item = Schema.Struct({
  identity: Schema.String,
  path: Schema.String,
  bytes: Schema.Number,
  sha256: Schema.String,
  integrity: Schema.String,
});
const Inventory = Schema.fromJsonString(Schema.Struct({ artifacts: Schema.Array(Item) }));
export function inspectCurrentOfflineArchives(root: string) {
  function* inspect() {
    const fs = yield* FileSystem.FileSystem;
    yield* requireInventory(
      root.startsWith('/') && (yield* fs.realPath(root)) === root,
      'InputChanged',
    );
    const text = yield* readBounded(`${root}/inventory.json`, 2097152);
    yield* requireInventory(
      (yield* sha256(text)) === currentArchivePins.inventorySha256,
      'InputChanged',
    );
    const inventory = yield* Schema.decodeUnknownEffect(Inventory)(text);
    const budget = { raw: 0, expanded: 0, entries: 0 };
    let admitted = 0;
    let firstIdentity: string | undefined;
    while (admitted < inventory.artifacts.length && firstIdentity === undefined) {
      const item = inventory.artifacts[admitted]!;
      const path = `${root}/cache/offline/${item.path}`;
      yield* requireInventory((yield* fs.realPath(path)) === path, 'InputChanged');
      const bytes = yield* readCacheBlob(path);
      yield* requireInventory(bytes.length <= archiveLimits.totalArtifactBytes - budget.raw);
      budget.raw += bytes.length;
      const copied = new Uint8Array(bytes);
      const hashing = Effect.tryPromise(() => crypto.subtle.digest('SHA-512', copied));
      const hash = yield* hashing;
      const integrity = 'sha512-' + Buffer.from(hash).toString('base64');
      const sha256 = yield* digestBytes(bytes);
      const unchanged = [
        bytes.length === item.bytes,
        integrity === item.integrity,
        sha256 === item.sha256,
      ].every(Boolean);
      yield* requireInventory(unchanged, 'InputChanged');
      const checking = inspectArchive([bytes], bytes.length, archiveLimits, budget).pipe(
        Effect.result,
      );
      const result = yield* checking;
      firstIdentity = Result.match(result, {
        onSuccess: () => undefined,
        onFailure: () => item.identity,
      });
      admitted += Number(Result.isSuccess(result));
    }
    const status = Match.value(firstIdentity).pipe(
      Match.when(undefined, () => 'Inspected' as const),
      Match.orElse(() => 'Refused' as const),
    );
    return {
      activation: 'Blocked' as const,
      scope: 'ArchiveDataOnly' as const,
      status,
      inventorySha256: currentArchivePins.inventorySha256,
      admitted,
      total: inventory.artifacts.length,
      firstIdentity,
      budget,
    };
  }
  const workflow = Effect.gen(inspect);
  return workflow.pipe(Effect.timeout('5 minutes'), Effect.scoped);
}
