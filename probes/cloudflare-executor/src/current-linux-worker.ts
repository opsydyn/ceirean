import {
  Cause,
  Console,
  Data,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Match,
  Option,
  Order,
  Path,
  Ref,
  Result,
  Schema,
  Stream,
} from 'effect';
import { ChildProcess } from 'effect/process';

import { makeLoopbackListener } from '../scripts/linux-replay-platform.ts';
import { readCacheBlob } from './cache-candidate.ts';
import { currentArchivePins } from './current-archive-preflight.ts';
import { fromCurrentBunLock } from './current-dependencies.ts';
import { validateCurrentLinuxRuntime } from './current-linux-cache.ts';
import { readCurrentNpmSnapshot } from './current-npm-frozen.ts';
import { currentNpmProfiles, fromCurrentNpmLock } from './current-npm-profiles.ts';
import {
  admitCaseCache,
  CacheMetadata,
  copyCaseCache,
  type makeCacheMetadata,
  sealCache,
  verifySealedCache,
} from './linux-qualification/cache.ts';
import { makeWorkerCases } from './linux-qualification/cases.ts';
import { startReplayOn } from './linux-qualification/registry.ts';
import { digestBytes } from './payload.ts';
import { sha256, validateSourceInventory } from './preparation.ts';
import { readBounded } from './runner-input.ts';

export const currentLinuxWorkerPins = {
  sourceInventorySha256: '3b2862214f45be2d0d4211acce1c7c81b0c717ac3b9487f139535239cc6a16df',
  lockSha256: '9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89',
} as const;
export class CurrentLinuxWorkerError extends Data.TaggedError('CurrentLinuxWorkerError')<{
  readonly code:
    | 'CommandFailed'
    | 'OutputBudgetExceeded'
    | 'OwnershipRefused'
    | 'InputChanged'
    | 'WorkspaceRefused'
    | 'EvidenceRefused';
}> {}
const FailureCode = Schema.Struct({
  code: Schema.Literals([
    'CommandFailed',
    'OutputBudgetExceeded',
    'OwnershipRefused',
    'InputChanged',
    'ArchiveRefused',
    'CacheRefused',
    'ResolutionRefused',
    'InvalidInventory',
    'DestinationRefused',
    'WorkspaceRefused',
    'EvidenceRefused',
    'StopFailed',
    'EvidenceIncomplete',
  ]),
});
export function sanitizeCacheOnlyFailure(error: unknown) {
  const decoded = Schema.decodeUnknownResult(FailureCode)(error);
  return Result.match(decoded, {
    onSuccess: ({ code }) => ({ reason: code }),
    onFailure: () => ({ reason: 'UnclassifiedFailure' as const }),
  });
}
function requireWorker(valid: boolean, code: CurrentLinuxWorkerError['code']) {
  const result = Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new CurrentLinuxWorkerError({ code }),
    ),
  );
  const workflow = Effect.fromResult(result);
  return workflow;
}
const isRun = Schema.is(Schema.Tuple([Schema.Literal('--run-cache-only')]));
export const acceptsCacheOnlyArguments = (args: readonly string[]) => isRun(args);
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
type WorkspaceMetadata = Effect.Success<ReturnType<ReturnType<typeof makeCacheMetadata>['lstat']>>;
export type CurrentLinuxWorkspace = { readonly root: '/work'; readonly evidence: '/work/evidence' };
const workspaceOwners = new WeakMap<
  CurrentLinuxWorkspace,
  { readonly root: WorkspaceMetadata; readonly evidence: WorkspaceMetadata }
>();
function privateDirectory(info: WorkspaceMetadata) {
  return [isDirectory(info.type), info.uid === 1000, info.gid === 1000, info.mode === 0o700].every(
    Boolean,
  );
}
function sameDirectory(left: WorkspaceMetadata, right: WorkspaceMetadata) {
  return [privateDirectory(right), left.dev === right.dev, left.ino === right.ino].every(Boolean);
}
function admitCurrentLinuxWorkspace() {
  function* admit() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const root = yield* metadata.lstat('/work');
    yield* requireWorker(privateDirectory(root), 'WorkspaceRefused');
    const canonical = yield* fs.realPath('/work');
    const isWork = Schema.is(Schema.Literal('/work'));
    yield* requireWorker(isWork(canonical), 'WorkspaceRefused');
    yield* requireWorker((yield* fs.readDirectory('/work')).length === 0, 'WorkspaceRefused');
    yield* requireWorker(sameDirectory(root, yield* metadata.lstat('/work')), 'WorkspaceRefused');
    yield* fs.makeDirectory('/work/evidence', { mode: 0o700 });
    const evidence = yield* metadata.lstat('/work/evidence');
    yield* requireWorker(privateDirectory(evidence), 'EvidenceRefused');
    const isEvidence = Schema.is(Schema.Literal('/work/evidence'));
    yield* requireWorker(isEvidence(yield* fs.realPath('/work/evidence')), 'EvidenceRefused');
    yield* requireWorker(sameDirectory(root, yield* metadata.lstat('/work')), 'WorkspaceRefused');
    const owner: CurrentLinuxWorkspace = Object.freeze({
      root: '/work',
      evidence: '/work/evidence',
    });
    workspaceOwners.set(owner, { root, evidence });
    return owner;
  }
  const workflow = Effect.gen(admit);
  return workflow;
}
function verifyCurrentLinuxWorkspace(owner: CurrentLinuxWorkspace) {
  function* verify() {
    const expected = yield* Effect.fromNullishOr(workspaceOwners.get(owner));
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    for (const [path, identity] of [
      [owner.root, expected.root],
      [owner.evidence, expected.evidence],
    ] as const) {
      yield* requireWorker(sameDirectory(identity, yield* metadata.lstat(path)), 'EvidenceRefused');
      yield* requireWorker((yield* fs.realPath(path)) === path, 'EvidenceRefused');
    }
  }
  const workflow = Effect.gen(verify);
  return workflow;
}
function writeCurrentLinuxEvidence(owner: CurrentLinuxWorkspace, value: unknown) {
  function* write() {
    yield* verifyCurrentLinuxWorkspace(owner);
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const path = `${owner.evidence}/result.json`;
    const file = yield* fs.open(path, { flag: 'wx', mode: 0o600, noFollow: true });
    const text = encode(value);
    yield* file.writeAll(new TextEncoder().encode(text));
    const info = yield* metadata.lstat(path);
    yield* validateOutputMetadata(info);
    yield* requireWorker(isFile(info.type) && info.mode === 0o600, 'EvidenceRefused');
  }
  const workflow = Effect.gen(write);
  return workflow.pipe(Effect.scoped);
}
function sanitizeCacheOnlyCause(cause: Cause.Cause<unknown>) {
  function reasonCode(reason: Cause.Reason<unknown>) {
    return Match.value(reason).pipe(
      Match.when(Cause.isFailReason, ({ error }) => sanitizeCacheOnlyFailure(error).reason),
      Match.when(Cause.isDieReason, ({ defect }) => sanitizeCacheOnlyFailure(defect).reason),
      Match.orElse(() => 'Interrupted' as const),
    );
  }
  const reasons = [...new Set(cause.reasons.map(reasonCode))];
  const reason = Match.value(reasons.includes('StopFailed')).pipe(
    Match.when(true, () => 'StopFailed' as const),
    Match.orElse(() => reasons[0] ?? 'UnclassifiedFailure'),
  );
  return { reason, reasons, defect: Cause.hasDies(cause), interrupted: Cause.hasInterrupts(cause) };
}
export function attemptCurrentLinuxCacheOnly(
  args: readonly string[],
  execute: typeof runCurrentLinuxCacheOnly,
) {
  function* attempt() {
    const progress = yield* Ref.make('WorkspaceAdmission');
    const admitted = yield* Ref.make<Option.Option<CurrentLinuxWorkspace>>(Option.none());
    function* executeOwned() {
      const owner = yield* admitCurrentLinuxWorkspace();
      yield* Ref.set(admitted, Option.some(owner));
      yield* Ref.set(progress, 'ArchiveAdmission');
      return yield* execute(progress, owner);
    }
    const execution = Effect.gen(executeOwned);
    const scoped = execution.pipe(Effect.timeout('15 minutes'), Effect.scoped);
    function captureAfterCleanup(restore: typeof Effect.interruptible) {
      function* report() {
        const exit = yield* restore(scoped).pipe(Effect.exit);
        function* publish() {
          const value = Exit.match(exit, {
            onSuccess: (result) => result,
            onFailure: (cause) => ({
              status: 'CacheOnlyFailed' as const,
              qualified: false,
              activation: 'Blocked' as const,
              acceptance: 'CacheOnlyNotBaselineQualified' as const,
              ...sanitizeCacheOnlyCause(cause),
            }),
          });
          const phase = yield* Ref.get(progress);
          const owner = yield* Ref.get(admitted);
          const evidence = { ...value, phase };
          const writing = Option.match(owner, {
            onNone: () => Effect.fail(new CurrentLinuxWorkerError({ code: 'WorkspaceRefused' })),
            onSome: (workspace) => writeCurrentLinuxEvidence(workspace, evidence),
          });
          const boundedWriting = writing.pipe(Effect.timeout('5 seconds'), Effect.scoped);
          const written = yield* boundedWriting.pipe(Effect.exit);
          const fallback = Console.error(
            encode({ ...evidence, status: 'CacheOnlyFailed', evidence: 'Unavailable' }),
          );
          const unavailable = Effect.succeed(Exit.isFailure(written));
          const logging = fallback.pipe(Effect.when(unavailable), Effect.timeout('1 second'));
          yield* logging.pipe(Effect.exit);
          return Number(Exit.isFailure(exit) || Exit.isFailure(written));
        }
        const publishing = Effect.gen(publish);
        // A fresh owned fiber has no pending parent interrupt; its I/O remains interruptible.
        const child = yield* publishing.pipe(Effect.forkChild({ uninterruptible: false }));
        return yield* Fiber.join(child);
      }
      const workflow = Effect.gen(report);
      return workflow;
    }
    const reporting = Effect.uninterruptibleMask(captureAfterCleanup);
    return yield* reporting;
  }
  const running = Effect.gen(attempt);
  const usage = Console.error('{"status":"UsageError","activation":"Blocked"}').pipe(
    Effect.map(() => 64),
  );
  return Match.value(acceptsCacheOnlyArguments(args)).pipe(
    Match.when(true, () => running),
    Match.orElse(() => usage),
  );
}
const npmPrefix = [
  '--require',
  '/tools/scripts/npm-offline-guard.cjs',
  '/tools/node_modules/npm/bin/npm-cli.js',
] as const;
type Command = {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly cache: string;
};
export function currentLinuxWorkerCommands() {
  const install = ['install', '--frozen-lockfile', '--ignore-scripts', '--backend=copyfile'];
  return {
    lockReadback: {
      executable: '/usr/local/bin/bun',
      argv: [
        '--no-env-file',
        '--no-install',
        '--no-macros',
        '--config=/work/empty.bunfig.toml',
        '--eval',
        'console.log(JSON.stringify(Bun.JSON5.parse(await Bun.file("/work/warmup/source/bun.lock").text())))',
      ],
      cwd: '/work',
      cache: '/work/runtime-cache',
    },
    runtime: [
      {
        executable: '/tools/node',
        argv: [
          '-p',
          'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})',
        ],
        cwd: '/work',
        cache: '/work/runtime-cache',
      },
      {
        executable: '/usr/local/bin/bun',
        argv: ['--version'],
        cwd: '/work',
        cache: '/work/runtime-cache',
      },
      {
        executable: '/tools/node',
        argv: [...npmPrefix, '--version', '--offline'],
        cwd: '/work',
        cache: '/work/runtime-cache',
      },
    ],
    warmup: {
      executable: '/usr/local/bin/bun',
      argv: [...install, '--registry=http://127.0.0.1:4873'],
      cwd: '/work/warmup/source',
      cache: '/work/bun-seed',
    },
    fresh: {
      executable: '/usr/local/bin/bun',
      argv: [...install],
      cwd: '/work/fresh/source',
      cache: '/work/fresh/bun-cache',
    },
    npm: currentNpmProfiles.map((profile) => ({
      executable: '/tools/node',
      argv: [
        ...npmPrefix,
        'install',
        '--offline',
        '--ignore-scripts',
        '--include=dev',
        '--include=optional',
        '--no-audit',
        '--no-fund',
        '--registry=https://registry.npmjs.org/',
      ],
      cwd: `/work/npm/${profile.id}/source`,
      cache: `/work/npm/${profile.id}/cache`,
    })),
  };
}
export function validateCacheOnlyRuntime(outputs: readonly string[]) {
  function* validate() {
    const Host = Schema.fromJsonString(
      Schema.Struct({
        version: Schema.Literal('v22.23.4'),
        platform: Schema.Literal('linux'),
        arch: Schema.Literal('x64'),
      }),
    );
    const host = yield* Schema.decodeUnknownEffect(Host)(outputs[0]);
    return yield* validateCurrentLinuxRuntime({
      node: host.version.slice(1),
      os: host.platform,
      arch: host.arch,
      bun: outputs[1]?.trim(),
      npm: outputs[2]?.trim(),
    });
  }
  const workflow = Effect.gen(validate);
  return workflow;
}
export function collectCacheOnlyOutput(
  stream: Stream.Stream<Uint8Array, unknown>,
  spent: Ref.Ref<number>,
) {
  function* collect() {
    const chunks: Uint8Array[] = [];
    function* append(bytes: Uint8Array) {
      const fits = yield* Ref.modify(
        spent,
        (total) => [bytes.length <= 1048576 - total, total + bytes.length] as const,
      );
      yield* requireWorker(fits, 'OutputBudgetExceeded');
      chunks.push(new Uint8Array(bytes));
    }
    yield* Stream.runForEach(stream, (bytes) => Effect.gen(() => append(bytes)));
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  const workflow = Effect.gen(collect);
  return workflow;
}
function runChild(command: Command) {
  function* run() {
    const child = yield* ChildProcess.make(command.executable, command.argv, {
      cwd: command.cwd,
      env: {
        HOME: '/work/home',
        XDG_CONFIG_HOME: '/work/home',
        TMPDIR: '/work/tmp',
        PATH: '/tools:/usr/local/bin:/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        CI: '1',
        DO_NOT_TRACK: '1',
        BUN_INSTALL_CACHE_DIR: command.cache,
        npm_config_cache: command.cache,
        npm_config_userconfig: '/work/empty.npmrc',
        npm_config_globalconfig: '/work/empty.npmrc',
        npm_config_ignore_scripts: 'true',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
      extendEnv: false,
      shell: false,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      killSignal: 'SIGKILL',
      forceKillAfter: 0,
    });
    const spent = yield* Ref.make(0);
    const [stdout, , code] = yield* Effect.all(
      [
        collectCacheOnlyOutput(child.stdout, spent),
        collectCacheOnlyOutput(child.stderr, spent),
        child.exitCode,
      ],
      { concurrency: 3 },
    );
    yield* requireWorker(Number(code) === 0, 'CommandFailed');
    return { stdout, outputBytes: yield* Ref.get(spent), exitCode: Number(code) };
  }
  const workflow = Effect.gen(run);
  return workflow.pipe(Effect.timeout('5 minutes'), Effect.scoped);
}
export function withCacheOnlyReplay(
  acquiring: ReturnType<typeof startReplayOn>,
  warmup: ReturnType<typeof warmBunCache>,
) {
  function* run() {
    const replay = yield* Effect.acquireRelease(acquiring, (replay) => replay.stop());
    const result = yield* warmup;
    const requests = yield* replay.snapshotRequests();
    yield* requireWorker(!requests.blocked && !requests.truncated, 'InputChanged');
    return result;
  }
  const workflow = Effect.gen(run);
  return workflow.pipe(Effect.scoped);
}
type OutputMetadata = {
  readonly type: string;
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly nlink: bigint;
};
const isDirectory = Schema.is(Schema.Literal('Directory'));
const isFile = Schema.is(Schema.Literal('File'));
const isBunLock = Schema.is(Schema.Literal('bun.lock'));
export function validateOutputMetadata(info: OutputMetadata) {
  const allowed = ['Directory', 'File', 'SymbolicLink'].includes(info.type);
  const independent = isDirectory(info.type) || info.nlink === 1n;
  const safeOwner = [
    allowed,
    independent,
    info.uid === 1000,
    info.gid === 1000,
    (info.mode & 0o7000) === 0,
  ].every(Boolean);
  const workflow = requireWorker(safeOwner, 'OwnershipRefused');
  return workflow;
}
function inspectOutputTree(root: string) {
  function* inspect() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const pathService = yield* Path.Path;
    const pending = [root];
    let entries = 0;
    while (pending.length > 0) {
      const path = pending.pop()!;
      const info = yield* metadata.lstat(path);
      const Ownership = Schema.Struct({ uid: Schema.Number, gid: Schema.Number });
      const ownership = yield* Schema.decodeUnknownEffect(Ownership)(info);
      yield* validateOutputMetadata({ ...info, ...ownership });
      entries++;
      yield* requireWorker(entries <= 200000, 'OwnershipRefused');
      function* inspectDirectory() {
        for (const name of yield* fs.readDirectory(path)) pending.push(`${path}/${name}`);
      }
      function* inspectLink() {
        const target = yield* fs.readLink(path);
        const lexical = pathService.resolve(pathService.dirname(path), target);
        const resolved = yield* fs.realPath(path);
        yield* requireWorker(
          lexical.startsWith(`${root}/`) && resolved.startsWith(`${root}/`),
          'OwnershipRefused',
        );
      }
      const directory = Effect.gen(inspectDirectory);
      const link = Effect.gen(inspectLink);
      const directoryPresent = Effect.succeed(isDirectory(info.type));
      yield* directory.pipe(Effect.when(directoryPresent));
      const isLink = Schema.is(Schema.Literal('SymbolicLink'));
      const linkPresent = Effect.succeed(isLink(info.type));
      yield* link.pipe(Effect.when(linkPresent));
    }
    return entries;
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
const SourceRecord = Schema.Struct({
  path: Schema.String,
  mode: Schema.Literals(['100644', '100755']),
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1048576 })),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
const SourceInventory = Schema.fromJsonString(
  Schema.Struct({
    source: Schema.Struct({
      revision: Schema.Literal('be0427e2aba2cf951ef4dbbbe9296e307ed41ad3'),
      tree: Schema.Literal('0e3ea1ab2999dbd83cb3a38920cab47b2a02352e'),
    }),
    files: Schema.Array(SourceRecord).check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  }),
);
function readVerifiedSource() {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const text = yield* readBounded('/inputs/source-inventory.json', 2097152);
    yield* requireWorker(
      (yield* sha256(text)) === currentLinuxWorkerPins.sourceInventorySha256,
      'InputChanged',
    );
    const inventory = yield* Schema.decodeUnknownEffect(SourceInventory)(text);
    yield* validateSourceInventory(inventory.files.map(({ path }) => ({ path, kind: 'File' })));
    const files = [];
    let total = 0;
    for (const entry of inventory.files) {
      const path = `/inputs/consumer/${entry.path}`;
      yield* requireWorker((yield* fs.realPath(path)) === path, 'InputChanged');
      const info = yield* metadata.lstat(path);
      const mode = Match.value(entry.mode).pipe(
        Match.when('100755', () => 0o755),
        Match.orElse(() => 0o644),
      );
      const regular = isFile(info.type);
      const matchesRecord = [
        regular,
        info.mode === mode,
        info.size === BigInt(entry.size),
        info.nlink === 1n,
      ].every(Boolean);
      yield* requireWorker(matchesRecord, 'InputChanged');
      const bytes = yield* fs.readFile(path);
      total += bytes.length;
      const actualHash = yield* digestBytes(bytes);
      const contentMatches = [
        total <= 33554432,
        bytes.length === entry.size,
        actualHash === entry.sha256,
      ].every(Boolean);
      yield* requireWorker(contentMatches, 'InputChanged');
      files.push({ ...entry, bytes, permissions: mode });
    }
    const lock = files.find(({ path }) => isBunLock(path));
    yield* requireWorker(lock?.sha256 === currentLinuxWorkerPins.lockSha256, 'InputChanged');
    const pending = ['/inputs/consumer'];
    const observed = new Set<string>();
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const name of yield* fs.readDirectory(directory)) {
        const path = `${directory}/${name}`;
        const info = yield* metadata.lstat(path);
        yield* requireWorker(isFile(info.type) || isDirectory(info.type), 'InputChanged');
        const action = Match.value(info.type).pipe(
          Match.when('Directory', () =>
            Effect.sync(() => {
              pending.push(path);
            }),
          ),
          Match.orElse(() =>
            Effect.sync(() => {
              observed.add(path.slice('/inputs/consumer/'.length));
            }),
          ),
        );
        yield* action;
        yield* requireWorker(pending.length + observed.size <= 20000, 'InputChanged');
      }
    }
    yield* requireWorker(
      observed.size === files.length && files.every(({ path }) => observed.has(path)),
      'InputChanged',
    );
    return files;
  }
  const workflow = Effect.gen(read);
  return workflow;
}
function stageSource(destination: string) {
  function* stage() {
    const files = yield* readVerifiedSource();
    const fs = yield* FileSystem.FileSystem;
    yield* requireWorker(!(yield* fs.exists(destination)), 'InputChanged');
    yield* fs.makeDirectory(destination, { mode: 0o700 });
    for (const file of files) {
      const parent = file.path.split('/').slice(0, -1).join('/');
      yield* fs.makeDirectory(`${destination}/${parent}`, { recursive: true, mode: 0o700 });
      yield* fs.writeFile(`${destination}/${file.path}`, file.bytes, {
        flag: 'wx',
        mode: file.permissions,
      });
      yield* fs.chmod(`${destination}/${file.path}`, file.permissions);
    }
    return files.length;
  }
  const workflow = Effect.gen(stage);
  return workflow;
}
function verifyLock(directory: string) {
  function* verify() {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs.readFile(`${directory}/bun.lock`);
    yield* requireWorker(
      (yield* digestBytes(bytes)) === currentLinuxWorkerPins.lockSha256,
      'InputChanged',
    );
  }
  const workflow = Effect.gen(verify);
  return workflow;
}
export function auditCurrentBunInstallation(directory: string, input: unknown) {
  function* audit() {
    const catalog = yield* fromCurrentBunLock(input);
    const Lock = Schema.Struct({ workspaces: Schema.Record(Schema.String, Schema.Unknown) });
    const lock = yield* Schema.decodeUnknownEffect(Lock)(input);
    const expected = new Set(['']);
    for (const entry of catalog.workspaces) {
      const relative = entry.identity.slice(entry.key.length + '@workspace:'.length);
      expected.add(relative);
      const Workspace = Schema.Struct({ name: Schema.Literal(entry.key) });
      yield* Schema.decodeUnknownEffect(Workspace)(lock.workspaces[relative]);
    }
    const keys = Object.keys(lock.workspaces);
    yield* requireWorker(
      keys.length === expected.size && keys.every((key) => expected.has(key)),
      'InputChanged',
    );
    const result = yield* makeWorkerCases().auditInstalled(directory, {
      ...catalog,
      workspaces: lock.workspaces,
    });
    yield* requireWorker(result.installed.length > 0, 'InputChanged');
    function relative(path: string) {
      return path.slice(directory.length + 1);
    }
    const installed = result.installed.map((entry) => ({
      identity: entry.identity,
      path: relative(entry.path),
    }));
    installed.sort((a, b) => Order.String(a.path, b.path));
    const links = result.links.map((entry) => ({
      path: relative(entry.path),
      target: relative(entry.target),
    }));
    links.sort((a, b) => Order.String(a.path, b.path));
    const direct = result.direct.map((entry) => ({
      identity: entry.identity,
      path: relative(entry.path),
    }));
    direct.sort((a, b) => Order.String(a.path, b.path));
    const normalized = {
      installed,
      links,
      direct,
      exclusions: result.exclusions,
      frozenPlatformExclusions: result.frozenPlatformExclusions,
    };
    return {
      status: 'Checked' as const,
      installedPackages: installed.length,
      directDependencies: direct.length,
      links: links.length,
      exclusions: result.exclusions.length,
      identitiesSha256: yield* sha256(encode(normalized)),
    };
  }
  const workflow = Effect.gen(audit);
  return workflow;
}
const ArtifactInventory = Schema.fromJsonString(
  Schema.Struct({
    artifacts: Schema.Array(
      Schema.Struct({
        identity: Schema.String,
        url: Schema.String,
        path: Schema.String,
        bytes: Schema.Number,
        sha256: Schema.String,
        integrity: Schema.String,
      }),
    ),
  }),
);
function readReplayArtifacts() {
  function* read() {
    const text = yield* readBounded('/inputs/inventory.json', 2097152);
    yield* requireWorker(
      (yield* sha256(text)) === currentArchivePins.inventorySha256,
      'InputChanged',
    );
    const inventory = yield* Schema.decodeUnknownEffect(ArtifactInventory)(text);
    const blobs = new Map<string, Uint8Array>();
    let rawBytes = 0;
    for (const item of inventory.artifacts) {
      yield* requireWorker(/^artifacts\/[0-9]{4}\.tgz$/.test(item.path), 'InputChanged');
      const url = yield* Effect.try(() => new URL(item.url));
      const isRegistry = Schema.is(Schema.Literal('https://registry.npmjs.org'));
      yield* requireWorker(
        isRegistry(url.origin) &&
          item.url === url.origin + url.pathname &&
          !blobs.has(url.pathname),
        'InputChanged',
      );
      const bytes = yield* readCacheBlob(`/inputs/cache/offline/${item.path}`);
      rawBytes += bytes.length;
      const hash = yield* digestBytes(bytes);
      const blobMatches = [
        rawBytes <= 1073741824,
        bytes.length === item.bytes,
        hash === item.sha256,
      ].every(Boolean);
      yield* requireWorker(blobMatches, 'InputChanged');
      blobs.set(url.pathname, bytes);
    }
    return {
      summary: { artifacts: blobs.size, entries: 0, expandedBytes: 0, rawBytes },
      read: (path: string) => blobs.get(path)?.slice(),
    };
  }
  const workflow = Effect.gen(read);
  return workflow;
}
function warmBunCache(command: Command) {
  function* warm() {
    const result = yield* runChild(command);
    yield* verifyLock(command.cwd);
    yield* inspectOutputTree('/work');
    return result;
  }
  const workflow = Effect.gen(warm);
  return workflow;
}
export function runCurrentLinuxCacheOnly(
  progress: Ref.Ref<string>,
  workspace: CurrentLinuxWorkspace,
) {
  function* execute() {
    yield* verifyCurrentLinuxWorkspace(workspace);
    const fs = yield* FileSystem.FileSystem;
    for (const path of ['home', 'tmp', 'warmup', 'fresh', 'npm', 'runtime-cache', 'bun-seed']) {
      yield* fs.makeDirectory(`/work/${path}`, { mode: 0o700 });
    }
    yield* fs.writeFileString('/work/empty.npmrc', '', { flag: 'wx', mode: 0o600 });
    yield* fs.writeFileString('/work/empty.bunfig.toml', 'preload = []\n', {
      flag: 'wx',
      mode: 0o600,
    });
    const commands = currentLinuxWorkerCommands();
    yield* Ref.set(progress, 'RuntimeReadback');
    const readbacks = yield* Effect.forEach(commands.runtime, runChild, { concurrency: 1 });
    const runtime = yield* validateCacheOnlyRuntime(readbacks.map(({ stdout }) => stdout));
    yield* Ref.set(progress, 'SourceWarmup');
    const sourceFiles = yield* stageSource(commands.warmup.cwd);
    yield* Ref.set(progress, 'BunLockReadback');
    yield* requireWorker((yield* fs.readDirectory('/work/home')).length === 0, 'InputChanged');
    const lockReadback = yield* runChild(commands.lockReadback);
    const bunLock = yield* decodeJson(lockReadback.stdout);
    yield* verifyLock(commands.warmup.cwd);
    const artifacts = yield* readReplayArtifacts();
    const replay = startReplayOn(artifacts, makeLoopbackListener(4873));
    yield* Ref.set(progress, 'ReplayWarmup');
    const warmup = yield* withCacheOnlyReplay(replay, warmBunCache(commands.warmup));
    yield* Ref.set(progress, 'WarmupIdentityReadback');
    const warmupIdentities = yield* auditCurrentBunInstallation(commands.warmup.cwd, bunLock);
    yield* Ref.set(progress, 'SealBunCache');
    const seed = yield* sealCache('/work/bun-seed');
    const freshCache = yield* copyCaseCache(seed, commands.fresh.cache);
    yield* admitCaseCache(seed, freshCache);
    yield* stageSource(commands.fresh.cwd);
    yield* Ref.set(progress, 'DefaultRegistryInstall');
    const fresh = yield* runChild(commands.fresh);
    yield* verifyLock(commands.fresh.cwd);
    yield* Ref.set(progress, 'FreshIdentityReadback');
    const freshIdentities = yield* auditCurrentBunInstallation(commands.fresh.cwd, bunLock);
    yield* requireWorker(encode(warmupIdentities) === encode(freshIdentities), 'InputChanged');
    yield* verifySealedCache(seed);
    yield* inspectOutputTree('/work');
    const snapshot = yield* readCurrentNpmSnapshot();
    yield* Ref.set(progress, 'NpmCacheCopy');
    // Never chmod or seal the read-only input cache. Copy regular data first.
    const npmSeedRoot = ['/work', 'npm-seed'].join('/');
    yield* fs.copy('/inputs/cache/offline/npm-cache', npmSeedRoot, {
      overwrite: false,
      preserveTimestamps: false,
    });
    yield* inspectOutputTree(npmSeedRoot);
    const npmSeed = yield* sealCache(npmSeedRoot);
    const profiles = [];
    for (const [index, profile] of currentNpmProfiles.entries()) {
      yield* Ref.set(progress, `NpmInstall:${profile.id}`);
      const command = commands.npm[index]!;
      const parent = `/work/npm/${profile.id}`;
      yield* fs.makeDirectory(parent, { mode: 0o700 });
      yield* fs.makeDirectory(command.cwd, { mode: 0o700 });
      const copy = yield* copyCaseCache(npmSeed, command.cache);
      yield* admitCaseCache(npmSeed, copy);
      const frozen = snapshot.profiles[index]!;
      const selected = yield* fromCurrentNpmLock(frozen.lock, profile);
      yield* fs.writeFileString(`${command.cwd}/package.json`, encode(profile.manifest), {
        flag: 'wx',
        mode: 0o600,
      });
      for (const vendor of profile.vendors) {
        yield* fs.makeDirectory(`${command.cwd}/${vendor.path}`, { recursive: true, mode: 0o700 });
        yield* fs.writeFileString(
          `${command.cwd}/${vendor.path}/package.json`,
          encode(vendor.manifest),
          { flag: 'wx', mode: 0o600 },
        );
      }
      const lockText = encode(frozen.lock);
      yield* fs.writeFileString(`${command.cwd}/package-lock.json`, lockText, {
        flag: 'wx',
        mode: 0o600,
      });
      const result = yield* runChild(command);
      const actualLock = yield* decodeJson(
        yield* readBounded(`${command.cwd}/package-lock.json`, 2097152),
      );
      const actual = yield* fromCurrentNpmLock(actualLock, profile);
      yield* requireWorker(encode(actual) === encode(selected), 'InputChanged');
      for (const entry of selected.selected) {
        const item = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ name: Schema.String, version: Schema.String }),
        )(
          yield* decodeJson(
            yield* readBounded(`${command.cwd}/${entry.key}/package.json`, 1048576),
          ),
        );
        yield* requireWorker(`${item.name}@${item.version}` === entry.identity, 'InputChanged');
      }
      yield* inspectOutputTree('/work');
      yield* verifySealedCache(npmSeed);
      profiles.push({
        id: profile.id,
        selected: selected.selected.length,
        outputBytes: result.outputBytes,
      });
    }
    yield* verifySealedCache(seed);
    yield* Ref.set(progress, 'Evidence');
    const result = {
      status: 'CacheOnlyCompleted',
      activation: 'Blocked',
      qualified: false,
      scripts: 'Disabled',
      acceptance: 'CacheOnlyNotBaselineQualified',
      runtime,
      sourceFiles,
      sourceInventorySha256: currentLinuxWorkerPins.sourceInventorySha256,
      lockSha256: currentLinuxWorkerPins.lockSha256,
      bun: {
        seedSha256: seed.sha256,
        warmupOutputBytes: warmup.outputBytes,
        freshOutputBytes: fresh.outputBytes,
        installedIdentities: { warmup: warmupIdentities, fresh: freshIdentities },
      },
      npm: profiles,
    } as const;
    yield* inspectOutputTree('/work');
    return result;
  }
  const workflow = Effect.gen(execute);
  return workflow.pipe(Effect.timeout('15 minutes'), Effect.scoped);
}
