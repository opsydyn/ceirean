import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Match, Path, Result, Schema } from 'effect';

import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';
import {
  commandSpec,
  classifyCacheFailure,
  makeWorkerCases,
  makeWorkerPlatform,
  makeWorkerProcess,
  makeWorkerArchives,
  makeWorkerCatalog,
  WorkerPlatform,
  WorkerProcess,
  WorkerArchives,
  WorkerCatalog,
  WorkerError,
  writeWorkerEvidence,
  workerTools,
  type WorkerCommand,
} from '../src/linux-qualification/cases.ts';
import { evidenceRequirements, requiredCases } from '../src/linux-qualification/contract.ts';
import { qualificationInstall, inputPins } from '../src/linux-qualification/tool-pins.ts';
import { stage, gzip, goodTar } from './linux-archive-fixtures.ts';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const withPlatform = Effect.provide(BunServices.layer);
const withMetadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
const withProcesses = Effect.provideService(WorkerProcess, makeWorkerProcess());
const withArchives = Effect.provideService(WorkerArchives, makeWorkerArchives());
const withCatalog = Effect.provideService(WorkerCatalog, makeWorkerCatalog());
const unavailable = Effect.provideService(WorkerPlatform, makeWorkerPlatform());
const PartialDiagnostic = Schema.Struct({
  _tag: Schema.Literal('Incomplete'),
  activation: Schema.Literal('Blocked'),
  exitCode: Schema.Literal(1),
  qualificationReceipt: Schema.Literal('NotProduced'),
});
const selected = {
  key: 'foo',
  identity: 'foo@1.0.0',
  name: 'foo',
  version: '1.0.0',
  constraints: { os: [], cpu: [], libc: [] },
};
const auditInput = {
  selected: [selected],
  excluded: [],
  workspaces: { '': { dependencies: { foo: '1.0.0' } } },
};
const syntheticReadbacks = {
  _tag: 'Verified',
  os: 'Linux',
  architecture: 'x86_64',
  libc: 'glibc',
  bun: '1.3.11',
  node: '22.23.4',
  runnerImage: 'synthetic',
  runnerVersion: 'synthetic',
  dockerVersion: 'synthetic',
  installerConfigSha256: 'a'.repeat(64),
  nodeConfigSha256: 'b'.repeat(64),
  nodeExecutableSha256: 'c'.repeat(64),
  controllerExecutableSha256: 'd'.repeat(64),
  controls: {
    networkNone: true,
    readOnlyRoot: true,
    unprivileged: true,
    capabilitiesDropped: true,
    noNewPrivileges: true,
    noExtraDevices: true,
    privatePidIpc: true,
    noPublishedPorts: true,
    noDockerSocket: true,
    boundedTmpfs: true,
    noexecNosuidNodev: true,
    networkDnsTcpDenied: true,
    resourceLimitsVerified: true,
    runnerEligible: true,
  },
} as const;
type Options = {
  observerUnavailable?: boolean;
  unexpectedChild?: boolean;
  native?: boolean;
  mutateSource?: boolean;
  mutateLock?: boolean;
  metadataRequest?: boolean;
  unrelatedFailure?: boolean;
  hardlinkInstall?: boolean;
  deadlineUnknown?: boolean;
  wrongRuntime?: boolean;
  negativeFailure?: { install: 4 | 5; exitCode: number; stderr: string };
};
function fixture() {
  function* prepare() {
    const bytes = yield* Effect.promise(async () => gzip(goodTar()));
    const inputs = yield* stage([bytes]);
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(`${inputs.root}/source`);
    const lock = yield* fs.readFile(
      `${import.meta.dir}/../fixtures/dependencies/consumer.bun.lock`,
    );
    const manifest = new TextEncoder().encode(encode({ dependencies: { foo: '1.0.0' } }));
    yield* fs.writeFile(`${inputs.root}/source/bun.lock`, lock);
    yield* fs.writeFile(`${inputs.root}/source/package.json`, manifest);
    yield* fs.makeDirectory(`${inputs.root}/source/src/pages`, { recursive: true });
    const route = new TextEncoder().encode('inert owned route bytes');
    yield* fs.writeFile(`${inputs.root}/source/src/pages/[...path].astro`, route);
    yield* fs.chmod(`${inputs.root}/source/src/pages/[...path].astro`, 0o644);
    for (const path of ['bun.lock', 'package.json'])
      yield* fs.chmod(`${inputs.root}/source/${path}`, 0o644);
    const files = [
      {
        path: 'bun.lock',
        mode: '100644' as const,
        objectId: 'a'.repeat(40),
        size: lock.length,
        sha256: hash(lock),
      },
      {
        path: 'package.json',
        mode: '100644' as const,
        objectId: 'b'.repeat(40),
        size: manifest.length,
        sha256: hash(manifest),
      },
      {
        path: 'src/pages/[...path].astro',
        mode: '100644' as const,
        objectId: 'c'.repeat(40),
        size: route.length,
        sha256: hash(route),
      },
    ];
    const sha256 = hash(encode(files));
    return {
      ...inputs,
      source: { files, sha256 },
      admission: { ...inputs.admission, source: { ...inputs.admission.source, sha256 } },
    };
  }
  const workflow = Effect.gen(prepare);
  return workflow;
}
function scenario(options: Options = {}) {
  const calls: string[] = [];
  let installs = 0;
  let stopped = false;
  function runtime(command: WorkerCommand) {
    const version = Match.value(Boolean(options.wrongRuntime)).pipe(
      Match.when(true, () => '1.4.2'),
      Match.orElse(() => '1.3.11'),
    );
    const stdout = Match.value(command.kind).pipe(
      Match.when('BunVersion', () => version),
      Match.when('BunHelp', () => qualificationInstall.argv.join(' ')),
      Match.when(
        'NodeIdentity',
        () => '{"node":"22.23.4","os":"linux","architecture":"x64","libc":"2.36"}',
      ),
      Match.orElse(() => ''),
    );
    calls.push(command.kind);
    const workflow = Effect.succeed({ stdout, stderr: '', exitCode: 0 });
    return workflow;
  }
  function observe(command: WorkerCommand) {
    function* executeFakeTarget() {
      const fs = yield* FileSystem.FileSystem;
      installs++;
      calls.push(`install-${installs}`);
      expect(commandSpec(command).args).toEqual(qualificationInstall.argv.slice(1));
      expect(Object.keys(commandSpec(command).env).sort()).toEqual([
        'BUN_INSTALL_CACHE_DIR',
        'HOME',
        'LANG',
        'LC_ALL',
        'PATH',
        'TMPDIR',
      ]);
      expect(yield* fs.readDirectory(command.workspace)).not.toContain('node_modules');
      const cacheEntries = yield* fs.readDirectory(command.cache);
      const hasFoo = yield* fs.exists(`${command.cache}/opaque-identity/package.json`);
      const miss = installs >= 4 && !hasFoo;
      function* materialize() {
        calls.push('warmup');
        yield* fs.makeDirectory(`${command.cache}/opaque-identity`);
        yield* fs.writeFileString(
          `${command.cache}/opaque-identity/package.json`,
          '{"name":"foo","version":"1.0.0"}',
        );
      }
      const warming = Effect.gen(materialize);
      const isWarmup = Effect.sync(() => installs === 2);
      const warmWhenNeeded = warming.pipe(Effect.when(isWarmup));
      yield* warmWhenNeeded;
      function* installPackage() {
        yield* fs.makeDirectory(`${command.workspace}/node_modules/foo`, { recursive: true });
        const source = `${command.cache}/opaque-identity/package.json`;
        const destination = `${command.workspace}/node_modules/foo/package.json`;
        const copy = Match.value(options.hardlinkInstall && installs === 3).pipe(
          Match.when(true, () => fs.link(source, destination)),
          Match.orElse(() => fs.copyFile(source, destination)),
        );
        yield* copy;
      }
      const installing = Effect.gen(installPackage);
      const installNeeded = Effect.sync(() => !miss && installs !== 1);
      const installWhenNeeded = installing.pipe(Effect.when(installNeeded));
      yield* installWhenNeeded;
      const changedFile = Match.value(Boolean(options.mutateLock)).pipe(
        Match.when(true, () => 'bun.lock'),
        Match.orElse(() => 'package.json'),
      );
      const mutation = fs.writeFileString(`${command.workspace}/${changedFile}`, 'mutation');
      const mutationRequested = Effect.sync(
        () => installs === 2 && Boolean(options.mutateSource || options.mutateLock),
      );
      const mutateWhenNeeded = mutation.pipe(Effect.when(mutationRequested));
      yield* mutateWhenNeeded;
      for (const index of [installs].filter((value) => value === 3)) {
        void index;
        expect(stopped).toBe(true);
        calls.push('positive');
      }
      for (const index of [installs].filter((value) => value === 4)) {
        void index;
        expect(cacheEntries).toHaveLength(0);
      }
      for (const index of [installs].filter((value) => value === 5)) {
        void index;
        expect(hasFoo).toBe(false);
      }
      const stderr = Match.value({ miss, unrelated: options.unrelatedFailure }).pipe(
        Match.when({ miss: true, unrelated: true }, () => 'error while loading shared libraries'),
        Match.when(
          { miss: true },
          () => 'ConnectionRefused http://127.0.0.1:4873/foo/-/foo-1.0.0.tgz',
        ),
        Match.orElse(() => ''),
      );
      const executions = Match.value(Boolean(options.unexpectedChild)).pipe(
        Match.when(true, () => [workerTools.bun, '/bin/sh']),
        Match.orElse(() => [workerTools.bun]),
      );
      const nativeExecutions = Match.value(Boolean(options.native)).pipe(
        Match.when(true, () => ['/work/helper']),
        Match.orElse(() => [] as string[]),
      );
      const failure = [options.negativeFailure].find((value) => value?.install === installs);
      const processResult = Match.value(failure).pipe(
        Match.when(undefined, () => ({ stderr, exitCode: Number(miss) })),
        Match.orElse((value) => ({ stderr: value.stderr, exitCode: value.exitCode })),
      );
      return {
        stdout: '',
        ...processResult,
        complete: true,
        executions,
        nativeExecutions,
      };
    }
    const workflow = Effect.gen(executeFakeTarget);
    return workflow;
  }
  function admitChildObservation() {
    const admission = Effect.sync(() => !options.observerUnavailable);
    const admitted = admission.pipe(
      Effect.filterOrFail(
        (value) => value,
        () => new WorkerError({ code: 'BlockedChildObservation' }),
      ),
      Effect.asVoid,
    );
    return admitted;
  }
  function cancellation() {
    calls.push('cancellation');
    const workflow = Effect.succeed({
      deadlineStoppedOwnedResources: !options.deadlineUnknown,
      interruptedWarmupStopped: true,
      removalConfirmed: true,
    });
    return workflow;
  }
  const platform = {
    ...makeWorkerPlatform(),
    preflight: () => Effect.sync(() => syntheticReadbacks),
    admitChildObservation,
    observe,
    cancellation,
  };
  const archives = {
    ...makeWorkerArchives(),
    startReplay: () =>
      Effect.succeed({
        host: '127.0.0.1' as const,
        port: 4873,
        stop: () =>
          Effect.sync(() => {
            calls.push('stop-replay');
            stopped = true;
          }),
        snapshotRequests: () =>
          Effect.succeed({
            blocked: Boolean(options.metadataRequest),
            truncated: false,
            requests: [],
          }),
      }),
  };
  const providePlatform = Effect.provideService(WorkerPlatform, platform);
  const provideProcesses = Effect.provideService(WorkerProcess, { run: runtime });
  const provideArchives = Effect.provideService(WorkerArchives, archives);
  const provideCatalog = Effect.provideService(WorkerCatalog, {
    read: () => Effect.sync(() => auditInput),
  });
  function run() {
    function* check() {
      const inputs = yield* fixture();
      const result = yield* makeWorkerCases().runWorkerCases(inputs);
      yield* writeWorkerEvidence(result, `${inputs.root}/evidence`);
      const fs = yield* FileSystem.FileSystem;
      const documents: Record<string, string> = {};
      for (const document of result.evidence) {
        const name = evidenceRequirements[document.caseId].name;
        documents[name] = yield* fs.readFileString(`${inputs.root}/evidence/${name}`);
      }
      const refusalKeys = Match.value(result).pipe(
        Match.when({ _tag: 'Incomplete' }, (value) => Object.keys(value.refusal)),
        Match.orElse(() => [] as string[]),
      );
      return { result, inputs, documents, refusalKeys };
    }
    const workflow = Effect.gen(check);
    const scoped = Effect.scoped(workflow);
    const provided = scoped.pipe(
      providePlatform,
      provideProcesses,
      provideArchives,
      provideCatalog,
      withMetadata,
      withPlatform,
    );
    const running = Effect.runPromise(provided);
    return running;
  }
  return { run, calls, installs: () => installs };
}
async function orderedWorkflow() {
  const s = scenario();
  const { result, inputs, documents } = await s.run();
  expect(result._tag).toBe('Completed');
  expect(result.exitCode).toBe(0);
  expect(result.observations.map((item) => item.caseId)).toEqual([...requiredCases]);
  expect(result.seedAdmission?.sourceSha256).toBe(inputs.source.sha256);
  expect(result.seedAdmission?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(s.calls.indexOf('warmup')).toBeLessThan(s.calls.indexOf('stop-replay'));
  expect(s.calls.indexOf('stop-replay')).toBeLessThan(s.calls.indexOf('positive'));
  expect(s.installs()).toBe(5);
  for (const document of result.evidence) {
    expect(document.checks).toEqual(evidenceRequirements[document.caseId].checks);
    expect(document.observation.evidence).toEqual([evidenceRequirements[document.caseId].name]);
    expect(documents[evidenceRequirements[document.caseId].name]).toBe(encode(document));
  }
}
test(
  'ordered full workflow uses actual seal/copies/metadata and fixed evidence contract',
  orderedWorkflow,
);
async function unavailableObserver() {
  const s = scenario({ observerUnavailable: true });
  const { result, refusalKeys } = await s.run();
  expect(result.observations.at(-1)?.reason).toBe('BlockedChildObservation');
  expect(result.exitCode).toBe(1);
  expect(result.seedAdmission).toBeUndefined();
  expect(s.installs()).toBe(0);
  expect(refusalKeys).toEqual(['caseId', 'stage', 'reason']);
}
test('unavailable observer stops before any install and has no seed', unavailableObserver);
async function unexpectedExecution(options: Options) {
  const s = scenario(options);
  const { result } = await s.run();
  expect(result.observations.at(-1)?.reason).toBe('BlockedChildObservation');
  expect(s.installs()).toBe(1);
}
for (const options of [{ unexpectedChild: true }, { native: true }])
  test(`disallowed execution ${encode(options)}`, () => unexpectedExecution(options));
async function changedInput(options: Options) {
  const s = scenario(options);
  const { result } = await s.run();
  expect(result.observations.at(-1)?.reason).toBe('InputChanged');
  expect(result.seedAdmission).toBeUndefined();
  expect(s.installs()).toBe(2);
  expect(s.calls).toContain('stop-replay');
}
for (const options of [{ mutateSource: true }, { mutateLock: true }])
  test(`source invariance ${encode(options)}`, () => changedInput(options));
async function metadataRequest() {
  const s = scenario({ metadataRequest: true });
  const { result } = await s.run();
  expect(result.observations.at(-1)?.reason).toBe('BlockedMissingBunMetadata');
  expect(result.seedAdmission).toBeUndefined();
  expect(s.installs()).toBe(2);
}
test('metadata request blocks without sealing', metadataRequest);
async function unrelatedFailure() {
  const s = scenario({ unrelatedFailure: true });
  const { result } = await s.run();
  expect(result.exitCode).toBe(1);
  expect(result.observations.at(-1)?.caseId).toBe('EmptyCache');
  expect(s.installs()).toBe(4);
}
test('unrelated empty-cache failure never satisfies negative', unrelatedFailure);
async function aliasFailure() {
  const s = scenario({ hardlinkInstall: true });
  const { result } = await s.run();
  expect(result.exitCode).toBe(1);
  expect(result.observations.at(-1)?.caseId).toBe('CaseIsolation');
}
test('copy backend hardlink alias caught by installed mutation', aliasFailure);
async function cancellationFailure() {
  const s = scenario({ deadlineUnknown: true });
  const { result } = await s.run();
  expect(result.exitCode).toBe(1);
  expect(result.observations.at(-1)?.reason).toBe('CleanupUnknown');
}
test('unconfirmed cancellation cannot pass', cancellationFailure);
async function runtimeFailure() {
  const s = scenario({ wrongRuntime: true });
  const { result } = await s.run();
  expect(result.observations.at(-1)?.reason).toBe('BlockedRuntime');
  expect(s.installs()).toBe(0);
}
test('wrong runtime blocks all installs', runtimeFailure);
function exactNegative() {
  expect(
    classifyCacheFailure(
      { exitCode: 1, stderr: 'ConnectionRefused http://127.0.0.1:4873/foo/-/foo-1.0.0.tgz' },
      'foo@1.0.0',
    ),
  ).toBe(true);
  expect(classifyCacheFailure({ exitCode: 1, stderr: 'ConnectionRefused bar' }, 'foo@1.0.0')).toBe(
    false,
  );
  expect(classifyCacheFailure({ exitCode: 0, stderr: 'cache miss foo' }, 'foo@1.0.0')).toBe(false);
  expect(classifyCacheFailure({ exitCode: 1, stderr: 'unknown option --backend' })).toBe(false);
}
test('negative classification requires missing identity and cache diagnostic', exactNegative);

const normalCacheMiss = {
  exitCode: 1,
  stderr: 'ConnectionRefused http://127.0.0.1:4873/foo/-/foo-1.0.0.tgz',
};
const misleadingCacheFailures = [
  {
    name: 'review warning plus EACCES',
    stderr:
      'warning: cache miss http://127.0.0.1:4873/foo/-/foo-1.0.0.tgz\nerror: EACCES opening bun.lock',
  },
  {
    name: 'permission after exact refusal',
    stderr: `${normalCacheMiss.stderr}\nerror: EACCES opening bun.lock`,
  },
  {
    name: 'permission before exact refusal',
    stderr: `error: EPERM opening cache\n${normalCacheMiss.stderr}`,
  },
  {
    name: 'permission on refusal line',
    stderr: `${normalCacheMiss.stderr} EACCES opening bun.lock`,
  },
  {
    name: 'missing runtime executable',
    stderr: `${normalCacheMiss.stderr}\nerror: ENOENT spawning bun`,
  },
  {
    name: 'runtime loader failure',
    stderr: `${normalCacheMiss.stderr}\nerror while loading shared libraries`,
  },
  {
    name: 'unsupported runtime flag',
    stderr: `${normalCacheMiss.stderr}\nunknown option --backend`,
  },
  { name: 'OOM diagnostic', stderr: `${normalCacheMiss.stderr}\nOut of memory: Killed process` },
  {
    name: 'fatal V8 heap diagnostic',
    stderr: `${normalCacheMiss.stderr}\nFATAL ERROR: Reached heap limit`,
  },
  { name: 'signal diagnostic', stderr: `${normalCacheMiss.stderr}\nterminated by SIGKILL` },
  {
    name: 'segmentation fault diagnostic',
    stderr: `${normalCacheMiss.stderr}\nSegmentation fault`,
  },
  { name: 'deadline diagnostic', stderr: `${normalCacheMiss.stderr}\nprocess deadline exceeded` },
  {
    name: 'warning alone',
    stderr: 'warning: cache miss http://127.0.0.1:4873/foo/-/foo-1.0.0.tgz',
  },
  {
    name: 'unrelated socket failure with URL elsewhere',
    stderr: 'ConnectionRefused on another endpoint\nhttp://127.0.0.1:4873/foo/-/foo-1.0.0.tgz',
  },
  { name: 'wrong version', stderr: 'ConnectionRefused http://127.0.0.1:4873/foo/-/foo-2.0.0.tgz' },
  { name: 'URL query suffix', stderr: `${normalCacheMiss.stderr}?failure=EACCES` },
  {
    name: 'unknown multiline diagnostic',
    stderr: `${normalCacheMiss.stderr}\nunknown installer failure`,
  },
];
for (const failure of misleadingCacheFailures) {
  test(`cache classifier refuses ${failure.name}`, () =>
    expect(classifyCacheFailure({ exitCode: 1, stderr: failure.stderr }, 'foo@1.0.0')).toBe(false));
}
for (const exitCode of [
  0,
  2,
  64,
  126,
  127,
  128,
  129,
  134,
  137,
  139,
  143,
  255,
  -9,
  -15,
  1.5,
  NaN,
  Infinity,
]) {
  test(`cache classifier refuses abnormal or unsupported exit ${exitCode}`, () =>
    expect(classifyCacheFailure({ ...normalCacheMiss, exitCode }, 'foo@1.0.0')).toBe(false));
}
function intendedCacheFailureContext() {
  expect(classifyCacheFailure(normalCacheMiss)).toBe(false);
  expect(classifyCacheFailure(normalCacheMiss, 'bar@1.0.0')).toBe(false);
  expect(classifyCacheFailure(normalCacheMiss, 'foo@2.0.0')).toBe(false);
  expect(classifyCacheFailure(normalCacheMiss, 'foo@1.0.0')).toBe(true);
  expect(
    classifyCacheFailure(
      { ...normalCacheMiss, stderr: `${normalCacheMiss.stderr}\n` },
      'foo@1.0.0',
    ),
  ).toBe(true);
  expect(
    classifyCacheFailure(
      {
        exitCode: 1,
        stderr: 'ConnectionRefused http://127.0.0.1:4873/@owned/local/-/local-1.0.0.tgz\r\n',
      },
      '@owned/local@1.0.0',
    ),
  ).toBe(true);
}
test(
  'cache classifier requires exact missing identity context and preserves normal refusals',
  intendedCacheFailureContext,
);

async function unrelatedNegativeStops(install: 4 | 5, failure: typeof normalCacheMiss) {
  const s = scenario({ negativeFailure: { install, ...failure } });
  const { result } = await s.run();
  const caseId = Match.value(install).pipe(
    Match.when(4, () => 'EmptyCache' as const),
    Match.orElse(() => 'MissingRequiredArtifact' as const),
  );
  expect(result._tag).toBe('Incomplete');
  expect(result.observations.at(-1)?.caseId).toBe(caseId);
  expect(result.observations.at(-1)?.stage).toBe('Offline');
  expect(result.observations.at(-1)?.reason).toBe('EvidenceIncomplete');
  expect(s.installs()).toBe(install);
}
for (const install of [4, 5] as const) {
  test(`mixed permission failure stops negative install ${install}`, () =>
    unrelatedNegativeStops(install, {
      exitCode: 1,
      stderr: `${normalCacheMiss.stderr}\nerror: EACCES opening bun.lock`,
    }));
  test(`abnormal status stops negative install ${install}`, () =>
    unrelatedNegativeStops(install, { ...normalCacheMiss, exitCode: 137 }));
}
async function metadataAudit() {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-cases-audit-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.makeDirectory(`${root}/node_modules/alien`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/node_modules/alien/package.json`,
      '{"name":"alien","version":"9.0.0","main":"throw-on-import.js"}',
    );
    yield* fs.writeFileString(
      `${root}/node_modules/alien/throw-on-import.js`,
      'throw new Error("must not import")',
    );
    const result = yield* makeWorkerCases().auditInstalled(root, auditInput).pipe(Effect.result);
    expect(result._tag).toBe('Failure');
    yield* fs.remove(`${root}/node_modules/alien`, { recursive: true });
    yield* fs.symlink('/private/tmp', `${root}/node_modules/escape`);
    const escaped = yield* makeWorkerCases().auditInstalled(root, auditInput).pipe(Effect.result);
    expect(escaped._tag).toBe('Failure');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test('metadata read as data rejects foreign identities and escaping links', metadataAudit);
async function defaultRefusal() {
  function* check() {
    const inputs = yield* fixture();
    const result = yield* makeWorkerCases().runWorkerCases(inputs);
    expect(result._tag).toBe('Incomplete');
    expect(result.exitCode).toBe(1);
    expect(result.observations.at(-1)?.reason).toBe('BlockedControls');
    expect(result.seedAdmission).toBeUndefined();
    expect(result.observations[0]?.digests._tag).toBe('Unknown');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(
    unavailable,
    withProcesses,
    withArchives,
    withCatalog,
    withMetadata,
    withPlatform,
  );
  await Effect.runPromise(provided);
}
test(
  'default controls produce explicit incomplete diagnostic without seed or hashes',
  defaultRefusal,
);

async function archiveControl() {
  const result = await Effect.runPromise(makeWorkerArchives().negatives());
  expect(result).toEqual({ controlAdmitted: true, refused: 6 });
}
test('archive negative fixtures first admit a valid control archive', archiveControl);

async function canonicalCatalog() {
  function* check() {
    const inputs = yield* fixture();
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs.readFile(`${import.meta.dir}/../fixtures/dependencies/inventory.lock`);
    const CatalogWorkspaces = Schema.Struct({
      bun: Schema.Struct({
        workspaces: Schema.Array(Schema.Struct({ key: Schema.String, identity: Schema.String })),
      }),
    });
    const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(CatalogWorkspaces));
    const catalog = yield* decode(new TextDecoder().decode(bytes));
    for (const item of catalog.bun.workspaces) {
      const relative = item.identity.split('@workspace:')[1]!;
      yield* fs.makeDirectory(`${inputs.root}/source/${relative}`, { recursive: true });
      yield* fs.writeFileString(
        `${inputs.root}/source/${relative}/package.json`,
        encode({ name: item.key }),
      );
    }
    yield* fs.makeDirectory(`${inputs.root}/catalog`);
    yield* fs.writeFile(`${inputs.root}/catalog/inventory.lock`, bytes);
    const prepared = {
      ...inputs,
      catalog: { ...inputs.catalog, sha256: inputPins.inventorySha256 },
    };
    const audited = yield* makeWorkerCatalog().read(prepared);
    expect(audited.selected.length).toBe(674);
    expect(Object.keys(audited.workspaces)).toHaveLength(5);
    expect(audited.selected.some((entry) => entry.name.endsWith('-musl'))).toBe(true);
    yield* fs.writeFileString(`${inputs.root}/catalog/inventory.lock`, '{}');
    const changed = yield* makeWorkerCatalog().read(prepared).pipe(Effect.result);
    expect(changed._tag).toBe('Failure');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'audit reads SHA-pinned catalog JSON, not raw Bun lock or cross-profile artifacts',
  canonicalCatalog,
);

async function actualEvidenceFiles() {
  function* check() {
    const inputs = yield* fixture();
    const fs = yield* FileSystem.FileSystem;
    const result = yield* makeWorkerCases().runWorkerCases(inputs);
    const root = `${inputs.root}/evidence`;
    yield* writeWorkerEvidence(result, root);
    expect(yield* fs.readDirectory(root)).toEqual(['worker-diagnostic.json']);
    const raw = yield* fs.readFileString(`${root}/worker-diagnostic.json`);
    const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(PartialDiagnostic));
    expect((yield* decode(raw)).exitCode).toBe(1);
    expect(raw).not.toContain('seedAdmission');
    expect(raw).not.toContain('seedBefore');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(
    unavailable,
    withProcesses,
    withArchives,
    withCatalog,
    withMetadata,
    withPlatform,
  );
  await Effect.runPromise(provided);
}
test(
  'early refusal writes bounded partial diagnostic, never a seed or full receipt',
  actualEvidenceFiles,
);

async function fixedWorkerCli() {
  const executable = `${import.meta.dir}/../scripts/linux-qualification-worker.ts`;
  const extra = Bun.spawn({
    cmd: [process.execPath, '--no-env-file', executable, '--check', '--allow-observer'],
    env: {},
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await extra.exited).toBe(64);
  const check = Bun.spawn({
    cmd: [process.execPath, '--no-env-file', executable, '--check'],
    env: { CEIREAN_CHILD_OBSERVER: 'true', CEIREAN_CONTROLS_VERIFIED: 'true' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(check.stdout).text();
  expect(await check.exited).toBe(1);
  expect(output).toContain('BlockedChildObservation');
  expect(output).not.toContain('seedSha256');
}
test(
  'fixed worker CLI refuses extra arguments and cannot gain capability from env',
  fixedWorkerCli,
);

async function directResolutionAndInternalLinks() {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-direct-resolution-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.makeDirectory(`${root}/node_modules/.bun/opaque/node_modules/foo`, {
      recursive: true,
    });
    yield* fs.writeFileString(
      `${root}/node_modules/.bun/opaque/node_modules/foo/package.json`,
      '{"name":"foo","version":"1.0.0","main":"must-not-import.js"}',
    );
    yield* fs.writeFileString(
      `${root}/node_modules/.bun/opaque/node_modules/foo/must-not-import.js`,
      'throw new Error("must not import")',
    );
    const missing = yield* makeWorkerCases().auditInstalled(root, auditInput).pipe(Effect.result);
    expect(missing._tag).toBe('Failure');
    yield* fs.symlink('.bun/opaque/node_modules/foo', `${root}/node_modules/foo`);
    const installed = yield* makeWorkerCases().auditInstalled(root, auditInput);
    expect(installed.direct.map((entry) => entry.identity)).toEqual(['foo@1.0.0']);
    yield* fs.writeFileString(
      `${root}/node_modules/.bun/opaque/node_modules/foo/package.json`,
      '{"name":"foo","version":"2.0.0"}',
    );
    const wrong = yield* makeWorkerCases().auditInstalled(root, auditInput).pipe(Effect.result);
    expect(wrong._tag).toBe('Failure');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'direct dependency must resolve at its workspace; internal package links are data',
  directResolutionAndInternalLinks,
);

async function conservativeExclusions() {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-exclusion-policy-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.makeDirectory(`${root}/node_modules/foo`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/node_modules/foo/package.json`,
      '{"name":"foo","version":"1.0.0"}',
    );
    const absent = {
      ...selected,
      key: 'extra-musl',
      name: 'extra-musl',
      identity: 'extra-musl@1.0.0',
    };
    const candidate = { ...auditInput, selected: [selected, absent] };
    const unexplainedResult = yield* makeWorkerCases()
      .auditInstalled(root, candidate)
      .pipe(Effect.result);
    expect(unexplainedResult._tag).toBe('Failure');
    const UnexplainedSkip = Schema.Struct({
      detail: Schema.Literal('UnexplainedSkip'),
      identity: Schema.Literal('extra-musl@1.0.0'),
    });
    const isUnexplainedSkip = Schema.is(UnexplainedSkip);
    const detail = unexplainedResult.pipe(
      Result.match({
        onFailure: isUnexplainedSkip,
        onSuccess: () => false,
      }),
    );
    expect(detail).toBe(true);
    const optional = {
      ...candidate,
      workspaces: {
        '': { dependencies: { foo: '1.0.0' }, optionalDependencies: { 'extra-musl': '1.0.0' } },
      },
    };
    const admitted = yield* makeWorkerCases().auditInstalled(root, optional);
    expect(admitted.exclusions[0]?.reason).toBe('OptionalNotSelected');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'conservative candidate absence needs explicit optional/platform evidence, never name guessing',
  conservativeExclusions,
);

async function verifiedWorkspaceLink() {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-workspace-link-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.makeDirectory(`${root}/packages/local`, { recursive: true });
    yield* fs.makeDirectory(`${root}/node_modules/@owned`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/packages/local/package.json`,
      '{"name":"@owned/local","version":"1.0.0"}',
    );
    yield* fs.symlink('../../packages/local', `${root}/node_modules/@owned/local`);
    const input = {
      selected: [],
      excluded: [],
      workspaces: {
        '': { dependencies: { '@owned/local': 'workspace:*' } },
        'packages/local': { name: '@owned/local' },
      },
    };
    const audit = yield* makeWorkerCases().auditInstalled(root, input);
    expect(audit.links).toHaveLength(1);
    expect(audit.direct).toHaveLength(0);
    yield* fs.remove(`${root}/node_modules/@owned/local`);
    const missing = yield* makeWorkerCases().auditInstalled(root, input).pipe(Effect.result);
    expect(missing._tag).toBe('Failure');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test(
  'verified workspace link satisfies local dependency without inventing a registry identity',
  verifiedWorkspaceLink,
);

async function rejectsWorkspaceAlias(aliases: readonly string[]) {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-workspace-alias-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.makeDirectory(`${root}/packages/local`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/packages/local/package.json`,
      '{"name":"@owned/local","version":"1.0.0"}',
    );
    for (const alias of aliases) {
      const link = `${root}/node_modules/${alias}`;
      const parent = paths.dirname(link);
      yield* fs.makeDirectory(parent, { recursive: true });
      yield* fs.symlink(paths.relative(parent, `${root}/packages/local`), link);
    }
    const dependencies = Match.value(aliases.includes('@owned/local')).pipe(
      Match.when(true, () => ({ '@owned/local': 'workspace:*' })),
      Match.orElse(() => ({})),
    );
    const input = {
      selected: [],
      excluded: [],
      workspaces: { '': { dependencies }, 'packages/local': { name: '@owned/local' } },
    };
    const result = yield* makeWorkerCases().auditInstalled(root, input).pipe(Effect.result);
    expect(result._tag).toBe('Failure');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
for (const aliases of [
  ['@wrong/local'],
  ['local'],
  ['@owned/local', '@wrong/local'],
  ['@wrong/@owned/local'],
]) {
  test(`workspace aliases must match full admitted scoped name ${aliases.join(',')}`, () =>
    rejectsWorkspaceAlias(aliases));
}

async function rejectsWorkspaceTargetOrMetadata(target: string, metadataName: string) {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-workspace-binding-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.makeDirectory(`${root}/packages/local`, { recursive: true });
    yield* fs.makeDirectory(`${root}/packages/other`, { recursive: true });
    yield* fs.makeDirectory(`${root}/node_modules/@owned`, { recursive: true });
    yield* fs.writeFileString(
      `${root}/${target}/package.json`,
      encode({ name: metadataName, version: '1.0.0' }),
    );
    yield* fs.symlink(
      paths.relative(`${root}/node_modules/@owned`, `${root}/${target}`),
      `${root}/node_modules/@owned/local`,
    );
    const input = {
      selected: [],
      excluded: [],
      workspaces: { '': {}, 'packages/local': { name: '@owned/local' } },
    };
    const result = yield* makeWorkerCases().auditInstalled(root, input).pipe(Effect.result);
    expect(result._tag).toBe('Failure');
  }
  const workflow = Effect.gen(check);
  const scoped = Effect.scoped(workflow);
  const provided = scoped.pipe(withMetadata, withPlatform);
  await Effect.runPromise(provided);
}
test('workspace link rejects canonical but unadmitted target with matching package name', () =>
  rejectsWorkspaceTargetOrMetadata('packages/other', '@owned/local'));
test('workspace link rejects admitted target with mismatched package metadata', () =>
  rejectsWorkspaceTargetOrMetadata('packages/local', '@wrong/local'));
