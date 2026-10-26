import {
  Context,
  Effect,
  FileSystem,
  Match,
  Option,
  Order,
  Ref,
  Result,
  Schema,
  Stream,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import { fetchArtifact } from '../cache-download.ts';
import { registryIdentity, requireInventory } from '../dependency-inventory.ts';
import { dependencyPins } from '../dependency-pins.ts';
import { encodeInventory, frozenDependencyInventory } from '../frozen-dependencies.ts';
import { digestBytes, inspectSourceFiles, requirePayload } from '../payload.ts';
import { validateSourceInventory } from '../preparation.ts';
import { sourcePins } from '../source-payload.ts';
import { GitSha, QualificationRequest, Sha256, decodeRequest, strict } from './contract.ts';
import {
  PreparedInputs,
  SourceDigest,
  ToolDigest,
  ToolReadbacks,
  trustedToolLimits,
  trustedToolsFit,
} from './prepared-inputs.ts';
import { inputPins, toolPins } from './tool-pins.ts';

const HostCommand = Schema.Struct({
  executable: Schema.Literals([
    '/usr/bin/git',
    '/bin/git',
    '/usr/bin/docker',
    '/usr/local/bin/docker',
  ]),
  args: Schema.Array(Schema.String),
  home: Schema.String,
  cwd: Schema.String,
  maximum: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 67108864 })),
  input: Schema.optionalKey(Schema.Uint8Array),
});
const ToolFile = Schema.Struct({
  path: Schema.Literals(['node', 'worker.mjs']),
  mode: Schema.Literals(['100644', '100755']),
  bytes: Schema.Uint8Array,
});
const ToolCapsule = Schema.Struct({ files: Schema.Array(ToolFile), lock: Schema.Uint8Array });
export const ReviewedInputContext = Schema.Struct({
  request: QualificationRequest,
  build: Schema.Struct({
    provenance: Schema.Literal('ReviewedToolBuild'),
    ceireanRevision: GitSha,
    lockBlob: GitSha,
    lockSha256: Sha256,
    effect: Schema.Literal(toolPins.effect),
    nodeImage: Schema.Literal(toolPins.nodeImage),
    nodeConfigSha256: Sha256,
    files: Schema.Array(ToolDigest).check(Schema.isMinLength(2), Schema.isMaxLength(2)),
  }),
});
const TreeEntry = Schema.Struct({
  path: Schema.String,
  mode: Schema.Literals(['100644', '100755']),
  objectId: GitSha,
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1048576 })),
});
const isFile = Schema.is(Schema.Literal('File'));
const sameRequest = Schema.toEquivalence(QualificationRequest);
const sameFiles = Schema.toEquivalence(Schema.Array(ToolDigest));
const sourceAcquisition = { url: 'https://github.com/opsydyn/fold-kit-experiments.git' } as const;
const encode = (text: string) => new TextEncoder().encode(text);
const isNode = Schema.is(Schema.Literal('node'));
const isWorker = Schema.is(Schema.Literal('worker.mjs'));
const isExecutable = Schema.is(Schema.Literal('100755'));
const isRegular = Schema.is(Schema.Literal('100644'));
const isLinux = Schema.is(Schema.Literal('Linux'));
const isBlob = Schema.is(Schema.Literal('blob'));
const isLock = Schema.is(Schema.Literal('bun.lock'));
const isString = Schema.is(Schema.String);

function decodeText(bytes: Uint8Array) {
  const workflow = Effect.try(() =>
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
  );
  return workflow;
}
function hashInventory(input: unknown) {
  const text = encodeInventory(input);
  const bytes = encode(text);
  const workflow = digestBytes(bytes);
  return workflow;
}
function gitBlob(bytes: Uint8Array) {
  const header = encode(`blob ${bytes.length}\0`);
  const content = new Uint8Array(header.length + bytes.length);
  content.set(header);
  content.set(bytes, header.length);
  return digestBytes(content, 'SHA-1');
}
function collect(stream: Stream.Stream<Uint8Array, unknown>, maximum: number) {
  function* read() {
    const chunks: Uint8Array[] = [];
    let used = 0;
    function* append(chunk: Uint8Array) {
      yield* requirePayload(chunk.length <= maximum - used, 'ProcessRefused');
      chunks.push(new Uint8Array(chunk));
      used += chunk.length;
    }
    yield* Stream.runForEach(stream, (chunk) => Effect.gen(() => append(chunk)));
    const bytes = new Uint8Array(used);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }
  const workflow = Effect.gen(read);
  return workflow;
}

export const linuxGitEnvironment = (home: string) => ({
  HOME: home,
  XDG_CONFIG_HOME: home,
  TMPDIR: home,
  PATH: '/usr/bin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/bin/false',
  SSH_ASKPASS: '/bin/false',
});

export function makeLinuxInputHost() {
  function* make() {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    function run(input: typeof HostCommand.Type) {
      function* execute() {
        const command = yield* Schema.decodeUnknownEffect(HostCommand, strict)(input);
        yield* requirePayload((command.input?.length ?? 0) <= 3145728, 'ProcessRefused');
        const child = yield* spawner.spawn(
          ChildProcess.make(command.executable, command.args, {
            cwd: command.cwd,
            shell: false,
            extendEnv: false,
            env: linuxGitEnvironment(command.home),
            stdin: Stream.fromIterable([command.input ?? new Uint8Array()]),
            stdout: 'pipe',
            stderr: 'pipe',
            killSignal: 'SIGKILL',
            forceKillAfter: 0,
          }),
        );
        const [bytes, , code] = yield* Effect.all(
          [collect(child.stdout, command.maximum), collect(child.stderr, 4096), child.exitCode],
          { concurrency: 3 },
        );
        yield* requirePayload(code === 0, 'ProcessRefused');
        return bytes;
      }
      const workflow = Effect.gen(execute);
      const bounded = workflow.pipe(Effect.timeout(90000));
      const scoped = Effect.scoped(bounded);
      return scoped;
    }
    return {
      os: fs.readFileString('/proc/sys/kernel/ostype'),
      run,
      get: (url: string, init: RequestInit) => fetch(url, init),
    };
  }
  const workflow = Effect.gen(make);
  return workflow;
}
export class LinuxInputHost extends Context.Service<
  LinuxInputHost,
  Effect.Success<ReturnType<typeof makeLinuxInputHost>>
>()('ceirean/LinuxInputHost') {}

// This context is controller-owned, never decoded from dispatch/case JSON or a
// manifest next to the capsule. The later worksheet boundary must establish it.
export function makeLinuxInputs(
  reviewed: unknown,
  locations: { checkout: string; capsule: string },
) {
  function* make() {
    const host = yield* LinuxInputHost;
    const fs = yield* FileSystem.FileSystem;
    const context = yield* Schema.decodeUnknownEffect(
      ReviewedInputContext,
      strict,
    )(structuredClone(reviewed));
    const { request, build } = context;
    yield* requireInventory(
      build.ceireanRevision === request.ceireanRevision && build.lockBlob === request.lockBlob,
      'InputChanged',
    );
    const expectedTools = [...build.files].sort((a, b) => Order.String(a.path, b.path));
    const expectedSizes = expectedTools.map((file) => file.size);
    yield* requireInventory(trustedToolsFit(expectedSizes), 'InputChanged');
    const toolBuildMatches = [
      isNode(expectedTools[0]?.path),
      isExecutable(expectedTools[0]?.mode),
      isWorker(expectedTools[1]?.path),
      isRegular(expectedTools[1]?.mode),
      expectedTools[1].sha256 === request.harnessSha256 &&
        (yield* hashInventory(expectedTools)) === request.toolCapsuleSha256,
    ].every(Boolean);
    yield* requireInventory(toolBuildMatches, 'InputChanged');
    function ownedRoot(prefix: string) {
      function* create() {
        const root = yield* fs.makeTempDirectoryScoped({ prefix });
        yield* fs.chmod(root, 0o700);
        return yield* fs.realPath(root);
      }
      const workflow = Effect.gen(create);
      return workflow;
    }
    function destinationRoot(root: string) {
      function* create() {
        yield* fs.makeDirectory(root, { mode: 0o700 });
        return root;
      }
      const workflow = Effect.gen(create);
      return workflow;
    }
    function git(
      executable: typeof ToolReadbacks.Type.git.path,
      args: readonly string[],
      home: string,
      maximum = 1048576,
      input?: Uint8Array,
    ) {
      const workflow = host.run({
        executable,
        args: [
          '--no-replace-objects',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'protocol.allow=never',
          '-c',
          'protocol.https.allow=always',
          '-c',
          'credential.helper=',
          '-c',
          'core.askPass=/bin/false',
          '-c',
          'http.followRedirects=false',
          '-c',
          'fetch.fsckObjects=true',
          '-c',
          'transfer.fsckObjects=true',
          ...args,
        ],
        home,
        cwd: home,
        maximum,
        input,
      });
      return workflow;
    }
    function findTool(
      paths: readonly (typeof HostCommand.Type.executable)[],
      prefix: string,
      home: string,
    ) {
      function* discover() {
        const available = [];
        for (const path of paths) {
          const probing = host
            .run({ executable: path, args: ['--version'], home, cwd: home, maximum: 4096 })
            .pipe(Effect.result);
          const result = yield* probing;
          const found = Result.match(result, {
            onSuccess: (bytes) => [{ path, bytes }],
            onFailure: () => [],
          });
          available.push(...found);
        }
        const found = yield* Effect.fromNullishOr(available[0]);
        const version = (yield* decodeText(found.bytes)).trim();
        yield* requirePayload(
          version.startsWith(prefix) && !version.includes('\n'),
          'ProcessRefused',
        );
        return { path: found.path, version };
      }
      const workflow = Effect.gen(discover);
      return workflow;
    }
    function discoverGit(home: string) {
      function* discover() {
        yield* requirePayload(isLinux((yield* host.os).trim()), 'ProcessRefused');
        const found = yield* findTool(['/usr/bin/git', '/bin/git'], 'git version ', home);
        return yield* Schema.decodeUnknownEffect(ToolReadbacks.fields.git, strict)(found);
      }
      const workflow = Effect.gen(discover);
      return workflow;
    }
    function readBytes(path: string, maximum: number) {
      function* read() {
        yield* requireInventory((yield* fs.realPath(path)) === path, 'InputChanged');
        const file = yield* fs.open(path, { flag: 'r', noFollow: true });
        const info = yield* file.stat;
        yield* requireInventory(
          isFile(info.type) &&
            Option.getOrElse(info.nlink, () => 0n) === 1n &&
            info.size <= BigInt(maximum),
          'InputChanged',
        );
        const part = yield* file.readAlloc(Number(info.size) + 1);
        const bytes = Option.getOrElse(part, () => new Uint8Array());
        const tail = yield* file.readAlloc(1);
        yield* requireInventory(
          bytes.length <= maximum && BigInt(bytes.length) === info.size && Option.isNone(tail),
          'InputChanged',
        );
        return { bytes, mode: info.mode & 0o7777 };
      }
      const workflow = Effect.gen(read);
      const scoped = Effect.scoped(workflow);
      return scoped;
    }
    function admitSource(destination?: string) {
      function* admit() {
        const home = yield* ownedRoot('ceirean-linux-source-');
        const tool = yield* discoverGit(home);
        const templates = `${home}/templates`;
        yield* fs.makeDirectory(templates);
        const store = `${home}/source.git`;
        yield* git(
          tool.path,
          ['init', '--bare', '--quiet', `--template=${templates}`, store],
          home,
          4096,
        );
        yield* git(
          tool.path,
          [
            '--git-dir',
            store,
            'fetch',
            '--no-tags',
            '--depth=1',
            '--no-recurse-submodules',
            sourceAcquisition.url,
            sourcePins.revision,
          ],
          home,
          4096,
        );
        const tree = (yield* decodeText(
          yield* git(
            tool.path,
            ['--git-dir', store, 'rev-parse', `${sourcePins.revision}^{tree}`],
            home,
            128,
          ),
        )).trim();
        yield* requirePayload(tree === sourcePins.tree);
        const listing = yield* decodeText(
          yield* git(
            tool.path,
            [
              '--git-dir',
              store,
              'ls-tree',
              '-r',
              '-z',
              '--format=%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(objectsize)%x09%(path)',
              sourcePins.revision,
            ],
            home,
            2097152,
          ),
        );
        yield* requirePayload(listing.endsWith('\0'));
        const rows = listing.slice(0, -1).split('\0');
        yield* requirePayload(rows.length > 0 && rows.length <= 4096);
        const entries = [];
        for (const row of rows) {
          const [mode, kind, objectId, size, path, ...rest] = row.split('\t');
          yield* requirePayload(isBlob(kind) && rest.length === 0 && /^\d+$/.test(size ?? ''));
          entries.push(
            yield* Schema.decodeUnknownEffect(
              TreeEntry,
              strict,
            )({ mode, objectId, size: Number(size), path }),
          );
        }
        yield* requirePayload(entries.reduce((sum, file) => sum + file.size, 0) <= 33554432);
        yield* validateSourceInventory(entries.map(({ path }) => ({ path, kind: 'File' })));
        // Additional handoff exclusions do not weaken the shared path/secret validator.
        yield* requirePayload(
          entries.every(
            ({ path }) =>
              !path
                .split('/')
                .some((part) =>
                  /^(?:\.local|\.ssh|\.config|node_modules|\.yarnrc(?:\.yml)?|\.?bunfig\.toml|\.gitconfig|\.gitmodules)$/i.test(
                    part,
                  ),
                ),
          ),
        );
        // Reconstruct membership in an independent empty index, as source-payload does.
        const index = `${home}/membership.git`;
        yield* git(
          tool.path,
          ['init', '--bare', '--quiet', `--template=${templates}`, index],
          home,
          4096,
        );
        const indexInfo = encode(
          entries.map(({ mode, objectId, path }) => `${mode} ${objectId}\t${path}\0`).join(''),
        );
        yield* git(
          tool.path,
          ['--git-dir', index, 'update-index', '--add', '--info-only', '-z', '--index-info'],
          home,
          4096,
          indexInfo,
        );
        const rebuilt = (yield* decodeText(
          yield* git(tool.path, ['--git-dir', index, 'write-tree', '--missing-ok'], home, 128),
        )).trim();
        yield* requirePayload(rebuilt === sourcePins.tree);
        const raw = [];
        for (const entry of entries)
          raw.push({
            ...entry,
            bytes: yield* git(
              tool.path,
              ['--git-dir', store, 'cat-file', 'blob', entry.objectId],
              home,
              1048576,
            ),
          });
        const inspected = yield* inspectSourceFiles(raw);
        const root = yield* Match.value(destination).pipe(
          Match.when(isString, destinationRoot),
          Match.orElse(() => ownedRoot('ceirean-linux-source-files-')),
        );
        const files = [];
        for (const file of [...inspected.files].sort((a, b) => Order.String(a.path, b.path))) {
          const parent = file.path.split('/').slice(0, -1).join('/');
          yield* fs.makeDirectory(`${root}/${parent}`, { recursive: true });
          yield* fs.writeFile(`${root}/${file.path}`, file.bytes, {
            flag: 'wx',
            mode: Number.parseInt(file.mode, 8),
          });
          yield* fs.chmod(`${root}/${file.path}`, Number.parseInt(file.mode, 8) % 0o1000);
          const staged = yield* readBytes(`${root}/${file.path}`, 1048576);
          yield* requirePayload(
            (yield* gitBlob(staged.bytes)) === file.objectId &&
              staged.mode === Number.parseInt(file.mode, 8) % 0o1000,
          );
          files.push(
            yield* Schema.decodeUnknownEffect(
              SourceDigest,
              strict,
            )({
              path: file.path,
              mode: file.mode,
              objectId: file.objectId,
              size: staged.bytes.length,
              sha256: yield* digestBytes(staged.bytes),
            }),
          );
        }
        const sha256 = yield* hashInventory(files);
        return {
          root,
          files,
          admission: {
            provenance: 'ValidatedInputBoundary' as const,
            revision: sourcePins.revision,
            tree: sourcePins.tree,
            inventorySha256: inputPins.inventorySha256,
            sha256,
          },
        };
      }
      const workflow = Effect.gen(admit);
      return workflow;
    }
    function discoverTools() {
      function* discover() {
        const home = yield* ownedRoot('ceirean-linux-tool-discovery-');
        const git = yield* discoverGit(home);
        const docker = yield* findTool(
          ['/usr/bin/docker', '/usr/local/bin/docker'],
          'Docker version ',
          home,
        );
        return yield* Schema.decodeUnknownEffect(
          ToolReadbacks,
          strict,
        )({ os: 'Linux', git, docker });
      }
      const workflow = Effect.gen(discover);
      return workflow;
    }
    function validateToolCapsule(input: unknown) {
      function* validate() {
        const decoded = yield* Schema.decodeUnknownEffect(ToolCapsule, strict)(input);
        const bounded =
          decoded.lock.length <= 2097152 &&
          trustedToolsFit(decoded.files.map((file) => file.bytes.length));
        yield* requireInventory(bounded, 'InputChanged');
        const snapshot = structuredClone(decoded);
        const snapshotSizes = snapshot.files.map((file) => file.bytes.length);
        yield* requireInventory(trustedToolsFit(snapshotSizes), 'InputChanged');
        yield* requireInventory(
          (yield* gitBlob(snapshot.lock)) === request.lockBlob &&
            (yield* digestBytes(snapshot.lock)) === build.lockSha256,
          'InputChanged',
        );
        const lockText = yield* decodeText(snapshot.lock);
        const parsing = Effect.try(() => Bun.JSON5.parse(lockText));
        const lock = yield* parsing;
        const LockCohort = Schema.Struct({
          packages: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
        });
        const cohort = yield* Schema.decodeUnknownEffect(LockCohort)(lock);
        yield* requireInventory(
          cohort.packages.effect?.[0] === `effect@${toolPins.effect}`,
          'InputChanged',
        );
        const files = [];
        for (const file of snapshot.files) {
          files.push({
            path: file.path,
            mode: file.mode,
            size: file.bytes.length,
            sha256: yield* digestBytes(file.bytes),
          });
        }
        files.sort((a, b) => Order.String(a.path, b.path));
        yield* requireInventory(sameFiles(files, expectedTools), 'InputChanged');
        const sha256 = yield* hashInventory(files);
        yield* requireInventory(sha256 === request.toolCapsuleSha256, 'InputChanged');
        return {
          files,
          sha256,
          lockBlob: request.lockBlob,
          lockSha256: build.lockSha256,
          nodeConfigSha256: build.nodeConfigSha256,
        };
      }
      const workflow = Effect.gen(validate);
      return workflow;
    }
    function admitTools() {
      function* admit() {
        const home = yield* ownedRoot('ceirean-linux-tool-reader-');
        const tool = yield* discoverGit(home);
        const lock = yield* git(
          tool.path,
          ['-C', locations.checkout, 'show', `${request.ceireanRevision}:bun.lock`],
          home,
          2097152,
        );
        const capsuleRoot = yield* fs.realPath(locations.capsule);
        const names = yield* fs.readDirectory(capsuleRoot);
        yield* requireInventory(
          names.length === 2 && names.includes('node') && names.includes('worker.mjs'),
          'InputChanged',
        );
        const files = [];
        for (const expected of expectedTools) {
          const file = yield* readBytes(`${capsuleRoot}/${expected.path}`, expected.size);
          yield* requireInventory(
            file.mode === Number.parseInt(expected.mode, 8) % 0o1000,
            'InputChanged',
          );
          files.push({ path: expected.path, mode: expected.mode, bytes: file.bytes });
        }
        return { ...(yield* validateToolCapsule({ files, lock })), bytes: files };
      }
      const workflow = Effect.gen(admit);
      return workflow;
    }
    function prepareLinuxInputs(input: QualificationRequest) {
      function* prepare() {
        const admittedRequest = yield* decodeRequest(input);
        yield* requireInventory(sameRequest(request, admittedRequest), 'InputChanged');
        const readbacks = yield* discoverTools();
        const root = yield* ownedRoot('ceirean-linux-handoff-');
        const catalogRoot = `${root}/catalog`;
        yield* fs.makeDirectory(catalogRoot, { mode: 0o700 });
        const home = yield* ownedRoot('ceirean-linux-frozen-reader-');
        const inputs = [];
        for (const [name, expected] of Object.entries(dependencyPins.inputs)) {
          const bytes = yield* git(
            readbacks.git.path,
            [
              '-C',
              locations.checkout,
              'show',
              `${request.ceireanRevision}:probes/cloudflare-executor/fixtures/dependencies/${name}`,
            ],
            home,
            2097152,
          );
          yield* requireInventory((yield* digestBytes(bytes)) === expected, 'InputChanged');
          yield* fs.writeFile(`${catalogRoot}/${name}`, bytes, { flag: 'wx', mode: 0o644 });
          yield* fs.chmod(`${catalogRoot}/${name}`, 0o644);
          inputs.push({
            path: `catalog/${name}`,
            mode: '100644' as const,
            size: bytes.length,
            sha256: expected,
          });
        }
        const catalog = yield* git(
          readbacks.git.path,
          [
            '-C',
            locations.checkout,
            'show',
            `${request.ceireanRevision}:probes/cloudflare-executor/fixtures/dependencies/inventory.lock`,
          ],
          home,
          2097152,
        );
        yield* requireInventory(
          (yield* digestBytes(catalog)) === inputPins.inventorySha256,
          'InputChanged',
        );
        yield* fs.writeFile(`${catalogRoot}/inventory.lock`, catalog, { flag: 'wx', mode: 0o644 });
        yield* fs.chmod(`${catalogRoot}/inventory.lock`, 0o644);
        const stagedCatalog = yield* readBytes(`${catalogRoot}/inventory.lock`, 2097152);
        yield* requireInventory(
          (yield* digestBytes(stagedCatalog.bytes)) === inputPins.inventorySha256,
          'InputChanged',
        );
        const catalogDirectory = new URL('file:///');
        catalogDirectory.pathname = `${catalogRoot}/`;
        const frozen = yield* frozenDependencyInventory(catalogDirectory);
        yield* requireInventory(
          (yield* digestBytes(encode(encodeInventory(frozen) + '\n'))) ===
            inputPins.inventorySha256,
          'InputChanged',
        );
        const source = yield* admitSource(`${root}/source`);
        const sourceLock = source.files.find((file) => isLock(file.path));
        yield* requireInventory(sourceLock?.sha256 === inputPins.lockSha256, 'InputChanged');
        const tools = yield* admitTools();
        const artifacts = yield* stageArtifacts(frozen.artifacts, host.get, `${root}/artifacts`);
        yield* fs.makeDirectory(`${root}/tools`, { mode: 0o700 });
        for (const file of tools.bytes) {
          yield* fs.writeFile(`${root}/tools/${file.path}`, file.bytes, {
            flag: 'wx',
            mode: Number.parseInt(file.mode, 8),
          });
          yield* fs.chmod(`${root}/tools/${file.path}`, Number.parseInt(file.mode, 8) % 0o1000);
          const staged = yield* readBytes(
            `${root}/tools/${file.path}`,
            trustedToolLimits.fileBytes,
          );
          const unchanged =
            (yield* digestBytes(staged.bytes)) ===
              tools.files.find((item) => item.path === file.path)?.sha256 &&
            staged.mode === Number.parseInt(file.mode, 8) % 0o1000;
          yield* requireInventory(unchanged, 'InputChanged');
        }
        const { bytes: _bytes, ...toolDigests } = tools;
        return yield* Schema.decodeUnknownEffect(
          PreparedInputs,
          strict,
        )({
          activation: 'Blocked',
          root,
          admission: { request: structuredClone(request), source: source.admission },
          source: { files: source.files, sha256: source.admission.sha256 },
          artifacts: artifacts.files.map((file) => ({ ...file, path: `artifacts/${file.path}` })),
          catalog: { path: 'catalog/inventory.lock', sha256: inputPins.inventorySha256, inputs },
          tools: toolDigests,
          readbacks,
        });
      }
      const workflow = Effect.gen(prepare);
      const bounded = workflow.pipe(Effect.timeout(request.limits.qualificationMs));
      return bounded;
    }
    function stageArtifacts(
      artifacts: readonly { identity: string; url: string; integrity: string }[],
      get = host.get,
      destination?: string,
    ) {
      function* stage() {
        yield* requireInventory(artifacts.length > 0 && artifacts.length <= 1024);
        yield* requireInventory(
          new Set(artifacts.map((artifact) => artifact.url)).size === artifacts.length,
        );
        for (const artifact of artifacts) {
          const identity = yield* registryIdentity(artifact.identity);
          yield* requireInventory(identity.url === artifact.url, 'InputChanged');
        }
        const root = yield* Match.value(destination).pipe(
          Match.when(isString, destinationRoot),
          Match.orElse(() => ownedRoot('ceirean-linux-blobs-')),
        );
        const spent = yield* Ref.make(0);
        const files = [];
        for (const [index, artifact] of artifacts.entries()) {
          const fetched = yield* fetchArtifact(
            get,
            artifact,
            artifacts.map((item) => item.url),
            spent,
          );
          const path = `${String(index).padStart(4, '0')}.tgz`;
          yield* fs.writeFile(`${root}/${path}`, fetched.bytes, { flag: 'wx', mode: 0o600 });
          const staged = yield* readBytes(`${root}/${path}`, 67108864);
          const sha256 = yield* digestBytes(staged.bytes);
          yield* requireInventory(sha256 === fetched.sha256, 'InputChanged');
          files.push({ ...artifact, path, size: staged.bytes.length, sha256 });
        }
        return { root, files };
      }
      const workflow = Effect.gen(stage);
      return workflow;
    }
    return {
      admitSource,
      discoverTools,
      validateToolCapsule,
      admitTools,
      prepareLinuxInputs,
      stageArtifacts,
    };
  }
  const workflow = Effect.gen(make);
  return workflow;
}

export class LinuxInputs extends Context.Service<
  LinuxInputs,
  Effect.Success<ReturnType<typeof makeLinuxInputs>>
>()('ceirean/LinuxInputs') {}

export function prepareLinuxInputs(request: QualificationRequest) {
  const workflow = Effect.flatMap(LinuxInputs, (service) => service.prepareLinuxInputs(request));
  return workflow;
}
export function validateToolCapsule(input: unknown) {
  const workflow = Effect.flatMap(LinuxInputs, (service) => service.validateToolCapsule(input));
  return workflow;
}
