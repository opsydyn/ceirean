import { Deferred, Effect, Fiber, Option, Schema, Stdio, Stream } from 'effect';

import type { makeWorkerCases } from './cases.ts';
import { QualificationAdmission, QualificationRequest, Sha256, strict } from './contract.ts';
import { SupervisorError, requireSupervisor } from './docker-process.ts';
import type { PreparedInputs } from './prepared-inputs.ts';

export const ProducerId = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/));
export const WorkerMode = Schema.Literals(['Qualification', 'InterruptWarmup', 'Deadline']);
export type WorkerMode = typeof WorkerMode.Type;
export const ProducerExecution = Schema.Struct({
  producerId: ProducerId,
  mode: WorkerMode,
  request: QualificationRequest,
});
const frameFields = {
  _tag: Schema.Literal('WorkerEvidenceReady'),
  request: QualificationRequest,
  sourceSha256: Sha256,
  producerId: ProducerId,
};
export const WorkerEvidenceReady = Schema.Union([
  Schema.Struct({
    ...frameFields,
    producerState: Schema.Literal('PendingHostFinalization'),
    workerExit: Schema.Literal(0),
    seedAdmission: QualificationAdmission.fields.seed,
  }),
  Schema.Struct({
    ...frameFields,
    producerState: Schema.Literal('Incomplete'),
    workerExit: Schema.Literal(1),
    seedAdmission: Schema.optionalKey(QualificationAdmission.fields.seed),
  }),
]);
export const WorkerWarmupReady = Schema.Struct({
  ...frameFields,
  _tag: Schema.Literal('WorkerWarmupReady'),
  mode: Schema.Literals(['InterruptWarmup', 'Deadline']),
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
});
const WorkerFrame = Schema.Union([WorkerEvidenceReady, WorkerWarmupReady]);
const CollectionComplete = Schema.Struct({
  _tag: Schema.Literal('CollectionComplete'),
  runId: QualificationRequest.fields.run.fields.runId,
  producerId: ProducerId,
});
const encodeReady = Schema.encodeSync(Schema.fromJsonString(WorkerEvidenceReady));
const decodeAck = Schema.decodeUnknownEffect(Schema.fromJsonString(CollectionComplete), strict);
const decodeReady = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkerEvidenceReady), strict);
const decodeFrame = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkerFrame), strict);
const decodeReadyValue = Schema.decodeUnknownEffect(WorkerEvidenceReady, strict);
type WorkerResult = Effect.Success<
  ReturnType<ReturnType<typeof makeWorkerCases>['runWorkerCases']>
>;

export function readBoundedHandoffLine(stream: Stream.Stream<Uint8Array, unknown>) {
  function* read() {
    let used = 0;
    function reserve(chunk: Uint8Array) {
      function* check() {
        yield* requireSupervisor(chunk.length <= 262144 - used);
        used += chunk.length;
        return chunk;
      }
      const workflow = Effect.gen(check);
      return workflow;
    }
    const bounded = stream.pipe(
      Stream.filter((chunk) => chunk.length > 0),
      Stream.mapEffect(reserve),
    );
    const chunks = yield* Stream.runCollect(bounded);
    const bytes = new Uint8Array(used);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const framed = [used > 1, bytes.indexOf(10) === used - 1].every(Boolean);
    yield* requireSupervisor(framed);
    return yield* Effect.try(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used - 1)),
    );
  }
  const workflow = Effect.gen(read);
  const bounded = workflow.pipe(Effect.timeout(90000));
  return bounded;
}

// Keep reading after READY. Qualification must await finished after worker exit,
// so a second frame or trailing bytes in any later chunk cannot be ignored.
export function openWorkerEvidenceChannel(
  stream: Stream.Stream<Uint8Array, unknown>,
  inputs: PreparedInputs,
  producerId: string,
) {
  function* open() {
    const first = yield* Deferred.make<string, unknown>();
    yield* Effect.addFinalizer(() =>
      Deferred.fail(first, new SupervisorError({ code: 'EvidenceIncomplete' })),
    );
    const chunks: Uint8Array[] = [];
    let used = 0;
    let framed = false;
    function consume(chunk: Uint8Array) {
      function* read() {
        yield* requireSupervisor(chunk.length <= 262144 - used);
        yield* requireSupervisor(!framed || chunk.length === 0);
        used += chunk.length;
        chunks.push(new Uint8Array(chunk));
        const end = chunk.indexOf(10);
        for (const _ of [end].filter((value) => value >= 0)) {
          yield* requireSupervisor(end === chunk.length - 1);
          const bytes = new Uint8Array(used);
          let offset = 0;
          for (const part of chunks) {
            bytes.set(part, offset);
            offset += part.length;
          }
          const text = yield* Effect.try(() =>
            new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used - 1)),
          );
          framed = true;
          yield* Deferred.succeed(first, text);
        }
      }
      const workflow = Effect.gen(read);
      return workflow;
    }
    function* drain() {
      const nonempty = stream.pipe(Stream.filter((chunk) => chunk.length > 0));
      yield* Stream.runForEach(nonempty, consume);
      yield* requireSupervisor(framed);
    }
    function fail(error: unknown) {
      function* propagate() {
        yield* Deferred.fail(first, error);
        return yield* Effect.fail(error);
      }
      const workflow = Effect.gen(propagate);
      return workflow;
    }
    const consuming = Effect.gen(drain);
    const checked = consuming.pipe(Effect.catch(fail), Effect.forkScoped);
    const reader = yield* checked;
    const incoming = Deferred.await(first).pipe(Effect.timeout(540000));
    const decoded = incoming.pipe(Effect.flatMap(decodeFrame));
    const sameRequest = Schema.toEquivalence(QualificationRequest);
    function bind(frame: typeof WorkerFrame.Type) {
      function* admit() {
        const matches = [
          sameRequest(frame.request, inputs.admission.request),
          frame.sourceSha256 === inputs.admission.source.sha256,
          frame.producerId === producerId,
        ].every(Boolean);
        yield* requireSupervisor(matches, 'InputChanged');
        return frame;
      }
      const workflow = Effect.gen(admit);
      return workflow;
    }
    const ready = decoded.pipe(Effect.flatMap(bind));
    const finished = Fiber.join(reader);
    return { ready, finished };
  }
  const workflow = Effect.gen(open);
  return workflow;
}

// This is transport state, not an authority or qualification receipt. A host
// must still own/admit the process and source and collect/hash the fixed files.
export function readWorkerEvidenceReady(
  stream: Stream.Stream<Uint8Array, unknown>,
  inputs: PreparedInputs,
  producerId: string,
) {
  function* read() {
    const frame = yield* decodeReady(yield* readBoundedHandoffLine(stream));
    const sameRequest = Schema.toEquivalence(QualificationRequest);
    const matches = [
      sameRequest(frame.request, inputs.admission.request),
      frame.sourceSha256 === inputs.admission.source.sha256,
      frame.producerId === producerId,
    ].every(Boolean);
    yield* requireSupervisor(matches, 'InputChanged');
    return frame;
  }
  const workflow = Effect.gen(read);
  return workflow;
}

// The caller supplies the actual in-process Task 5 result, never decoded case
// JSON. No seed is emitted if warm-up never reached its trusted seal boundary.
export function publishEvidenceAndAwaitCollection(
  inputs: PreparedInputs,
  result: WorkerResult,
  producerId: string,
) {
  function* publish() {
    const stdio = yield* Stdio.Stdio;
    const seed = Option.fromNullishOr(result.seedAdmission);
    const seedFields = Option.match(seed, {
      onNone: () => ({}),
      onSome: (seedAdmission) => ({ seedAdmission }),
    });
    const frame = yield* decodeReadyValue({
      _tag: 'WorkerEvidenceReady',
      request: inputs.admission.request,
      sourceSha256: inputs.admission.source.sha256,
      producerId,
      workerExit: result.exitCode,
      producerState: result._tag,
      ...seedFields,
    });
    const bytes = new TextEncoder().encode(encodeReady(frame) + '\n');
    yield* requireSupervisor(bytes.length <= 262144);
    yield* Stream.run(Stream.fromIterable([bytes]), stdio.stdout());
    const ack = yield* decodeAck(yield* readBoundedHandoffLine(stdio.stdin));
    yield* requireSupervisor(ack.runId === inputs.admission.request.run.runId, 'InputChanged');
    yield* requireSupervisor(ack.producerId === producerId, 'InputChanged');
    return { _tag: 'CollectionAcknowledged' as const, workerExit: result.exitCode };
  }
  const workflow = Effect.gen(publish);
  return workflow;
}
