import { Context, Data, Effect, Result, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

export class SupervisorError extends Data.TaggedError('SupervisorError')<{
  readonly code:
    | 'BlockedControls'
    | 'EvidenceIncomplete'
    | 'CleanupUnknown'
    | 'InputChanged'
    | 'BlockedChildObservation'
    | 'BlockedRuntime';
}> {}
export function requireSupervisor(
  valid: boolean,
  code: SupervisorError['code'] = 'EvidenceIncomplete',
) {
  const checked = Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new SupervisorError({ code }),
    ),
    Effect.fromResult,
  );
  return checked;
}
export function collectDockerOutput(stream: Stream.Stream<Uint8Array, unknown>) {
  const reading = collectDockerBytes(stream);
  function decode(bytes: Uint8Array) {
    const workflow = Effect.try({
      try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      catch: () => new SupervisorError({ code: 'EvidenceIncomplete' }),
    });
    return workflow;
  }
  const workflow = reading.pipe(Effect.flatMap(decode));
  return workflow;
}
export function collectDockerBytes(stream: Stream.Stream<Uint8Array, unknown>) {
  function* read() {
    const chunks: Uint8Array[] = [];
    let used = 0;
    function* append(chunk: Uint8Array) {
      yield* requireSupervisor(chunk.length <= 262144 - used);
      used += chunk.length;
      chunks.push(new Uint8Array(chunk));
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
export function makeDockerProcess(
  executable: '/usr/bin/docker' | '/usr/local/bin/docker' = '/usr/bin/docker',
) {
  function run(args: readonly string[], cwd: string, timeout: number) {
    function* execute() {
      yield* requireSupervisor(timeout > 0 && timeout <= 540000);
      const child = yield* ChildProcess.make(executable, args, {
        cwd,
        shell: false,
        extendEnv: false,
        env: {
          HOME: cwd,
          DOCKER_CONFIG: cwd,
          PATH: '/usr/bin:/bin',
          LANG: 'C',
          LC_ALL: 'C',
          DOCKER_HOST: 'unix:///var/run/docker.sock',
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        killSignal: 'SIGKILL',
        forceKillAfter: 0,
      });
      const [bytes, stderr, exit] = yield* Effect.all(
        [collectDockerBytes(child.stdout), collectDockerOutput(child.stderr), child.exitCode],
        { concurrency: 3 },
      );
      return { stdout: new TextDecoder().decode(bytes), bytes, stderr, exitCode: Number(exit) };
    }
    const workflow = Effect.gen(execute);
    const bounded = workflow.pipe(Effect.timeout(timeout), Effect.scoped);
    return bounded;
  }
  return { run };
}
export class DockerProcess extends Context.Service<
  DockerProcess,
  ReturnType<typeof makeDockerProcess>
>()('ceirean/LinuxDockerProcess') {}
