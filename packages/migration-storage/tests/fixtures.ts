import { test } from 'bun:test';

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Data, Effect, FileSystem, Layer, Option, Schema } from 'effect';

/**
 * The cases that open a ledger at an owned temporary root, gated to the host
 * where that root is accepted.
 *
 * Two things pin this package to macOS, and neither is incidental.
 * `prepareMigrationPaths` refuses a root under Linux's `/tmp` as `UnsafePath`,
 * and `childInput` below requires `/private/tmp/...` in a regex. On macOS both
 * hold because `fs.realPath` resolves the temporary directory back through the
 * `/tmp` symlink; on Linux `/tmp` is real and neither does.
 *
 * Skipped rather than relaxed: that policy exists to refuse unsafe state roots,
 * and loosening it to satisfy a second host would trade a security property for
 * a green check. Nothing in this repository imports `@ceirean/migration-storage`,
 * and the deployed surface is Cloudflare Workers, which has no filesystem, so
 * this host is the only one it currently needs.
 *
 * `tests/paths.test.ts` is deliberately NOT gated. It passes on Linux in full
 * and covers the path policy itself, which is portable.
 *
 * Porting this would start at the `childInput` pattern and the `/tmp` ancestor
 * checks in `src/paths.ts`, and needs its own evidence.
 */
const isOwnedRootHost = Schema.is(Schema.Literal('darwin'));
export const hostTest = test.skipIf(!isOwnedRootHost(process.platform));

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
      directory: '/tmp',
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
