import { afterEach, expect, spyOn, test } from 'bun:test';

import { Effect, Fiber, FileSystem, Match, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { QualificationReceipt } from '../src/linux-qualification/contract.ts';
import { WorkerEvidenceReady, WorkerWarmupReady } from '../src/linux-qualification/live-handoff.ts';
import {
  collectReadiness,
  decodeReadiness,
  invokeReadinessWorker,
  ReadinessOnly,
} from '../src/linux-qualification/readiness-worker.ts';

const paths = { mount: '/proc/self/mountinfo', status: '/proc/self/status' };
const namespaces = ['mnt', 'pid', 'ipc', 'net', 'user'] as const;
const cgroups = ['cpu.max', 'memory.max', 'memory.swap.max', 'pids.max'] as const;
const texts: Record<string, string> = {
  [paths.mount]:
    '1 0 0:1 / / ro,nosuid - overlay overlay ro\n2 1 0:2 / /proc ro,nosuid,nodev,noexec - proc proc ro\n3 1 0:3 / /work rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=1024k\n4 1 0:4 / /private-secret ro - secret-type secret-source ro\n',
  [paths.status]:
    'Uid:\t1000 1000 1000 1000\nGid:\t1001 1001 1001 1001\nCapEff:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t2\n',
  '/sys/fs/cgroup/cpu.max': '200000 100000\n',
  '/sys/fs/cgroup/memory.max': '4294967296\n',
  '/sys/fs/cgroup/memory.swap.max': '0\n',
  '/sys/fs/cgroup/pids.max': '128\n',
};
type Fixture = {
  texts?: Record<string, string | Uint8Array>;
  links?: Record<string, string>;
  chunk?: number;
  hang?: string;
  missing?: readonly string[];
};
function fake(fixture: Fixture = {}) {
  const calls: string[] = [];
  const input = { ...texts, ...fixture.texts };
  const missingFs = FileSystem.makeNoop({});
  const isString = Schema.is(Schema.String);
  function stream(path: string) {
    calls.push(`stream:${path}`);
    const data = input[path];
    const bytes = Match.value(data).pipe(
      Match.when(isString, (value) => new TextEncoder().encode(value)),
      Match.orElse((value) => value ?? new Uint8Array()),
    );
    const chunk = fixture.chunk ?? Math.max(bytes.length, 1);
    const normal = Stream.fromIterable(
      Array.from({ length: Math.ceil(bytes.length / chunk) }, (_, i) =>
        bytes.slice(i * chunk, (i + 1) * chunk),
      ),
    );
    const waiting = Stream.fromEffect(
      Effect.sleep(1000000).pipe(Effect.map(() => new Uint8Array())),
    );
    return Match.value({
      missing: fixture.missing?.includes(path) ?? false,
      hanging: path === fixture.hang,
    }).pipe(
      Match.when({ missing: true }, () => missingFs.stream(path)),
      Match.when({ hanging: true }, () => waiting),
      Match.orElse(() => normal),
    );
  }
  function readLink(path: string) {
    calls.push(`readLink:${path}`);
    const name = path.split('/').at(-1) ?? '';
    const target = fixture.links?.[name] ?? `${name}:[123456789]`;
    function* waitForLink() {
      yield* Effect.sleep(1000000);
      return 'private-target';
    }
    const waiting = Effect.gen(waitForLink);
    const result = Match.value({
      missing: fixture.missing?.includes(path) ?? false,
      hanging: path === fixture.hang,
    }).pipe(
      Match.when({ missing: true }, () => missingFs.readLink(path)),
      Match.when({ hanging: true }, () => waiting),
      Match.orElse(() => Effect.sync(() => target)),
    );
    return result;
  }
  const fs = FileSystem.makeNoop({
    stream,
    readLink,
    stat: () => Effect.die('stat must not be used for pseudo-files'),
    readFile: () => Effect.die('unbounded reads are forbidden'),
    readFileString: () => Effect.die('unbounded reads are forbidden'),
  });
  return { fs, calls };
}
async function collect(fixture: Fixture = {}) {
  const { fs, calls } = fake(fixture);
  const clock = Effect.provide(TestClock.layer());
  const result = await Effect.runPromise(
    collectReadiness().pipe(Effect.provideService(FileSystem.FileSystem, fs), clock),
  );
  return { result, calls };
}

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const activeSpy = { restore: () => {} };
afterEach(() => activeSpy.restore());
async function fixedPaths() {
  const { result, calls } = await collect();
  expect(calls.sort()).toEqual(
    [
      ...[paths.mount, paths.status, ...cgroups.map((name) => `/sys/fs/cgroup/${name}`)].map(
        (path) => `stream:${path}`,
      ),
      ...namespaces.map((name) => `readLink:/proc/self/ns/${name}`),
    ].sort(),
  );
  expect(result).toMatchObject({
    _tag: 'ReadinessOnly',
    version: 1,
    qualificationReceipt: 'NotProduced',
    kernelMountPolicy: 'Unreviewed',
    activation: 'Blocked',
    observer: 'NotMeasured',
    networkNegatives: 'NotMeasured',
    cleanup: 'NotMeasured',
    mounts: { summary: { input: 'Parsed' } },
    status: {
      uid: [1000, 1000, 1000, 1000],
      gid: [1001, 1001, 1001, 1001],
      capEff: '0000000000000000',
      noNewPrivs: 1,
      seccomp: 2,
    },
    namespaces: {
      mnt: 'WellFormed',
      pid: 'WellFormed',
      ipc: 'WellFormed',
      net: 'WellFormed',
      user: 'WellFormed',
    },
    cgroups: { cpu: { quota: 200000, period: 100000 }, memory: 4294967296, swap: 0, pids: 128 },
  });
  const encoded = encode(result);
  for (const secret of ['123456789', 'private-secret', 'secret-type', 'secret-source'])
    expect(encoded).not.toContain(secret);
  expect(result.mounts.details).toContainEqual({
    category: 'Proc',
    count: 1,
    type: 'proc',
    access: 'ro',
    nosuid: true,
    nodev: true,
    noexec: true,
  });
}
test(
  'reads only fixed paths and reports reviewed fields without leaking identities or paths',
  fixedPaths,
);

async function ambiguousMountFlags() {
  const isRoot = Schema.is(Schema.Literal('Root'));
  for (const options of [
    ['ro,nosuid,suid', 'ro'],
    ['ro,nodev,dev', 'ro'],
    ['ro,noexec,exec', 'ro'],
    ['ro,nosuid,nosuid', 'ro'],
    ['ro,nodev', 'ro,nodev'],
    ['ro,noexec', 'ro,exec'],
    ['ro,relatime,relatime', 'ro'],
    ['ro', 'ro,privateflag,privateflag'],
    ['ro', 'ro,size=1k,size=2k'],
  ]) {
    const line = `1 0 0:1 / / ${options[0]} - overlay overlay ${options[1]}`;
    const { result } = await collect({ texts: { [paths.mount]: line } });
    const root = result.mounts.details.find((entry) => isRoot(entry.category));
    expect(root).toMatchObject({ nosuid: 'Unknown', nodev: 'Unknown', noexec: 'Unknown' });
    expect(encode(result)).not.toContain('privateflag');
  }
}
test(
  'conflicting or duplicate non-access mount flags are not reported as known',
  ambiguousMountFlags,
);

async function partitions() {
  const expected = (await collect()).result;
  for (const chunk of [1, 2, 7, 8192]) expect((await collect({ chunk })).result).toEqual(expected);
}
test(
  'all byte partitions produce the same result, including zero-sized pseudo-file metadata',
  partitions,
);

async function invalidReadbacks() {
  const { result } = await collect({
    texts: {
      [paths.mount]: 'x'.repeat(65537),
      [paths.status]: 'Uid: 1 1 1 1\nUid: 2 2 2 2\nCapEff: 1234\n',
      '/sys/fs/cgroup/cpu.max': new Uint8Array([255]),
      '/sys/fs/cgroup/memory.max': '9'.repeat(8193),
      '/sys/fs/cgroup/memory.swap.max': 'max\n',
      '/sys/fs/cgroup/pids.max': 'unreviewed-secret',
    },
    links: {
      mnt: 'mnt:[123] trailing-secret',
      pid: 'net:[42]',
      ipc: 'ipc:[0]',
      net: '/private-secret',
      user: 'user:[1]',
    },
  });
  expect(result.mounts.summary.input).toBe('TooLarge');
  expect(result.status.uid).toBe('Unknown');
  expect(result.status.gid).toBe('Unknown');
  expect(result.cgroups).toEqual({
    cpu: 'Unknown',
    memory: 'Unknown',
    swap: 'Max',
    pids: 'Unknown',
  });
  expect(result.namespaces).toEqual({
    mnt: 'Unknown',
    pid: 'Unknown',
    ipc: 'Unknown',
    net: 'Unknown',
    user: 'WellFormed',
  });
  expect(encode(result)).not.toContain('secret');
}
test(
  'oversize, invalid UTF-8, absent controls and duplicate status keys become unknown',
  invalidReadbacks,
);

async function missingReadbacks() {
  const missing = [paths.status, '/sys/fs/cgroup/pids.max', '/proc/self/ns/net'];
  const { result } = await collect({ missing });
  expect(result.status.uid).toBe('Unknown');
  expect(result.status.capEff).toBe('Unknown');
  expect(result.cgroups.pids).toBe('Unknown');
  expect(result.namespaces.net).toBe('Unknown');
  expect(result.namespaces.mnt).toBe('WellFormed');
  expect(encode(result)).not.toContain('/proc/self/ns/net');
}
test('missing controls and namespace links remain unknown', missingReadbacks);

async function schemaIsolation() {
  const { result } = await collect();
  const strict = { onExcessProperty: 'error' } as const;
  expect(Schema.decodeUnknownResult(ReadinessOnly, strict)(result)._tag).toBe('Success');
  for (const forged of [
    { qualificationReceipt: 'Produced' },
    { kernelMountPolicy: 'Reviewed' },
    { activation: 'Enabled' },
  ]) {
    expect(Schema.decodeUnknownResult(ReadinessOnly, strict)({ ...result, ...forged })._tag).toBe(
      'Failure',
    );
  }
  expect(
    Schema.decodeUnknownResult(ReadinessOnly, strict)({ ...result, extra: 'secret' })._tag,
  ).toBe('Failure');
  expect(
    Schema.decodeUnknownResult(
      ReadinessOnly,
      strict,
    )({ ...result, namespaces: { ...result.namespaces, extra: 'secret' } })._tag,
  ).toBe('Failure');
  expect(Schema.decodeUnknownResult(QualificationReceipt, strict)(result)._tag).toBe('Failure');
  expect(Schema.decodeUnknownResult(WorkerEvidenceReady, strict)(result)._tag).toBe('Failure');
  expect(Schema.decodeUnknownResult(WorkerWarmupReady, strict)(result)._tag).toBe('Failure');
  expect(
    Schema.decodeUnknownResult(
      ReadinessOnly,
      strict,
    )({ ...result, status: { ...result.status, uid: [4294967296, 0, 0, 0] } })._tag,
  ).toBe('Failure');
  expect(
    Schema.decodeUnknownResult(
      ReadinessOnly,
      strict,
    )({ ...result, status: { ...result.status, seccomp: 999 } })._tag,
  ).toBe('Failure');
  expect(
    Schema.decodeUnknownResult(
      ReadinessOnly,
      strict,
    )({ ...result, namespaces: { ...result.namespaces, mnt: 'mnt:[123]' } })._tag,
  ).toBe('Failure');
}
test(
  'strict readiness schema rejects excess properties and qualification decoders reject the frame',
  schemaIsolation,
);

async function strictHostBoundary() {
  const { result } = await collect();
  const clock = Effect.provide(TestClock.layer());
  const valid = await Effect.runPromise(decodeReadiness(result).pipe(clock, Effect.result));
  const extra = await Effect.runPromise(
    decodeReadiness({ ...result, extra: 'secret' }).pipe(clock, Effect.result),
  );
  const nested = await Effect.runPromise(
    decodeReadiness({ ...result, namespaces: { ...result.namespaces, extra: 'secret' } }).pipe(
      clock,
      Effect.result,
    ),
  );
  expect(valid._tag).toBe('Success');
  expect(extra._tag).toBe('Failure');
  expect(nested._tag).toBe('Failure');
}
test('exported host decoder enforces strict decoding without caller options', strictHostBoundary);

async function cpuSchemaBounds() {
  const { result } = await collect();
  const decode = Schema.decodeUnknownResult(ReadinessOnly, { onExcessProperty: 'error' });
  for (const cpu of [
    { quota: 'Unknown', period: 100000 },
    { quota: 100, period: 0 },
  ]) {
    expect(decode({ ...result, cgroups: { ...result.cgroups, cpu } })._tag).toBe('Failure');
  }
  for (const cpu of ['Unknown', { quota: 'Max', period: 100000 }, { quota: 1000, period: 1000 }]) {
    expect(decode({ ...result, cgroups: { ...result.cgroups, cpu } })._tag).toBe('Success');
  }
}
test('known CPU data requires a known quota and positive period', cpuSchemaBounds);

async function cpuCollectorBounds() {
  for (const input of [
    '0 100000',
    '999 100000',
    '1000 1',
    '1000 999',
    'max 999',
    '1000 1000001',
    '9007199254740992 100000',
  ]) {
    const { result } = await collect({ texts: { '/sys/fs/cgroup/cpu.max': input } });
    expect(result.cgroups.cpu).toBe('Unknown');
  }
  for (const [input, cpu] of [
    ['1000 1000', { quota: 1000, period: 1000 }],
    ['1000000 1000000', { quota: 1000000, period: 1000000 }],
    ['max 1000', { quota: 'Max', period: 1000 }],
    ['max 1000000', { quota: 'Max', period: 1000000 }],
  ] as const) {
    const { result } = await collect({ texts: { '/sys/fs/cgroup/cpu.max': input } });
    expect(result.cgroups.cpu).toEqual(cpu);
  }
}
test('collector treats invalid or unsupported CPU limits as unknown', cpuCollectorBounds);

async function strictCpuBounds() {
  const { result } = await collect();
  const clock = Effect.provide(TestClock.layer());
  for (const cpu of [
    { quota: 0, period: 100000 },
    { quota: 999, period: 100000 },
    { quota: 1000, period: 1 },
    { quota: 1000, period: 999 },
    { quota: 1000, period: 1000001 },
    { quota: Number.MAX_SAFE_INTEGER + 1, period: 100000 },
  ]) {
    const input = { ...result, cgroups: { ...result.cgroups, cpu } };
    const decoded = await Effect.runPromise(decodeReadiness(input).pipe(clock, Effect.result));
    expect(decoded._tag).toBe('Failure');
  }
  for (const cpu of [
    { quota: 1000, period: 1000 },
    { quota: 1000000, period: 1000000 },
    { quota: 'Max', period: 1000 },
    { quota: 'Max', period: 1000000 },
  ]) {
    const input = { ...result, cgroups: { ...result.cgroups, cpu } };
    const decoded = await Effect.runPromise(decodeReadiness(input).pipe(clock, Effect.result));
    expect(decoded._tag).toBe('Success');
  }
}
test('strict host decoder rejects invalid or unsupported CPU limits', strictCpuBounds);

async function multicoreQuota() {
  const clock = Effect.provide(TestClock.layer());
  for (const quota of [2000000, Number.MAX_SAFE_INTEGER]) {
    const { result } = await collect({
      texts: { '/sys/fs/cgroup/cpu.max': `${quota} 1000000` },
    });
    expect(result.cgroups.cpu).toEqual({ quota, period: 1000000 });
    const decoded = await Effect.runPromise(decodeReadiness(result).pipe(clock, Effect.result));
    expect(decoded._tag).toBe('Success');
  }
}
test('preserves multicore and maximum safe integer quotas', multicoreQuota);

async function strictMulticoreQuota() {
  const { result } = await collect();
  const clock = Effect.provide(TestClock.layer());
  for (const quota of [2000000, Number.MAX_SAFE_INTEGER]) {
    const input = { ...result, cgroups: { ...result.cgroups, cpu: { quota, period: 1000000 } } };
    const decoded = await Effect.runPromise(decodeReadiness(input).pipe(clock, Effect.result));
    expect(decoded._tag).toBe('Success');
  }
}
test('strict decoder accepts multicore and maximum safe integer quotas', strictMulticoreQuota);

async function fixedInvocation() {
  const { fs, calls } = fake();
  const clock = Effect.provide(TestClock.layer());
  for (const args of [[], ['--check'], ['--worker', 'extra'], ['--worker=/tmp']]) {
    expect(
      (
        await Effect.runPromise(
          invokeReadinessWorker(args).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            clock,
            Effect.result,
          ),
        )
      )._tag,
    ).toBe('Failure');
  }
  expect(calls).toEqual([]);
  const frame = await Effect.runPromise(
    invokeReadinessWorker(['--worker']).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      clock,
    ),
  );
  expect(frame.endsWith('\n')).toBe(true);
  expect(frame.split('\n')).toHaveLength(2);
  expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(262144);
  const json = Schema.fromJsonString(ReadinessOnly);
  expect(Schema.decodeUnknownResult(json, { onExcessProperty: 'error' })(frame)._tag).toBe(
    'Success',
  );
}
test('only the exact worker invocation produces one bounded frame', fixedInvocation);

async function fakeTimeout() {
  const { fs } = fake({ hang: paths.mount });
  const collector = collectReadiness().pipe(Effect.provideService(FileSystem.FileSystem, fs));
  function* exercise() {
    const fiber = yield* Effect.forkChild(collector);
    yield* TestClock.adjust(90001);
    const result = yield* Fiber.join(fiber);
    expect(result.mounts.summary.input).toBe('Invalid');
  }
  const program = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(program.pipe(Effect.scoped, clock));
}
test('a stuck read expires on the fake clock', fakeTimeout);

async function namespaceTimeout() {
  const { fs } = fake({ hang: '/proc/self/ns/net' });
  const collector = collectReadiness().pipe(Effect.provideService(FileSystem.FileSystem, fs));
  function* exercise() {
    const fiber = yield* Effect.forkChild(collector);
    yield* TestClock.adjust(90001);
    const result = yield* Fiber.join(fiber);
    expect(result.namespaces.net).toBe('Unknown');
    expect(encode(result)).not.toContain('private-target');
  }
  const program = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(program.pipe(Effect.scoped, clock));
}
test('a stuck namespace read expires without exposing its target', namespaceTimeout);

async function oversizedNamespace() {
  const target = `mnt:[${'1'.repeat(65536)}]`;
  const regex = spyOn(RegExp.prototype, 'test');
  activeSpy.restore = () => regex.mockRestore();
  const { result } = await collect({ links: { mnt: target } });
  expect(result.namespaces.mnt).toBe('Unknown');
  expect(regex.mock.calls.some((args) => args[0] === target)).toBe(false);
  expect(encode(result)).not.toContain(target);
}
test('oversized namespace targets are rejected before regex scanning', oversizedNamespace);
