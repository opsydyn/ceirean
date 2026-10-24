import { Config, Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

import { fromNpmLock, npmProfiles, requireInventory } from './dependency-inventory.ts';
import { digestBytes } from './payload.ts';
import { runPreparationProcess } from './preparation-process.ts';
import { readPinnedSource } from './source-payload.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const NpmVersion = Schema.Literal('10.9.9');
const NodeObservation = Schema.Struct({
  version: Schema.String,
  platform: Schema.String,
  arch: Schema.String,
});

function readOutput(stream: Stream.Stream<Uint8Array, unknown>, maximum: number) {
  function* collect() {
    const chunks: Uint8Array[] = [];
    let total = 0;
    function* append(chunk: Uint8Array) {
      yield* requireInventory(chunk.length <= maximum - total, 'ResolutionRefused');
      total += chunk.length;
      chunks.push(new Uint8Array(chunk));
    }
    yield* Stream.runForEach(stream, (chunk) => Effect.gen(() => append(chunk)));
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(result);
  }
  const workflow = Effect.gen(collect);
  return workflow;
}
export function invokeResolver(
  node: string,
  args: readonly string[],
  home: string,
  cwd: string,
  cache = `${home}/cache`,
) {
  function* run() {
    const child = yield* ChildProcess.make(node, args, {
      cwd,
      shell: false,
      extendEnv: false,
      env: {
        HOME: home,
        TMPDIR: home,
        PATH: '/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'protocol.allow',
        GIT_CONFIG_VALUE_0: 'never',
        NPM_CONFIG_CACHE: cache,
        NPM_CONFIG_USERCONFIG: `${home}/user.npmrc`,
        NPM_CONFIG_GLOBALCONFIG: `${home}/global.npmrc`,
        NPM_CONFIG_IGNORE_SCRIPTS: 'true',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      killSignal: 'SIGKILL',
      forceKillAfter: 0,
    });
    const [output, , code] = yield* Effect.all(
      [readOutput(child.stdout, 131072), readOutput(child.stderr, 262144), child.exitCode],
      { concurrency: 3 },
    );
    yield* requireInventory(code === 0, 'ResolutionRefused');
    return output;
  }
  const workflow = Effect.gen(run);
  const bounded = workflow.pipe(Effect.timeout('90 seconds'));
  const scoped = Effect.scoped(bounded);
  return scoped;
}
export function writeEmptyConfig(home: string) {
  function* write() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(`${home}/user.npmrc`, '', { flag: 'wx', mode: 0o600 });
    yield* fs.writeFileString(`${home}/global.npmrc`, '', { flag: 'wx', mode: 0o600 });
  }
  const workflow = Effect.gen(write);
  return workflow;
}
export function probeNpmVersion(node: string) {
  function* inspect() {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-npm-version-' });
    yield* fs.chmod(home, 0o700);
    yield* writeEmptyConfig(home);
    const npm = decodeURIComponent(
      new URL('../node_modules/npm/bin/npm-cli.js', import.meta.url).pathname,
    );
    const version = yield* invokeResolver(node, [npm, '--version', '--offline'], home, home);
    return yield* Schema.decodeUnknownEffect(NpmVersion)(version.trim());
  }
  const workflow = Effect.gen(inspect);
  const scoped = Effect.scoped(workflow);
  return scoped;
}

export function captureDependencyInputs(repository: string) {
  function* capture() {
    const node = yield* Config.String('CEIREAN_INVENTORY_NODE');
    yield* requireInventory(node.startsWith('/'), 'ResolutionRefused');
    const fs = yield* FileSystem.FileSystem;
    const output = yield* fs.makeTempDirectory({ prefix: 'ceirean-dependency-snapshots-' });
    yield* fs.chmod(output, 0o700);
    yield* writeEmptyConfig(output);
    const files = yield* readPinnedSource(repository);
    const paths = new Map([
      ['bun.lock', 'consumer.bun.lock'],
      ['apps/promo/src/lib/example-project.ts', 'template-generator.source'],
      ['packages/foldkit-viz/package.json', 'viz-package.source'],
    ]);
    const sourceInputs = [];
    for (const [source, name] of paths) {
      const file = files.find((item) => item.path === source);
      const bytes = file?.bytes ?? new Uint8Array();
      yield* requireInventory(bytes.length > 0, 'InputChanged');
      yield* fs.writeFile(`${output}/${name}`, bytes, { mode: 0o600, flag: 'wx' });
      sourceInputs.push({ source, name, sha256: yield* digestBytes(bytes) });
    }
    const nodeText = yield* invokeResolver(
      node,
      [
        '-p',
        'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})',
      ],
      output,
      output,
    );
    const nodeCodec = Schema.fromJsonString(NodeObservation);
    const nodeData = yield* Schema.decodeUnknownEffect(nodeCodec)(nodeText);
    const npm = decodeURIComponent(
      new URL('../node_modules/npm/bin/npm-cli.js', import.meta.url).pathname,
    );
    const version = yield* invokeResolver(node, [npm, '--version'], output, output);
    yield* Schema.decodeUnknownEffect(NpmVersion)(version.trim());
    const profiles = [];
    for (const profile of npmProfiles) {
      const directory = `${output}/${profile.id}`;
      yield* fs.makeDirectory(`${directory}/vendor/foldkit-viz`, { recursive: true });
      yield* fs.writeFileString(`${directory}/package.json`, encode(profile.manifest));
      yield* fs.writeFileString(
        `${directory}/vendor/foldkit-viz/package.json`,
        encode(profile.vendor),
      );
      yield* invokeResolver(
        node,
        [
          npm,
          'install',
          '--package-lock-only',
          '--ignore-scripts',
          '--include=dev',
          '--include=optional',
          '--no-audit',
          '--no-fund',
          '--update-notifier=false',
          '--os=linux',
          '--cpu=x64',
          '--libc=glibc',
          '--registry=https://registry.npmjs.org/',
        ],
        output,
        directory,
      );
      yield* requireInventory(
        !(yield* fs.exists(`${directory}/node_modules`)),
        'ResolutionRefused',
      );
      const info = yield* fs.stat(`${directory}/package-lock.json`);
      yield* requireInventory(info.size > 0n && info.size <= 2097152n, 'ResolutionRefused');
      const bytes = yield* fs.readFile(`${directory}/package-lock.json`);
      const data = yield* decodeJson(new TextDecoder().decode(bytes));
      const inventory = yield* fromNpmLock(data);
      const name = `npm-${profile.id}.lock`;
      yield* fs.writeFile(`${output}/${name}`, bytes, { flag: 'wx', mode: 0o600 });
      profiles.push({
        id: profile.id,
        name,
        sha256: yield* digestBytes(bytes),
        registryEntries: inventory.selected.length,
        excluded: inventory.excluded.length,
      });
    }
    const root = decodeURIComponent(new URL('../../../', import.meta.url).pathname);
    const previousLock = yield* runPreparationProcess(
      '/usr/bin/git',
      ['-C', root, 'show', '1ffb9711890f213a8db6174ea0ca2c41dfd22144:bun.lock'],
      output,
      output,
      2097152,
    );
    const parse = Effect.try(() => Bun.JSON5.parse(new TextDecoder().decode(previousLock)));
    const previous = yield* parse;
    const PreviousLock = Schema.Struct({ packages: Schema.Record(Schema.String, Schema.Unknown) });
    const decoded = yield* Schema.decodeUnknownEffect(PreviousLock)(previous);
    const browser = {
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: {},
      packages: {
        '@playwright/test': decoded.packages['@playwright/test'],
        playwright: decoded.packages.playwright,
        'playwright-core': decoded.packages['playwright-core'],
        effect: decoded.packages.effect,
      },
    };
    const browserText = encode(browser);
    yield* fs.writeFileString(`${output}/browser.bun.lock`, browserText, {
      mode: 0o600,
      flag: 'wx',
    });
    const report = {
      _tag: 'DependencyResolutionSnapshot',
      activation: 'Blocked',
      directory: output,
      target: { os: 'linux', cpu: 'x64', libc: 'glibc' },
      resolver: { npm: version.trim(), host: nodeData },
      sourceInputs,
      profiles,
      browser: {
        name: 'browser.bun.lock',
        sha256: yield* digestBytes(new TextEncoder().encode(browserText)),
        origin: '1ffb9711890f213a8db6174ea0ca2c41dfd22144:bun.lock',
      },
      cacheStatus: 'MetadataOnlyUnqualified',
    } as const;
    yield* fs.writeFileString(`${output}/capture.json`, encode(report), {
      mode: 0o600,
      flag: 'wx',
    });
    return report;
  }
  const workflow = Effect.gen(capture);
  const bounded = workflow.pipe(Effect.timeout('5 minutes'));
  const scoped = Effect.scoped(bounded);
  return scoped;
}
