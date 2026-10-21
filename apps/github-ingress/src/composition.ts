import { LocalIngressPolicy, type ClockReading } from '@ceirean/domain';
import {
  LiveAdmission,
  LiveAuthority,
  LiveInbox,
  makeLiveAdmission,
  makeLiveAuthority,
  makeLiveInbox,
} from '@ceirean/engine';
import { makeGitHubAuthorityDriver } from '@ceirean/github-adapter/authority';
import { captureRequestBody, makeVerifiedGitHubIngress } from '@ceirean/github-adapter/protocol';
import {
  initializeLiveInbox,
  openLiveInbox,
  readLiveInboxStatus,
  type LiveInboxConfig,
} from '@ceirean/github-adapter/storage';
import { BunFileSystem, BunPath, BunStdio } from '@effect/platform-bun';
import {
  Config,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  ManagedRuntime,
  Match,
  Option,
  Path,
  Result,
  Schema,
  Stdio,
  Stream,
} from 'effect';

import {
  CliError,
  HostContext,
  parseArgv,
  readConfiguration,
  type Arguments,
  type Configuration,
} from './config.ts';
import { makeBoundedListener, publicFailure } from './listener.ts';
import { projectProtocolResponse, projectReply } from './responses.ts';

export interface ApplicationOptions {
  readonly host?: HostContext;
  readonly fetch?: Parameters<typeof makeGitHubAuthorityDriver>[0]['fetch'];
  readonly clock?: () => ClockReading;
  readonly schedule?: (callback: () => void, ms: number) => () => void;
  readonly requestClock?: () => number;
  readonly port?: number;
  readonly silent?: boolean;
  readonly testFault?: LiveInboxConfig['testFault'];
}
export function nativeHostContext() {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* Config.String('HOME');
    const temporary = yield* Config.String('TMPDIR').pipe(Config.withDefault('/tmp'));
    const identity = yield* Effect.sync(() => ({
      ownerUid: process.geteuid?.(),
      cwd: process.cwd(),
    }));
    const cwd = yield* fs.realPath(identity.cwd);
    const temporaryRoot = yield* fs.realPath(temporary);
    const repository = yield* fs.exists(path.join(cwd, '.git'));
    const repositoryRoots = Match.value(repository).pipe(
      Match.when(true, () => [cwd]),
      Match.orElse(() => []),
    );
    return yield* Schema.decodeUnknownEffect(HostContext)({
      ...identity,
      cwd,
      homeDirectory: home,
      repositoryRoots,
      buildRoots: ['dist', 'build', '.output', '.moon', 'target'].map((name) =>
        path.join(cwd, name),
      ),
      temporaryRoots: [
        temporaryRoot,
        '/tmp',
        '/private/tmp',
        '/var/tmp',
        '/private/var/tmp',
        '/var/folders',
        '/private/var/folders',
        '/dev/shm',
      ],
      syncedRoots: ['CloudStorage', 'Mobile Documents'].map((name) =>
        path.join(home, 'Library', name),
      ),
    });
  }
  const reading = Effect.gen(read);
  return reading;
}
function storageConfig(
  args: Arguments,
  config: Configuration,
  host: HostContext,
  options: ApplicationOptions,
) {
  const production = {
    _tag: 'Production' as const,
    stateRoot: config.stateRoot,
    ownerUid: host.ownerUid,
    homeDirectory: host.homeDirectory,
    repositoryRoots: host.repositoryRoots,
    buildRoots: host.buildRoots,
    temporaryRoots: host.temporaryRoots,
    syncedRoots: host.syncedRoots,
    filesystem: 'OperatorDeclaredLocalNonSynced' as const,
  };
  const pathPolicy = Option.match(Option.fromNullishOr(host.ownedTemporaryRoot), {
    onNone: () => production,
    onSome: (ownedTemporaryRoot) => ({
      _tag: 'TestOwnedTemporary' as const,
      stateRoot: config.stateRoot,
      ownerUid: host.ownerUid,
      ownedTemporaryRoot,
    }),
  });
  return {
    file: args.database ?? `${config.stateRoot}/github-admission.sqlite`,
    ingressScopeId: config.policy.ingressScopeId,
    initialPolicy: config.policy,
    pathPolicy,
    limits: { decisions: 256, receipts: 1024, authorityRevisions: 256 },
    clock:
      options.clock ?? (() => ({ wallMs: Date.now(), monotonicMs: Math.floor(performance.now()) })),
    testFault: options.testFault,
  } satisfies LiveInboxConfig;
}
const isFile = Schema.is(Schema.Literal('File'));
function readCredential(file: string, ownerUid: number, maximum: number) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(file);
    const safe = [
      isFile(info.type),
      (info.mode & 0o777) === 0o600,
      Option.contains(info.uid, ownerUid),
      Option.contains(info.nlink, 1n),
      Number(info.size) > 0,
      Number(info.size) <= maximum,
      (yield* fs.realPath(file)) === file,
    ].every(Boolean);
    yield* Effect.fromResult(
      Match.value(safe).pipe(
        Match.when(true, () => Result.succeed(undefined)),
        Match.orElse(() => Result.fail(new CliError({ code: 'UnsafeCredentials' }))),
      ),
    );
    return yield* fs.readFileString(file);
  }
  const reading = Effect.gen(read);
  return reading.pipe(Effect.mapError(() => new CliError({ code: 'UnsafeCredentials' })));
}
type Settings = {
  readonly args: Arguments;
  readonly config: Configuration;
  readonly host: HostContext;
  readonly storage: LiveInboxConfig;
  readonly options: ApplicationOptions;
};
function acquireStart({ config, host, storage, options }: Settings) {
  function* acquire() {
    const secret = yield* readCredential(config.webhookSecretFile, host.ownerUid, 4096);
    const privateKey = yield* readCredential(config.privateKeyFile, host.ownerUid, 16384);
    const inbox = yield* openLiveInbox(storage);
    const active = yield* readLiveInboxStatus(storage);
    const samePolicy = Schema.toEquivalence(LocalIngressPolicy)(active.policy, config.policy);
    yield* Effect.fromResult(
      Match.value(samePolicy).pipe(
        Match.when(true, () => Result.succeed(undefined)),
        Match.orElse(() => Result.fail(new CliError({ code: 'OperationFailed' }))),
      ),
    );
    const acquisition = Effect.tryPromise({
      try: () =>
        makeGitHubAuthorityDriver({
          appId: config.policy.appId,
          privateKey,
          fetch: options.fetch ?? fetch,
          clock: storage.clock,
        }),
      catch: () => new CliError({ code: 'OperationFailed' }),
    });
    const opening = acquisition.pipe(Effect.flatMap(Effect.fromResult));
    const authority = yield* Effect.acquireRelease(opening, (resource) =>
      Effect.promise(resource.dispose),
    );
    return { secret, scope: config.policy.ingressScopeId, inbox, authority };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
class StartResources extends Context.Service<
  StartResources,
  Effect.Success<ReturnType<typeof acquireStart>>
>()('@ceirean/github-ingress/StartResources') {}
function startSession() {
  function* acquire() {
    const resources = yield* StartResources;
    const admission = yield* LiveAdmission;
    return { _tag: 'Start' as const, secret: resources.secret, scope: resources.scope, admission };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
function adminSession({ args, config, storage }: Settings) {
  function* configure() {
    const inbox = yield* openLiveInbox(storage);
    return yield* Effect.fromResult(
      inbox.updatePolicy({ expectedRevision: args.expectedRevision, next: config.policy }),
    );
  }
  function* initialize() {
    yield* initializeLiveInbox(storage);
    return { _tag: 'Initialized' as const };
  }
  const configuring = Effect.gen(configure);
  const configureProgram = configuring.pipe(Effect.scoped);
  const initializeProgram = Effect.gen(initialize);
  const operation = Match.value(args.command).pipe(
    Match.when('init', () => initializeProgram),
    Match.when('status', () => readLiveInboxStatus(storage)),
    Match.orElse(() => configureProgram),
  );
  return operation.pipe(Effect.map((output) => ({ _tag: 'Completed' as const, output })));
}
class Invocation extends Context.Service<
  Invocation,
  Effect.Success<ReturnType<typeof startSession> | ReturnType<typeof adminSession>>
>()('@ceirean/github-ingress/Invocation') {}
function invocationLayer(settings: Settings) {
  function start() {
    const resources = Layer.effect(StartResources, acquireStart(settings));
    const inboxEffect = Effect.map(StartResources, (value) => makeLiveInbox(value.inbox.driver));
    const authorityEffect = Effect.map(StartResources, (value) =>
      makeLiveAuthority(value.authority.driver),
    );
    const inputs = Layer.merge(
      Layer.effect(LiveInbox, inboxEffect),
      Layer.effect(LiveAuthority, authorityEffect),
    );
    const admission = Layer.effect(LiveAdmission, makeLiveAdmission()).pipe(Layer.provide(inputs));
    const session = Layer.effect(Invocation, startSession()).pipe(Layer.provide(admission));
    return session.pipe(Layer.provide(resources));
  }
  return Match.value(settings.args.command).pipe(
    Match.when('start', start),
    Match.orElse(() => Layer.effect(Invocation, adminSession(settings))),
  );
}
function makeApplicationLayer(argv: ReadonlyArray<string>, options: ApplicationOptions) {
  function* acquire() {
    const args = yield* Effect.fromResult(parseArgv(argv));
    const host = yield* Option.match(Option.fromNullishOr(options.host), {
      onNone: nativeHostContext,
      onSome: (input) => Schema.decodeUnknownEffect(HostContext)(structuredClone(input)),
    });
    const config = yield* readConfiguration(args.configFile, host.homeDirectory);
    const storage = storageConfig(args, config, host, options);
    return invocationLayer({ args, host, config, storage, options });
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}

// The only runtime and Bun platform provisioning boundary. No import starts it.
export async function openLocalGitHubApp(
  argv: ReadonlyArray<string>,
  options: ApplicationOptions = {},
) {
  const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, BunStdio.layer);
  const selected = Layer.unwrap(makeApplicationLayer(argv, options));
  const application = selected.pipe(Layer.provide(platform));
  const runtime = ManagedRuntime.make(Layer.merge(application, platform));
  const acquired = await runtime.runPromiseExit(Invocation);
  async function failed(): Promise<never> {
    await runtime.dispose();
    throw new CliError({ code: 'OperationFailed' });
  }
  const session = await Exit.match(acquired, { onFailure: failed, onSuccess: (value) => value });
  function bridge(request: Request, signal: AbortSignal) {
    function verifiedBridge(started: Extract<typeof session, { _tag: 'Start' }>) {
      async function admit(command: Parameters<typeof started.admission.admit>[0]) {
        const reply = await runtime.runPromise(started.admission.admit(command), { signal });
        return projectReply(reply);
      }
      const ingress = makeVerifiedGitHubIngress({
        secret: started.secret,
        ingressScopeId: started.scope,
        capture: (input) =>
          runtime.runPromise(captureRequestBody(input, 65536, signal), { signal }),
        onVerified: admit,
      });
      return ingress.fetch(request).then(projectProtocolResponse);
    }
    return Match.value(session).pipe(
      Match.tag('Completed', () => Promise.resolve(publicFailure(503, 'Disposed'))),
      Match.tag('Start', verifiedBridge),
      Match.exhaustive,
    );
  }
  const listener = makeBoundedListener({
    fetch: bridge,
    clock: options.requestClock,
    schedule: options.schedule,
  });
  let disposal: Promise<void> | undefined;
  function dispose() {
    disposal ??= listener
      .dispose()
      .then(() => runtime.dispose())
      .catch(() => {
        throw new CliError({ code: 'ShutdownFailed' });
      });
    return disposal;
  }
  function write(output: unknown, error = false) {
    function* print() {
      const stdio = yield* Stdio.Stdio;
      const sink = Match.value(error).pipe(
        Match.when(true, () => stdio.stderr()),
        Match.orElse(() => stdio.stdout()),
      );
      const json = Schema.fromJsonString(Schema.Unknown);
      const text = Schema.encodeSync(json)(output);
      yield* Stream.run(Stream.make(`${text}\n`), sink);
    }
    const printing = Effect.gen(print);
    return runtime.runPromise(printing);
  }
  return { session, fetch: listener.fetch, listen: listener.listen, dispose, write };
}
