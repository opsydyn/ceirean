import { Context, Effect, FileSystem, Result, Schema } from 'effect';

import {
  networkRejection,
  probeFixedDns,
  probeFixedTcp,
} from '../../scripts/linux-control-platform.ts';
import { requireSupervisor } from './docker-process.ts';
const decodeCause = Schema.decodeUnknownResult(Schema.Struct({ cause: Schema.Unknown }));
function httpRejection(error: unknown) {
  const cause = Result.match(decodeCause(error), {
    onSuccess: (value) => value.cause,
    onFailure: () => error,
  });
  return networkRejection(cause);
}
const NegativeResult = Schema.Struct({
  http: Schema.Literal('Denied'),
  dns: Schema.Literal('Denied'),
  rawTcp: Schema.Literal('Denied'),
});
const decodeNegative = Schema.decodeUnknownEffect(NegativeResult);
const denied = Schema.is(
  Schema.Struct({
    _tag: Schema.Literal('Rejected'),
    code: Schema.Literals(['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'EACCES', 'EPERM']),
  }),
);
const isTmpfs = Schema.is(Schema.Literal('tmpfs'));
const isRoot = Schema.is(Schema.Literal('/'));
const isZeroCapabilities = Schema.is(Schema.Literal('0000000000000000'));
const isEnabled = Schema.is(Schema.Literal('1'));
const isLoopback = Schema.is(Schema.Literal('lo'));
const isBudget = Schema.is(Schema.Literal('200000 100000|4294967296|0|128'));
function statusEntry(line: string) {
  const colon = line.indexOf(':');
  return [line.slice(0, colon), line.slice(colon + 1).trim()] as const;
}

export function makeControlProbeIO() {
  function dns() {
    const workflow = Effect.tryPromise(probeFixedDns);
    return workflow;
  }
  function tcp() {
    const workflow = Effect.tryPromise(probeFixedTcp);
    return workflow;
  }
  async function httpNegative() {
    const response = await fetch('http://1.1.1.1/', {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
    return { _tag: 'Connected' as const };
  }
  function http() {
    const attempting = Effect.tryPromise({ try: httpNegative, catch: httpRejection });
    const workflow = attempting.pipe(
      Effect.match({ onSuccess: (value) => value, onFailure: (value) => value }),
    );
    return workflow;
  }
  return { dns, tcp, http };
}
export class ControlProbeIO extends Context.Service<
  ControlProbeIO,
  ReturnType<typeof makeControlProbeIO>
>()('ceirean/ControlProbeIO') {}
export function makeUnavailableControlProbeIO() {
  function refuse() {
    const refusing = Effect.succeed({ _tag: 'Rejected' as const, code: 'Unavailable' });
    return refusing;
  }
  return { dns: refuse, tcp: refuse, http: refuse };
}
export function makeControlNegatives() {
  function probe() {
    function* measure() {
      const io = yield* ControlProbeIO;
      const results = yield* Effect.all([io.http(), io.dns(), io.tcp()], { concurrency: 3 });
      yield* requireSupervisor(results.every(denied), 'BlockedControls');
      return yield* decodeNegative({ http: 'Denied', dns: 'Denied', rawTcp: 'Denied' });
    }
    const workflow = Effect.gen(measure);
    return workflow;
  }
  return { probe };
}
export class ControlNegatives extends Context.Service<
  ControlNegatives,
  ReturnType<typeof makeControlNegatives>
>()('ceirean/ControlNegatives') {}
const mountCaps = { '/work': 2883584, '/home': 131072, '/tmp': 131072 } as const;
const isReadOnly = Schema.is(Schema.Literal('ro'));
const isReadWrite = Schema.is(Schema.Literal('rw'));
const isFixedMount = Schema.is(Schema.Literals(['/work', '/home', '/tmp']));
function readMount(line: string) {
  const fields = line.split(' ');
  const separator = fields.indexOf('-');
  const options = (fields[5] ?? '').split(',');
  const superOptions = (fields[separator + 3] ?? '').split(',');
  const access = options.filter((flag) => isReadOnly(flag) || isReadWrite(flag));
  const superAccess = superOptions.filter((flag) => isReadOnly(flag) || isReadWrite(flag));
  const sizeOptions = superOptions.filter((flag) => flag.startsWith('size='));
  const size = /^size=([1-9][0-9]*)k$/u.exec(sizeOptions[0] ?? '');
  const kibibytes = Number(size?.[1]);
  const valid = [
    separator >= 6,
    fields.length === separator + 4,
    fields.every(Boolean),
    /^[1-9][0-9]*$/u.test(fields[0] ?? ''),
    /^[0-9]+$/u.test(fields[1] ?? ''),
    /^[0-9]+:[0-9]+$/u.test(fields[2] ?? ''),
    (fields[3] ?? '').startsWith('/'),
    (fields[4] ?? '').startsWith('/'),
    access.length === 1,
    superAccess.length === 1,
  ].every(Boolean);
  const capacityKnown = [
    sizeOptions.length === 1,
    Number.isSafeInteger(kibibytes),
    kibibytes > 0,
  ].every(Boolean);
  return {
    valid,
    id: fields[0],
    device: fields[2],
    root: fields[3],
    mount: fields[4],
    type: fields[separator + 1],
    flags: new Set([...options, ...superOptions]),
    writable: isReadWrite(access[0]) && isReadWrite(superAccess[0]),
    capacityKnown,
    kibibytes,
  };
}
function mountIsEffective(
  observed: ReturnType<typeof readMount>,
  mount: string,
  kibibytes: number,
  uid: number,
  gid: number,
) {
  return [
    observed.mount === mount,
    isRoot(observed.root),
    isTmpfs(observed.type),
    observed.writable,
    observed.capacityKnown,
    observed.kibibytes === kibibytes,
    ['rw', 'noexec', 'nosuid', 'nodev', `size=${kibibytes}k`, `uid=${uid}`, `gid=${gid}`].every(
      (flag) => observed.flags.has(flag),
    ),
  ].every(Boolean);
}
// These are independent effective kernel readbacks, not the Docker request argv.
// Behavioral negatives require a separately reviewed adapter; no new native
// socket/DNS boundary or observer tool is acquired by this implementation.
export function measureWorkerControls(uid: number, gid: number) {
  function* measure() {
    const negatives = yield* ControlNegatives;
    const probes = yield* negatives.probe();
    const fs = yield* FileSystem.FileSystem;
    const status = yield* fs.readFileString('/proc/self/status');
    const mounts = yield* fs.readFileString('/proc/self/mountinfo');
    const interfaces = yield* fs.readDirectory('/sys/class/net');
    const ipv4 = yield* fs.readFileString('/proc/net/route');
    const ipv6 = yield* fs.readFileString('/proc/net/ipv6_route');
    const onlyLoopback = [
      interfaces.length === 1,
      interfaces.includes('lo'),
      ipv4.startsWith('Iface'),
      ipv4
        .trim()
        .split('\n')
        .slice(1)
        .every((line) => isLoopback(line.trim().split(/\s+/u)[0])),
      ipv6
        .trim()
        .split('\n')
        .filter(Boolean)
        .every((line) => isLoopback(line.trim().split(/\s+/u).at(-1))),
    ].every(Boolean);
    yield* requireSupervisor(onlyLoopback, 'BlockedControls');
    const observedMounts = mounts.trim().split('\n').map(readMount);
    const values = new Map(status.trim().split('\n').map(statusEntry));
    const identity = (name: string, value: number) =>
      (values.get(name) ?? '').split(/\s+/u).every((part) => part === String(value));
    const root = observedMounts.filter((mount) => isRoot(mount.mount));
    // Count all effective writable tmpfs, including auxiliary/root-owned mounts.
    // Ownership of the mount root cannot establish access to every descendant.
    const writable = observedMounts.filter((mount) => mount.writable);
    const writableTmpfs = writable.filter((mount) => isTmpfs(mount.type));
    const tmpfsBytes = writableTmpfs.reduce((sum, mount) => sum + mount.kibibytes * 1024, 0);
    const boundedMounts = [
      observedMounts.every((mount) => mount.valid),
      new Set(observedMounts.map((mount) => mount.id)).size === observedMounts.length,
      writableTmpfs.every((mount) => mount.capacityKnown),
      Number.isSafeInteger(tmpfsBytes),
      tmpfsBytes <= 3221225472,
      writable.length === 3,
      writable.every((mount) => isTmpfs(mount.type) && isFixedMount(mount.mount)),
      new Set(writable.map((mount) => mount.device)).size === 3,
    ].every(Boolean);
    const effective = [
      uid > 0,
      gid > 0,
      identity('Uid', uid),
      identity('Gid', gid),
      isZeroCapabilities(values.get('CapEff')),
      isEnabled(values.get('NoNewPrivs')),
      root.length === 1,
      root.every((mount) => !mount.writable),
      boundedMounts,
      Object.entries(mountCaps).every(
        ([mount, kib]) =>
          observedMounts.filter((observed) => observed.mount === mount).length === 1 &&
          observedMounts.some((observed) => mountIsEffective(observed, mount, kib, uid, gid)),
      ),
    ].every(Boolean);
    yield* requireSupervisor(effective, 'BlockedControls');
    const limits = yield* Effect.all(
      [
        '/sys/fs/cgroup/cpu.max',
        '/sys/fs/cgroup/memory.max',
        '/sys/fs/cgroup/memory.swap.max',
        '/sys/fs/cgroup/pids.max',
      ].map((path) => fs.readFileString(path)),
      { concurrency: 1 },
    );
    const observed = limits.map((value) => value.trim());
    const budget = observed.join('|');
    yield* requireSupervisor(isBudget(budget), 'BlockedControls');
    return { status, mounts, limits: observed, negatives: probes };
  }
  const workflow = Effect.gen(measure);
  const bounded = workflow.pipe(Effect.timeout(90000));
  return bounded;
}
