import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Match,
  Option,
  Queue,
  Result,
  Schema,
  Sink,
  Stdio,
  Stream,
} from 'effect';

import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';
import { WorkerProcess } from '../src/linux-qualification/cases.ts';
import {
  CaseObservation,
  ControlReadbacks,
  evidenceRequirements,
  requiredCases,
} from '../src/linux-qualification/contract.ts';
import { QualificationRequest } from '../src/linux-qualification/contract.ts';
import { QualificationAuthority, runQualification } from '../src/linux-qualification/controller.ts';
import {
  measureWorkerControls,
  ControlNegatives,
  makeControlNegatives,
  ControlProbeIO,
  makeControlProbeIO,
  makeUnavailableControlProbeIO,
} from '../src/linux-qualification/controls.ts';
import { assertDockerReadback } from '../src/linux-qualification/docker-controls.ts';
import { readDockerEvidence } from '../src/linux-qualification/docker-evidence.ts';
import {
  collectDockerOutput,
  requireSupervisor,
  SupervisorError,
} from '../src/linux-qualification/docker-process.ts';
import { DockerSession } from '../src/linux-qualification/docker-session.ts';
import {
  QualificationOutput,
  makeQualificationOutput,
} from '../src/linux-qualification/durable-output.ts';
import { admitEvidenceFiles } from '../src/linux-qualification/evidence-files.ts';
import { LinuxInputs } from '../src/linux-qualification/inputs.ts';
import {
  publishEvidenceAndAwaitCollection,
  readBoundedHandoffLine,
} from '../src/linux-qualification/live-handoff.ts';
import { superviseOwnedWorker } from '../src/linux-qualification/owned-worker.ts';
import { PreparedInputs } from '../src/linux-qualification/prepared-inputs.ts';
import { prepareOwnedProducer } from '../src/linux-qualification/producer.ts';
import { makeReceipt, qualificationExitCode } from '../src/linux-qualification/receipt.ts';
import { exportReceipt } from '../src/linux-qualification/receipt.ts';
import { DockerProcess, superviseFixedWorker } from '../src/linux-qualification/supervisor.ts';
import { toolPins } from '../src/linux-qualification/tool-pins.ts';
import { makeProductionWorkerPlatform } from '../src/linux-qualification/worker-platform.ts';
import { stage, tar } from './linux-archive-fixtures.ts';
import { ownedFixture, producerDocuments } from './linux-owned-fixtures.ts';

const withPlatform = Effect.provide(BunServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isWarmup = Schema.is(Schema.Literal('Warmup'));
const isExport = Schema.is(Schema.Literal('-'));
const isCollectionComplete = Schema.is(Schema.Literal('CollectionComplete'));
const isText = Schema.is(Schema.String);
const isWorkerInvocation = Schema.is(Schema.Literal('--worker'));
const isWorkerDiagnostic = Schema.is(Schema.Literal('worker-diagnostic.json'));
const HostEvidence = Schema.Struct({
  observation: CaseObservation,
  details: Schema.Array(
    Schema.Struct({ mode: Schema.String, termination: Schema.optionalKey(Schema.String) }),
  ),
});
const decodeHost = Schema.decodeUnknownEffect(Schema.fromJsonString(HostEvidence));
function partitionBytes(bytes: Uint8Array, size: number) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size)
    chunks.push(bytes.subarray(offset, offset + size));
  return chunks;
}
function outputText(chunk: string | Uint8Array) {
  return Match.value(chunk).pipe(
    Match.when(isText, (text) => text),
    Match.orElse((bytes) => new TextDecoder().decode(bytes)),
  );
}
async function realControlClassification() {
  for (const code of ['ENETUNREACH', 'EHOSTUNREACH', 'EPERM']) {
    const fake: typeof ControlProbeIO.Service = {
      dns: () => Effect.succeed({ _tag: 'Rejected', code }),
      tcp: () => Effect.succeed({ _tag: 'Rejected', code }),
      http: () => Effect.succeed({ _tag: 'Rejected', code }),
    };
    const result = await Effect.runPromise(
      makeControlNegatives().probe().pipe(Effect.provideService(ControlProbeIO, fake)),
    );
    expect(result).toEqual({ http: 'Denied', dns: 'Denied', rawTcp: 'Denied' });
  }
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEOUT', 'Unexpected']) {
    const fake: typeof ControlProbeIO.Service = {
      dns: () => Effect.succeed({ _tag: 'Rejected', code }),
      tcp: () => Effect.succeed({ _tag: 'Rejected', code: 'ENETUNREACH' }),
      http: () => Effect.succeed({ _tag: 'Rejected', code: 'ENETUNREACH' }),
    };
    const result = await Effect.runPromise(
      makeControlNegatives()
        .probe()
        .pipe(Effect.provideService(ControlProbeIO, fake), Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
  }
  const methods = Object.keys(makeControlProbeIO());
  expect(methods).toEqual(['dns', 'tcp', 'http']);
}
test(
  'fixed behavioral control probes require concrete denial, never DNS absence, timeout or connection refusal',
  realControlClassification,
);
function effectiveControlFixture() {
  const files: Record<string, string> = {
    '/proc/self/status':
      'Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nCapEff:\t0000000000000000\nNoNewPrivs:\t1\n',
    '/proc/self/mountinfo':
      '1 0 0:1 / / ro - overlay overlay ro\n2 1 0:2 / /work rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=2883584k,uid=1000,gid=1000\n3 1 0:3 / /home rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=131072k,uid=1000,gid=1000\n4 1 0:4 / /tmp rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=131072k,uid=1000,gid=1000\n',
    '/sys/fs/cgroup/cpu.max': '200000 100000\n',
    '/sys/fs/cgroup/memory.max': '4294967296\n',
    '/sys/fs/cgroup/memory.swap.max': '0\n',
    '/sys/fs/cgroup/pids.max': '128\n',
    '/proc/net/route': 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n',
    '/proc/net/ipv6_route': '',
  };
  const probe: typeof ControlProbeIO.Service = {
    dns: () => Effect.succeed({ _tag: 'Rejected', code: 'ENETUNREACH' }),
    tcp: () => Effect.succeed({ _tag: 'Rejected', code: 'ENETUNREACH' }),
    http: () => Effect.succeed({ _tag: 'Rejected', code: 'ENETUNREACH' }),
  };
  async function measure() {
    const fs = FileSystem.makeNoop({
      readFileString: (path) => Effect.succeed(files[path] ?? ''),
      readDirectory: () => Effect.succeed(['lo']),
    });
    return await Effect.runPromise(
      measureWorkerControls(1000, 1000).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(ControlNegatives, makeControlNegatives()),
        Effect.provideService(ControlProbeIO, probe),
        Effect.result,
      ),
    );
  }
  return { files, measure };
}
async function effectiveKernelReadbacks() {
  const { files, measure } = effectiveControlFixture();
  expect(Result.isSuccess(await measure())).toBe(true);
  files['/proc/net/route'] += 'eth0 00000000 0100000A 0003 0 0 0 00000000 0 0 0\n';
  expect(Result.isFailure(await measure())).toBe(true);
  files['/proc/net/route'] =
    'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n';
  files['/proc/self/status'] = files['/proc/self/status']!.replace(
    'NoNewPrivs:\t1',
    'NoNewPrivs:\t0',
  );
  expect(Result.isFailure(await measure())).toBe(true);
}
test(
  'effective kernel measurements reject outbound routes and missing no-new-privileges independently of requested flags',
  effectiveKernelReadbacks,
);
const extraMounts = [
  [
    'extra 1 GiB exceeds aggregate ceiling',
    '5 1 0:5 / /extra rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=1048576k,uid=1000,gid=1000',
  ],
  [
    'root-owned auxiliary mount is not exempt',
    '5 1 0:5 / /dev rw,nosuid - tmpfs tmpfs rw,size=65536k,mode=755',
  ],
  [
    'shared-memory auxiliary mount is not exempt',
    '5 1 0:5 / /dev/shm rw,nosuid,nodev,noexec - tmpfs shm rw,size=65536k',
  ],
  [
    'unknown capacity refuses',
    '5 1 0:5 / /extra rw,nosuid,nodev,noexec - tmpfs tmpfs rw,uid=1000,gid=1000',
  ],
  [
    'unknown capacity unit refuses',
    '5 1 0:5 / /extra rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=10%,uid=1000,gid=1000',
  ],
  [
    'submount cannot shadow fixed work allocation',
    '5 2 0:5 / /work/extra rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=1k,uid=1000,gid=1000',
  ],
  [
    'writable non-tmpfs submount refuses',
    '5 2 0:5 / /work/extra rw,nosuid,nodev,noexec - ext4 /dev/example rw',
  ],
  [
    'duplicate fixed mount refuses',
    '5 1 0:5 / /work rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=2883584k,uid=1000,gid=1000',
  ],
] as const;
for (const [name, line] of extraMounts) {
  async function reject() {
    const { files, measure } = effectiveControlFixture();
    files['/proc/self/mountinfo'] += `${line}\n`;
    const result = await measure();
    expect(Result.isFailure(result)).toBe(true);
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'BlockedControls' } });
  }
  test(`effective tmpfs admission: ${name}`, reject);
}
async function productionPlatform() {
  function* run() {
    const { prepared, fs } = yield* ownedFixture();
    const info = yield* fs.stat(prepared.root);
    const readSchema = Schema.Struct({
      observations: Schema.Array(CaseObservation),
    });
    const json = Schema.fromJsonString(readSchema);
    const read = Schema.decodeUnknownSync(json)(
      producerDocuments(prepared)['worker-diagnostic.json']!,
    ).observations[0]!.readbacks;
    const reads: string[] = [];
    const files: Record<string, string> = {
      '/proc/self/status':
        'Uid: 1000 1000 1000 1000\nGid: 1000 1000 1000 1000\nCapEff: 0000000000000000\nNoNewPrivs: 1\n',
      '/proc/self/mountinfo':
        '1 0 0:1 / / ro - overlay overlay ro\n2 1 0:2 / /work rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=2883584k,uid=1000,gid=1000\n3 1 0:3 / /home rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=131072k,uid=1000,gid=1000\n4 1 0:4 / /tmp rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=131072k,uid=1000,gid=1000\n',
      '/sys/fs/cgroup/cpu.max': '200000 100000',
      '/sys/fs/cgroup/memory.max': '4294967296',
      '/sys/fs/cgroup/memory.swap.max': '0',
      '/sys/fs/cgroup/pids.max': '128',
      '/proc/net/route': 'Iface Destination Gateway\n',
      '/proc/net/ipv6_route': '',
    };
    function readFileString(path: string) {
      function read() {
        reads.push(path);
        return files[path] ?? '';
      }
      const workflow = Effect.sync(read);
      return workflow;
    }
    const fakeFs = {
      ...fs,
      stat: () => Effect.succeed({ ...info, uid: Option.some(1000), gid: Option.some(1000) }),
      readFileString,
      readDirectory: () => Effect.succeed(['lo']),
    };
    const negatives = {
      probe: () =>
        Effect.succeed({
          http: 'Denied' as const,
          dns: 'Denied' as const,
          rawTcp: 'Denied' as const,
        }),
    };
    const verified = Schema.decodeUnknownSync(ControlReadbacks.members[1])(read);
    const platform = yield* makeProductionWorkerPlatform({
      read: () => Effect.sync(() => verified),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fakeFs),
      Effect.provideService(ControlNegatives, negatives),
      Effect.provideService(ControlProbeIO, makeUnavailableControlProbeIO()),
    );
    const measured = platform
      .preflight(prepared)
      .pipe(
        Effect.provideService(FileSystem.FileSystem, fakeFs),
        Effect.provideService(ControlNegatives, negatives),
        Effect.result,
      );
    expect(Result.isSuccess(yield* measured)).toBe(true);
    expect(reads).toContain('/proc/self/mountinfo');
    files['/sys/fs/cgroup/memory.max'] = 'max';
    expect(Result.isFailure(yield* measured)).toBe(true);
    let spawned = false;
    function recordSpawn() {
      spawned = true;
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    const process: typeof WorkerProcess.Service = { run: () => Effect.sync(recordSpawn) };
    const blocked = platform
      .observe({
        kind: 'Install',
        purpose: 'Warmup',
        workspace: '/work/a',
        home: '/home/a',
        tmp: '/tmp/a',
        cache: '/work/cache',
      })
      .pipe(Effect.provideService(WorkerProcess, process), Effect.result);
    expect(Result.isFailure(yield* blocked)).toBe(true);
    expect(spawned).toBe(false);
    const observer = {
      admitChildObservation: () => Effect.void,
      observe(command: Parameters<typeof process.run>[0], transport: typeof WorkerProcess.Service) {
        const workflow = transport.run(command).pipe(
          Effect.map((result) => ({
            ...result,
            complete: true,
            executions: ['/usr/local/bin/bun'],
            nativeExecutions: [] as readonly string[],
          })),
        );
        return workflow;
      },
    };
    const admitted = yield* makeProductionWorkerPlatform(
      { read: () => Effect.sync(() => verified) },
      observer,
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fakeFs),
      Effect.provideService(ControlNegatives, negatives),
      Effect.provideService(ControlProbeIO, makeUnavailableControlProbeIO()),
    );
    const observed = yield* admitted
      .observe({
        kind: 'Install',
        purpose: 'Warmup',
        workspace: '/work/a',
        home: '/home/a',
        tmp: '/tmp/a',
        cache: '/work/cache',
      })
      .pipe(Effect.provideService(WorkerProcess, process));
    expect(observed.complete).toBe(true);
    expect(spawned).toBe(true);
  }
  await Effect.runPromise(Effect.gen(run).pipe(Effect.scoped, withPlatform));
}
test(
  'production WorkerPlatform measures effective controls and never spawns with unavailable observer',
  productionPlatform,
);
async function boundedLiveAcknowledgement() {
  function* run() {
    const inputs = yield* stage([]);
    const captured: (string | Uint8Array)[] = [];
    function observe(chunk: string | Uint8Array) {
      captured.push(chunk);
      const observed = Effect.void;
      return observed;
    }
    const result = {
      _tag: 'Incomplete' as const,
      exitCode: 1 as const,
      refusal: {
        caseId: 'RuntimeIsolationPreflight' as const,
        stage: 'Preflight' as const,
        reason: 'BlockedControls' as const,
      },
      observations: [],
      evidence: [],
      seedAdmission: undefined,
    };
    const producerId = yield* Effect.try(() => crypto.randomUUID());
    for (const ack of [
      { _tag: 'CollectionComplete', runId: inputs.admission.request.run.runId, producerId },
      { _tag: 'Passed', runId: inputs.admission.request.run.runId, producerId },
      { _tag: 'CollectionComplete', runId: 'forged-run', producerId },
    ]) {
      const ackBytes = new TextEncoder().encode(encode(ack) + '\n');
      const fragments = partitionBytes(ackBytes, 3);
      const stdio = Stdio.make({
        args: Effect.succeed([]),
        stdin: Stream.fromIterable(fragments),
        stdout: () => Sink.forEach(observe),
        stderr: () => Sink.drain,
      });
      const publishing = publishEvidenceAndAwaitCollection(inputs, result, producerId).pipe(
        Effect.provideService(Stdio.Stdio, stdio),
        Effect.result,
      );
      const admitted = yield* publishing;
      const matchingAck = [
        isCollectionComplete(ack._tag),
        ack.runId === inputs.admission.request.run.runId,
      ].every(Boolean);
      expect(Result.isSuccess(admitted)).toBe(matchingAck);
    }
    const output = captured.map(outputText).join('');
    expect(output).toContain('WorkerEvidenceReady');
    expect(output).not.toContain('TrustedSealBoundary');
    expect(output).not.toContain('qualificationReceipt');
  }
  await Effect.runPromise(Effect.gen(run).pipe(Effect.scoped, withPlatform));
}
test(
  'live handoff requires matching bounded collection ACK and never promotes pre-seal failure',
  boundedLiveAcknowledgement,
);
async function handoffFramingLimits() {
  const valid = new TextEncoder().encode('{}\n');
  expect(
    await Effect.runPromise(
      readBoundedHandoffLine(Stream.fromIterable([valid.subarray(0, 1), valid.subarray(1)])),
    ),
  ).toBe('{}');
  for (const chunks of [
    [],
    [valid.subarray(0, 2)],
    [new Uint8Array(262145)],
    [new TextEncoder().encode('{}\nextra')],
    [new Uint8Array([255, 10])],
  ]) {
    const result = await Effect.runPromise(
      readBoundedHandoffLine(Stream.fromIterable(chunks)).pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
  }
  const connected: typeof ControlProbeIO.Service = {
    dns: () => Effect.succeed({ _tag: 'Connected' }),
    tcp: () => Effect.succeed({ _tag: 'Connected' }),
    http: () => Effect.succeed({ _tag: 'Connected' }),
  };
  const network = await Effect.runPromise(
    makeControlNegatives()
      .probe()
      .pipe(Effect.provideService(ControlProbeIO, connected), Effect.result),
  );
  expect(Result.isFailure(network)).toBe(true);
}
test(
  'handoff rejects missing frames, overflow, trailing bytes and invalid UTF-8; network connection is not denial',
  handoffFramingLimits,
);
async function evidenceTransport() {
  const valid = tar([{ path: 'warmup.json', content: '{}' }]);
  expect(
    new TextDecoder().decode(await Effect.runPromise(readDockerEvidence(valid, 'warmup.json'))),
  ).toBe('{}');
  for (const bytes of [
    valid.subarray(0, 700),
    tar([{ path: '../warmup.json', content: '{}' }]),
    tar([{ path: 'warmup.json', type: 'SymbolicLink', linkpath: '/etc/passwd' }]),
    tar([
      { path: 'warmup.json', content: '{}' },
      { path: 'other.json', content: '{}' },
    ]),
  ]) {
    const result = await Effect.runPromise(
      readDockerEvidence(bytes, 'warmup.json').pipe(Effect.result),
    );
    expect(Result.isFailure(result)).toBe(true);
  }
}
test(
  'Docker tar transport refuses traversal, links, extra entries and truncation before writes',
  evidenceTransport,
);
type Fault =
  | 'none'
  | 'create-unknown'
  | 'before-start'
  | 'warmup'
  | 'deadline'
  | 'overflow'
  | 'remove'
  | 'unknown'
  | 'early-exit'
  | 'trailing'
  | 'missing-evidence'
  | 'interrupt-collect'
  | 'replayed-ready'
  | 'no-live-bun'
  | 'rehearsal-unknown'
  | 'wrong-node'
  | 'rehearsal-trailing'
  | 'image-unknown'
  | 'malformed-diagnostic'
  | 'forged';
const isOperation = (operation: string) => Schema.is(Schema.Literal(operation));
const isFault = (fault: Fault) => Schema.is(Schema.Literal(fault));
const output = (
  stdout = '',
  exitCode = 0,
  stderr = '',
  bytes = new TextEncoder().encode(stdout),
) => ({ exitCode, stdout, stderr, bytes });
function scenario(fault: Fault = 'none', ownedProof = false) {
  const calls: string[][] = [];
  const state = {
    name: 'unallocated',
    token: 'unallocated',
    user: 'unallocated',
    root: 'unallocated',
    removed: false,
    alive: false,
    paused: false,
    mode: '--worker',
    inputs: undefined as PreparedInputs | undefined,
    frames: undefined as Queue.Queue<Uint8Array, Cause.Done> | undefined,
    exited: undefined as Deferred.Deferred<void> | undefined,
  };
  function inspect() {
    const imagePrefix = Match.value(fault).pipe(
      Match.when('image-unknown', () => ''),
      Match.orElse(() => 'sha256:'),
    );
    const token = Match.value(fault).pipe(
      Match.when('forged', () => 'other'),
      Match.orElse(() => state.token),
    );
    return output(
      encode([
        {
          Id: 'a'.repeat(64),
          Name: '/' + state.name,
          Image: imagePrefix + 'a'.repeat(64),
          State: { Running: state.alive, Paused: state.paused },
          Config: {
            Labels: { 'ceirean.qualification': token },
            User: state.user,
            Image: toolPins.installerImage,
          },
          HostConfig: {
            NetworkMode: 'none',
            ReadonlyRootfs: true,
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges:true'],
            Privileged: false,
            Devices: [],
            DeviceRequests: null,
            PortBindings: {},
            PidMode: '',
            IpcMode: 'private',
            NanoCpus: 2000000000,
            Memory: 4294967296,
            MemorySwap: 4294967296,
            PidsLimit: 128,
          },
          Mounts: [
            { Type: 'bind', Source: state.root, Destination: '/inputs', RW: false },
            { Type: 'bind', Source: `${state.root}/tools`, Destination: '/tools', RW: false },
          ],
        },
      ]),
    );
  }
  const run: typeof DockerProcess.Service.run = (args, _cwd, _timeout) => {
    calls.push([...args]);
    const operation = args[0];
    function* create() {
      state.name = args[args.indexOf('--name') + 1]!;
      state.mode = args.at(-1)!;
      state.removed = false;
      state.paused = false;
      state.token = args[args.indexOf('--label') + 1]!.split('=')[1]!;
      state.user = args[args.indexOf('--user') + 1]!;
      state.root = args[args.indexOf('--mount') + 1]!.split(',')[1]!.slice(4);
      yield* requireSupervisor(!isFault('create-unknown')(fault), 'CleanupUnknown');
      return output('a'.repeat(64) + '\n');
    }
    function* remove() {
      yield* Effect.yieldNow;
      state.removed = true;
      state.alive = false;
      for (const frames of [state.frames].filter((value) => value !== undefined))
        yield* Queue.end(frames);
      for (const exited of [state.exited].filter((value) => value !== undefined))
        yield* Deferred.succeed(exited, undefined);
      return output();
    }
    function copy() {
      const name = args[1]!.split('/').at(-1)!;
      const documents = Match.value(ownedProof).pipe(
        Match.when(true, () => producerDocuments(state.inputs!)),
        Match.orElse(() => ({}) as Record<string, string>),
      );
      const content = Match.value(fault).pipe(
        Match.when('wrong-node', () =>
          (documents[name] ?? '{}').replaceAll(
            state.inputs!.tools.files[0]!.sha256,
            'b'.repeat(64),
          ),
        ),
        Match.orElse(() => documents[name] ?? '{}'),
      );
      const bytes = tar([{ path: name, content }]);
      const malformed = isFault('malformed-diagnostic')(fault) && isWorkerDiagnostic(name);
      for (const _ of [malformed].filter(Boolean)) bytes[512] = 0xff;
      const exporting = isExport(args.at(-1));
      function* hold() {
        yield* Effect.sleep(600000);
        return output();
      }
      const held = Effect.gen(hold);
      const result = Match.value({ fault, exporting, alive: state.alive }).pipe(
        Match.when({ fault: 'missing-evidence', exporting: true }, () =>
          Effect.fail(new Error('missing fixed file')),
        ),
        Match.when({ fault: 'interrupt-collect', exporting: true }, () => held),
        Match.when({ exporting: true, alive: false }, () =>
          Effect.fail(new Error('tmpfs disappeared at exit')),
        ),
        Match.when({ fault: 'before-start' }, () =>
          Effect.fail(new Error('interrupted before start')),
        ),
        Match.orElse(() => Effect.succeed(output('', 0, '', bytes))),
      );
      return result;
    }
    function start() {
      const stdout = Match.value(fault).pipe(
        Match.when('overflow', () => 'x'.repeat(262145)),
        Match.orElse(() => ''),
      );
      const result = Effect.succeed(output(stdout));
      return result;
    }
    function* delayedWarmup() {
      yield* Effect.sleep(600000);
      return output('0\n');
    }
    function wait() {
      state.alive = false;
      const result = Match.value(fault).pipe(
        Match.when('warmup', () => Effect.gen(delayedWarmup)),
        Match.when('deadline', () => Effect.fail(new Error('deadline'))),
        Match.orElse(() => Effect.succeed(output('0\n'))),
      );
      return result;
    }
    function removeResult() {
      const result = Match.value(fault).pipe(
        Match.when('remove', () => Effect.succeed(output('', 1, 'refused'))),
        Match.orElse(() => Effect.gen(remove)),
      );
      return result;
    }
    function list() {
      const stdout = Match.value(state.removed).pipe(
        Match.when(true, () => ''),
        Match.orElse(() => 'a'.repeat(64) + '\n'),
      );
      const value = Match.value({ fault, qualification: isWorkerInvocation(state.mode) }).pipe(
        Match.when({ fault: 'unknown' }, () => output('', 1, 'daemon unavailable')),
        Match.when({ fault: 'rehearsal-unknown', qualification: false }, () =>
          output('', 1, 'daemon unavailable'),
        ),
        Match.orElse(() => output(stdout)),
      );
      const result = Effect.succeed(
        output(value.stdout, value.exitCode, value.stderr, value.bytes),
      );
      return result;
    }
    function pause() {
      state.paused = true;
      const result = Effect.succeed(output());
      return result;
    }
    function top() {
      const text = Match.value(fault).pipe(
        Match.when('no-live-bun', () => 'PID COMMAND\n100 node\n'),
        Match.orElse(() => 'PID COMMAND\n100 node\n101 bun\n'),
      );
      const result = Effect.succeed(output(text));
      return result;
    }
    const response = Match.value(operation).pipe(
      Match.when('create', () => Effect.gen(create)),
      Match.when('inspect', () => Effect.succeed(inspect())),
      Match.when('cp', copy),
      Match.when('start', start),
      Match.when('wait', wait),
      Match.when('rm', removeResult),
      Match.when('container', list),
      Match.when('pause', pause),
      Match.when('top', top),
      Match.orElse(() => Effect.succeed(output())),
    );
    return response;
  };
  const attach: typeof DockerSession.Service.attach = (_name, _cwd) => {
    function* attached() {
      calls.push(['attach']);
      yield* requireSupervisor(!isFault('before-start')(fault));
      const fs = yield* FileSystem.FileSystem;
      const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(PreparedInputs));
      const raw = yield* fs.readFileString(`${state.root}/prepared.json`);
      const decoding = decode(raw).pipe(
        Effect.mapError(() => new SupervisorError({ code: 'EvidenceIncomplete' })),
      );
      const inputs = yield* decoding;
      state.inputs = inputs;
      state.alive = true;
      const frames = yield* Queue.bounded<Uint8Array, Cause.Done>(1);
      state.frames = frames;
      const exited = yield* Deferred.make<void>();
      state.exited = exited;
      yield* Effect.addFinalizer(() => Queue.shutdown(frames));
      const producerId = Match.value(fault).pipe(
        Match.when('replayed-ready', () => '00000000-0000-0000-0000-000000000000'),
        Match.orElse(() => state.token),
      );
      const rehearsalMode = Match.value(state.mode).pipe(
        Match.when('--rehearse-interrupt-warmup', () => 'InterruptWarmup'),
        Match.orElse(() => 'Deadline'),
      );
      const frame = Match.value(state.mode).pipe(
        Match.when('--worker', () => ({
          _tag: 'WorkerEvidenceReady',
          producerId,
          request: inputs.admission.request,
          sourceSha256: inputs.admission.source.sha256,
          workerExit: 0,
          producerState: 'PendingHostFinalization',
          seedAdmission: {
            provenance: 'TrustedSealBoundary',
            sourceSha256: inputs.admission.source.sha256,
            sha256: 'a'.repeat(64),
          },
        })),
        Match.orElse(() => ({
          _tag: 'WorkerWarmupReady',
          producerId,
          request: inputs.admission.request,
          sourceSha256: inputs.admission.source.sha256,
          mode: rehearsalMode,
          pid: 7,
        })),
      );
      const ready = encode(frame) + '\n';
      const fragments = partitionBytes(new TextEncoder().encode(ready), 7);
      const pieces = Match.value(fault).pipe(
        Match.when('overflow', () => [new Uint8Array(262145)]),
        Match.when('trailing', () => [...fragments, new TextEncoder().encode('extra')]),
        Match.when('rehearsal-trailing', () => [
          ...fragments,
          ...[new TextEncoder().encode('extra')].filter(() => !isWorkerInvocation(state.mode)),
        ]),
        Match.orElse(() => fragments),
      );
      function* produce() {
        calls.push(['wait']);
        const stall = Match.value(fault).pipe(
          Match.when('warmup', () => Effect.sleep(600000)),
          Match.orElse(() => Effect.yieldNow),
        );
        yield* stall;
        for (const piece of pieces) yield* Queue.offer(frames, piece);
      }
      const producer = Effect.gen(produce);
      const producing = producer.pipe(Effect.forkChild);
      yield* producing;
      state.alive = !isFault('early-exit')(fault);
      const stdout = Stream.fromQueue(frames);
      function acknowledge(_runId: string) {
        calls.push(['ack']);
        const result = Queue.end(frames).pipe(
          Effect.andThen(Deferred.succeed(exited, undefined)),
          Effect.asVoid,
        );
        return result;
      }
      function* finished() {
        const waiting = Deferred.await(exited).pipe(Effect.timeout(540000));
        yield* waiting;
        calls.push(['attached-exit']);
        state.alive = false;
        yield* requireSupervisor(!isFault('deadline')(fault));
        return { exitCode: 0, stderr: '' };
      }
      const wait = Effect.gen(finished);
      return { stdout, acknowledge, wait };
    }
    const workflow = Effect.gen(attached);
    const provided = workflow.pipe(withPlatform);
    return provided;
  };
  return { calls, run, attach };
}
function exercise(fault: Fault) {
  const fake = scenario(fault);
  function* run() {
    const inputs = yield* stage([]);
    const result = yield* superviseFixedWorker(inputs);
    return { result, calls: fake.calls };
  }
  const workflow = Effect.gen(run);
  const provided = workflow.pipe(
    Effect.provideService(DockerProcess, { run: fake.run }),
    Effect.provideService(DockerSession, { attach: fake.attach }),
    Effect.scoped,
    withPlatform,
  );
  const running = Effect.runPromise(provided);
  return running;
}
async function fixedControls() {
  const { result, calls } = await exercise('none');
  expect(result.complete).toBe(true);
  const acknowledged = calls.findIndex((args) => isOperation('ack')(args[0]));
  const copied = calls
    .map((args, index) => ({ args, index }))
    .filter(({ args }) => isOperation('cp')(args[0]) && isExport(args.at(-1)));
  expect(copied).toHaveLength(10);
  expect(copied.every(({ args }) => args[1]?.includes(':/work/evidence/'))).toBe(true);
  expect(
    calls.filter((args) => isOperation('cp')(args[0])).every((args) => isExport(args.at(-1))),
  ).toBe(true);
  expect(copied.every(({ index }) => index < acknowledged)).toBe(true);
  expect(acknowledged).toBeLessThan(
    calls.findIndex((args) => isOperation('attached-exit')(args[0])),
  );
  expect(result.cleanup._tag).toBe('ConfirmedRemoval');
  expect(result.workerExit).toBe(0);
  const create = calls[0]!;
  for (const flag of [
    '--pull=never',
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--memory=4294967296',
    '--memory-swap=4294967296',
    '--cpus=2',
    '--pids-limit=128',
    '--ipc=private',
  ])
    expect(create).toContain(flag);
  expect(create.some((arg) => arg.startsWith('--pid='))).toBe(false);
  expect(create.filter((arg) => arg.startsWith('/work:'))[0]).toMatch(
    /size=2952790016.*uid=\d+,gid=\d+/,
  );
  expect(create).toContain('TMPDIR=/work');
  expect(create.slice(-2)).toEqual(['/tools/worker.mjs', '--worker']);
  expect(calls.findIndex((args) => isOperation('rm')(args[0]))).toBeLessThan(calls.length - 1);
  expect(calls.at(-1)?.slice(0, 2)).toEqual(['container', 'ls']);
}
test('registers intent before create and confirms removal independently', fixedControls);
for (const fault of [
  'before-start',
  'deadline',
  'overflow',
  'remove',
  'unknown',
  'early-exit',
  'trailing',
  'missing-evidence',
  'replayed-ready',
  'forged',
  'create-unknown',
] as const) {
  async function failure() {
    const { result, calls } = await exercise(fault);
    expect(result.complete).toBe(false);
    expect(calls.at(-1)?.slice(0, 2)).toEqual(['container', 'ls']);
    for (const _ of [fault].filter((value) =>
      ['remove', 'unknown', 'forged', 'create-unknown'].includes(value),
    ))
      expect(result.cleanup._tag).not.toBe('ConfirmedRemoval');
    expect(calls.filter((args) => isOperation('create')(args[0]))).toHaveLength(1);
    for (const _ of [fault].filter(isFault('forged')))
      expect(calls.some((args) => isOperation('rm')(args[0]))).toBe(false);
  }
  test(`${fault} cannot complete; cleanup is always read back`, failure);
}
async function interrupt(fault: 'warmup' | 'interrupt-collect') {
  const fake = scenario(fault);
  function atInterruptionPoint(args: string[]) {
    return Match.value(fault).pipe(
      Match.when('warmup', () => isOperation('wait')(args[0])),
      Match.orElse(() => isOperation('cp')(args[0]) && isExport(args.at(-1))),
    );
  }
  function* run() {
    const inputs = yield* stage([]);
    const spawning = superviseFixedWorker(inputs).pipe(
      Effect.provideService(DockerProcess, { run: fake.run }),
      Effect.provideService(DockerSession, { attach: fake.attach }),
      Effect.forkChild,
    );
    const fiber = yield* spawning;
    while (!fake.calls.some(atInterruptionPoint)) yield* Effect.yieldNow;
    yield* Fiber.interrupt(fiber);
    expect(fake.calls.some((args) => isOperation('rm')(args[0]))).toBe(true);
    expect(fake.calls.at(-1)?.slice(0, 2)).toEqual(['container', 'ls']);
    expect(fake.calls.some((args) => isOperation('ack')(args[0]))).toBe(false);
  }
  await Effect.runPromise(Effect.gen(run).pipe(Effect.scoped, withPlatform));
}
test('interrupted warmup stops the owned container and reads back absence', () =>
  interrupt('warmup'));
test('interrupted live collection sends no ACK and unconditionally removes the owned namespace', () =>
  interrupt('interrupt-collect'));
async function badFiles() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const inputs = yield* stage([]);
    for (const kind of ['missing', 'symlink', 'oversized', 'truncated']) {
      const temporary = yield* fs.makeTempDirectoryScoped();
      const root = yield* fs.realPath(temporary);
      yield* Match.value(kind).pipe(
        Match.when('symlink', () => fs.symlink('/etc/passwd', `${root}/worker-diagnostic.json`)),
        Match.when('oversized', () =>
          fs.writeFileString(`${root}/worker-diagnostic.json`, 'x'.repeat(16777217)),
        ),
        Match.when('truncated', () => fs.writeFileString(`${root}/worker-diagnostic.json`, '{')),
        Match.orElse(() => fs.exists(`${root}/worker-diagnostic.json`)),
      );
      const admitting = admitEvidenceFiles(inputs, root, { _tag: 'Unknown', evidence: [] }).pipe(
        Effect.result,
      );
      const result = yield* admitting;
      expect(Result.isFailure(result)).toBe(true);
    }
  }
  await Effect.runPromise(Effect.gen(run).pipe(withMetadata, Effect.scoped, withPlatform));
}
test('missing, symlinked, oversized and truncated actual files refuse admission', badFiles);
async function overflow() {
  const result = await Effect.runPromise(
    collectDockerOutput(Stream.fromIterable([new Uint8Array(262144), new Uint8Array(1)])).pipe(
      Effect.result,
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
}
test('stream overflow refuses actual chunks instead of truncating', overflow);
async function malformedDockerText() {
  const attempted = collectDockerOutput(Stream.make(new Uint8Array([0xff]))).pipe(
    Effect.result,
    Effect.exit,
  );
  const exit = await Effect.runPromise(attempted);
  expect(Exit.isSuccess(exit)).toBe(true);
  for (const value of [exit].filter(Exit.isSuccess))
    expect(value.value).toMatchObject({ _tag: 'Failure', failure: { code: 'EvidenceIncomplete' } });
  const handoff = readBoundedHandoffLine(Stream.make(new Uint8Array([0xff, 10]))).pipe(
    Effect.result,
    Effect.exit,
  );
  expect(Exit.isSuccess(await Effect.runPromise(handoff))).toBe(true);
}
test('malformed Docker output is a typed failure, not a decoder defect', malformedDockerText);
for (const operation of ['stop', 'rm'] as const) {
  async function malformedCleanup() {
    const fake = scenario('before-start');
    function run(args: readonly string[], cwd: string, timeout: number) {
      function* execute() {
        const result = yield* fake.run(args, cwd, timeout);
        for (const _ of [args[0]].filter(isOperation(operation)))
          yield* collectDockerOutput(Stream.make(new Uint8Array([0xff])));
        return result;
      }
      const workflow = Effect.gen(execute);
      return workflow;
    }
    function* supervise() {
      const inputs = yield* stage([]);
      const result = yield* superviseFixedWorker(inputs);
      expect(result.complete).toBe(false);
      expect(fake.calls.some((args) => isOperation('rm')(args[0]))).toBe(true);
      expect(fake.calls.at(-1)?.slice(0, 2)).toEqual(['container', 'ls']);
      const expected = Match.value(operation).pipe(
        Match.when('stop', () => 'ConfirmedRemoval' as const),
        Match.orElse(() => 'Unknown' as const),
      );
      expect(result.cleanup._tag).toBe(expected);
    }
    await Effect.runPromise(
      Effect.gen(supervise).pipe(
        Effect.provideService(DockerProcess, { run }),
        Effect.provideService(DockerSession, { attach: fake.attach }),
        Effect.scoped,
        withPlatform,
      ),
    );
  }
  test(`malformed ${operation} stderr does not skip remaining cleanup`, malformedCleanup);
}
async function controls() {
  const result = await Effect.runPromise(
    measureWorkerControls(1000, 1000).pipe(
      Effect.provideService(ControlNegatives, makeControlNegatives()),
      Effect.provideService(ControlProbeIO, makeUnavailableControlProbeIO()),
      Effect.result,
      withPlatform,
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
}
test('unavailable behavioral negatives block effective control measurement', controls);
async function inspect() {
  const result = await Effect.runPromise(
    assertDockerReadback('[{}]', { uid: 1000, gid: 1000, root: '/owned' }).pipe(Effect.result),
  );
  expect(Result.isFailure(result)).toBe(true);
}
test('missing actual Docker inspect fields refuse before start', inspect);
async function earlyFailure(forged = false) {
  const fake = scenario('before-start');
  function* run() {
    const { prepared: inputs } = yield* ownedFixture();
    const unexpected = Effect.die(new Error('Unexpected acquisition operation'));
    const preparation: typeof LinuxInputs.Service = {
      prepareLinuxInputs: () => Effect.succeed(PreparedInputs.make(inputs)),
      admitSource: () => unexpected,
      discoverTools: () => unexpected,
      validateToolCapsule: () => unexpected,
      admitTools: () => unexpected,
      stageArtifacts: () => unexpected,
    };
    const approved = Match.value(forged).pipe(
      Match.when(true, () =>
        QualificationRequest.make({
          ...inputs.admission.request,
          run: { ...inputs.admission.request.run, runId: 'different-reviewed-run' },
        }),
      ),
      Match.orElse(() => inputs.admission.request),
    );
    const authority: typeof QualificationAuthority.Service = {
      reviewedRun: () => Effect.succeed(QualificationRequest.make(approved)),
      preflight: () => Effect.void,
    };
    const provided = runQualification(inputs.admission.request).pipe(
      Effect.provideService(QualificationOutput, makeQualificationOutput(inputs.root)),
      Effect.provideService(LinuxInputs, preparation),
      Effect.provideService(QualificationAuthority, authority),
      Effect.provideService(DockerProcess, { run: fake.run }),
      Effect.provideService(DockerSession, { attach: fake.attach }),
    );
    const result = yield* provided;
    expect(result.exitCode).toBe(1);
    expect(result).toMatchObject({
      diagnostic: { _tag: 'QualificationIncomplete', qualificationReceipt: 'NotProduced' },
    });
    for (const _ of [forged].filter(Boolean)) {
      expect(fake.calls).toHaveLength(0);
      expect(result).toMatchObject({ diagnostic: { reason: 'InputChanged' } });
    }
    for (const _ of [forged].filter((value) => !value))
      expect(result).toMatchObject({ cleanup: { _tag: 'ConfirmedRemoval' } });
    expect('receipt' in result).toBe(false);
  }
  await Effect.runPromise(Effect.gen(run).pipe(withMetadata, Effect.scoped, withPlatform));
}
test('pre-seal worker refusal returns nonzero incomplete diagnostic without fake admission', () =>
  earlyFailure());
test('forged run identity refuses before acquisition or Docker', () => earlyFailure(true));

async function ownedHost(fault: Fault = 'none', controller = false) {
  const fake = scenario(fault, true);
  function* run() {
    const { prepared, boundary, fs } = yield* ownedFixture();
    const authority: typeof QualificationAuthority.Service = {
      reviewedRun: () => Effect.succeed(QualificationRequest.make(prepared.admission.request)),
      preflight: () => Effect.void,
    };
    const owned = yield* prepareOwnedProducer(prepared.admission.request).pipe(
      Effect.provideService(LinuxInputs, boundary),
    );
    const outputParent = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const selected = Match.value(controller).pipe(
      Match.when(true, () => runQualification(prepared.admission.request)),
      Match.orElse(() => superviseOwnedWorker(owned)),
    );
    const result = yield* selected.pipe(
      Effect.provideService(QualificationAuthority, authority),
      Effect.provideService(LinuxInputs, boundary),
      Effect.provideService(QualificationOutput, makeQualificationOutput(outputParent)),
    );
    for (const value of [result].filter((value) => 'exitCode' in value)) {
      expect(value).toMatchObject({
        exitCode: 0,
        receipt: { outcome: 'Passed', activation: 'Blocked' },
      });
      expect(value).toHaveProperty('outputDirectory');
      expect(
        yield* fs.exists(`${outputParent}/qualification-output/qualification-receipt.json`),
      ).toBe(true);
    }
    for (const value of [result].filter((value) => 'seal' in value)) {
      const worker = value;
      const expectedComplete = isFault('none')(fault);
      expect(worker.complete).toBe(expectedComplete);
      expect(worker.seal !== undefined).toBe(expectedComplete);
      for (const _ of [fault].filter(isFault('rehearsal-unknown')))
        expect(worker.cleanup._tag).toBe('Unknown');
      for (const _ of [fault].filter(isFault('none'))) {
        const admitted = yield* admitEvidenceFiles(
          prepared,
          worker.evidenceRoot,
          worker.cleanup,
          worker.seal,
        );
        const receipt = yield* makeReceipt(
          prepared.admission.request,
          admitted.observations,
          worker.cleanup,
          admitted.admission,
        );
        expect(qualificationExitCode(receipt, admitted.admission)).toBe(0);
        const host = yield* decodeHost(
          yield* fs.readFileString(`${worker.evidenceRoot}/cancellation-deadline.json`),
        );
        expect(host.observation.digests).toEqual({ _tag: 'Unknown' });
        expect(host.details.map((item: { mode: string }) => item.mode)).toEqual([
          'Qualification',
          'InterruptWarmup',
          'Deadline',
        ]);
        expect(host.details).toMatchObject([
          {},
          { termination: 'Interrupted' },
          { termination: 'DeadlineElapsed' },
        ]);
        expect(new Set(worker.names).size).toBe(3);
      }
      for (const _ of [fault].filter((value) => !isFault('none')(value)))
        expect(yield* fs.exists(`${worker.evidenceRoot}/cancellation-deadline.json`)).toBe(false);
    }
    const creates = fake.calls
      .map((args, index) => ({ args, index }))
      .filter(({ args }) => isOperation('create')(args[0]));
    for (const item of creates.slice(1))
      expect(fake.calls.slice(0, item.index).some((args) => isOperation('rm')(args[0]))).toBe(true);
    expect(creates.length).toBeLessThanOrEqual(3);
  }
  await Effect.runPromise(
    Effect.gen(run).pipe(
      Effect.provideService(DockerProcess, { run: fake.run }),
      Effect.provideService(DockerSession, { attach: fake.attach }),
      withMetadata,
      Effect.scoped,
      withPlatform,
    ),
  );
}

test('owned seal and host finalization admit all ten cases only after sequential real cancellation paths', () =>
  ownedHost());
for (const fault of [
  'no-live-bun',
  'rehearsal-unknown',
  'wrong-node',
  'replayed-ready',
  'trailing',
  'missing-evidence',
  'rehearsal-trailing',
  'image-unknown',
  'malformed-diagnostic',
] as const)
  test(`owned ${fault} never invents seal or host proof`, () => ownedHost(fault));
test('controller consumes the measured owned producer, not an authority seal stub', () =>
  ownedHost('none', true));
async function fullEvidence() {
  function* run() {
    const inputs = yield* stage([]);
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped();
    const root = yield* fs.realPath(temporary);
    const sha = 'a'.repeat(64);
    const seal = {
      provenance: 'TrustedSealBoundary' as const,
      sourceSha256: inputs.admission.source.sha256,
      sha256: sha,
    };
    const readbacks = {
      _tag: 'Verified' as const,
      os: 'Linux' as const,
      architecture: 'x86_64' as const,
      libc: 'glibc' as const,
      bun: '1.3.11' as const,
      node: '22.23.4' as const,
      runnerImage: 'synthetic',
      runnerVersion: 'synthetic',
      dockerVersion: 'synthetic',
      installerConfigSha256: sha,
      nodeConfigSha256: sha,
      nodeExecutableSha256: sha,
      controllerExecutableSha256: sha,
      controls: {
        networkNone: true as const,
        readOnlyRoot: true as const,
        unprivileged: true as const,
        capabilitiesDropped: true as const,
        noNewPrivileges: true as const,
        noExtraDevices: true as const,
        privatePidIpc: true as const,
        noPublishedPorts: true as const,
        noDockerSocket: true as const,
        boundedTmpfs: true as const,
        noexecNosuidNodev: true as const,
        networkDnsTcpDenied: true as const,
        resourceLimitsVerified: true as const,
        runnerEligible: true as const,
      },
    };
    const expected = [
      ['Preflight', 'Verified'],
      ['Admission', 'ArchiveRefused'],
      ['Canaries', 'ScriptsSuppressed'],
      ['Warmup', 'CacheMaterialized'],
      ['Offline', 'InstalledFromCache'],
      ['Offline', 'EmptyCacheRefused'],
      ['Offline', 'MissingArtifactRefused'],
      ['Admission', 'CacheIntegrityRefused'],
      ['Isolation', 'CopiesIsolated'],
      ['Cleanup', 'CancellationConfirmed'],
    ] as const;
    const observations: CaseObservation[] = requiredCases.map((caseId, index) =>
      Match.value(caseId).pipe(
        Match.when('CancellationDeadline', () => ({ _tag: 'Unknown' as const })),
        Match.orElse(() => ({
          _tag: 'Recorded' as const,
          sourceBefore: sha,
          sourceAfter: sha,
          lockBefore: '47fbd0c33dc391b1ac3d801ab5fb2db638d901d419c67222f708d186065ac19d',
          lockAfter: '47fbd0c33dc391b1ac3d801ab5fb2db638d901d419c67222f708d186065ac19d',
          seedBefore: sha,
          seedAfter: sha,
          harnessSha256: sha,
          toolCapsuleSha256: sha,
        })),
        (digests) => ({
          caseId,
          stage: expected[index]![0],
          reason: expected[index]![1],
          outcome: 'Passed',
          evidence: [evidenceRequirements[caseId].name],
          readbacks,
          digests,
        }),
      ),
    );
    const cleanup = { _tag: 'ConfirmedRemoval' as const, evidence: ['cleanup.json'] };
    for (const observation of observations.slice(0, 9))
      yield* fs.writeFileString(
        `${root}/${observation.evidence[0]}`,
        encode({
          caseId: observation.caseId,
          checks: evidenceRequirements[observation.caseId].checks,
          observation,
          details: {},
        }),
      );
    yield* fs.writeFileString(`${root}/cleanup.json`, encode({ observation: cleanup }));
    yield* fs.writeFileString(
      `${root}/worker-diagnostic.json`,
      encode({
        _tag: 'PendingHostFinalization',
        activation: 'Blocked',
        exitCode: 0,
        observations: observations.slice(0, 9),
        seedAdmission: seal,
        qualificationReceipt: 'NotProduced',
      }),
    );
    const pending = admitEvidenceFiles(inputs, root, cleanup, seal).pipe(Effect.result);
    expect(Result.isFailure(yield* pending)).toBe(true);
    const hostObservation = observations[9]!;
    yield* fs.writeFileString(
      `${root}/cancellation-deadline.json`,
      encode({
        caseId: hostObservation.caseId,
        checks: evidenceRequirements.CancellationDeadline.checks,
        observation: hostObservation,
        details: {},
      }),
    );
    const files = yield* admitEvidenceFiles(inputs, root, cleanup, seal);
    const receipt = yield* makeReceipt(
      inputs.admission.request,
      observations,
      cleanup,
      files.admission,
    );
    expect(qualificationExitCode(receipt, files.admission)).toBe(0);
    expect(qualificationExitCode(receipt)).toBe(1);
    expect(files.observations[9]!.digests).toEqual({ _tag: 'Unknown' });
    const hostFile = yield* fs.readFileString(`${root}/cancellation-deadline.json`);
    for (const missing of evidenceRequirements.CancellationDeadline.checks) {
      yield* fs.writeFileString(
        `${root}/cancellation-deadline.json`,
        encode({
          caseId: hostObservation.caseId,
          checks: evidenceRequirements.CancellationDeadline.checks.filter(
            (check) => check !== missing,
          ),
          observation: hostObservation,
          details: {},
        }),
      );
      const missingProof = admitEvidenceFiles(inputs, root, cleanup, seal).pipe(Effect.result);
      expect(Result.isFailure(yield* missingProof)).toBe(true);
    }
    yield* fs.writeFileString(`${root}/cancellation-deadline.json`, hostFile);
    const unknownCleanup = { _tag: 'Unknown' as const, evidence: ['cleanup.json'] };
    yield* fs.writeFileString(`${root}/cleanup.json`, encode({ observation: unknownCleanup }));
    const notRemoved = admitEvidenceFiles(inputs, root, unknownCleanup, seal).pipe(Effect.result);
    expect(Result.isFailure(yield* notRemoved)).toBe(true);
    yield* fs.writeFileString(`${root}/cleanup.json`, encode({ observation: cleanup }));
    const producerDiagnostic = yield* fs.readFileString(`${root}/worker-diagnostic.json`);
    yield* fs.writeFileString(
      `${root}/worker-diagnostic.json`,
      encode({
        _tag: 'PendingHostFinalization',
        activation: 'Blocked',
        exitCode: 0,
        observations,
        seedAdmission: seal,
        qualificationReceipt: 'NotProduced',
      }),
    );
    const producerClaimedRemoval = admitEvidenceFiles(inputs, root, cleanup, seal).pipe(
      Effect.result,
    );
    expect(Result.isFailure(yield* producerClaimedRemoval)).toBe(true);
    yield* fs.writeFileString(`${root}/worker-diagnostic.json`, producerDiagnostic);
    const overBudget = exportReceipt(root, receipt, 16777216).pipe(Effect.result);
    expect(Result.isFailure(yield* overBudget)).toBe(true);
    const untrusted = admitEvidenceFiles(inputs, root, cleanup).pipe(Effect.result);
    expect(Result.isFailure(yield* untrusted)).toBe(true);
    const data = yield* fs.readFile(`${root}/warmup.json`);
    const actual = yield* Effect.tryPromise(
      async () => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data))),
    );
    expect(files.admission.evidence.cases.find((file) => isWarmup(file.caseId))).toMatchObject({
      sha256: Array.from(actual, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      byteLength: data.length,
    });
    yield* fs.writeFileString(
      `${root}/warmup.json`,
      encode({ caseId: 'Warmup', checks: ['Invented'], observation: observations[3], details: {} }),
    );
    const forged = admitEvidenceFiles(inputs, root, cleanup, seal).pipe(Effect.result);
    expect(Result.isFailure(yield* forged)).toBe(true);
    for (const observation of observations.slice(0, 2))
      yield* fs.writeFileString(
        `${root}/${observation.evidence[0]}`,
        encode({
          caseId: observation.caseId,
          checks: evidenceRequirements[observation.caseId].checks,
          observation,
          details: 'x'.repeat(9 * 1024 * 1024),
        }),
      );
    const overflow = admitEvidenceFiles(inputs, root, cleanup, seal).pipe(Effect.result);
    expect(Result.isFailure(yield* overflow)).toBe(true);
  }
  await Effect.runPromise(Effect.gen(run).pipe(withMetadata, Effect.scoped, withPlatform));
}
test(
  'actual files plus independent source and seal admit a full receipt; claims alone do not',
  fullEvidence,
);
