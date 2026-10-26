import { Effect, FileSystem, Option, Schema } from 'effect';

import { makeWorkerPlatform, WorkerError, WorkerProcess, type WorkerCommand } from './cases.ts';
import { ControlReadbacks } from './contract.ts';
import { ControlNegatives, ControlProbeIO, measureWorkerControls } from './controls.ts';
import { requireSupervisor } from './docker-process.ts';
import type { PreparedInputs } from './prepared-inputs.ts';

export function makeWorkerProvenance() {
  return { read: makeWorkerPlatform().preflight };
}
export function makeChildObservation() {
  const unavailable = makeWorkerPlatform();
  function observe(command: WorkerCommand, process: typeof WorkerProcess.Service) {
    const workflow = unavailable
      .observe(command)
      .pipe(Effect.provideService(WorkerProcess, process));
    return workflow;
  }
  return { admitChildObservation: unavailable.admitChildObservation, observe };
}
// These trusted in-process dependencies cannot be read from JSON or environment.
// An admitted observer executes through the provided fixed WorkerProcess port.
export function makeProductionWorkerPlatform(
  provenance = makeWorkerProvenance(),
  observer = makeChildObservation(),
) {
  function* make() {
    const fs = yield* FileSystem.FileSystem;
    const negatives = yield* ControlNegatives;
    const io = yield* ControlProbeIO;
    function preflight(inputs: PreparedInputs) {
      function* measure() {
        const owner = yield* fs.stat(inputs.root);
        yield* measureWorkerControls(
          Option.getOrElse(owner.uid, () => 0),
          Option.getOrElse(owner.gid, () => 0),
        );
        const decoded = yield* Schema.decodeUnknownEffect(ControlReadbacks.members[1])(
          yield* provenance.read(inputs),
        );
        yield* requireSupervisor(
          decoded.nodeConfigSha256 === inputs.tools.nodeConfigSha256 &&
            decoded.nodeExecutableSha256 ===
              inputs.tools.files.find((file) => isNode(file.path))?.sha256,
          'InputChanged',
        );
        return decoded;
      }
      const workflow = Effect.gen(measure);
      return workflow.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(ControlNegatives, negatives),
        Effect.provideService(ControlProbeIO, io),
        Effect.mapError(() => new WorkerError({ code: 'BlockedControls' })),
      );
    }
    function observe(command: WorkerCommand) {
      function* execute() {
        yield* observer.admitChildObservation();
        const process = yield* WorkerProcess;
        return yield* observer.observe(command, process);
      }
      const workflow = Effect.gen(execute);
      return workflow;
    }
    return { preflight, admitChildObservation: observer.admitChildObservation, observe };
  }
  const workflow = Effect.gen(make);
  return workflow;
}
const isNode = Schema.is(Schema.Literal('node'));
