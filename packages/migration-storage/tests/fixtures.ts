import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Data, Effect, FileSystem, Layer, Option, Schema } from 'effect';

export const childInput = Schema.Struct({
  root: Schema.String.check(Schema.isPattern(/^\/private\/tmp\/migration-task3-[a-zA-Z0-9]+$/)),
  ownerUid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mode: Schema.Literals([
    'Crash',
    'Probe',
    'Create',
    'Start',
    'Execution',
    'UnknownCreate',
    'UnknownStart',
  ]),
  point: Schema.Literals([
    'BeforeTransaction',
    'AfterRunWrite',
    'AfterWorkerWrite',
    'AfterEventWrite',
    'AfterCommit',
  ]),
});
export type ChildInput = typeof childInput.Type;
export class ChildFixtureFailure extends Data.TaggedError('ChildFixtureFailure')<{
  readonly phase: 'Spawn' | 'Readiness' | 'Exit' | 'Watchdog';
}> {}

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
