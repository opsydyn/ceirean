import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Layer, Option } from 'effect';

export const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
export function ownedConfig() {
  function* acquire() {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({
      directory: '/private/tmp',
      prefix: 'migration-task3-',
    });
    const root = yield* fs.realPath(directory);
    yield* fs.chmod(root, 0o700);
    const ownerUid = Option.getOrThrow((yield* fs.stat(root)).uid);
    return {
      fs,
      root,
      file: `${root}/migration.sqlite`,
      guard: `${root}/migration.sqlite.owner.sqlite`,
      config: {
        ledgerId: 'test-ledger',
        pathPolicy: {
          _tag: 'TestOwnedTemporary' as const,
          stateRoot: root,
          ownerUid,
          ownedTemporaryRoot: root,
        },
      },
    };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
