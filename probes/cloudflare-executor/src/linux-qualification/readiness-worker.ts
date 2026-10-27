import { Effect, FileSystem, Match, Option, Result, Schema, Stream } from 'effect';

import { inspectMountDetails, inspectMountInventory } from './readiness.ts';

const unknown = Schema.Literal('Unknown');
const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 256 }));
const value = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const uid = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4294967295 }));
const category = Schema.Literals(['Root', 'Work', 'Home', 'Tmp', 'Dev', 'DevShm', 'Other']);
const detailCategory = Schema.Literals([
  'Root',
  'Work',
  'Home',
  'Tmp',
  'Dev',
  'DevShm',
  'Proc',
  'Sys',
  'Cgroup',
  'DevPts',
]);
const finding = Schema.Literals([
  'DuplicateId',
  'WritableDeviceAlias',
  'Overmount',
  'MissingRoot',
  'AmbiguousRoot',
  'WritableRoot',
  'WritableSubmount',
  'UnexpectedWritableMount',
  'UnknownCapacity',
  'CapacityOverflow',
  'OverBudget',
  'ProposedCapacityMismatch',
  'NonRootMountRoot:Work',
  'NonRootMountRoot:Home',
  'NonRootMountRoot:Tmp',
  'NonRootMountRoot:Dev',
  'NonRootMountRoot:DevShm',
]);
const maybeNumber = Schema.Union([value, Schema.Null]);
const summary = Schema.Struct({
  _tag: Schema.Literal('ReadinessOnly'),
  input: Schema.Literals(['Parsed', 'Invalid', 'TooLarge']),
  kernelMountPolicy: Schema.Literal('Unreviewed'),
  budgetBytes: Schema.Literal(3221225472),
  writableTmpfsBytes: maybeNumber,
  categories: Schema.Array(
    Schema.Struct({ category, count, writableTmpfsBytes: maybeNumber, proposedBytes: maybeNumber }),
  ).check(Schema.isMaxLength(7)),
  findings: Schema.Array(finding).check(Schema.isMaxLength(17)),
});
const flag = Schema.Union([Schema.Boolean, unknown]);
const detail = Schema.Struct({
  category: detailCategory,
  count,
  type: Schema.Literals([
    'overlay',
    'tmpfs',
    'proc',
    'sysfs',
    'cgroup2',
    'devpts',
    'ext4',
    'xfs',
    'Unknown',
  ]),
  access: Schema.Literals(['ro', 'rw', 'Unknown']),
  nosuid: flag,
  nodev: flag,
  noexec: flag,
});
const identity = Schema.Union([Schema.Tuple([uid, uid, uid, uid]), unknown]);
const capability = Schema.Union([
  Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/u)),
  unknown,
]);
const namespace = Schema.Literals(['WellFormed', 'Unknown']);
const limit = Schema.Union([value, Schema.Literal('Max'), unknown]);
const cpuFiniteQuota = Schema.Int.check(
  Schema.isBetween({ minimum: 1000, maximum: Number.MAX_SAFE_INTEGER }),
);
const cpuQuota = Schema.Union([cpuFiniteQuota, Schema.Literal('Max')]);
const cpuPeriod = Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 1000000 }));
export const ReadinessOnly = Schema.Struct({
  _tag: Schema.Literal('ReadinessOnly'),
  version: Schema.Literal(1),
  qualificationReceipt: Schema.Literal('NotProduced'),
  kernelMountPolicy: Schema.Literal('Unreviewed'),
  activation: Schema.Literal('Blocked'),
  mounts: Schema.Struct({ summary, details: Schema.Array(detail).check(Schema.isMaxLength(10)) }),
  status: Schema.Struct({
    uid: identity,
    gid: identity,
    capInh: capability,
    capPrm: capability,
    capEff: capability,
    capBnd: capability,
    capAmb: capability,
    noNewPrivs: Schema.Literals([0, 1, 'Unknown']),
    seccomp: Schema.Literals([0, 1, 2, 'Unknown']),
  }),
  namespaces: Schema.Struct({
    mnt: namespace,
    pid: namespace,
    ipc: namespace,
    net: namespace,
    user: namespace,
  }),
  cgroups: Schema.Struct({
    cpu: Schema.Union([Schema.Struct({ quota: cpuQuota, period: cpuPeriod }), unknown]),
    memory: limit,
    swap: limit,
    pids: limit,
  }),
  observer: Schema.Literal('NotMeasured'),
  networkNegatives: Schema.Literal('NotMeasured'),
  cleanup: Schema.Literal('NotMeasured'),
});
export type ReadinessOnly = typeof ReadinessOnly.Type;
export const decodeReadiness = Schema.decodeUnknownEffect(ReadinessOnly, {
  onExcessProperty: 'error',
});

type Read = { tag: 'Read'; text: string } | { tag: 'Unknown' | 'TooLarge' };
const isTooLarge = Schema.is(Schema.Literal('TooLarge'));
const isRead = Schema.is(Schema.Struct({ tag: Schema.Literal('Read'), text: Schema.String }));
const isMax = Schema.is(Schema.Literal('max'));
const isUnknown = Schema.is(unknown);
const isCpuQuota = Schema.is(cpuQuota);
const isCpuPeriod = Schema.is(cpuPeriod);
function readText(fs: FileSystem.FileSystem, path: string, max: number) {
  function* read() {
    let size = 0;
    function reserve(chunk: Uint8Array) {
      size += chunk.length;
      const checked = Result.succeed(chunk).pipe(
        Result.filterOrFail(
          () => size <= max,
          () => 'TooLarge' as const,
        ),
      );
      const workflow = Effect.fromResult(checked);
      return workflow;
    }
    const chunks = yield* fs.stream(path, { chunkSize: 4096, bytesToRead: max + 1 }).pipe(
      Stream.filter((chunk) => chunk.length > 0),
      Stream.mapEffect(reserve),
      Stream.runCollect,
    );
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = yield* Effect.try(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    // A final newline detects an incomplete last record, not truncation at an earlier record boundary.
    yield* Effect.fromResult(
      Result.succeed(text).pipe(
        Result.filterOrFail(
          (value) => value.endsWith('\n'),
          () => 'Unterminated' as const,
        ),
      ),
    );
    return { tag: 'Read' as const, text };
  }
  function failed(error: unknown): Read {
    return Match.value(error).pipe(
      Match.when(isTooLarge, () => ({ tag: 'TooLarge' as const })),
      Match.orElse(() => ({ tag: 'Unknown' as const })),
    );
  }
  function classify(result: Result.Result<{ tag: 'Read'; text: string }, unknown>): Read {
    return Result.match(result, { onSuccess: (value) => value, onFailure: failed });
  }
  const reading = Effect.gen(read);
  const timed = reading.pipe(Effect.timeout(90000), Effect.result, Effect.map(classify));
  return timed;
}
function parseNumber(input: string): number | 'Unknown' {
  const number = Number(input);
  return Option.getOrElse(
    Option.liftPredicate(
      number,
      (value) => /^(0|[1-9][0-9]*)$/u.test(input) && Number.isSafeInteger(value),
    ),
    () => 'Unknown' as const,
  );
}
function parseLimit(input: string): number | 'Max' | 'Unknown' {
  return Match.value(input).pipe(
    Match.when(isMax, () => 'Max' as const),
    Match.orElse(parseNumber),
  );
}
function text(read: Read) {
  return Match.value(read).pipe(
    Match.when(isRead, (value) => value.text.trim()),
    Match.orElse(() => ''),
  );
}
function parseStatus(read: Read) {
  const entries = new Map<string, string[]>();
  for (const line of text(read).split('\n')) {
    const match = /^([A-Za-z]+):\s*(.*?)\s*$/u.exec(line);
    Option.map(Option.fromNullishOr(match), (fields) =>
      entries.set(fields[1]!, [...(entries.get(fields[1]!) ?? []), fields[2]!]),
    );
  }
  function get(key: string) {
    const entry = Option.liftPredicate(entries.get(key), (value) => value?.length === 1);
    const first = entry.pipe(Option.map((value) => value?.[0] ?? ''));
    return Option.getOrElse(first, () => '');
  }
  function ids(key: string) {
    const parts = get(key).split(/\s+/u).map(parseNumber);
    const decoded = Schema.decodeUnknownResult(identity)(parts);
    return Result.getOrElse(decoded, () => 'Unknown' as const);
  }
  function cap(key: string) {
    const decoded = Schema.decodeUnknownResult(capability)(get(key));
    return Result.getOrElse(decoded, () => 'Unknown' as const);
  }
  function numeric(key: string, allowed: readonly number[]) {
    const n = parseNumber(get(key));
    const valid = Option.liftPredicate(
      n,
      (number) => !isUnknown(number) && allowed.includes(number),
    );
    return Option.getOrElse(valid, () => 'Unknown' as const);
  }
  return {
    uid: ids('Uid'),
    gid: ids('Gid'),
    capInh: cap('CapInh'),
    capPrm: cap('CapPrm'),
    capEff: cap('CapEff'),
    capBnd: cap('CapBnd'),
    capAmb: cap('CapAmb'),
    noNewPrivs: numeric('NoNewPrivs', [0, 1]),
    seccomp: numeric('Seccomp', [0, 1, 2]),
  };
}
function readNamespace(fs: FileSystem.FileSystem, name: 'mnt' | 'pid' | 'ipc' | 'net' | 'user') {
  function classify(target: string) {
    return Match.value(
      target.length <= 64 && new RegExp(`^${name}:\\[[1-9][0-9]*\\]$`, 'u').test(target),
    ).pipe(
      Match.when(true, () => 'WellFormed' as const),
      Match.orElse(() => 'Unknown' as const),
    );
  }
  // FileSystem.readLink allocates its result before we can inspect its length.
  // The length guard bounds synchronous classification; the deadline cannot preempt synchronous work.
  const reading = fs
    .readLink(`/proc/self/ns/${name}`)
    .pipe(Effect.map(classify), Effect.timeout(90000), Effect.result);
  return reading.pipe(
    Effect.map((result) =>
      Result.match(result, { onSuccess: (value) => value, onFailure: () => 'Unknown' as const }),
    ),
  );
}
export function collectReadiness() {
  function* collect() {
    const fs = yield* FileSystem.FileSystem;
    const [mount, status, cpu, memory, swap, pids, mnt, pid, ipc, net, user] = yield* Effect.all(
      [
        readText(fs, '/proc/self/mountinfo', 65536),
        readText(fs, '/proc/self/status', 8192),
        readText(fs, '/sys/fs/cgroup/cpu.max', 8192),
        readText(fs, '/sys/fs/cgroup/memory.max', 8192),
        readText(fs, '/sys/fs/cgroup/memory.swap.max', 8192),
        readText(fs, '/sys/fs/cgroup/pids.max', 8192),
        readNamespace(fs, 'mnt'),
        readNamespace(fs, 'pid'),
        readNamespace(fs, 'ipc'),
        readNamespace(fs, 'net'),
        readNamespace(fs, 'user'),
      ],
      { concurrency: 'unbounded' },
    );
    const inventory = Match.value(mount).pipe(
      Match.when(isRead, (value) => value.text),
      Match.when({ tag: isTooLarge }, () => 'x'.repeat(65537)),
      Match.orElse(() => ''),
    );
    const cpuParts = text(cpu).split(/\s+/u);
    const quota = parseLimit(cpuParts[0] ?? '');
    const period = parseNumber(cpuParts[1] ?? '');
    const isValidCpu = (cpu: { quota: number | 'Max' | 'Unknown'; period: number | 'Unknown' }) =>
      [cpuParts.length === 2, isCpuQuota(cpu.quota), isCpuPeriod(cpu.period)].every(Boolean);
    const cpuValue = Option.getOrElse(
      Option.liftPredicate({ quota, period }, isValidCpu),
      () => 'Unknown' as const,
    );
    return yield* decodeReadiness({
      _tag: 'ReadinessOnly',
      version: 1,
      qualificationReceipt: 'NotProduced',
      kernelMountPolicy: 'Unreviewed',
      activation: 'Blocked',
      mounts: {
        summary: inspectMountInventory(inventory),
        details: inspectMountDetails(inventory),
      },
      status: parseStatus(status),
      namespaces: { mnt, pid, ipc, net, user },
      cgroups: {
        cpu: cpuValue,
        memory: parseLimit(text(memory)),
        swap: parseLimit(text(swap)),
        pids: parseLimit(text(pids)),
      },
      observer: 'NotMeasured',
      networkNegatives: 'NotMeasured',
      cleanup: 'NotMeasured',
    });
  }
  const workflow = Effect.gen(collect);
  return workflow;
}
const workerArgs = Schema.is(Schema.Tuple([Schema.Literal('--worker')]));
const encodeFrame = Schema.encodeSync(Schema.fromJsonString(ReadinessOnly));
export function invokeReadinessWorker(args: readonly string[]) {
  function* invoke() {
    yield* Effect.fromResult(
      Result.succeed(args).pipe(Result.filterOrFail(workerArgs, () => 'UsageError' as const)),
    );
    const readiness = yield* collectReadiness();
    const frame = `${encodeFrame(readiness)}\n`;
    yield* Effect.fromResult(
      Result.succeed(frame).pipe(
        Result.filterOrFail(
          (value) => new TextEncoder().encode(value).length <= 262144,
          () => 'FrameTooLarge' as const,
        ),
      ),
    );
    return frame;
  }
  const workflow = Effect.gen(invoke);
  return workflow;
}
