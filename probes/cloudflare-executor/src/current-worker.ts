import {
  Console,
  Context,
  Data,
  Effect,
  Fiber,
  FileSystem,
  Match,
  Ref,
  Result,
  Schedule,
  Schema,
  Stream,
} from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';

import { currentBaseline } from './current-baseline.ts';

export class CurrentWorkerError extends Data.TaggedError('CurrentWorkerError')<{
  readonly code:
    | 'AdmissionUnavailable'
    | 'InvalidObservation'
    | 'CommandFailed'
    | 'MissingTests'
    | 'OutputBudgetExceeded'
    | 'ServerUnavailable'
    | 'InputChanged';
}> {}
const contract = currentBaseline();
const Admission = Schema.Struct({
  sourceSha: Schema.Literal(contract.source.sha),
  contractSha256: Schema.Literal(
    '487b4fa0a24dde7de46d41cbbc349b1b1103f4da41ce9c630b69554b617c50be',
  ),
  imageSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  controls: Schema.Literal('Verified'),
});
const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000000 }));
const Outcome = Schema.Struct({
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 15 })),
  id: Schema.String,
  exitCode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  outputBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: contract.limits.commandOutputBytes }),
  ),
  tests: Schema.Struct({ passed: count, failed: count, skipped: count }),
});
function requireWorker(valid: boolean, code: CurrentWorkerError['code']) {
  const checked = Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new CurrentWorkerError({ code }),
    ),
  );
  const workflow = Effect.fromResult(checked);
  return workflow;
}
const SummaryKind = Schema.Literals(['pass', 'fail', 'skip', 'passed', 'failed', 'skipped']);
const decodeSummaryKind = Schema.decodeUnknownResult(SummaryKind);
export function inspectTestSummary(text: string) {
  const summary = { passed: 0, failed: 0, skipped: 0 };
  const escape = String.fromCharCode(27);
  const plain = text.replaceAll(escape, '').replace(/\[[0-9;]*m/g, '');
  for (const line of plain.split('\n')) {
    const value = (line.split('|').at(-1) ?? '').trim();
    const bun = /^(\d+) (pass|fail|skip)$/.exec(value);
    const playwright = /^(\d+) (passed|failed|skipped)(?: \([^\n]*\))?$/.exec(value);
    const vitest = /^Tests\s+(\d+) (passed|failed|skipped)(?: \([^\n]*\))?$/.exec(value);
    const match = bun ?? playwright ?? vitest;
    const field = {
      pass: 'passed',
      fail: 'failed',
      skip: 'skipped',
      passed: 'passed',
      failed: 'failed',
      skipped: 'skipped',
    } as const;
    const decoded = decodeSummaryKind(match?.[2]);
    for (const key of Result.match(decoded, { onSuccess: (key) => [key], onFailure: () => [] })) {
      summary[field[key]] += Number(match?.[1]);
    }
  }
  return summary;
}
export function collectCurrentCommandOutput(
  stream: Stream.Stream<Uint8Array, unknown>,
  spent: Ref.Ref<number>,
) {
  function* collect() {
    const chunks: Uint8Array[] = [];
    function* append(chunk: Uint8Array) {
      const allowed = yield* Ref.modify(
        spent,
        (total) =>
          [
            chunk.length <= contract.limits.commandOutputBytes - total,
            total + chunk.length,
          ] as const,
      );
      yield* requireWorker(allowed, 'OutputBudgetExceeded');
      chunks.push(new Uint8Array(chunk));
    }
    yield* Stream.runForEach(stream, (chunk) => Effect.gen(() => append(chunk)));
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }
  const workflow = Effect.gen(collect);
  return workflow;
}
const locations = { repository: '/workspace/repository', evidence: '/workspace/evidence' };
const env = {
  HOME: '/workspace/home',
  TMPDIR: '/workspace/tmp',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
  DO_NOT_TRACK: '1',
  ASTRO_TELEMETRY_DISABLED: '1',
  PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  BUN_INSTALL_CACHE_DIR: '/workspace/bun-cache',
  npm_config_cache: '/workspace/npm-cache',
  npm_config_offline: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
};
export function observeCurrentPreview(
  child: Pick<ChildProcessSpawner.ChildProcessHandle, 'stdout' | 'stderr' | 'exitCode'>,
) {
  function* observe() {
    const spent = yield* Ref.make(0);
    const draining = Effect.all(
      [
        collectCurrentCommandOutput(child.stdout, spent),
        collectCurrentCommandOutput(child.stderr, spent),
      ],
      { concurrency: 2 },
    );
    const unavailable = Effect.fail(new CurrentWorkerError({ code: 'ServerUnavailable' }));
    const exited = child.exitCode.pipe(Effect.andThen(unavailable));
    const logsFinished = draining.pipe(Effect.andThen(exited));
    return yield* Effect.raceFirst(logsFinished, exited).pipe(Effect.scoped);
  }
  const workflow = Effect.gen(observe);
  return workflow;
}
export function probeCurrentPreview(
  origin: string,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  function* inspect() {
    yield* requireWorker(
      contract.servers.some((server) => server.origin === origin),
      'InputChanged',
    );
    const requesting = Effect.tryPromise((signal) =>
      request(origin, { redirect: 'manual', credentials: 'omit', signal }),
    );
    const acquiring = requesting.pipe(Effect.interruptible);
    const response = yield* Effect.acquireRelease(acquiring, (response) =>
      Effect.tryPromise(() => response.body?.cancel() ?? Promise.resolve()).pipe(
        Effect.interruptible,
        Effect.timeout(1000),
        Effect.catch(() => Console.error('{"_tag":"BaselineReadinessBodyCleanupUnconfirmed"}')),
      ),
    );
    yield* requireWorker(response.status === 200, 'ServerUnavailable');
  }
  const workflow = Effect.gen(inspect);
  return workflow.pipe(Effect.scoped, Effect.timeout(1000));
}
export function makeCurrentBaselinePlatform() {
  function admit() {
    const refused = Effect.fail(new CurrentWorkerError({ code: 'AdmissionUnavailable' }));
    const observation = Schema.decodeUnknownEffect(Admission)(undefined);
    const workflow = refused.pipe(Effect.andThen(observation));
    return workflow;
  }
  function* initialize() {
    const fs = yield* FileSystem.FileSystem;
    yield* requireWorker(
      (yield* fs.realPath(locations.repository)) === locations.repository,
      'InputChanged',
    );
    yield* fs.makeDirectory(locations.evidence, { mode: 0o700 });
  }
  function run(index: number) {
    function* execute() {
      yield* requireWorker(
        Number.isSafeInteger(index) && index >= 0 && index < contract.checks.length,
        'InputChanged',
      );
      const check = contract.checks[index] ?? contract.checks[0]!;
      const fs = yield* FileSystem.FileSystem;
      const cwd = Match.value(check.cwd.startsWith('/')).pipe(
        Match.when(true, () => check.cwd),
        Match.orElse(() => `${locations.repository}/${check.cwd}`),
      );
      const child = yield* ChildProcess.make(
        '/usr/local/bin/bun',
        ['--no-env-file', '--no-install', ...check.argv.slice(1)],
        {
          cwd,
          env,
          extendEnv: false,
          shell: false,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          killSignal: 'SIGKILL',
          forceKillAfter: 0,
        },
      );
      const spent = yield* Ref.make(0);
      const [stdout, stderr, code] = yield* Effect.all(
        [
          collectCurrentCommandOutput(child.stdout, spent),
          collectCurrentCommandOutput(child.stderr, spent),
          child.exitCode,
        ],
        { concurrency: 3 },
      );
      const directory = `${locations.evidence}/${check.id}`;
      yield* fs.makeDirectory(directory, { mode: 0o700 });
      yield* fs.writeFile(`${directory}/stdout.log`, stdout, { flag: 'wx', mode: 0o600 });
      yield* fs.writeFile(`${directory}/stderr.log`, stderr, { flag: 'wx', mode: 0o600 });
      const text = new TextDecoder().decode(stdout) + '\n' + new TextDecoder().decode(stderr);
      return {
        index,
        id: check.id,
        exitCode: Number(code),
        outputBytes: stdout.length + stderr.length,
        tests: inspectTestSummary(text),
      };
    }
    const workflow = Effect.gen(execute);
    const scoped = Effect.scoped(workflow);
    return scoped;
  }
  function observeServer(server: (typeof contract.servers)[number]) {
    function* acquire() {
      const child = yield* ChildProcess.make('/usr/local/bin/bun', server.argv.slice(1), {
        cwd: `${locations.repository}/${server.cwd}`,
        env,
        extendEnv: false,
        shell: false,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        killSignal: 'SIGKILL',
        forceKillAfter: 0,
      });
      return observeCurrentPreview(child);
    }
    const workflow = Effect.gen(acquire);
    return workflow;
  }
  function* startServers() {
    const watches = yield* Effect.forEach(contract.servers, observeServer, { concurrency: 1 });
    function* watchServers() {
      return yield* Effect.raceFirst(watches[0]!, watches[1]!).pipe(Effect.scoped);
    }
    const watching = Effect.gen(watchServers);
    const fiber = yield* watching.pipe(Effect.forkChild);
    function readiness(origin: string) {
      const attempt = probeCurrentPreview(origin);
      return attempt.pipe(Effect.retry({ times: 50, schedule: Schedule.spaced('100 millis') }));
    }
    const ready = Effect.all(
      contract.servers.map(({ origin }) => readiness(origin)),
      { concurrency: 2 },
    );
    yield* Effect.raceFirst(ready, Fiber.join(fiber)).pipe(Effect.scoped);
    return { watch: Fiber.join(fiber) };
  }
  return {
    admit,
    initialize: () => Effect.gen(initialize),
    run,
    startServers: () => Effect.gen(startServers),
  };
}
export class CurrentBaselinePlatform extends Context.Service<
  CurrentBaselinePlatform,
  ReturnType<typeof makeCurrentBaselinePlatform>
>()('ceirean/CurrentBaselinePlatform') {}

export function runCurrentBaseline() {
  function* execute() {
    const platform = yield* CurrentBaselinePlatform;
    yield* Schema.decodeUnknownEffect(Admission, { onExcessProperty: 'error' })(
      yield* platform.admit(),
    );
    yield* platform.initialize();
    const commands = [];
    function executeCommand(index: number) {
      function* run() {
        const decoded = Schema.decodeUnknownEffect(Outcome, { onExcessProperty: 'error' })(
          yield* platform.run(index),
        );
        const result = yield* decoded.pipe(
          Effect.mapError(() => new CurrentWorkerError({ code: 'InvalidObservation' })),
        );
        yield* requireWorker(
          result.index === index && result.id === contract.checks[index]?.id,
          'InvalidObservation',
        );
        yield* requireWorker(result.exitCode === 0, 'CommandFailed');
        const requiredTests = [3, 14, 15].includes(index);
        const enough = [
          result.tests.passed > 0,
          result.tests.failed === 0,
          result.tests.skipped === 0,
        ].every(Boolean);
        yield* requireWorker(!requiredTests || enough, 'MissingTests');
        yield* requireWorker(
          index !== 15 || result.tests.passed === contract.browserCases.length,
          'MissingTests',
        );
        return result;
      }
      const workflow = Effect.gen(run);
      return workflow;
    }
    for (let index = 0; index < 15; index++) commands.push(yield* executeCommand(index));
    const servers = yield* platform.startServers();
    commands.push(yield* Effect.raceFirst(executeCommand(15), servers.watch).pipe(Effect.scoped));
    return {
      status: 'ChecksCompleted' as const,
      qualified: false as const,
      sourceSha: contract.source.sha,
      commands,
      qualification: 'NativeControlsAndCustodyUnqualified' as const,
    };
  }
  const workflow = Effect.gen(execute);
  const scoped = Effect.scoped(workflow);
  return scoped.pipe(Effect.timeout(contract.limits.executionMs));
}
