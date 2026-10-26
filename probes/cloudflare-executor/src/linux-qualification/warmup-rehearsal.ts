import { Effect, Schema, Stdio, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';

import { requireSupervisor } from './docker-process.ts';
import { ProducerExecution, WorkerWarmupReady } from './live-handoff.ts';
import type { PreparedInputs } from './prepared-inputs.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(WorkerWarmupReady));

// Reached only after Task 5 preflight, archive admission, canaries, replay start
// and the actual fixed Bun warm-up spawn. No synthetic sleep certifies warm-up.
export function holdWarmupForRehearsal(
  child: ChildProcessSpawner.ChildProcessHandle,
  inputs: PreparedInputs,
  execution: typeof ProducerExecution.Type,
) {
  function* hold() {
    const stdio = yield* Stdio.Stdio;
    yield* requireSupervisor(yield* child.isRunning);
    const frame = yield* Schema.decodeUnknownEffect(WorkerWarmupReady)({
      _tag: 'WorkerWarmupReady',
      request: inputs.admission.request,
      sourceSha256: inputs.admission.source.sha256,
      producerId: execution.producerId,
      mode: execution.mode,
      pid: Number(child.pid),
    });
    const bytes = new TextEncoder().encode(encode(frame) + '\n');
    yield* requireSupervisor(bytes.length <= 262144);
    yield* Stream.run(Stream.fromIterable([bytes]), stdio.stdout());
    yield* child.exitCode;
    return yield* requireSupervisor(false);
  }
  const workflow = Effect.gen(hold);
  return workflow;
}
