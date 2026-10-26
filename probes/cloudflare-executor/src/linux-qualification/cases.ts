import {
  Context,
  Data,
  Effect,
  FileSystem,
  Match,
  Option,
  Path,
  Result,
  Schema,
  Stream,
} from 'effect';
import { ChildProcess } from 'effect/process';

import { Header } from '../../node_modules/npm/node_modules/tar/dist/esm/header.js';
import { admitArchives, inspectArchive, archiveLimits } from './archives.ts';
import {
  CacheMetadata,
  admitCaseCache,
  copyCaseCache,
  sealCache,
  verifySealedCache,
  type SealedCache,
} from './cache.ts';
import {
  CaseObservation,
  ControlReadbacks,
  evidenceRequirements,
  requiredCases,
  QualificationReason,
  type QualificationAdmission,
} from './contract.ts';
import { PreparedInputs, SourceDigest } from './prepared-inputs.ts';
import { startReplay } from './registry.ts';
import { inputPins, qualificationInstall } from './tool-pins.ts';

export class WorkerError extends Data.TaggedError('WorkerError')<{
  readonly code: QualificationReason;
  readonly detail?: 'UnexplainedSkip' | 'MissingDirectDependency';
  readonly identity?: string;
}> {}
function presentDiagnostics({ detail, identity }: Pick<WorkerError, 'detail' | 'identity'>) {
  const entries = Object.entries({ detail, identity });
  const present = entries.filter(([, value]) => value !== undefined);
  return Object.fromEntries(present);
}
function requireWorker(
  valid: boolean,
  code: QualificationReason = 'EvidenceIncomplete',
  detail?: WorkerError['detail'],
  identity?: string,
) {
  const diagnostics = presentDiagnostics({ detail, identity });
  const checked = Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new WorkerError({ code, ...diagnostics }),
    ),
    Effect.fromResult,
  );
  return checked;
}
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const utf8 = (value: string) => new TextEncoder().encode(value);
const same = (left: unknown, right: unknown) => encode(left) === encode(right);
const within = (root: string, path: string) => path === root || path.startsWith(`${root}/`);
const dotSegment = Schema.is(Schema.Literals(['.', '..']));
const safeRelative = (path: string) =>
  path.length > 0 &&
  path.length <= 512 &&
  path.split('/').every((part) => /^[A-Za-z0-9_@.+[\]-]+$/.test(part) && !dotSegment(part));
const isFile = Schema.is(Schema.Literal('File'));
const isDirectory = Schema.is(Schema.Literal('Directory'));
const isNodeModules = Schema.is(Schema.Literal('node_modules'));
const isLock = Schema.is(Schema.Literal('bun.lock'));
const unexplained = Schema.is(Schema.Literal('Unexplained'));
const isString = Schema.is(Schema.String);
const archiveRefused = Schema.is(Schema.Struct({ code: Schema.Literal('ArchiveRefused') }));
const inputChanged = Schema.is(Schema.Struct({ code: Schema.Literal('InputChanged') }));
const isArchiveLink = Schema.is(Schema.Literals(['SymbolicLink', 'Link']));
const decodeRefusal = Schema.decodeUnknownResult(
  Schema.Struct({
    code: QualificationReason,
    detail: Schema.optionalKey(Schema.Literals(['UnexplainedSkip', 'MissingDirectDependency'])),
    identity: Schema.optionalKey(Schema.String),
  }),
);
const NodeIdentity = Schema.Struct({
  node: Schema.Literal('22.23.4'),
  os: Schema.Literal('linux'),
  architecture: Schema.Literal('x64'),
  libc: Schema.String.check(Schema.isMinLength(1)),
});
const decodeNodeIdentity = Schema.decodeUnknownEffect(Schema.fromJsonString(NodeIdentity));
const installerVersion = Schema.is(Schema.Literal('1.3.11'));
function refusalReason(error: unknown) {
  return Result.match(decodeRefusal(error), {
    onSuccess: (value) => value.code,
    onFailure: () => 'EvidenceIncomplete' as const,
  });
}
function refusalDiagnostic(error: unknown) {
  return Result.match(decodeRefusal(error), {
    onSuccess: (value) => value,
    onFailure: () => ({
      code: 'EvidenceIncomplete' as const,
      detail: undefined,
      identity: undefined,
    }),
  });
}
const expected = {
  RuntimeIsolationPreflight: ['Preflight', 'Verified'],
  ArchiveAdmissionNegatives: ['Admission', 'ArchiveRefused'],
  ScriptCanaries: ['Canaries', 'ScriptsSuppressed'],
  Warmup: ['Warmup', 'CacheMaterialized'],
  FreshPositive: ['Offline', 'InstalledFromCache'],
  EmptyCache: ['Offline', 'EmptyCacheRefused'],
  MissingRequiredArtifact: ['Offline', 'MissingArtifactRefused'],
  CorruptCacheContent: ['Admission', 'CacheIntegrityRefused'],
  CaseIsolation: ['Isolation', 'CopiesIsolated'],
  CancellationDeadline: ['Cleanup', 'CancellationConfirmed'],
} as const;
type CaseId = CaseObservation['caseId'];
export type WorkerCommand = {
  readonly kind: 'Install' | 'BunVersion' | 'BunHelp' | 'NodeIdentity';
  readonly workspace: string;
  readonly home: string;
  readonly tmp: string;
  readonly cache: string;
};
export const workerTools = { bun: '/usr/local/bin/bun', node: '/tools/node' } as const;
const nodeIdentityProgram = [
  'console.log(JSON.stringify({node:process.versions.node,os:process.platform,',
  'architecture:process.arch,libc:process.report.getReport().header.glibcVersionRuntime}))',
].join('');
export function commandSpec(command: WorkerCommand) {
  const invocation = Match.value(command.kind).pipe(
    Match.when('Install', () => ({
      executable: workerTools.bun,
      args: qualificationInstall.argv.slice(1),
    })),
    Match.when('BunVersion', () => ({ executable: workerTools.bun, args: ['--version'] })),
    Match.when('BunHelp', () => ({ executable: workerTools.bun, args: ['install', '--help'] })),
    Match.when('NodeIdentity', () => ({
      executable: workerTools.node,
      args: ['--input-type=module', '--eval', nodeIdentityProgram],
    })),
    Match.exhaustive,
  );
  return {
    ...invocation,
    cwd: command.workspace,
    env: {
      HOME: command.home,
      TMPDIR: command.tmp,
      BUN_INSTALL_CACHE_DIR: command.cache,
      PATH: '/tools:/usr/local/bin',
      LANG: 'C',
      LC_ALL: 'C',
    },
  };
}
function collect(stream: Stream.Stream<Uint8Array, unknown>) {
  function* read() {
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    function* append(chunk: Uint8Array) {
      yield* requireWorker(chunk.length <= 262144 - bytes);
      chunks.push(chunk);
      bytes += chunk.length;
    }
    yield* Stream.runForEach(stream, (chunk) => Effect.gen(() => append(chunk)));
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(output);
  }
  const workflow = Effect.gen(read);
  return workflow;
}
export function makeWorkerProcess() {
  function run(command: WorkerCommand) {
    function* execute() {
      const spec = commandSpec(command);
      const fs = yield* FileSystem.FileSystem;
      const paths = [command.workspace, command.home, command.tmp, command.cache];
      yield* requireWorker(new Set(paths).size === paths.length, 'InputChanged');
      for (const path of paths)
        yield* requireWorker((yield* fs.realPath(path)) === path, 'InputChanged');
      const child = yield* ChildProcess.make(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        extendEnv: false,
        shell: false,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        killSignal: 'SIGKILL',
        forceKillAfter: 0,
      });
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [collect(child.stdout), collect(child.stderr), child.exitCode],
        { concurrency: 3 },
      );
      return { stdout, stderr, exitCode: Number(exitCode) };
    }
    const workflow = Effect.gen(execute);
    const bounded = workflow.pipe(Effect.timeout(90000));
    const scoped = Effect.scoped(bounded);
    return scoped;
  }
  return { run };
}
export class WorkerProcess extends Context.Service<
  WorkerProcess,
  ReturnType<typeof makeWorkerProcess>
>()('ceirean/WorkerProcess') {}

// These are trusted in-process ports, never deserialized capabilities. Task 6 owns
// measured controls, observer acquisition/admission and owned-resource supervision.
export function makeWorkerPlatform() {
  function preflight(_inputs: PreparedInputs) {
    const refused = Effect.fail(new WorkerError({ code: 'BlockedControls' }));
    const decoding = Schema.decodeUnknownEffect(ControlReadbacks.members[1])(undefined);
    const workflow = refused.pipe(Effect.andThen(decoding));
    return workflow;
  }
  function admitChildObservation() {
    const refused = Effect.fail(new WorkerError({ code: 'BlockedChildObservation' }));
    const workflow = refused.pipe(Effect.asVoid);
    return workflow;
  }
  function observe(command: WorkerCommand) {
    function* execute() {
      yield* admitChildObservation();
      const process = yield* WorkerProcess;
      const result = yield* process.run(command);
      return {
        ...result,
        complete: false,
        executions: [] as readonly string[],
        nativeExecutions: [] as readonly string[],
      };
    }
    const workflow = Effect.gen(execute);
    return workflow;
  }
  function cancellation() {
    const refused = Effect.fail(new WorkerError({ code: 'CleanupUnknown' }));
    const workflow = refused.pipe(
      Effect.map(() => ({
        deadlineStoppedOwnedResources: false,
        interruptedWarmupStopped: false,
        removalConfirmed: false,
      })),
    );
    return workflow;
  }
  return { preflight, admitChildObservation, observe, cancellation };
}
export class WorkerPlatform extends Context.Service<
  WorkerPlatform,
  ReturnType<typeof makeWorkerPlatform>
>()('ceirean/WorkerPlatform') {}
export function makeWorkerArchives() {
  return { admitArchives, startReplay, negatives: archiveNegatives };
}
export class WorkerArchives extends Context.Service<
  WorkerArchives,
  ReturnType<typeof makeWorkerArchives>
>()('ceirean/WorkerArchives') {}

function hash(bytes: Uint8Array) {
  const hashing = Effect.tryPromise({
    try: async () =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join(''),
    catch: () => new WorkerError({ code: 'InputChanged' }),
  });
  return hashing;
}
function boundedFile(path: string, maximum = 1048576) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const info = yield* metadata.lstat(path);
    yield* requireWorker(
      isFile(info.type) && info.size >= 0n && info.size <= BigInt(maximum),
      'InputChanged',
    );
    const file = yield* fs.open(path, { flag: 'r', noFollow: true });
    const stat = yield* file.stat;
    yield* requireWorker(
      stat.size === info.size && stat.dev === info.dev && Option.contains(info.ino)(stat.ino),
      'InputChanged',
    );
    const bytes = new Uint8Array(Number(info.size));
    let offset = 0;
    const more = () => offset < bytes.length;
    while (more()) {
      const part = yield* file.readAlloc(Math.min(65536, bytes.length - offset));
      yield* requireWorker(Option.isSome(part) && part.value.length > 0, 'InputChanged');
      const data = yield* Effect.fromOption(part);
      bytes.set(data, offset);
      offset += data.length;
    }
    const tail = yield* file.readAlloc(1);
    yield* requireWorker(Option.isNone(tail), 'InputChanged');
    const after = yield* metadata.lstat(path);
    const unchanged = [
      after.ino === info.ino,
      after.dev === info.dev,
      after.size === info.size,
      after.mode === info.mode,
    ].every(Boolean);
    yield* requireWorker(unchanged, 'InputChanged');
    return bytes;
  }
  const workflow = Effect.gen(read);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
function readJson(path: string) {
  const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
  function decode(bytes: Uint8Array) {
    return decodeJson(new TextDecoder().decode(bytes));
  }
  const workflow = boundedFile(path).pipe(Effect.flatMap(decode));
  return workflow;
}
const Dependencies = Schema.Record(Schema.String, Schema.String);
const Workspace = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  dependencies: Schema.optionalKey(Dependencies),
  devDependencies: Schema.optionalKey(Dependencies),
  optionalDependencies: Schema.optionalKey(Dependencies),
});
const Constraints = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const Metadata = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  os: Schema.optionalKey(Constraints),
  cpu: Schema.optionalKey(Constraints),
  libc: Schema.optionalKey(Constraints),
  dependencies: Schema.optionalKey(Dependencies),
  optionalDependencies: Schema.optionalKey(Dependencies),
});
const decodeMetadata = Schema.decodeUnknownEffect(Metadata);
const CatalogEntry = Schema.Struct({
  key: Schema.String,
  identity: Schema.String,
  name: Schema.String,
  version: Schema.String,
  constraints: Schema.Struct({
    os: Schema.Array(Schema.String),
    cpu: Schema.Array(Schema.String),
    libc: Schema.Array(Schema.String),
  }),
});
const Catalog = Schema.Struct({
  bun: Schema.Struct({
    selected: Schema.Array(CatalogEntry),
    excluded: Schema.Array(CatalogEntry),
    workspaces: Schema.Array(Schema.Struct({ key: Schema.String, identity: Schema.String })),
  }),
});
const AuditInput = Schema.Struct({
  selected: Schema.Array(CatalogEntry),
  excluded: Schema.Array(CatalogEntry),
  workspaces: Schema.Record(Schema.String, Workspace),
});
function platformFits(parts: string | readonly string[] | undefined, target: string) {
  const values = Match.value(parts).pipe(
    Match.when(isString, (part) => [part]),
    Match.orElse((part) => part ?? []),
  );
  return (
    !values.includes(`!${target}`) &&
    (values.filter((part) => !part.startsWith('!')).length === 0 || values.includes(target))
  );
}
function metadataFits(value: {
  readonly os?: string | readonly string[];
  readonly cpu?: string | readonly string[];
  readonly libc?: string | readonly string[];
}) {
  return (
    platformFits(value.os, 'linux') &&
    platformFits(value.cpu, 'x64') &&
    platformFits(value.libc, 'glibc')
  );
}
export function makeWorkerCatalog() {
  function read(inputs: PreparedInputs) {
    function* load() {
      const bytes = yield* boundedFile(`${inputs.root}/${inputs.catalog.path}`, 2097152);
      yield* requireWorker(
        (yield* hash(bytes)) === inputPins.inventorySha256 &&
          inputs.catalog.sha256 === inputPins.inventorySha256,
        'InputChanged',
      );
      const decodeCatalog = Schema.decodeUnknownEffect(Schema.fromJsonString(Catalog));
      const { bun } = yield* decodeCatalog(new TextDecoder().decode(bytes));
      const workspaces: Record<string, typeof Workspace.Type> = {};
      workspaces[''] = yield* Schema.decodeUnknownEffect(Workspace)(
        yield* readJson(`${inputs.root}/source/package.json`),
      );
      for (const entry of bun.workspaces) {
        const split = entry.identity.indexOf('@workspace:');
        const relative = entry.identity.slice(split + 11);
        yield* requireWorker(split > 0 && safeRelative(relative), 'InputChanged');
        const item = yield* Schema.decodeUnknownEffect(Workspace)(
          yield* readJson(`${inputs.root}/source/${relative}/package.json`),
        );
        yield* requireWorker(
          item.name === entry.key && entry.identity.slice(0, split) === item.name,
          'InputChanged',
        );
        workspaces[relative] = item;
      }
      return { ...bun, workspaces };
    }
    const workflow = Effect.gen(load);
    return workflow;
  }
  return { read };
}
export class WorkerCatalog extends Context.Service<
  WorkerCatalog,
  ReturnType<typeof makeWorkerCatalog>
>()('ceirean/WorkerCatalog') {}
function auditInstalled(workspace: string, input: unknown) {
  function* audit() {
    const lock = yield* Schema.decodeUnknownEffect(AuditInput)(input);
    const registry = lock.selected;
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const paths = yield* Path.Path;
    const installed: { identity: string; path: string }[] = [];
    const links: { path: string; target: string }[] = [];
    const pending = Object.keys(lock.workspaces).map((path) =>
      paths.resolve(workspace, path, 'node_modules'),
    );
    const visited = new Set<string>();
    const optionalNames = new Set(
      Object.values(lock.workspaces).flatMap((entry) =>
        Object.keys(entry.optionalDependencies ?? {}),
      ),
    );
    const requiredNames = new Set<string>();
    let count = 0;
    function inspectPackage(path: string) {
      function* inspect() {
        const item = yield* decodeMetadata(yield* readJson(`${path}/package.json`));
        const identity = `${item.name}@${item.version}`;
        yield* requireWorker(
          registry.some((candidate) => candidate.identity === identity) && metadataFits(item),
        );
        installed.push({ identity, path });
        for (const name of Object.keys(item.optionalDependencies ?? {})) optionalNames.add(name);
        for (const name of Object.keys(item.dependencies ?? {}).filter(
          (name) => !(name in (item.optionalDependencies ?? {})),
        ))
          requiredNames.add(name);
        pending.push(`${path}/node_modules`);
      }
      const workflow = Effect.gen(inspect);
      return workflow;
    }
    function inspectDirectory(path: string) {
      function* inspect() {
        const hasPackage = yield* fs.exists(`${path}/package.json`);
        const descend = Effect.sync(() => {
          pending.push(path);
        });
        const reading = Match.value(hasPackage).pipe(
          Match.when(true, () => inspectPackage(path)),
          Match.orElse(() => descend),
        );
        yield* reading;
      }
      const workflow = Effect.gen(inspect);
      return workflow;
    }
    function inspectLink(root: string, name: string, path: string) {
      function* inspect() {
        const target = yield* fs.realPath(path);
        yield* requireWorker(within(workspace, target));
        const workspaceEntry = Object.entries(lock.workspaces).find(
          ([relative]) => `${workspace}/${relative}` === target,
        );
        const registryLink = !root.endsWith('/.bin') && workspaceEntry === undefined;
        const readingRegistryLink = inspectPackage(target);
        const registryLinkCheck = Effect.sync(() => registryLink);
        const readWhenRegistry = readingRegistryLink.pipe(Effect.when(registryLinkCheck));
        yield* readWhenRegistry;
        for (const [, entry] of [workspaceEntry].filter((value) => value !== undefined)) {
          const item = yield* Schema.decodeUnknownEffect(Workspace)(
            yield* readJson(`${target}/package.json`),
          );
          yield* requireWorker(item.name === entry.name && name === item.name?.split('/').at(-1));
        }
        links.push({ path, target });
      }
      const workflow = Effect.gen(inspect);
      return workflow;
    }
    function readModuleDirectory(path: string) {
      function* read() {
        const info = yield* metadata.lstat(path);
        yield* requireWorker(isDirectory(info.type) && (yield* fs.realPath(path)) === path);
        return yield* fs.readDirectory(path);
      }
      const workflow = Effect.gen(read);
      return workflow;
    }
    function resolveDirect(relative: string, name: string) {
      function* resolve() {
        yield* requireWorker(safeRelative(name));
        const candidates: string[] = [];
        let owner = paths.resolve(workspace, relative);
        while (within(workspace, owner)) {
          candidates.push(`${owner}/node_modules/${name}`);
          owner = paths.dirname(owner);
        }
        const exists = yield* Effect.forEach(candidates, (candidate) =>
          fs.exists(`${candidate}/package.json`),
        );
        const found = candidates.find((_, index) => exists[index]);
        yield* requireWorker(
          found !== undefined,
          'EvidenceIncomplete',
          'MissingDirectDependency',
          name,
        );
        const target = yield* fs.realPath(found!);
        yield* requireWorker(within(workspace, target));
        return target;
      }
      const workflow = Effect.gen(resolve);
      return workflow;
    }
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const root of [directory].filter(() => !visited.has(directory))) {
        visited.add(root);
        const exists = yield* fs.exists(root);
        const names = yield* Match.value(exists).pipe(
          Match.when(true, () => readModuleDirectory(root)),
          Match.orElse(() => Effect.succeed([] as string[])),
        );
        for (const name of names) {
          yield* requireWorker(++count <= 200000 && safeRelative(name));
          const path = `${root}/${name}`;
          const info = yield* metadata.lstat(path);
          const action = Match.value(info.type).pipe(
            Match.when('Directory', () => inspectDirectory(path)),
            Match.when('SymbolicLink', () => inspectLink(root, name, path)),
            Match.when('File', () => requireWorker(name.startsWith('.'))),
            Match.orElse(() => Effect.fail(new WorkerError({ code: 'EvidenceIncomplete' }))),
          );
          yield* action;
        }
      }
    }
    const direct = [];
    for (const [relative, value] of Object.entries(lock.workspaces)) {
      const dependencies = { ...value.dependencies, ...value.devDependencies };
      for (const name of Object.keys(dependencies).filter(
        (key) => !(key in (value.optionalDependencies ?? {})),
      )) {
        const local = Object.entries(lock.workspaces).find(([, entry]) => entry.name === name);
        const candidates = registry.filter(
          (entry) => entry.key === name || entry.key === `${relative}/${name}`,
        );
        const target = yield* resolveDirect(relative, name);
        const observed = installed.find(
          (item) =>
            item.path === target && candidates.some((entry) => entry.identity === item.identity),
        );
        const localLinked =
          local !== undefined &&
          target === paths.resolve(workspace, local[0]) &&
          links.some((link) => link.target === target);
        yield* requireWorker(localLinked || observed !== undefined);
        for (const item of [observed].filter((entry) => entry !== undefined)) {
          direct.push(item);
          requiredNames.add(name);
        }
      }
    }
    for (const name of requiredNames)
      yield* requireWorker(
        installed.some((item) =>
          registry.some((entry) => entry.name === name && entry.identity === item.identity),
        ),
      );
    const exclusions = [];
    for (const candidate of registry.filter(
      (entry) => !installed.some((item) => item.identity === entry.identity),
    )) {
      const reason = Match.value({
        fits: metadataFits(candidate.constraints),
        optional: optionalNames.has(candidate.name) && !requiredNames.has(candidate.name),
        excludedParent: lock.excluded.some(
          (entry) => !metadataFits(entry.constraints) && candidate.key.startsWith(`${entry.key}/`),
        ),
      }).pipe(
        Match.when({ fits: false }, () => 'PlatformExcluded'),
        Match.when({ optional: true }, () => 'OptionalNotSelected'),
        Match.when({ excludedParent: true }, () => 'ExcludedParent'),
        Match.orElse(() => 'Unexplained'),
      );
      yield* requireWorker(
        !unexplained(reason),
        'EvidenceIncomplete',
        'UnexplainedSkip',
        candidate.identity,
      );
      exclusions.push({
        key: candidate.key,
        identity: candidate.identity,
        reason,
        constraints: candidate.constraints,
      });
    }
    return { installed, links, direct, exclusions, frozenPlatformExclusions: lock.excluded };
  }
  const workflow = Effect.gen(audit);
  return workflow;
}

function sourceSnapshot(inputs: PreparedInputs, root: string, installed = false) {
  function* inspect() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const files: (typeof SourceDigest.Type)[] = [];
    const found: string[] = [];
    const pending = [''];
    while (pending.length > 0) {
      const parent = pending.pop()!;
      for (const name of yield* fs.readDirectory(`${root}/${parent}`)) {
        const relative = `${parent}${name}`;
        yield* requireWorker(safeRelative(relative) && found.length < 20000, 'InputChanged');
        const info = yield* metadata.lstat(`${root}/${relative}`);
        const skip = installed && isNodeModules(name) && isDirectory(info.type);
        const checking = Match.value({ skip, type: info.type }).pipe(
          Match.when({ skip: true }, () => Effect.void),
          Match.when({ type: 'Directory' }, () =>
            Effect.sync(() => {
              pending.push(`${relative}/`);
            }),
          ),
          Match.when({ type: 'File' }, () =>
            Effect.sync(() => {
              found.push(relative);
            }),
          ),
          Match.orElse(() => Effect.fail(new WorkerError({ code: 'InputChanged' }))),
        );
        yield* checking;
      }
    }
    const expectedPaths = inputs.source.files.map((file) => file.path);
    found.sort();
    expectedPaths.sort();
    yield* requireWorker(same(found, expectedPaths), 'InputChanged');
    for (const expectedFile of inputs.source.files) {
      const bytes = yield* boundedFile(`${root}/${expectedFile.path}`);
      const info = yield* metadata.lstat(`${root}/${expectedFile.path}`);
      const sha256 = yield* hash(bytes);
      const expectedMode = Number.parseInt(expectedFile.mode, 8) % 0o1000;
      const unchanged = [
        sha256 === expectedFile.sha256,
        bytes.length === expectedFile.size,
        info.mode === expectedMode,
      ].every(Boolean);
      yield* requireWorker(unchanged, 'InputChanged');
      files.push({ ...expectedFile, sha256, size: bytes.length });
    }
    const encoded = utf8(encode(files));
    const sha256 = yield* hash(encoded);
    const lock = files.find((file) => isLock(file.path));
    const admitted = [
      sha256 === inputs.source.sha256,
      sha256 === inputs.admission.source.sha256,
      lock?.sha256 === inputPins.lockSha256,
    ].every(Boolean);
    yield* requireWorker(admitted, 'InputChanged');
    return { source: sha256, lock: lock!.sha256 };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
function freshCase(parent: string, id: string, inputs?: PreparedInputs) {
  function* create() {
    const fs = yield* FileSystem.FileSystem;
    const root = `${parent}/${id}`;
    yield* requireWorker(!(yield* fs.exists(root)), 'InputChanged');
    for (const path of [root, `${root}/workspace`, `${root}/home`, `${root}/tmp`])
      yield* fs.makeDirectory(path, { mode: 0o700 });
    for (const prepared of [inputs].filter((value) => value !== undefined)) {
      for (const file of prepared.source.files) {
        yield* requireWorker(
          safeRelative(file.path) && !file.path.split('/').some(isNodeModules),
          'InputChanged',
        );
        const destination = `${root}/workspace/${file.path}`;
        const parentDirectory = destination.slice(0, destination.lastIndexOf('/'));
        yield* fs.makeDirectory(parentDirectory, {
          recursive: true,
        });
        yield* fs.writeFile(
          destination,
          yield* boundedFile(`${prepared.root}/source/${file.path}`),
          { flag: 'wx' },
        );
        yield* fs.chmod(destination, Number.parseInt(file.mode, 8) % 0o1000);
      }
      yield* sourceSnapshot(prepared, `${root}/workspace`);
    }
    return {
      kind: 'Install' as const,
      workspace: `${root}/workspace`,
      home: `${root}/home`,
      tmp: `${root}/tmp`,
      cache: `${root}/cache`,
    };
  }
  const workflow = Effect.gen(create);
  return workflow;
}
function checkObserved(
  result: Effect.Success<ReturnType<ReturnType<typeof makeWorkerPlatform>['observe']>>,
) {
  const valid = [
    result.complete,
    result.executions.length === 1,
    result.executions[0] === workerTools.bun,
    result.nativeExecutions.length === 0,
  ].every(Boolean);
  const checked = requireWorker(valid, 'BlockedChildObservation');
  return checked;
}
export function classifyCacheFailure(
  result: { exitCode: number; stderr: string },
  identity?: string,
) {
  // Bun's absence diagnostics must identify the requested artifact, not ENOENT,
  // a loader/flag error, or an arbitrary nonzero exit. Runtime proof is still open.
  const knownMiss =
    /(?:ConnectionRefused|ECONNREFUSED|FailedToOpenSocket|failed to connect|cache miss)/i.test(
      result.stderr,
    );
  const relevant = Match.value(identity).pipe(
    Match.when(isString, identifiesMissingArtifact),
    Match.orElse(() => /(?:https?:\/\/127\.0\.0\.1:4873|127\.0\.0\.1:4873)/.test(result.stderr)),
  );
  function identifiesMissingArtifact(value: string) {
    const split = value.lastIndexOf('@');
    const name = value.slice(0, split);
    const version = value.slice(split + 1);
    const basename = name.split('/').at(-1);
    return result.stderr.includes(`http://127.0.0.1:4873/${name}/-/${basename}-${version}.tgz`);
  }
  return (
    result.exitCode !== 0 &&
    knownMiss &&
    relevant &&
    !/(?:error while loading shared libraries|unknown option|command not found)/i.test(
      result.stderr,
    )
  );
}

// Synthetic archives are constructed, not extracted. The reviewed streaming
// parser is the oracle. No filesystem writes or third-party package code run.
function archiveFixture(path: string, type = 'File', size = 0) {
  const bytes = new Uint8Array(1536);
  const linkpath = Match.value(type).pipe(
    Match.when(isArchiveLink, () => '../../escape'),
    Match.orElse(() => ''),
  );
  const header = new Header({
    path,
    type,
    size,
    mode: 0o644,
    uid: 0,
    gid: 0,
    uname: '',
    gname: '',
    linkpath,
  });
  const block = Buffer.alloc(512);
  header.encode(block);
  bytes.set(block);
  return bytes;
}
async function compressedFixture(raw: Uint8Array) {
  const body = new Blob([new Uint8Array(raw)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(body).arrayBuffer());
}
function compressFixture(raw: Uint8Array) {
  const workflow = Effect.tryPromise({
    try: () => compressedFixture(raw),
    catch: () => new WorkerError({ code: 'ArchiveRefused' }),
  });
  return workflow;
}
function archiveNegatives() {
  function* check() {
    const control = yield* compressFixture(archiveFixture('package/control'));
    yield* inspectArchive([control], control.length);
    const malformed = archiveFixture('package/a');
    malformed[0] = 1;
    const duplicate = new Uint8Array(2048);
    duplicate.set(archiveFixture('package/a').subarray(0, 512));
    duplicate.set(archiveFixture('package/a'), 512);
    const fixtures = [
      archiveFixture('../escape'),
      archiveFixture('package/link', 'SymbolicLink'),
      archiveFixture('package/link', 'Link'),
      duplicate,
      malformed,
      archiveFixture('package/bomb', 'File', 1024),
    ];
    for (const raw of fixtures) {
      const compressed = yield* compressFixture(raw);
      const result = yield* inspectArchive([compressed], compressed.length, {
        ...archiveLimits,
        expandedEntryBytes: 512,
      }).pipe(Effect.result);
      yield* requireWorker(Result.isFailure(result) && archiveRefused(result.failure));
    }
    return { controlAdmitted: true, refused: fixtures.length };
  }
  const workflow = Effect.gen(check);
  return workflow;
}

export function makeWorkerCases() {
  function runWorkerCases(inputs: PreparedInputs) {
    function* run() {
      const platform = yield* WorkerPlatform;
      const processes = yield* WorkerProcess;
      const archives = yield* WorkerArchives;
      const catalog = yield* WorkerCatalog;
      const fs = yield* FileSystem.FileSystem;
      const observations: CaseObservation[] = [];
      const cleanupStatus = { failed: false };
      let current: CaseId = requiredCases[0];
      let readbacks: CaseObservation['readbacks'] = { _tag: 'Unknown' };
      let seed: SealedCache | undefined;
      let seedAdmission: QualificationAdmission['seed'] | undefined;
      let replay: Effect.Success<ReturnType<typeof startReplay>> | undefined;
      let digests: CaseObservation['digests'] = { _tag: 'Unknown' };
      const evidence: {
        caseId: CaseId;
        checks: readonly string[];
        observation: CaseObservation;
        details: unknown;
      }[] = [];
      const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-worker-cases-' });
      const parent = yield* fs.realPath(scratch);
      // Task 6 still owns namespace/container removal. Restore owned seed directory
      // permissions for scoped filesystem cleanup even when a later case refuses.
      function restoreDirectories() {
        function* restore() {
          const pending = [parent];
          const metadata = yield* CacheMetadata;
          while (pending.length > 0) {
            const path = pending.pop()!;
            yield* fs.chmod(path, 0o700);
            for (const name of yield* fs.readDirectory(path)) {
              const child = `${path}/${name}`;
              const info = yield* metadata.lstat(child);
              pending.push(...[child].filter(() => isDirectory(info.type)));
            }
          }
        }
        const workflow = Effect.gen(restore);
        const restoring = workflow.pipe(Effect.result);
        const checked = restoring.pipe(
          Effect.map((result) => {
            cleanupStatus.failed = cleanupStatus.failed || Result.isFailure(result);
          }),
        );
        return checked;
      }
      yield* Effect.addFinalizer(restoreDirectories);
      function record(details: unknown = {}) {
        const [stage, reason] = expected[current];
        const observation = CaseObservation.make({
          caseId: current,
          stage,
          reason,
          outcome: 'Passed',
          evidence: [evidenceRequirements[current].name],
          readbacks,
          digests,
        });
        observations.push(observation);
        evidence.push({
          caseId: current,
          checks: evidenceRequirements[current].checks,
          observation,
          details,
        });
      }
      function execute(command: WorkerCommand) {
        function* install() {
          const result = yield* platform.observe(command);
          yield* checkObserved(result);
          return result;
        }
        const workflow = Effect.gen(install);
        return workflow;
      }
      function snapshot(root: string) {
        function* inspect() {
          const source = yield* sourceSnapshot(inputs, root, true);
          const after = yield* verifySealedCache(seed!);
          digests = {
            _tag: 'Recorded',
            sourceBefore: source.source,
            sourceAfter: source.source,
            lockBefore: source.lock,
            lockAfter: source.lock,
            seedBefore: seed!.sha256,
            seedAfter: after.sha256,
            harnessSha256: inputs.admission.request.harnessSha256,
            toolCapsuleSha256: inputs.admission.request.toolCapsuleSha256,
          };
        }
        const workflow = Effect.gen(inspect);
        return workflow;
      }
      function offline(id: string) {
        function* prepare() {
          const command = yield* freshCase(parent, id, inputs);
          const cache = yield* copyCaseCache(seed!, command.cache);
          yield* admitCaseCache(seed!, cache);
          return { command, cache };
        }
        const workflow = Effect.gen(prepare);
        return workflow;
      }
      function* cases() {
        readbacks = yield* platform.preflight(inputs);
        yield* Schema.decodeUnknownEffect(ControlReadbacks.members[1])(readbacks);
        const runtime = yield* freshCase(parent, 'runtime');
        yield* fs.makeDirectory(runtime.cache);
        const bun = yield* processes.run({ ...runtime, kind: 'BunVersion' });
        const help = yield* processes.run({ ...runtime, kind: 'BunHelp' });
        const node = yield* processes.run({ ...runtime, kind: 'NodeIdentity' });
        const runtimeValid = [
          bun.exitCode === 0,
          installerVersion(bun.stdout.trim()),
          help.exitCode === 0,
          node.exitCode === 0,
        ].every(Boolean);
        const flagsSupported = [
          '--frozen-lockfile',
          '--ignore-scripts',
          '--backend',
          '--registry',
        ].every((flag) => help.stdout.includes(flag));
        yield* requireWorker(runtimeValid && flagsSupported, 'BlockedRuntime');
        const nodeReading = decodeNodeIdentity(node.stdout.trim());
        const checkedNode = nodeReading.pipe(
          Effect.mapError(() => new WorkerError({ code: 'BlockedRuntime' })),
        );
        yield* checkedNode;
        record({ bun: bun.stdout.trim(), node: node.stdout.trim() });
        current = 'ArchiveAdmissionNegatives';
        yield* archives.negatives();
        const admitted = yield* archives.admitArchives(inputs);
        record();
        current = 'ScriptCanaries';
        yield* platform.admitChildObservation();
        const canary = yield* freshCase(parent, 'canaries');
        yield* fs.makeDirectory(canary.cache);
        yield* fs.makeDirectory(`${canary.workspace}/dependency`);
        const scripts = (marker: string) => ({
          preinstall: `echo forbidden > ${marker}`,
          install: `echo forbidden > ${marker}`,
          postinstall: `echo forbidden > ${marker}`,
        });
        yield* fs.writeFileString(
          `${canary.workspace}/package.json`,
          encode({
            name: 'owned-canary-root',
            version: '1.0.0',
            workspaces: ['dependency'],
            trustedDependencies: ['owned-canary-dependency'],
            dependencies: { 'owned-canary-dependency': 'workspace:*' },
            scripts: scripts('root-marker'),
          }),
        );
        yield* fs.writeFileString(
          `${canary.workspace}/dependency/package.json`,
          encode({
            name: 'owned-canary-dependency',
            version: '1.0.0',
            scripts: scripts('../dependency-marker'),
          }),
        );
        // Generate the owned fixture lock with the same fixed frozen invocation:
        // a reviewed fixture lock is staged explicitly, never resolved from a registry.
        yield* fs.writeFileString(
          `${canary.workspace}/bun.lock`,
          encode({
            lockfileVersion: 1,
            configVersion: 1,
            workspaces: {
              '': {
                name: 'owned-canary-root',
                dependencies: { 'owned-canary-dependency': 'workspace:*' },
              },
              dependency: { name: 'owned-canary-dependency', version: '1.0.0' },
            },
            packages: {
              'owned-canary-dependency': ['owned-canary-dependency@workspace:dependency'],
            },
          }),
        );
        const canaryResult = yield* execute(canary);
        yield* requireWorker(
          canaryResult.exitCode === 0 &&
            !(yield* fs.exists(`${canary.workspace}/root-marker`)) &&
            !(yield* fs.exists(`${canary.workspace}/dependency-marker`)),
          'BlockedChildObservation',
        );
        record();
        current = 'Warmup';
        const before = yield* sourceSnapshot(inputs, `${inputs.root}/source`);
        const lock = yield* catalog.read(inputs);
        const warmup = yield* freshCase(parent, 'warmup', inputs);
        yield* fs.makeDirectory(warmup.cache);
        replay = yield* archives.startReplay(admitted);
        const warmed = yield* execute(warmup);
        const requests = yield* replay.snapshotRequests();
        yield* requireWorker(!requests.blocked && !requests.truncated, 'BlockedMissingBunMetadata');
        yield* requireWorker(warmed.exitCode === 0);
        const after = yield* sourceSnapshot(inputs, warmup.workspace, true);
        yield* requireWorker(same(before, after), 'InputChanged');
        seed = yield* sealCache(warmup.cache);
        seedAdmission = {
          provenance: 'TrustedSealBoundary',
          sourceSha256: inputs.admission.source.sha256,
          sha256: seed.sha256,
        };
        yield* snapshot(warmup.workspace);
        record({ requests });
        // Awaited stop confirms listener termination; discarded node_modules can
        // never become a later workspace's input.
        yield* replay.stop();
        replay = undefined;
        yield* fs.remove(warmup.workspace, { recursive: true });
        current = 'FreshPositive';
        const positive = yield* offline('positive');
        const positiveResult = yield* execute(positive.command);
        yield* requireWorker(positiveResult.exitCode === 0);
        const audit = yield* auditInstalled(positive.command.workspace, lock);
        yield* requireWorker(audit.direct.length > 0);
        yield* snapshot(positive.command.workspace);
        record({ audit });
        current = 'EmptyCache';
        const empty = yield* freshCase(parent, 'empty', inputs);
        yield* fs.makeDirectory(empty.cache);
        yield* requireWorker((yield* fs.readDirectory(empty.cache)).length === 0);
        const emptyResult = yield* execute(empty);
        yield* requireWorker(classifyCacheFailure(emptyResult));
        yield* snapshot(empty.workspace);
        record();
        current = 'MissingRequiredArtifact';
        const missing = yield* offline('missing');
        const selected = audit.direct[0]!;
        const candidates = [];
        for (const entry of seed.caseInventory.filter(
          (entry) => isFile(entry.type) && entry.path.endsWith('/package.json'),
        )) {
          const item = yield* Schema.decodeUnknownEffect(Metadata)(
            yield* readJson(`${missing.cache.root}/${entry.path}`),
          );
          for (const match of [entry].filter(
            () => `${item.name}@${item.version}` === selected.identity,
          ))
            candidates.push(match.path.slice(0, -'/package.json'.length));
        }
        yield* requireWorker(candidates.length > 0);
        for (const path of candidates)
          yield* fs.remove(`${missing.cache.root}/${path}`, { recursive: true });
        const missingResult = yield* execute(missing.command);
        yield* requireWorker(classifyCacheFailure(missingResult, selected.identity));
        yield* snapshot(missing.command.workspace);
        record({ identity: selected.identity, removed: candidates });
        current = 'CorruptCacheContent';
        const corrupt = yield* offline('corrupt');
        const file = seed.caseInventory.find((entry) => isFile(entry.type));
        yield* requireWorker(file !== undefined);
        yield* fs.writeFileString(`${corrupt.cache.root}/${file!.path}`, 'owned corruption');
        const refused = yield* admitCaseCache(seed, corrupt.cache).pipe(Effect.result);
        yield* requireWorker(Result.isFailure(refused) && inputChanged(refused.failure));
        yield* snapshot(corrupt.command.workspace);
        record();
        current = 'CaseIsolation';
        const next = yield* offline('isolation-next');
        const installed = audit.direct[0]!;
        const packagePath = `${installed.path}/package.json`;
        const original = yield* boundedFile(packagePath);
        yield* fs.writeFileString(packagePath, 'owned installed-file mutation');
        yield* admitCaseCache(seed, positive.cache);
        yield* admitCaseCache(seed, next.cache);
        yield* fs.writeFile(packagePath, original);
        yield* snapshot(positive.command.workspace);
        record({ first: positive.cache.sha256, next: next.cache.sha256 });
        current = 'CancellationDeadline';
        const cancellation = yield* platform.cancellation();
        yield* requireWorker(
          cancellation.deadlineStoppedOwnedResources &&
            cancellation.interruptedWarmupStopped &&
            cancellation.removalConfirmed,
          'CleanupUnknown',
        );
        yield* snapshot(positive.command.workspace);
        record(cancellation);
        return {
          _tag: 'Completed' as const,
          exitCode: 0 as const,
          observations,
          seedAdmission,
          evidence,
        };
      }
      const result = yield* Effect.gen(cases).pipe(Effect.timeout(540000), Effect.result);
      for (const handle of [replay].filter((value) => value !== undefined)) yield* handle.stop();
      const verifying = Effect.forEach(
        [seed].filter((value) => value !== undefined),
        verifySealedCache,
      );
      const seedCheck = yield* verifying.pipe(Effect.result);
      yield* restoreDirectories();
      const reason = Match.value({
        changed: Result.isFailure(seedCheck),
        cleanupFailed: cleanupStatus.failed,
      }).pipe(
        Match.when({ changed: true }, () => 'InputChanged' as const),
        Match.when({ cleanupFailed: true }, () => 'CleanupUnknown' as const),
        Match.orElse(() =>
          Result.match(result, { onFailure: refusalReason, onSuccess: () => 'Verified' as const }),
        ),
      );
      const diagnostic = Result.match(result, {
        onFailure: refusalDiagnostic,
        onSuccess: () => refusalDiagnostic({ code: 'Verified' }),
      });
      function incomplete() {
        const partial = observations.filter((item) => item.caseId !== current);
        partial.push(
          CaseObservation.make({
            caseId: current,
            stage: expected[current][0],
            outcome: 'Blocked',
            reason,
            evidence: [],
            readbacks,
            digests: { _tag: 'Unknown' },
          }),
        );
        return {
          _tag: 'Incomplete' as const,
          exitCode: 1 as const,
          refusal: {
            caseId: current,
            stage: expected[current][0],
            reason,
            ...presentDiagnostics(diagnostic),
          },
          observations: partial,
          seedAdmission,
          evidence: evidence.filter((item) => item.caseId !== current),
        };
      }
      const complete =
        Result.isSuccess(result) &&
        Result.isSuccess(seedCheck) &&
        !cleanupStatus.failed &&
        seedAdmission !== undefined;
      return Match.value(complete).pipe(
        Match.when(true, () => ({
          _tag: 'Completed' as const,
          exitCode: 0 as const,
          observations,
          seedAdmission: seedAdmission!,
          evidence,
        })),
        Match.orElse(incomplete),
      );
    }
    const workflow = Effect.gen(run);
    return workflow;
  }
  return { runWorkerCases, auditInstalled };
}
export class WorkerCases extends Context.Service<WorkerCases, ReturnType<typeof makeWorkerCases>>()(
  'ceirean/WorkerCases',
) {}
export function runWorkerCases(inputs: PreparedInputs) {
  const workflow = Effect.flatMap(WorkerCases, (service) => service.runWorkerCases(inputs));
  return workflow;
}

export function writeWorkerEvidence(
  result: Effect.Success<ReturnType<typeof runWorkerCases>>,
  root: string,
) {
  function* write() {
    const fs = yield* FileSystem.FileSystem;
    const documents = result.evidence.map((document) => ({
      name: evidenceRequirements[document.caseId].name,
      bytes: utf8(encode(document)),
    }));
    const refusal = Match.value(result).pipe(
      Match.when({ _tag: 'Incomplete' }, (value) => value.refusal),
      Match.orElse(() => undefined),
    );
    const diagnosticData = {
      _tag: result._tag,
      activation: 'Blocked',
      exitCode: result.exitCode,
      refusal,
      observations: result.observations,
      seedAdmission: result.seedAdmission,
      qualificationReceipt: 'NotProduced',
    };
    const diagnostic = { name: 'worker-diagnostic.json', bytes: utf8(encode(diagnosticData)) };
    const files = [...documents, diagnostic];
    const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
    yield* requireWorker(total <= 16777216);
    yield* fs.makeDirectory(root, { recursive: true, mode: 0o700 });
    yield* requireWorker((yield* fs.realPath(root)) === root);
    for (const file of files)
      yield* fs.writeFile(`${root}/${file.name}`, file.bytes, { flag: 'wx', mode: 0o600 });
  }
  const workflow = Effect.gen(write);
  return workflow;
}
