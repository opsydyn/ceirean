import { Effect, Match, Result, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

const unavailable = { _tag: 'ObservationUnavailable' } as const;
const observations = {
  system: ['/usr/bin/uname', ['-s']],
  architecture: ['/usr/bin/uname', ['-m']],
  total: ['/usr/sbin/sysctl', ['-n', 'hw.memsize']],
  cpus: ['/usr/sbin/sysctl', ['-n', 'hw.logicalcpu']],
  free: ['/usr/bin/vm_stat', []],
} as const;

function readObservation(id: keyof typeof observations, home: string) {
  function* read() {
    const [executable, args] = observations[id];
    const child = yield* ChildProcess.make(executable, args, {
      env: { HOME: home },
      extendEnv: false,
      cwd: home,
      shell: false,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      killSignal: 'SIGKILL',
      forceKillAfter: 0,
    });
    const buffer = new Uint8Array(4096);
    let used = 0;
    function* appendChunk(chunk: Uint8Array) {
      const fits = Match.value(chunk.length <= buffer.length - used).pipe(
        Match.when(true, () => Result.succeed(undefined)),
        Match.orElse(() => Result.fail(unavailable)),
      );
      yield* Effect.fromResult(fits);
      buffer.set(chunk, used);
      used += chunk.length;
      return used;
    }
    function append(chunk: Uint8Array) {
      const program = Effect.gen(() => appendChunk(chunk));
      return program;
    }
    yield* Stream.runForEach(child.all, append);
    const code = yield* child.exitCode;
    yield* Effect.fromResult(
      Match.value(code === 0).pipe(
        Match.when(true, () => Result.succeed(undefined)),
        Match.orElse(() => Result.fail(unavailable)),
      ),
    );
    const text = yield* Effect.try({
      try: () => new TextDecoder('utf-8', { fatal: true }).decode(buffer.slice(0, used)),
      catch: () => unavailable,
    });
    return text;
  }
  const workflow = Effect.gen(read);
  const bounded = workflow.pipe(Effect.timeout('1 second'));
  const scoped = Effect.scoped(bounded);
  const result = scoped.pipe(Effect.result);
  const sanitized = result.pipe(Effect.map(Result.getOrElse(() => undefined)));
  const program = sanitized.pipe(Effect.catchDefect(() => Effect.sync(() => undefined)));
  return program;
}

function integer(text: string | undefined, minimum = 1) {
  const value = Number(text?.trim());
  return Match.value(
    /^\d+\n?$/.test(text ?? '') && Number.isSafeInteger(value) && value >= minimum,
  ).pipe(
    Match.when(true, () => value),
    Match.orElse(() => undefined),
  );
}

function freeMemory(text: string | undefined) {
  const lines = (text ?? '').split(/\r?\n/);
  // Count record-shaped lines before parsing, so even a malformed duplicate
  // cannot be hidden by an earlier valid match.
  const headers = lines.filter((line) =>
    /^Mach\s+Virtual\s+Memory\s+Statistics\b/.test(line.trimStart()),
  );
  const records = lines.filter((line) => /^Pages\s+free\b/.test(line.trimStart()));
  const page = /^Mach Virtual Memory Statistics: \(page size of (\d+) bytes\)$/.exec(
    headers[0] ?? '',
  )?.[1];
  const free = /^Pages free:[ \t]+(\d+)\.$/.exec(records[0] ?? '')?.[1];
  const count = integer(free ?? '', 0);
  const size = integer(page ?? '');
  const bytes = (count ?? NaN) * (size ?? NaN);
  const unambiguous = [headers.length === 1, records.length === 1, lines[0] === headers[0]].every(
    Boolean,
  );
  return Match.value(unambiguous && Number.isSafeInteger(bytes) && bytes >= 0).pipe(
    Match.when(true, () => bytes),
    Match.orElse(() => undefined),
  );
}

/** Only these fixed, read-only OS observations are supported. Inject the Effect
 * platform spawner to test; construction/import never runs a utility. */
export function collectHostObservations(home: string) {
  function* collect() {
    const system = yield* readObservation('system', home);
    const machine = yield* readObservation('architecture', home);
    const architecture = Match.value(machine).pipe(
      Match.when('arm64\n', () => 'arm64' as const),
      Match.when('aarch64\n', () => 'arm64' as const),
      Match.when('x86_64\n', () => 'x64' as const),
      Match.orElse(() => undefined),
    );
    function* darwin() {
      const total = yield* readObservation('total', home);
      const cpus = yield* readObservation('cpus', home);
      const free = yield* readObservation('free', home);
      return {
        totalMemoryBytes: integer(total),
        cpuCount: integer(cpus),
        freeMemoryBytes: freeMemory(free),
      };
    }
    const resources = yield* Match.value(system).pipe(
      Match.when('Darwin\n', () => Effect.gen(darwin)),
      Match.orElse(() =>
        Effect.succeed({
          totalMemoryBytes: undefined,
          cpuCount: undefined,
          freeMemoryBytes: undefined,
        }),
      ),
    );
    return { architecture, ...resources };
  }
  const program = Effect.gen(collect);
  return program;
}
