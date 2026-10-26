import { Cause, Context, Effect, Fiber, Queue, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

import { collectDockerOutput, requireSupervisor } from './docker-process.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
// The calling supervisor scope owns both the attached client and its readers.
// This is a fixed transport, not a general Docker command or input capability.
export function makeDockerSession(
  executable: '/usr/bin/docker' | '/usr/local/bin/docker' = '/usr/bin/docker',
) {
  function attach(name: string, cwd: string) {
    function* start() {
      yield* requireSupervisor(/^ceirean-linux-[a-f0-9-]{36}$/.test(name));
      const input = yield* Queue.bounded<Uint8Array, Cause.Done>(1);
      yield* Effect.addFinalizer(() => Queue.shutdown(input));
      const child = yield* ChildProcess.make(
        executable,
        ['start', '--attach', '--interactive', name],
        {
          cwd,
          shell: false,
          extendEnv: false,
          env: {
            HOME: cwd,
            DOCKER_CONFIG: cwd,
            DOCKER_HOST: 'unix:///var/run/docker.sock',
            PATH: '/usr/bin:/bin',
            LANG: 'C',
            LC_ALL: 'C',
          },
          stdin: Stream.fromQueue(input),
          stdout: 'pipe',
          stderr: 'pipe',
          killSignal: 'SIGKILL',
          forceKillAfter: 0,
        },
      );
      const completion = Effect.all([child.exitCode, collectDockerOutput(child.stderr)], {
        concurrency: 2,
      });
      const consuming = completion.pipe(Effect.forkScoped);
      const reader = yield* consuming;
      function acknowledge(runId: string, producerId: string) {
        function* send() {
          const bytes = new TextEncoder().encode(
            encode({ _tag: 'CollectionComplete', runId, producerId }) + '\n',
          );
          yield* requireSupervisor(yield* Queue.offer(input, bytes));
          yield* requireSupervisor(yield* Queue.end(input));
        }
        const workflow = Effect.gen(send);
        return workflow;
      }
      const joining = Fiber.join(reader);
      const wait = joining.pipe(
        Effect.map(([exitCode, stderr]) => ({ exitCode: Number(exitCode), stderr })),
      );
      return { stdout: child.stdout, acknowledge, wait };
    }
    const workflow = Effect.gen(start);
    return workflow;
  }
  return { attach };
}
export class DockerSession extends Context.Service<
  DockerSession,
  ReturnType<typeof makeDockerSession>
>()('ceirean/LinuxDockerSession') {}
