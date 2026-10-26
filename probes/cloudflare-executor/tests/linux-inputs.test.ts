import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Match, PlatformError, Result, Schema } from 'effect';
import { ChildProcessSpawner } from 'effect/process';

import {
  LinuxInputHost,
  makeLinuxInputHost,
  makeLinuxInputs,
  ReviewedInputContext,
} from '../src/linux-qualification/inputs.ts';
import { ArtifactDigest, trustedToolsFit } from '../src/linux-qualification/prepared-inputs.ts';
import { toolPins, inputPins } from '../src/linux-qualification/tool-pins.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const withTestPlatform = Effect.provide(BunServices.layer);
const isConsumerLock = Schema.is(Schema.Literal('consumer.bun.lock'));
const isCatalog = Schema.is(Schema.Literal('inventory.lock'));
const hash = (bytes: Uint8Array, algorithm = 'sha256') =>
  createHash(algorithm).update(bytes).digest('hex');
const blob = (bytes: Uint8Array) =>
  hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1');
const inventory = (files: readonly { path: string; mode: string; bytes: Uint8Array }[]) =>
  files.map(({ path, mode, bytes }) => ({ path, mode, size: bytes.length, sha256: hash(bytes) }));
const limits = {
  jobMs: 900000,
  qualificationMs: 540000,
  commandMs: 90000,
  cleanupMs: 30000,
  jobs: 1,
  automaticRetries: 0,
  cpus: 2,
  memoryBytes: 4294967296,
  swapBytes: 4294967296,
  pids: 128,
  tmpfsBytes: 3221225472,
  artifactBytes: 67108864,
  totalArtifactBytes: 536870912,
  expandedPackageBytes: 268435456,
  expandedEntryBytes: 201326592,
  totalExpandedBytes: 2147483648,
  packageEntries: 10000,
  totalEntries: 200000,
  pathBytes: 512,
  evidenceBytes: 16777216,
  streamBytes: 262144,
  retentionDays: 7,
} as const;
const tools = [
  { path: 'node', mode: '100755', bytes: encode('synthetic inert node bytes') },
  { path: 'worker.mjs', mode: '100644', bytes: encode('export const inert = true;\n') },
] as const;
const toolInventory = inventory(tools);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const capsuleJson = encodeJson(toolInventory);
const lock = encode('{"packages":{"effect":["effect@4.0.5","",{},"sha512-fixture"]}}');
const request = {
  authority: 'RequiresRunWorksheet',
  ceireanRevision: 'a'.repeat(40),
  lockBlob: blob(lock),
  harnessSha256: hash(tools[1].bytes),
  toolCapsuleSha256: hash(encode(capsuleJson)),
  sourceRevision: inputPins.sourceRevision,
  sourceTree: inputPins.sourceTree,
  inventorySha256: inputPins.inventorySha256,
  registry: 'http://127.0.0.1:4873',
  run: { runner: 'ubuntu-24.04', runId: 'synthetic-task-2', attempt: 1 },
  tools: toolPins,
  limits,
} as const;
const reviewed = {
  request,
  build: {
    provenance: 'ReviewedToolBuild',
    ceireanRevision: request.ceireanRevision,
    lockBlob: request.lockBlob,
    lockSha256: hash(lock),
    effect: '4.0.5',
    nodeImage: toolPins.nodeImage,
    nodeConfigSha256: 'b'.repeat(64),
    files: toolInventory,
  },
} as const;
const sourceBytes = encode('hello\n');
const source = { path: 'hello.txt', mode: '100644', objectId: blob(sourceBytes), size: 6 };

function scenario(
  options: {
    tree?: string;
    rebuiltTree?: string;
    bytes?: Uint8Array;
    path?: string;
    mode?: string;
    inaccessible?: boolean;
    noDocker?: boolean;
    os?: string;
    frozen?: 'Valid' | 'ChangedInput' | 'ChangedCatalog';
    fullSource?: boolean;
  } = {},
) {
  const calls: { executable: string; args: readonly string[]; home: string }[] = [];
  const gets: string[] = [];
  function* setup() {
    const fs = yield* FileSystem.FileSystem;
    const capsule = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-test-capsule-' });
    for (const file of tools) {
      yield* fs.writeFile(`${capsule}/${file.path}`, file.bytes, {
        mode: Number.parseInt(file.mode, 8),
      });
    }
    const real = yield* makeLinuxInputHost();
    const consumerLock = yield* fs.readFile(
      decodeURIComponent(
        new URL('../fixtures/dependencies/consumer.bun.lock', import.meta.url).pathname,
      ),
    );
    const sourceFiles = Match.value(options.fullSource).pipe(
      Match.when(true, () => [
        { ...source, bytes: sourceBytes },
        {
          path: 'bun.lock',
          mode: '100644',
          objectId: blob(consumerLock),
          size: consumerLock.length,
          bytes: consumerLock,
        },
      ]),
      Match.orElse(() => [{ ...source, bytes: sourceBytes }]),
    );
    function readReviewed(args: readonly string[]) {
      function* read() {
        const specifier = args.at(-1) ?? '';
        const name = specifier.split('/').at(-1) ?? '';
        const isFrozen = specifier.includes('fixtures/dependencies/');
        const changed = Match.value(options.frozen).pipe(
          Match.when('ChangedInput', () => isConsumerLock(name)),
          Match.when('ChangedCatalog', () => isCatalog(name)),
          Match.orElse(() => false),
        );
        const path = decodeURIComponent(
          new URL(`../fixtures/dependencies/${name}`, import.meta.url).pathname,
        );
        const reading = fs.readFile(path).pipe(Effect.map((bytes) => new Uint8Array(bytes)));
        const selected = Match.value(isFrozen && options.frozen !== undefined && !changed).pipe(
          Match.when(true, () => reading),
          Match.orElse(() => Effect.succeed(new Uint8Array(lock))),
        );
        return yield* selected;
      }
      const workflow = Effect.gen(read);
      return workflow;
    }
    const run: typeof real.run = (command) => {
      calls.push(command);
      const args = command.args;
      function fetchSource() {
        expect(args).toContain('https://github.com/opsydyn/fold-kit-experiments.git');
        expect(args).toContain(inputPins.sourceRevision);
        return Match.value(options.inaccessible).pipe(
          Match.when(true, () => Effect.fail(new Error('anonymous history inaccessible'))),
          Match.orElse(() => Effect.succeed(new Uint8Array())),
        );
      }
      return Match.value(args).pipe(
        Match.when(
          () => command.executable.includes('docker') && options.noDocker === true,
          () => Effect.fail(new Error('unavailable')),
        ),
        Match.when(
          () => command.executable.includes('docker'),
          () => Effect.succeed(encode('Docker version 28.0.0, build synthetic\n')),
        ),
        Match.when(
          (args) => args.includes('--version'),
          () => Effect.succeed(encode('git version 2.43.0\n')),
        ),
        Match.when((args) => args.includes('fetch'), fetchSource),
        Match.when(
          (args) => args.includes('rev-parse'),
          () => Effect.succeed(encode((options.tree ?? inputPins.sourceTree) + '\n')),
        ),
        Match.when(
          (args) => args.includes('ls-tree'),
          () =>
            Effect.succeed(
              encode(
                sourceFiles
                  .map(
                    (file) =>
                      `${options.mode ?? file.mode}\tblob\t${file.objectId}\t${file.size}\t${options.path ?? file.path}\0`,
                  )
                  .join(''),
              ),
            ),
        ),
        Match.when(
          (args) => args.includes('write-tree'),
          () => Effect.succeed(encode((options.rebuiltTree ?? inputPins.sourceTree) + '\n')),
        ),
        Match.when(
          (args) => args.includes('cat-file'),
          () =>
            Effect.succeed(
              new Uint8Array(
                options.bytes ?? sourceFiles.find((file) => file.objectId === args.at(-1))!.bytes,
              ),
            ),
        ),
        Match.when(
          (args) => args.includes('show'),
          () => readReviewed(args),
        ),
        Match.when(
          (args) => args.includes('init') || args.includes('update-index'),
          () => Effect.succeed(new Uint8Array()),
        ),
        Match.orElse(() => Effect.fail(new Error('unexpected process'))),
      );
    };
    async function get(url: string) {
      gets.push(url);
      return new Response('synthetic incorrect artifact');
    }
    const host = { ...real, run, get, os: Effect.succeed(options.os ?? 'Linux\n') };
    const service = yield* makeLinuxInputs(reviewed, {
      checkout: '/reviewed/ceirean',
      capsule,
    }).pipe(Effect.provideService(LinuxInputHost, host));
    return { service, fs, capsule, calls, gets };
  }
  const workflow = Effect.gen(setup);
  return workflow;
}

export async function admitsSource() {
  function* check() {
    const { service, fs, calls } = yield* scenario();
    const admitted = yield* service.admitSource();
    const expectedInventory = encodeJson([{ ...source, sha256: hash(sourceBytes) }]);
    expect(admitted.admission).toEqual({
      provenance: 'ValidatedInputBoundary',
      revision: inputPins.sourceRevision,
      tree: inputPins.sourceTree,
      inventorySha256: inputPins.inventorySha256,
      sha256: hash(encode(expectedInventory)),
    });
    expect(yield* fs.readFileString(`${admitted.root}/hello.txt`)).toBe('hello\n');
    expect(yield* fs.readDirectory(admitted.root)).toEqual(['hello.txt']);
    expect(calls.every(({ executable }) => executable.endsWith('/git'))).toBe(true);
    expect(calls.some(({ args }) => args.includes('update-index'))).toBe(true);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'independently admits staged source bytes and keeps Git state outside the handoff',
  admitsSource,
);

export async function rejectsChangedGit() {
  for (const options of [
    { tree: 'f'.repeat(40) },
    { rebuiltTree: 'f'.repeat(40) },
    { bytes: encode('jello\n') },
  ]) {
    function* check() {
      const { service } = yield* scenario(options);
      expect((yield* service.admitSource().pipe(Effect.result))._tag).toBe('Failure');
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withTestPlatform);
    await Effect.runPromise(provided);
  }
}
test(
  'rejects changed Git trees, independently reconstructed membership, and blob bytes',
  rejectsChangedGit,
);

export async function rejectsInaccessibleSource() {
  function* check() {
    const { service, calls } = yield* scenario({ inaccessible: true });
    expect((yield* service.admitSource().pipe(Effect.result))._tag).toBe('Failure');
    expect(calls.filter(({ args }) => args.includes('fetch'))).toHaveLength(1);
    expect(calls.some(({ args }) => args.includes('cat-file'))).toBe(false);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'anonymous private or inaccessible history blocks without token or alternate retrieval',
  rejectsInaccessibleSource,
);

export async function rejectsUnsafeSources() {
  for (const path of [
    '.env',
    '.git/config',
    '.npmrc',
    '.bunfig.toml',
    'bunfig.toml',
    '.local/state',
    '.ssh/config',
    'node_modules/a/index.js',
  ]) {
    function* check() {
      const { service } = yield* scenario({ path });
      expect((yield* service.admitSource().pipe(Effect.result))._tag, path).toBe('Failure');
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withTestPlatform);
    await Effect.runPromise(provided);
  }
  for (const mode of ['120000', '160000', '100664']) {
    function* check() {
      const { service } = yield* scenario({ mode });
      expect((yield* service.admitSource().pipe(Effect.result))._tag).toBe('Failure');
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withTestPlatform);
    await Effect.runPromise(provided);
  }
}
test(
  'rejects secret, configuration, operational paths and unsupported source modes',
  rejectsUnsafeSources,
);

export async function discoversLinuxTools() {
  function* check() {
    const { service } = yield* scenario();
    expect(yield* service.discoverTools()).toEqual({
      os: 'Linux',
      git: { path: '/usr/bin/git', version: 'git version 2.43.0' },
      docker: { path: '/usr/bin/docker', version: 'Docker version 28.0.0, build synthetic' },
    });
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
  for (const options of [{ noDocker: true }, { os: 'Darwin\n' }]) {
    function* checkMissing() {
      const { service } = yield* scenario(options);
      expect((yield* service.discoverTools().pipe(Effect.result))._tag).toBe('Failure');
    }
    const workflow = Effect.gen(checkMissing);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withTestPlatform);
    await Effect.runPromise(provided);
  }
}
test(
  'Linux discovery uses fixed Git and Docker paths and blocks missing tools or non-Linux hosts',
  discoversLinuxTools,
);

export async function bindsToolProvenance() {
  function* check() {
    const { service, fs, capsule, calls } = yield* scenario();
    const valid = yield* service.validateToolCapsule({ files: tools, lock });
    expect(valid.sha256).toBe(request.toolCapsuleSha256);
    for (const input of [
      { files: [{ ...tools[0], bytes: encode('changed') }, tools[1]], lock },
      { files: tools, lock: encode('changed lock') },
      { files: [...tools, { path: '.env', mode: '100644', bytes: encode('x') }], lock },
      { files: tools, lock, manifest: reviewed.build },
    ]) {
      const validating = service.validateToolCapsule(input).pipe(Effect.result);
      expect((yield* validating)._tag).toBe('Failure');
    }
    const mutation = new Uint8Array(tools[1].bytes);
    mutation[0] = mutation[0]! ^ 1;
    expect(mutation.length).toBe(tools[1].bytes.length);
    yield* fs.writeFile(`${capsule}/worker.mjs`, mutation);
    const admitting = service.admitTools().pipe(Effect.result);
    expect((yield* admitting)._tag).toBe('Failure');
    expect(calls.every(({ executable }) => executable.endsWith('/git'))).toBe(true);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'capsule bytes are bound to reviewed build provenance and approved lock, not sibling claims',
  bindsToolProvenance,
);

export async function bindsReviewedRequest() {
  function* check() {
    const { service, calls } = yield* scenario();
    const changed = { ...request, run: { ...request.run, runId: 'case-json-claim' } };
    expect((yield* service.prepareLinuxInputs(changed).pipe(Effect.result))._tag).toBe('Failure');
    expect(calls).toHaveLength(0);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'dispatch request must equal controller reviewed context before acquisition',
  bindsReviewedRequest,
);

export async function stagesOnlyRawArtifacts() {
  const bytes = encode('synthetic inert tarball; not an executable');
  const artifact = {
    identity: 'fixture@1.0.0',
    url: 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz',
    integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
  };
  function* check() {
    const { service, fs, calls } = yield* scenario();
    const approved = [artifact];
    async function get(url: string, init: RequestInit) {
      expect(url).toBe(artifact.url);
      expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
      return new Response(bytes);
    }
    const staged = yield* service.stageArtifacts(approved, get);
    expect(hash(yield* fs.readFile(`${staged.root}/${staged.files[0]!.path}`))).toBe(hash(bytes));
    const bad = [{ ...artifact, integrity: 'sha512-' + 'A'.repeat(86) + '==' }];
    const mismatched = service.stageArtifacts(bad, get).pipe(Effect.result);
    expect((yield* mismatched)._tag).toBe('Failure');
    const redirect = async () =>
      new Response(null, { status: 302, headers: { location: artifact.url } });
    const redirected = service.stageArtifacts(approved, redirect).pipe(Effect.result);
    expect((yield* redirected)._tag).toBe('Failure');
    expect(calls).toHaveLength(0);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'raw staging verifies SRI and refuses redirected GET without extraction or importing bytes',
  stagesOnlyRawArtifacts,
);

export async function rejectsChangedFrozenInputs() {
  for (const frozen of ['ChangedInput', 'ChangedCatalog'] as const) {
    function* check() {
      const { service, gets, calls } = yield* scenario({ frozen });
      const result = yield* service.prepareLinuxInputs(request).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      expect(gets).toHaveLength(0);
      const expected = Match.value(frozen).pipe(
        Match.when('ChangedInput', () => 'consumer.bun.lock'),
        Match.orElse(() => 'inventory.lock'),
      );
      const lastCall = calls.at(-1)!;
      expect(lastCall.args.at(-1)).toContain(expected);
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(withTestPlatform);
    await Effect.runPromise(provided);
  }
}
test(
  'changed frozen input/catalog bytes block before any artifact GET',
  rejectsChangedFrozenInputs,
);

export async function preparesUntilSriBoundary() {
  function* check() {
    const { service, gets, calls } = yield* scenario({ frozen: 'Valid', fullSource: true });
    const result = yield* service.prepareLinuxInputs(request).pipe(Effect.result);
    expect(Result.isFailure(result)).toBe(true);
    expect(gets).toEqual(['https://registry.npmjs.org/@adobe/css-tools/-/css-tools-4.5.0.tgz']);
    expect(
      calls.every(
        ({ executable }) => executable.endsWith('/git') || executable.endsWith('/docker'),
      ),
    ).toBe(true);
    const dockerCalls = calls.filter(({ executable }) => executable.endsWith('/docker'));
    for (const call of dockerCalls) expect(call.args).toEqual(['--version']);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'real orchestration validates frozen catalog, source and tools before the first integrity-checked GET',
  preparesUntilSriBoundary,
);

export async function checksRealProcessBoundary() {
  const calls: import('effect/process').ChildProcess.Command[] = [];
  function spawn(command: import('effect/process').ChildProcess.Command) {
    calls.push(command);
    const failed = Effect.fail(
      PlatformError.badArgument({
        module: 'Test',
        method: 'spawn',
        description: 'SyntheticBoundaryStop',
      }),
    );
    return failed;
  }
  const spawner = ChildProcessSpawner.make(spawn);
  function* check() {
    const host = yield* makeLinuxInputHost();
    const running = host
      .run({
        executable: '/usr/bin/git',
        args: ['--version'],
        home: '/owned/home',
        cwd: '/owned/home',
        maximum: 4096,
      })
      .pipe(Effect.result);
    yield* running;
    expect(calls).toHaveLength(1);
    const command = calls[0]!;
    expect(command._tag).toBe('StandardCommand');
    expect(command.options).toMatchObject({
      shell: false,
      extendEnv: false,
      cwd: '/owned/home',
      killSignal: 'SIGKILL',
    });
    const environment = Match.value(command).pipe(
      Match.tagsExhaustive({
        StandardCommand: ({ options }) => options.env,
        PipedCommand: () => undefined,
      }),
    );
    expect(environment).toEqual({
      HOME: '/owned/home',
      XDG_CONFIG_HOME: '/owned/home',
      TMPDIR: '/owned/home',
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
  }
  const workflow = Effect.gen(check);
  const fakeProcess = workflow.pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );
  const scoped = Effect.scoped(fakeProcess);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'real host adapter fixes executable, environment and process policy before the process port',
  checksRealProcessBoundary,
);

async function checksNodeClosure() {
  const result = await Bun.build({
    entrypoints: [
      decodeURIComponent(
        new URL('../src/linux-qualification/prepared-inputs.ts', import.meta.url).pathname,
      ),
    ],
    target: 'node',
    metafile: true,
  });
  expect(result.success).toBe(true);
  expect(result.metafile).toBeDefined();
  const inputs = Object.keys(result.metafile!.inputs);
  expect(
    inputs.some((path) =>
      /(?:^|\/)(?:inputs|cache-download|source-payload|frozen-dependencies)\.ts$/.test(path),
    ),
  ).toBe(false);
  expect(inputs.some((path) => path.includes('platform-bun'))).toBe(false);
}
test('PreparedInputs Node bundle excludes host acquisition and Bun-only code', checksNodeClosure);

async function preservesAdmittedModes() {
  function changeUmask(mask: number) {
    const workflow = Effect.try(() => process.umask(mask));
    return workflow;
  }
  function restoreUmask(mask: number) {
    function* restore() {
      const restoring = changeUmask(mask).pipe(Effect.result);
      const restored = yield* restoring;
      expect(restored._tag).toBe('Success');
    }
    const workflow = Effect.gen(restore);
    return workflow;
  }
  function* check() {
    const changing = changeUmask(0o077);
    yield* Effect.acquireRelease(changing, restoreUmask);
    const { service, fs } = yield* scenario({ mode: '100755' });
    const source = yield* service.admitSource();
    const info = yield* fs.stat(`${source.root}/hello.txt`);
    expect(info.mode & 0o777).toBe(0o755);
    expect(source.files[0]!.mode).toBe('100755');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'staged source mode identity is independent of the trusted host umask',
  preservesAdmittedModes,
);

async function rejectsArtifactIdentitySubstitution() {
  const bytes = encode('inert artifact');
  let hits = 0;
  const artifact = {
    identity: 'fixture@2.0.0',
    url: 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz',
    integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
  };
  async function get() {
    hits++;
    return new Response(bytes);
  }
  function* check() {
    const { service } = yield* scenario();
    const staging = service.stageArtifacts([artifact], get).pipe(Effect.result);
    expect((yield* staging)._tag).toBe('Failure');
    expect(hits).toBe(0);
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withTestPlatform);
  await Effect.runPromise(provided);
}
test(
  'artifact identity must derive the exact frozen GET URL before acquisition',
  rejectsArtifactIdentitySubstitution,
);

function checksTrustedToolPolicy() {
  const node = { ...toolInventory[0]!, size: 67108865 };
  const context = { ...reviewed, build: { ...reviewed.build, files: [node, toolInventory[1]!] } };
  expect(Schema.decodeUnknownResult(ReviewedInputContext)(context)._tag).toBe('Success');
  expect(
    Schema.decodeUnknownResult(ArtifactDigest)({
      identity: 'fixture@1.0.0',
      url: 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz',
      integrity: 'synthetic',
      path: 'artifacts/0000.tgz',
      size: 67108865,
      sha256: 'a'.repeat(64),
    })._tag,
  ).toBe('Failure');
  const reduced = { fileBytes: 12, totalBytes: 20 };
  const fixtures = [new Uint8Array(12), new Uint8Array(8)];
  const sizes = fixtures.map((file) => file.length);
  expect(trustedToolsFit(sizes, reduced)).toBe(true);
  expect(trustedToolsFit([13, 1], reduced)).toBe(false);
  expect(trustedToolsFit([12, 9], reduced)).toBe(false);
  expect(trustedToolsFit([0, 1], reduced)).toBe(false);
  expect(trustedToolsFit([1, 1], { fileBytes: 201326593, totalBytes: 268435456 })).toBe(false);
  expect(trustedToolsFit([1, 1], { fileBytes: 201326592, totalBytes: 268435457 })).toBe(false);
}
test(
  'trusted tool sizes have independent file and total caps without widening raw artifacts',
  checksTrustedToolPolicy,
);
