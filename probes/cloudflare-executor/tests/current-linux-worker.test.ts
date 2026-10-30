import { expect, test } from 'bun:test';

import { NodeServices } from '@effect/platform-node';
import {
  Console,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Match,
  Ref,
  Schema,
  Stream,
} from 'effect';
import { TestClock } from 'effect/testing';

import {
  acceptsCacheOnlyArguments,
  currentLinuxWorkerCommands,
  collectCacheOnlyOutput,
  validateCacheOnlyRuntime,
  validateOutputMetadata,
  withCacheOnlyReplay,
  CurrentLinuxWorkerError,
  sanitizeCacheOnlyFailure,
  attemptCurrentLinuxCacheOnly,
  runCurrentLinuxCacheOnly,
} from '../src/current-linux-worker.ts';
import { CacheError, CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';

const withPlatform = Effect.provide(NodeServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
const withClock = Effect.provide(TestClock.layer());
const decodeEvidence = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

test('only the exact cache-only CLI is admitted', () => {
  expect(acceptsCacheOnlyArguments(['--run-cache-only'])).toBe(true);
  for (const args of [[], ['--worker'], ['--run-cache-only', 'x'], ['--activate']]) {
    expect(acceptsCacheOnlyArguments(args)).toBe(false);
  }
});

type FakeMetadata = Effect.Success<ReturnType<ReturnType<typeof makeCacheMetadata>['lstat']>>;
function attemptFixture(
  root: Partial<FakeMetadata> = {},
  canonical = '/work',
  initial: string[] = [],
) {
  const calls: string[] = [];
  const stderr: string[] = [];
  const files = new Map<string, string>();
  const writeStarted = Deferred.makeUnsafe<void>();
  let stalled = false;
  let closed = 0;
  const directory: FakeMetadata = {
    type: 'Directory',
    mode: 0o700,
    uid: 1000,
    gid: 1000,
    size: 0n,
    dev: 1n,
    ino: 1n,
    nlink: 2n,
  };
  const nodes = new Map<string, FakeMetadata>([['/work', { ...directory, ...root }]]);
  function makeDirectory(path: string, options?: { recursive?: boolean; mode?: number }) {
    function create() {
      calls.push(`mkdir:${path}`);
      expect(options).toEqual({ mode: 0o700 });
      nodes.set(path, { ...directory, ino: 2n });
    }
    const workflow = Effect.sync(create);
    return workflow;
  }
  function open(path: string, options?: { flag?: string; mode?: number; noFollow?: boolean }) {
    function writeAll(bytes: Uint8Array) {
      function* write() {
        yield* Deferred.succeed(writeStarted, undefined);
        const waiting = Effect.sleep('1 hour');
        const shouldWait = Effect.sync(() => stalled);
        yield* waiting.pipe(Effect.when(shouldWait));
        calls.push(`write:${path}`);
        files.set(path, new TextDecoder().decode(bytes));
      }
      const workflow = Effect.gen(write);
      return workflow;
    }
    const unused = Effect.die(new Error('Unexpected fake file operation'));
    const file: FileSystem.File = {
      [FileSystem.FileTypeId]: FileSystem.FileTypeId,
      stat: unused,
      seek: () => unused,
      sync: unused,
      read: () => unused,
      readAlloc: () => unused,
      truncate: () => unused,
      write: () => unused,
      writeAll,
    };
    function createFile() {
      calls.push(`open:${path}`);
      expect(options).toEqual({ flag: 'wx', mode: 0o600, noFollow: true });
      expect(nodes.has(path)).toBe(false);
      nodes.set(path, { ...directory, type: 'File', mode: 0o600, ino: 3n, nlink: 1n });
      return file;
    }
    const creating = Effect.sync(createFile);
    const releasing = Effect.sync(() => {
      closed++;
    });
    const workflow = Effect.acquireRelease(creating, () => releasing);
    return workflow;
  }
  function realPath(path: string) {
    const actual = Match.value(path).pipe(
      Match.when('/work', () => canonical),
      Match.orElse((value) => value),
    );
    const workflow = Effect.sync(() => actual);
    return workflow;
  }
  const fs = FileSystem.makeNoop({
    realPath,
    readDirectory: () => Effect.sync(() => initial),
    makeDirectory,
    open,
  });
  function lstat(path: string) {
    function* inspect() {
      const found = nodes.get(path);
      const selecting = Effect.fromNullishOr(found);
      return yield* selecting.pipe(Effect.mapError(() => new CacheError({ code: 'CacheRefused' })));
    }
    const workflow = Effect.gen(inspect);
    return workflow;
  }
  const metadata = { lstat };
  const logger = {
    ...console,
    error: (...values: unknown[]) => {
      stderr.push(values.join(' '));
    },
  };
  const provide = Effect.provideService(FileSystem.FileSystem, fs);
  const provideMetadata = Effect.provideService(CacheMetadata, metadata);
  const provideConsole = Effect.provideService(Console.Console, logger);
  return {
    calls,
    stderr,
    files,
    nodes,
    provide,
    provideMetadata,
    provideConsole,
    writeStarted,
    stallWrites: () => {
      stalled = true;
    },
    closed: () => closed,
  };
}

async function wrapperUsageIsInert() {
  for (const args of [[], ['--worker'], ['--run-cache-only', 'extra'], ['--activate']]) {
    const fake = attemptFixture();
    function execute() {
      const workflow = Effect.die(new Error('Execution must not start'));
      return workflow;
    }
    const result = await Effect.runPromise(
      attemptCurrentLinuxCacheOnly(args, execute).pipe(
        fake.provide,
        fake.provideMetadata,
        fake.provideConsole,
        withPlatform,
      ),
    );
    expect(result).toBe(64);
    expect(fake.calls).toEqual([]);
    expect(fake.files.size).toBe(0);
    expect(fake.stderr).toEqual(['{"status":"UsageError","activation":"Blocked"}']);
  }
}
test(
  'attempt wrapper rejects invalid argv without execution or filesystem mutations',
  wrapperUsageIsInert,
);

async function oneSuccessfulReport() {
  const fake = attemptFixture();
  const receipt: Effect.Success<ReturnType<typeof runCurrentLinuxCacheOnly>> = {
    status: 'CacheOnlyCompleted',
    activation: 'Blocked',
    qualified: false,
    scripts: 'Disabled',
    acceptance: 'CacheOnlyNotBaselineQualified',
    runtime: { node: '22.23.4', bun: '1.4.3', npm: '10.9.9', os: 'linux', arch: 'x64' },
    sourceFiles: 1,
    sourceInventorySha256: '3b2862214f45be2d0d4211acce1c7c81b0c717ac3b9487f139535239cc6a16df',
    lockSha256: '9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89',
    bun: {
      seedSha256: 'a'.repeat(64),
      warmupOutputBytes: 0,
      freshOutputBytes: 0,
      installedIdentities: 'NotCheckedBunJsoncParserUnavailable',
    },
    npm: [],
  };
  function execute(progress: Ref.Ref<string>) {
    function* complete() {
      yield* Ref.set(progress, 'Evidence');
      return receipt;
    }
    const workflow = Effect.gen(complete);
    return workflow;
  }
  const result = await Effect.runPromise(
    attemptCurrentLinuxCacheOnly(['--run-cache-only'], execute).pipe(
      fake.provide,
      fake.provideMetadata,
      fake.provideConsole,
      withPlatform,
    ),
  );
  expect(result).toBe(0);
  expect(fake.calls).toEqual([
    'mkdir:/work/evidence',
    'open:/work/evidence/result.json',
    'write:/work/evidence/result.json',
  ]);
  expect(decodeEvidence(fake.files.get('/work/evidence/result.json')!)).toEqual({
    ...receipt,
    phase: 'Evidence',
  });
  expect(fake.closed()).toBe(1);
  expect(fake.stderr).toEqual([]);
}
test('successful execution publishes one exclusive result after cleanup', oneSuccessfulReport);

async function reportingDeadlineIsInterruptible() {
  const fake = attemptFixture();
  fake.stallWrites();
  function execute() {
    const workflow = Effect.fail(new CurrentLinuxWorkerError({ code: 'CommandFailed' }));
    return workflow;
  }
  function* checkDeadline() {
    const fiber = yield* attemptCurrentLinuxCacheOnly(['--run-cache-only'], execute).pipe(
      Effect.forkChild,
    );
    yield* Deferred.await(fake.writeStarted).pipe(Effect.timeout('1 second'));
    yield* TestClock.adjust('5 seconds');
    const closedAtDeadline = fake.closed();
    // Drain the old uninterruptible regression too, so a red test cannot leak its fiber.
    yield* TestClock.adjust('1 hour');
    expect(yield* Fiber.join(fiber)).toBe(1);
    expect(closedAtDeadline).toBe(1);
  }
  const workflow = Effect.gen(checkDeadline);
  await Effect.runPromise(
    workflow.pipe(
      Effect.scoped,
      fake.provide,
      fake.provideMetadata,
      fake.provideConsole,
      withPlatform,
      withClock,
    ),
  );
}
test(
  'evidence write deadline interrupts stalled I/O and closes its scoped handle',
  reportingDeadlineIsInterruptible,
);

async function externalCancellationReportsAfterCleanup() {
  const fake = attemptFixture();
  const ready = Deferred.makeUnsafe<void>();
  function execute() {
    function* holdExecution() {
      const acquiring = Deferred.succeed(ready, undefined);
      const cleanup = Effect.sync(() => {
        fake.calls.push('cleanup');
      });
      yield* Effect.acquireRelease(acquiring, () => cleanup);
      yield* Effect.sleep('1 hour');
      return yield* Effect.fail(new CurrentLinuxWorkerError({ code: 'CommandFailed' }));
    }
    const workflow = Effect.gen(holdExecution);
    return workflow.pipe(Effect.scoped);
  }
  function* cancel() {
    const fiber = yield* attemptCurrentLinuxCacheOnly(['--run-cache-only'], execute).pipe(
      Effect.forkChild,
    );
    yield* Deferred.await(ready).pipe(Effect.timeout('1 second'));
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    expect(Exit.hasInterrupts(exit)).toBe(true);
  }
  const workflow = Effect.gen(cancel);
  await Effect.runPromise(
    workflow.pipe(
      Effect.scoped,
      fake.provide,
      fake.provideMetadata,
      fake.provideConsole,
      withPlatform,
    ),
  );
  expect(fake.calls).toEqual([
    'mkdir:/work/evidence',
    'cleanup',
    'open:/work/evidence/result.json',
    'write:/work/evidence/result.json',
  ]);
  expect(decodeEvidence(fake.files.get('/work/evidence/result.json')!)).toMatchObject({
    status: 'CacheOnlyFailed',
    reason: 'Interrupted',
    interrupted: true,
    phase: 'ArchiveAdmission',
  });
  expect(fake.closed()).toBe(1);
  expect(fake.stderr).toEqual([]);
}
test(
  'external cancellation finishes cleanup before publishing sanitized evidence',
  externalCancellationReportsAfterCleanup,
);

async function refusesUnsafeWorkspace() {
  const cases = [
    attemptFixture({ type: 'SymbolicLink' }),
    attemptFixture({ uid: 0 }),
    attemptFixture({ gid: 0 }),
    attemptFixture({ mode: 0o1777 }),
    attemptFixture({}, '/elsewhere'),
    attemptFixture({}, '/work', ['existing']),
  ];
  for (const fake of cases) {
    function execute() {
      const workflow = Effect.die(new Error('Execution must not start'));
      return workflow;
    }
    const result = await Effect.runPromise(
      attemptCurrentLinuxCacheOnly(['--run-cache-only'], execute).pipe(
        fake.provide,
        fake.provideMetadata,
        fake.provideConsole,
        withPlatform,
      ),
    );
    expect(result).toBe(1);
    expect(fake.calls).toEqual([]);
    expect(fake.files.size).toBe(0);
    expect(fake.stderr.join('')).toContain('WorkspaceAdmission');
    expect(fake.stderr.join('')).not.toContain('Execution must not start');
  }
}
test(
  'unsafe or nonempty workspaces are refused before any filesystem mutation',
  refusesUnsafeWorkspace,
);

async function evidenceOnlyThroughOwner() {
  const fake = attemptFixture();
  function* failAfterAdmission() {
    expect(fake.calls).toEqual(['mkdir:/work/evidence']);
    return yield* Effect.fail(new CurrentLinuxWorkerError({ code: 'InputChanged' }));
  }
  function execute() {
    const workflow = Effect.gen(failAfterAdmission);
    return workflow;
  }
  const result = await Effect.runPromise(
    attemptCurrentLinuxCacheOnly(['--run-cache-only'], execute).pipe(
      fake.provide,
      fake.provideMetadata,
      fake.provideConsole,
      withPlatform,
    ),
  );
  expect(result).toBe(1);
  expect(fake.calls).toEqual([
    'mkdir:/work/evidence',
    'open:/work/evidence/result.json',
    'write:/work/evidence/result.json',
  ]);
  expect(decodeEvidence(fake.files.get('/work/evidence/result.json')!)).toMatchObject({
    status: 'CacheOnlyFailed',
    reason: 'InputChanged',
  });
}
test(
  'admission creates evidence once and archive failure writes exclusively through its owner',
  evidenceOnlyThroughOwner,
);

async function refusesReplacedEvidence() {
  for (const replacement of ['SymbolicLink', 'Directory'] as const) {
    const fake = attemptFixture();
    function* replaceAndFail() {
      const previous = fake.nodes.get('/work/evidence')!;
      fake.nodes.set('/work/evidence', { ...previous, type: replacement, ino: 99n });
      return yield* Effect.fail(new CurrentLinuxWorkerError({ code: 'InputChanged' }));
    }
    function execute() {
      const workflow = Effect.gen(replaceAndFail);
      return workflow;
    }
    const result = await Effect.runPromise(
      attemptCurrentLinuxCacheOnly(['--run-cache-only'], execute).pipe(
        fake.provide,
        fake.provideMetadata,
        fake.provideConsole,
        withPlatform,
      ),
    );
    expect(result).toBe(1);
    expect(fake.calls).toEqual(['mkdir:/work/evidence']);
    expect(fake.files.size).toBe(0);
    expect(fake.stderr.join('')).toContain('CacheOnlyFailed');
  }
}
test(
  'failure reporting never writes through linked or replaced evidence directories',
  refusesReplacedEvidence,
);

async function recordsCleanupDefects() {
  const fake = attemptFixture();
  function* executeScoped() {
    yield* Effect.acquireRelease(Effect.void, () =>
      Effect.die({ code: 'StopFailed', message: 'private cleanup text' }),
    );
    return yield* Effect.fail(new CurrentLinuxWorkerError({ code: 'CommandFailed' }));
  }
  function execute() {
    const workflow = Effect.gen(executeScoped);
    return workflow.pipe(Effect.scoped);
  }
  const result = await Effect.runPromise(
    attemptCurrentLinuxCacheOnly(['--run-cache-only'], execute).pipe(
      fake.provide,
      fake.provideMetadata,
      fake.provideConsole,
      withPlatform,
    ),
  );
  expect(result).toBe(1);
  const text = fake.files.get('/work/evidence/result.json')!;
  expect(decodeEvidence(text)).toMatchObject({
    status: 'CacheOnlyFailed',
    reason: 'StopFailed',
    reasons: expect.arrayContaining(['CommandFailed', 'StopFailed']),
    defect: true,
  });
  expect(text).not.toContain('private cleanup text');
}
test(
  'full exit capture records replay cleanup defects after scoped release',
  recordsCleanupDefects,
);

function fixedCommands() {
  const commands = currentLinuxWorkerCommands();
  expect(commands.warmup.executable).toBe('/usr/local/bin/bun');
  expect(commands.warmup.argv).toEqual([
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--backend=copyfile',
    '--registry=http://127.0.0.1:4873',
  ]);
  expect(commands.fresh.argv).toEqual([
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--backend=copyfile',
  ]);
  expect(commands.npm).toHaveLength(4);
  for (const command of commands.npm) {
    expect(command.executable).toBe('/tools/node');
    expect(command.argv).toEqual([
      '--require',
      '/tools/scripts/npm-offline-guard.cjs',
      '/tools/node_modules/npm/bin/npm-cli.js',
      'install',
      '--offline',
      '--ignore-scripts',
      '--include=dev',
      '--include=optional',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org/',
    ]);
  }
}
test(
  'fixed install commands disable scripts and fresh Bun has no registry override',
  fixedCommands,
);

async function runtimeReadbacks() {
  const valid = ['{"version":"v22.23.4","platform":"linux","arch":"x64"}', '1.4.3\n', '10.9.9\n'];
  expect(await Effect.runPromise(validateCacheOnlyRuntime(valid))).toEqual({
    node: '22.23.4',
    bun: '1.4.3',
    npm: '10.9.9',
    os: 'linux',
    arch: 'x64',
  });
  for (const values of [
    [valid[0]!, '1.4.2', valid[2]!],
    ['{}', valid[1]!, valid[2]!],
  ]) {
    const result = await Effect.runPromise(validateCacheOnlyRuntime(values).pipe(Effect.result));
    expect(result._tag).toBe('Failure');
  }
}
test('runtime readbacks reject host or historical runtimes', runtimeReadbacks);

async function boundedOutput() {
  const spent = Ref.makeUnsafe(1048575);
  const result = await Effect.runPromise(
    collectCacheOnlyOutput(Stream.make(new Uint8Array(2)), spent).pipe(Effect.result),
  );
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'OutputBudgetExceeded' } });
}
test('stdout and stderr share a strict output budget', boundedOutput);

function fakeReplay(events: string[]) {
  const workflow = Effect.succeed({
    host: '127.0.0.1' as const,
    port: 4873,
    snapshotRequests: () => Effect.succeed({ blocked: false, truncated: false, requests: [] }),
    stop: () =>
      Effect.sync(() => {
        events.push('stop');
      }),
  });
  return workflow;
}

async function stopsBeforeFresh() {
  const events: string[] = [];
  const replay = fakeReplay(events);
  function warmed() {
    events.push('warmup');
    return { stdout: '', exitCode: 0, outputBytes: 0 };
  }
  const warmup = Effect.sync(warmed);
  await Effect.runPromise(withCacheOnlyReplay(replay, warmup).pipe(withMetadata, withPlatform));
  events.push('fresh');
  expect(events).toEqual(['warmup', 'stop', 'fresh']);
}
test('replay is stopped before the default-registry phase', stopsBeforeFresh);

async function closesOnFailure() {
  const events: string[] = [];
  const replay = fakeReplay(events);
  const failing = Effect.fail(new CurrentLinuxWorkerError({ code: 'CommandFailed' }));
  await Effect.runPromise(
    withCacheOnlyReplay(replay, failing).pipe(Effect.result, withMetadata, withPlatform),
  );
  expect(events).toEqual(['stop']);
}
test('failed warmup still closes replay', closesOnFailure);

async function closesOnCancellation() {
  const events: string[] = [];
  const started = Deferred.makeUnsafe<void>();
  const replay = fakeReplay(events);
  function* holdWarmup() {
    yield* Effect.sleep('1 hour');
    return { stdout: '', exitCode: 0, outputBytes: 0 };
  }
  const holding = Effect.gen(holdWarmup);
  const waiting = Deferred.succeed(started, undefined).pipe(Effect.andThen(holding));
  function* cancel() {
    const fiber = yield* withCacheOnlyReplay(replay, waiting).pipe(Effect.forkChild);
    yield* Deferred.await(started).pipe(Effect.timeout('1 second'));
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    expect(Exit.hasInterrupts(exit)).toBe(true);
  }
  const workflow = Effect.gen(cancel);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withMetadata, withPlatform));
  expect(events).toEqual(['stop']);
}
test('cancellation closes a live replay before returning', closesOnCancellation);

async function blockedReplayFails() {
  const events: string[] = [];
  const base = await Effect.runPromise(fakeReplay(events));
  const replay = Effect.succeed({
    ...base,
    snapshotRequests: () => Effect.succeed({ blocked: true, truncated: false, requests: [] }),
  });
  const warmup = Effect.succeed({ stdout: '', exitCode: 0, outputBytes: 0 });
  const result = await Effect.runPromise(
    withCacheOnlyReplay(replay, warmup).pipe(Effect.result, withMetadata, withPlatform),
  );
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'InputChanged' } });
  expect(events).toEqual(['stop']);
}
test('a blocked replay refuses even a zero-exit warmup', blockedReplayFails);

async function outputMetadata() {
  const regular = { type: 'File', mode: 0o644, uid: 1000, gid: 1000, nlink: 1n };
  await Effect.runPromise(validateOutputMetadata(regular));
  for (const changed of [
    { ...regular, uid: 0 },
    { ...regular, gid: 0 },
    { ...regular, mode: 0o4644 },
    { ...regular, type: 'Socket' },
    { ...regular, nlink: 2n },
  ]) {
    const result = await Effect.runPromise(validateOutputMetadata(changed).pipe(Effect.result));
    expect(result._tag).toBe('Failure');
  }
}
test('output metadata rejects wrong owners, special modes, and special files', outputMetadata);

test('failure evidence keeps a concrete code without raw child text', () => {
  expect(
    sanitizeCacheOnlyFailure({ code: 'CommandFailed', message: 'private raw child output' }),
  ).toEqual({ reason: 'CommandFailed' });
  expect(sanitizeCacheOnlyFailure(new Error('private input path'))).toEqual({
    reason: 'UnclassifiedFailure',
  });
});
