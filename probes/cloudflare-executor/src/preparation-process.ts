import { Effect, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

import { requirePayload } from './payload.ts';

function collect(stream: Stream.Stream<Uint8Array, unknown>, maximum: number) {
  function* read() {
    const chunks: Uint8Array[] = [];
    let used = 0;
    function* append(chunk: Uint8Array) {
      yield* requirePayload(chunk.length <= maximum - used, 'ProcessRefused');
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

export function runPreparationProcess(
  executable: '/usr/bin/git' | '/usr/bin/tar',
  args: ReadonlyArray<string>,
  home: string,
  cwd: string,
  maximum = 1048576,
  input = new Uint8Array(),
) {
  function* run() {
    yield* requirePayload(input.length <= 3145728, 'ProcessRefused');
    const child = yield* ChildProcess.make(executable, args, {
      cwd,
      shell: false,
      extendEnv: false,
      env: {
        HOME: home,
        PATH: '/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_NO_LAZY_FETCH: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
      stdin: Stream.fromIterable([input]),
      stdout: 'pipe',
      stderr: 'pipe',
      killSignal: 'SIGKILL',
      forceKillAfter: 0,
    });
    const [bytes, , code] = yield* Effect.all(
      [collect(child.stdout, maximum), collect(child.stderr, 4096), child.exitCode],
      { concurrency: 3 },
    );
    yield* requirePayload(code === 0, 'ProcessRefused');
    return bytes;
  }
  const workflow = Effect.gen(run);
  const bounded = workflow.pipe(Effect.timeout('10 seconds'));
  const scoped = Effect.scoped(bounded);
  return scoped;
}
