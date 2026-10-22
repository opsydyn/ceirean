import { expect, test } from 'bun:test';

import { Data, Effect, Match, Option, Result, Schema } from 'effect';

import { openOwnedMigrationDatabase } from '../src/database.ts';
import {
  MigrationLedgerConfig,
  initializeMigrationLedger,
  readMigrationLedgerStatus,
} from '../src/index.ts';
import { ownedConfig, platform } from './fixtures.ts';

async function exclusiveOwner() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeMigrationLedger(config);
    function* held() {
      yield* openOwnedMigrationDatabase(config);
      expect(
        yield* Effect.scoped(openOwnedMigrationDatabase(config)).pipe(Effect.result),
      ).toMatchObject({ _tag: 'Failure', failure: { code: 'OwnershipBusy' } });
    }
    const holding = Effect.gen(held);
    yield* Effect.scoped(holding);
    yield* Effect.scoped(openOwnedMigrationDatabase(config));
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'exclusive native ownership refuses a second owner and scope exit releases the lock',
  exclusiveOwner,
);

class ChildFailure extends Data.TaggedError('ChildFailure')<{
  readonly phase: 'Spawn' | 'Ready';
}> {}
async function childDeath() {
  function* scenario() {
    const { config } = yield* ownedConfig();
    yield* initializeMigrationLedger(config);
    const script = `import { Effect, Layer } from 'effect';
      import { BunFileSystem, BunPath } from '@effect/platform-bun';
      import { openOwnedMigrationDatabase } from './src/database.ts';
      const config = JSON.parse(Bun.argv[1]);
      const program = Effect.gen(function* () {
        yield* openOwnedMigrationDatabase(config);
        console.log('OWNED');
        yield* Effect.promise(() => Bun.stdin.text());
      });
      await Effect.runPromise(Effect.provide(Effect.scoped(program), Layer.merge(BunFileSystem.layer, BunPath.layer)));`;
    const encode = Schema.encodeSync(Schema.fromJsonString(MigrationLedgerConfig));
    const args = encode(config);
    function spawn() {
      return Bun.spawn([process.execPath, '--no-env-file', '--no-install', '-e', script, args], {
        cwd: new URL('..', import.meta.url).pathname,
        env: {},
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    }
    const spawning = Effect.try({ try: spawn, catch: () => new ChildFailure({ phase: 'Spawn' }) });
    function stop(running: ReturnType<typeof spawn>) {
      function stopNative() {
        running.kill('SIGKILL');
      }
      const stopping = Effect.sync(stopNative);
      return stopping;
    }
    const child = yield* Effect.acquireRelease(spawning, stop);
    async function ready() {
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      const bytes = new Uint8Array(64);
      let used = 0;
      let line = Option.none<string>();
      async function accumulate() {
        while (Option.isNone(line)) {
          const chunk = await reader.read();
          const available = Match.value(chunk).pipe(
            Match.when({ done: false }, ({ value }) => Result.succeed(value)),
            Match.orElse(() => Result.fail(new ChildFailure({ phase: 'Ready' }))),
          );
          const value = Result.getOrThrow(available);
          const bounded = Match.value(used + value.byteLength <= bytes.byteLength).pipe(
            Match.when(true, () => Result.succeed(undefined)),
            Match.orElse(() => Result.fail(new ChildFailure({ phase: 'Ready' }))),
          );
          Result.getOrThrow(bounded);
          bytes.set(value, used);
          used += value.byteLength;
          const newline = bytes.subarray(0, used).indexOf(10);
          function completedLine(index: number) {
            const value = bytes.subarray(0, index + 1);
            const text = decoder.decode(value);
            return Option.some(text);
          }
          line = Match.value(newline).pipe(
            Match.when((index) => index >= 0, completedLine),
            Match.orElse(() => Option.none()),
          );
        }
        return Option.getOrThrow(line);
      }
      return accumulate().finally(() => reader.releaseLock());
    }
    const reading = Effect.promise(ready);
    const greeting = yield* reading.pipe(Effect.timeout('3 seconds'));
    expect(greeting).toBe('OWNED\n');
    expect(yield* openOwnedMigrationDatabase(config).pipe(Effect.result)).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'OwnershipBusy' },
    });
    expect((yield* readMigrationLedgerStatus(config)).sequence).toBe(0);
    child.kill('SIGKILL');
    const exited = Effect.promise(() => child.exited);
    yield* exited.pipe(Effect.timeout('3 seconds'));
    yield* openOwnedMigrationDatabase(config);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, platform);
  await Effect.runPromise(provided);
}
test(
  'real child ownership excludes competitors, permits status and releases on process death',
  childDeath,
);
