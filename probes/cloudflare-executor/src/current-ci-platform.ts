import { Effect, Exit, FileSystem, Match, Schema } from 'effect';
import { ChildProcess } from 'effect/process';

import {
  currentCiConsumerArguments,
  currentCiImages,
  currentCiNames,
  verifyCurrentCiConsumer,
} from './current-ci-docker.ts';
import { currentCiExportLimits, exportCurrentCiSeed } from './current-ci-export.ts';
import { prepareCurrentCiInputs } from './current-ci-inputs.ts';
import { currentSourcePins } from './current-inputs.ts';
import { currentLinuxWorkerPins } from './current-linux-worker.ts';
import { currentNpmProfiles } from './current-npm-profiles.ts';
import { CacheMetadata } from './linux-qualification/cache.ts';
import {
  collectDockerOutput,
  makeDockerProcess,
  requireSupervisor,
} from './linux-qualification/docker-process.ts';
import { digestBytes } from './payload.ts';
import { readBounded } from './runner-input.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const success = Schema.is(Schema.Literal(0));
const OwnerRecord = Schema.Struct({ Labels: Schema.Record(Schema.String, Schema.String) });
const Hex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Host = Schema.Struct({
  OSType: Schema.Literal('linux'),
  Architecture: Schema.Literals(['x86_64', 'amd64']),
  DockerRootDir: Schema.String,
  ServerVersion: Schema.String,
});
const ImageList = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Struct({ Architecture: Schema.Literal('amd64'), Os: Schema.Literal('linux') }),
  ]),
);
const ObjectList = Schema.fromJsonString(Schema.Array(Schema.Unknown));
const ContainerOwner = Schema.Struct({ Config: OwnerRecord });
const Identity = Schema.Struct({
  status: Schema.Literal('Checked'),
  installedPackages: Schema.Int,
  directDependencies: Schema.Int,
  links: Schema.Int,
  exclusions: Schema.Int,
  identitiesSha256: Hex,
});
const ResultRecord = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('CacheOnlyCompleted'),
    activation: Schema.Literal('Blocked'),
    qualified: Schema.Literal(false),
    scripts: Schema.Literal('Disabled'),
    acceptance: Schema.Literal('CacheOnlyNotBaselineQualified'),
    runtime: Schema.Struct({
      node: Schema.Literal('22.23.4'),
      bun: Schema.Literal('1.4.3'),
      npm: Schema.Literal('10.9.9'),
      os: Schema.Literal('linux'),
      arch: Schema.Literal('x64'),
    }),
    sourceInventorySha256: Schema.Literal(currentLinuxWorkerPins.sourceInventorySha256),
    lockSha256: Schema.Literal(currentLinuxWorkerPins.lockSha256),
    bun: Schema.Struct({
      seedSha256: Hex,
      portableSeedSha256: Hex,
      descriptorSha256: Hex,
      descriptorBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 67108864 })),
      seedPath: Schema.Literal('/work/portable-bun-seed'),
      descriptorPath: Schema.Literal('/work/bun-seed-descriptor.json'),
      installedIdentities: Schema.Struct({ warmup: Identity, fresh: Identity }),
    }),
    npm: Schema.Array(
      Schema.Struct({ id: Schema.String, selected: Schema.Int, outputBytes: Schema.Int }),
    ),
  }),
);

function trustedHostProcess(
  executable: '/usr/bin/git' | '/usr/bin/df' | '/opt/ceirean-controller/bun',
  argv: readonly string[],
  cwd: string,
  timeout = 30000,
) {
  function* run() {
    const child = yield* ChildProcess.make(executable, argv, {
      cwd,
      shell: false,
      extendEnv: false,
      env: {
        HOME: cwd,
        PATH: '/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_NO_LAZY_FETCH: '1',
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      killSignal: 'SIGKILL',
      forceKillAfter: 0,
    });
    const [stdout, , exit] = yield* Effect.all(
      [collectDockerOutput(child.stdout), collectDockerOutput(child.stderr), child.exitCode],
      { concurrency: 3 },
    );
    const exitCode = Number(exit);
    yield* requireSupervisor(success(exitCode), 'InputChanged');
    return stdout;
  }
  const workflow = Effect.gen(run);
  return workflow.pipe(Effect.timeout(timeout), Effect.scoped);
}
export function makeCurrentCiPorts(implementationRoot: string) {
  const docker = makeDockerProcess();
  const owned = new Map<
    string,
    { readonly dev: bigint; readonly ino: bigint; readonly uid: number | undefined }
  >();
  const outputs = new Set<string>();
  function directory(owner: string) {
    return `${implementationRoot}/.local/current-ci-${owner}`;
  }
  function command(owner: string, argv: readonly string[], timeout = 30000) {
    function* run() {
      const result = yield* docker.run(argv, directory(owner), timeout);
      yield* requireSupervisor(success(result.exitCode), 'CleanupUnknown');
      return result.stdout;
    }
    const workflow = Effect.gen(run);
    return workflow;
  }
  function* prepareOwned(owner: string) {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    yield* requireSupervisor(
      (yield* fs.realPath(implementationRoot)) === implementationRoot,
      'InputChanged',
    );
    const local = `${implementationRoot}/.local`;
    yield* fs.makeDirectory(local, { recursive: true, mode: 0o700 });
    yield* requireSupervisor((yield* fs.realPath(local)) === local, 'InputChanged');
    const root = directory(owner);
    function* claim() {
      yield* fs.makeDirectory(root, { mode: 0o700 });
      const info = yield* metadata.lstat(root);
      owned.set(owner, { dev: info.dev, ino: info.ino, uid: info.uid });
    }
    const claiming = Effect.gen(claim);
    yield* claiming.pipe(Effect.uninterruptible);
    const output = `${implementationRoot}/qualification-output`;
    yield* fs.makeDirectory(output, { mode: 0o700 });
    outputs.add(owner);
    const runtime = yield* trustedHostProcess('/opt/ceirean-controller/bun', ['--version'], root);
    const ControllerVersion = Schema.Literal('1.4.2');
    yield* Schema.decodeUnknownEffect(ControllerVersion)(runtime.trim());
    const system = yield* command(owner, ['info', '--format', '{{json .}}']);
    const host = yield* Schema.decodeUnknownEffect(Host)(yield* decode(system));
    const available = [];
    for (const path of [root, host.DockerRootDir]) {
      const report = yield* trustedHostProcess('/usr/bin/df', ['-Pk', '--', path], root);
      const line = report.trim().split('\n').at(-1)!.trim().split(/\s+/);
      available.push(Number(line[3]) * 1024);
    }
    const free = Math.min(...available);
    yield* requireSupervisor(Number.isSafeInteger(free) && free >= 17179869184, 'InputChanged');
    yield* fs.makeDirectory(`${root}/templates`, { mode: 0o700 });
    yield* trustedHostProcess(
      '/usr/bin/git',
      ['init', '--bare', '--quiet', `--template=${root}/templates`, `${root}/source.git`],
      root,
    );
    yield* trustedHostProcess(
      '/usr/bin/git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'protocol.allow=never',
        '-c',
        'protocol.https.allow=always',
        '-C',
        `${root}/source.git`,
        'fetch',
        '--no-tags',
        '--depth=1',
        'https://github.com/opsydyn/fold-kit-experiments.git',
        currentSourcePins.revision,
      ],
      root,
      120000,
    );
    const request = (url: string, init: RequestInit) => fetch(url, init);
    yield* prepareCurrentCiInputs(`${root}/source.git`, `${root}/inputs`, request, free);
    for (const image of Object.values(currentCiImages)) {
      yield* command(owner, ['pull', '--platform=linux/amd64', image], 120000);
      const raw = yield* command(owner, ['image', 'inspect', image]);
      yield* Schema.decodeUnknownEffect(ImageList)(raw);
    }
    const capsule = `${root}/capsule`;
    for (const child of ['src', 'fixtures', 'scripts'])
      yield* fs.makeDirectory(`${capsule}/${child}`, { recursive: true, mode: 0o755 });
    yield* trustedHostProcess(
      '/opt/ceirean-controller/bun',
      [
        '--no-env-file',
        '--no-install',
        'build',
        'probes/cloudflare-executor/scripts/current-linux-worker.ts',
        '--target=bun',
        `--outfile=${capsule}/src/current-linux-worker.mjs`,
      ],
      implementationRoot,
      60000,
    );
    for (const path of ['fixtures/current-npm.json', 'scripts/npm-offline-guard.cjs']) {
      yield* fs.copyFile(
        `${implementationRoot}/probes/cloudflare-executor/${path}`,
        `${capsule}/${path}`,
      );
      yield* fs.chmod(`${capsule}/${path}`, 0o644);
    }
    yield* fs.chmod(`${capsule}/src/current-linux-worker.mjs`, 0o644);
    const info = yield* metadata.lstat(root);
    yield* requireSupervisor(info.mode === 0o700, 'InputChanged');
    const bundlePath = `${capsule}/src/current-linux-worker.mjs`;
    const bundleInfo = yield* metadata.lstat(bundlePath);
    const validBundle = [
      bundleInfo.size > 0n,
      bundleInfo.size <= 33554432n,
      bundleInfo.nlink === 1n,
    ].every(Boolean);
    yield* requireSupervisor(validBundle, 'InputChanged');
    const workerSha256 = yield* digestBytes(yield* fs.readFile(bundlePath));
    const guardSha256 = yield* digestBytes(
      yield* fs.readFile(`${capsule}/scripts/npm-offline-guard.cjs`),
    );
    yield* fs.writeFileString(
      `${output}/host.json`,
      encode({
        os: host.OSType,
        architecture: host.Architecture,
        docker: host.ServerVersion,
        availableBytes: free,
        controllerBun: runtime.trim(),
        workerSha256,
        guardSha256,
        images: currentCiImages,
      }),
      { flag: 'wx', mode: 0o600 },
    );
  }
  function prepare(owner: string) {
    const workflow = Effect.gen(() => prepareOwned(owner));
    return workflow;
  }
  function createVolume(owner: string, kind: 'inputs' | 'tools' | 'work') {
    function* create() {
      const name = currentCiNames(owner)[kind];
      yield* requireSupervisor(!(yield* exists(owner, 'volume', name)), 'InputChanged');
      yield* command(owner, ['volume', 'create', '--label', `ceirean.current=${owner}`, name]);
    }
    const workflow = Effect.gen(create);
    return workflow;
  }
  function stage(owner: string) {
    function* run() {
      const names = currentCiNames(owner);
      yield* command(owner, [
        'create',
        '--name',
        names.stager,
        '--label',
        `ceirean.current=${owner}`,
        '--platform=linux/amd64',
        '--network=none',
        '--read-only',
        '--cap-drop=ALL',
        '--cap-add=CHOWN',
        '--cap-add=FOWNER',
        '--cap-add=DAC_OVERRIDE',
        '--security-opt=no-new-privileges:true',
        '--cpus=2',
        '--memory=3g',
        '--memory-swap=3g',
        '--pids-limit=128',
        '--mount',
        `type=volume,source=${names.inputs},target=/inputs`,
        '--mount',
        `type=volume,source=${names.tools},target=/tools`,
        '--mount',
        `type=volume,source=${names.work},target=/work`,
        '--entrypoint=/bin/sleep',
        currentCiImages.node,
        '120',
      ]);
      yield* command(owner, ['cp', `${directory(owner)}/inputs/.`, `${names.stager}:/inputs`]);
      yield* command(owner, ['cp', `${directory(owner)}/capsule/.`, `${names.stager}:/tools`]);
      yield* command(owner, ['start', names.stager]);
      for (const argv of [
        ['/bin/mkdir', '-p', '/tools/node_modules'],
        ['/bin/cp', '/usr/local/bin/node', '/tools/node'],
        ['/bin/cp', '-R', '/usr/local/lib/node_modules/npm', '/tools/node_modules/npm'],
        ['/bin/chmod', '-R', 'a+rX', '/tools'],
        ['/bin/chown', '1000:1000', '/work'],
        ['/bin/chmod', '700', '/work'],
      ])
        yield* command(owner, ['exec', names.stager, ...argv]);
      yield* command(owner, ['stop', '--time=1', names.stager]);
    }
    const workflow = Effect.gen(run);
    return workflow;
  }
  function readConsumer(owner: string) {
    function* read() {
      const text = yield* command(owner, ['inspect', currentCiNames(owner).consumer]);
      return yield* verifyCurrentCiConsumer(text, owner);
    }
    const workflow = Effect.gen(read);
    return workflow;
  }
  function createConsumer(owner: string) {
    function* create() {
      yield* command(owner, currentCiConsumerArguments(owner));
      const state = yield* readConsumer(owner);
      yield* requireSupervisor(!state.Running, 'BlockedControls');
    }
    const workflow = Effect.gen(create);
    return workflow;
  }
  function start(owner: string) {
    const workflow = command(owner, ['start', currentCiNames(owner).consumer]).pipe(Effect.asVoid);
    return workflow;
  }
  function wait(owner: string) {
    function* waiting() {
      let state = yield* readConsumer(owner);
      while (state.Running) {
        yield* Effect.sleep('2 seconds');
        state = yield* readConsumer(owner);
      }
      yield* requireSupervisor(success(state.ExitCode), 'EvidenceIncomplete');
    }
    const workflow = Effect.gen(waiting);
    return workflow;
  }
  function stop(owner: string) {
    function* stopped() {
      const state = yield* readConsumer(owner);
      yield* requireSupervisor(!state.Running && success(state.ExitCode), 'CleanupUnknown');
    }
    const workflow = Effect.gen(stopped);
    return workflow;
  }
  function exportSeed(owner: string) {
    function* exporting() {
      yield* stop(owner);
      const fs = yield* FileSystem.FileSystem;
      const metadata = yield* CacheMetadata;
      const root = `${directory(owner)}/export`;
      yield* fs.makeDirectory(root, { mode: 0o700 });
      const consumer = currentCiNames(owner).consumer;
      yield* command(owner, [
        'cp',
        `${consumer}:/work/evidence/result.json`,
        `${root}/worker.json`,
      ]);
      const raw = yield* readBounded(
        `${root}/worker.json`,
        currentCiExportLimits.evidenceBytes / 2,
      );
      const result = yield* Schema.decodeUnknownEffect(ResultRecord)(raw);
      const ids = result.bun.installedIdentities;
      yield* requireSupervisor(
        encode(ids.warmup) === encode(ids.fresh) && ids.fresh.installedPackages > 0,
        'InputChanged',
      );
      yield* requireSupervisor(
        encode(result.npm.map(({ id }) => id)) === encode(currentNpmProfiles.map(({ id }) => id)) &&
          result.npm.every(({ selected }) => selected > 0),
        'InputChanged',
      );
      for (const name of ['portable-bun-seed', 'bun-seed-descriptor.json'])
        yield* command(owner, ['cp', `${consumer}:/work/${name}`, `${root}/${name}`], 60000);
      const output = `${implementationRoot}/qualification-output`;
      const seed = yield* exportCurrentCiSeed(root, `${output}/seed.tar.gz`, result.bun);
      yield* fs.writeFileString(`${output}/worker.json`, encode(result), {
        flag: 'wx',
        mode: 0o600,
      });
      let evidenceBytes = 0n;
      for (const name of ['host.json', 'worker.json'])
        evidenceBytes += (yield* metadata.lstat(`${output}/${name}`)).size;
      yield* requireSupervisor(
        evidenceBytes <= BigInt(currentCiExportLimits.evidenceBytes - 65536),
        'EvidenceIncomplete',
      );
      return {
        bytes: seed.bytes,
        sha256: seed.sha256,
        descriptorSha256: seed.descriptorSha256,
        seedSha256: seed.seedSha256,
      };
    }
    const workflow = Effect.gen(exporting);
    return workflow;
  }
  function exists(owner: string, kind: 'container' | 'volume', name: string) {
    function* listing() {
      const args = Match.value(kind).pipe(
        Match.when('container', () => ['container', 'ls', '--all', '--format', '{{.Names}}']),
        Match.orElse(() => ['volume', 'ls', '--format', '{{.Name}}']),
      );
      const names = (yield* command(owner, args)).trim().split('\n');
      return names.includes(name);
    }
    const workflow = Effect.gen(listing);
    return workflow;
  }
  function removeOwned(owner: string, kind: 'container' | 'volume', name: string) {
    function* remove() {
      const present = yield* exists(owner, kind, name);
      function* deletion() {
        const argv = Match.value(kind).pipe(
          Match.when('container', () => ['inspect', name]),
          Match.orElse(() => ['volume', 'inspect', name]),
        );
        const text = yield* command(owner, argv);
        const records = yield* Schema.decodeUnknownEffect(ObjectList)(text);
        yield* requireSupervisor(records.length === 1, 'CleanupUnknown');
        const container = Schema.decodeUnknownEffect(ContainerOwner)(records[0]);
        const containerOwner = container.pipe(Effect.map(({ Config }) => Config));
        const volumeOwner = Schema.decodeUnknownEffect(OwnerRecord)(records[0]);
        const raw = Match.value(kind).pipe(
          Match.when('container', () => containerOwner),
          Match.orElse(() => volumeOwner),
        );
        const record = yield* raw;
        yield* requireSupervisor(record.Labels['ceirean.current'] === owner, 'CleanupUnknown');
        const removal = Match.value(kind).pipe(
          Match.when('container', () => ['rm', '--force', name]),
          Match.orElse(() => ['volume', 'rm', name]),
        );
        yield* command(owner, removal);
        yield* requireSupervisor(!(yield* exists(owner, kind, name)), 'CleanupUnknown');
      }
      const deleting = Effect.gen(deletion);
      const isPresent = Effect.sync(() => present);
      yield* deleting.pipe(Effect.when(isPresent));
    }
    const workflow = Effect.gen(remove);
    return workflow;
  }
  function cleanup(owner: string) {
    function* clean() {
      const fs = yield* FileSystem.FileSystem;
      const metadata = yield* CacheMetadata;
      const names = currentCiNames(owner);
      const hasRoot = Effect.succeed(owned.has(owner));
      function* removeResources() {
        const cleaned = [];
        for (const name of [names.consumer, names.stager])
          cleaned.push(yield* removeOwned(owner, 'container', name).pipe(Effect.exit));
        for (const name of [names.work, names.tools, names.inputs])
          cleaned.push(yield* removeOwned(owner, 'volume', name).pipe(Effect.exit));
        const root = directory(owner);
        const rootInfo = yield* metadata.lstat(root);
        const expected = yield* Effect.fromNullishOr(owned.get(owner));
        const sameRoot = [
          rootInfo.dev === expected.dev,
          rootInfo.ino === expected.ino,
          rootInfo.uid === expected.uid,
          (yield* fs.realPath(root)) === root,
        ].every(Boolean);
        yield* requireSupervisor(sameRoot, 'CleanupUnknown');
        const pending = [root];
        const isDirectory = Schema.is(Schema.Literal('Directory'));
        let count = 0;
        while (pending.length > 0) {
          const path = pending.pop()!;
          const info = yield* metadata.lstat(path);
          count++;
          yield* requireSupervisor(info.uid === rootInfo.uid && count <= 250000, 'CleanupUnknown');
          function* descend() {
            yield* fs.chmod(path, info.mode | 0o700);
            for (const child of yield* fs.readDirectory(path)) pending.push(`${path}/${child}`);
          }
          const descending = Effect.gen(descend);
          const directoryPresent = Effect.succeed(isDirectory(info.type));
          yield* descending.pipe(Effect.when(directoryPresent));
        }
        yield* fs.remove(root, { recursive: true });
        owned.delete(owner);
        yield* requireSupervisor(cleaned.every(Exit.isSuccess), 'CleanupUnknown');
        function* evidence() {
          yield* fs.writeFileString(
            `${implementationRoot}/qualification-output/cleanup.json`,
            encode({
              status: 'Confirmed',
              containers: 0,
              volumes: 0,
              scratch: 'Removed',
              activation: 'Blocked',
            }),
            { flag: 'wx', mode: 0o600 },
          );
        }
        const writing = Effect.gen(evidence);
        const outputPresent = Effect.succeed(outputs.has(owner));
        yield* writing.pipe(Effect.when(outputPresent));
      }
      const removing = Effect.gen(removeResources);
      yield* removing.pipe(Effect.when(hasRoot));
    }
    const workflow = Effect.gen(clean);
    return workflow;
  }
  return {
    prepare,
    createVolume,
    stage,
    createConsumer,
    start,
    wait,
    stop,
    export: exportSeed,
    cleanup,
  };
}
