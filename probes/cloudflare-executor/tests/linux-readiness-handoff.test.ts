import { expect, test } from 'bun:test';

import { Data, Deferred, Effect, Exit, Fiber, Match, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';

import { QualificationReceipt } from '../src/linux-qualification/contract.ts';
import {
  readReadinessFrame,
  simulateReadinessHandoff,
  type CanaryPort,
} from '../src/linux-qualification/readiness-handoff.ts';
import { ReadinessOnly } from '../src/linux-qualification/readiness-worker.ts';

const frame = {
  _tag: 'ReadinessOnly',
  version: 1,
  qualificationReceipt: 'NotProduced',
  kernelMountPolicy: 'Unreviewed',
  activation: 'Blocked',
  mounts: {
    summary: {
      _tag: 'ReadinessOnly',
      input: 'Invalid',
      kernelMountPolicy: 'Unreviewed',
      budgetBytes: 3221225472,
      writableTmpfsBytes: null,
      categories: [],
      findings: [],
    },
    details: [],
  },
  status: {
    uid: 'Unknown',
    gid: 'Unknown',
    capInh: 'Unknown',
    capPrm: 'Unknown',
    capEff: 'Unknown',
    capBnd: 'Unknown',
    capAmb: 'Unknown',
    noNewPrivs: 'Unknown',
    seccomp: 'Unknown',
  },
  namespaces: { mnt: 'Unknown', pid: 'Unknown', ipc: 'Unknown', net: 'Unknown', user: 'Unknown' },
  cgroups: { cpu: 'Unknown', memory: 'Unknown', swap: 'Unknown', pids: 'Unknown' },
  observer: 'NotMeasured',
  networkNegatives: 'NotMeasured',
  cleanup: 'NotMeasured',
} as const;
const bytes = (text: string) => new TextEncoder().encode(text);
const encode = Schema.encodeSync(Schema.fromJsonString(ReadinessOnly));
const encoded = `${encode(frame)}\n`;
const stream = (text: string) => Stream.fromIterable([bytes(text)]);
async function read(input: Stream.Stream<Uint8Array, unknown>) {
  const workflow = readReadinessFrame(input).pipe(Effect.result);
  const attempted = await Effect.runPromise(workflow);
  return attempted;
}

async function validFrame() {
  const input = bytes(encoded);
  const chunks = Array.from(input, (byte) => new Uint8Array([byte]));
  const decoded = await Effect.runPromise(readReadinessFrame(Stream.fromIterable(chunks)));
  expect(decoded).toEqual(frame);
  expect(
    Schema.decodeUnknownResult(QualificationReceipt, { onExcessProperty: 'error' })(decoded)._tag,
  ).toBe('Failure');
}
test('accepts split-byte framing and binds no qualification receipt to a frame', validFrame);

async function invalidFrames() {
  const invalid = [
    encoded.slice(0, -1),
    `${encoded} `,
    `${encoded}${encoded}`,
    '\n',
    encoded.replace('"version":1', '"version":1,"extra":true'),
    encoded.replace('"mnt":"Unknown"', '"mnt":"Unknown","extra":true'),
    '{bad}\n',
    `${'x'.repeat(262144)}\n`,
  ];
  for (const input of invalid) expect((await read(stream(input)))._tag).toBe('Failure');
  const badBytes = Stream.fromIterable([new Uint8Array([255, 10])]);
  expect((await read(badBytes))._tag).toBe('Failure');
  const splitInvalid = Stream.fromIterable([new Uint8Array([195]), new Uint8Array([40, 10])]);
  expect((await read(splitInvalid))._tag).toBe('Failure');
  const trailing = Stream.fromIterable([bytes(encoded), bytes('x')]);
  expect((await read(trailing))._tag).toBe('Failure');
}
test(
  'rejects missing EOF framing, trailing or duplicate output, oversized and malformed frames',
  invalidFrames,
);

async function missingEof() {
  function* exercise() {
    const waiting = Effect.sleep(1000000);
    const tail = Stream.fromEffect(waiting.pipe(Effect.map(() => new Uint8Array())));
    const input = Stream.concat(stream(encoded), tail);
    const fiber = yield* Effect.forkChild(readReadinessFrame(input).pipe(Effect.result));
    yield* TestClock.adjust(90001);
    expect((yield* Fiber.join(fiber))._tag).toBe('Failure');
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test('requires EOF within the deadline even after a valid frame', missingEof);

async function sanitizedErrors() {
  const failed = await read(Stream.fail('private transport detail'));
  expect(failed).toMatchObject({ _tag: 'Failure', failure: 'ReadinessFrameRefused' });
  const malformed = await read(stream('{"private": "secret"}\n'));
  expect(malformed).toMatchObject({ _tag: 'Failure', failure: 'ReadinessFrameRefused' });
}
test('frame errors never expose transport errors or untrusted input', sanitizedErrors);

async function defectFrame() {
  const failing = Stream.fromEffect(Effect.die(new Error('private stream defect')));
  const outcome = await read(failing);
  expect(outcome).toMatchObject({ _tag: 'Failure', failure: 'ReadinessFrameRefused' });
}
test('frame defects are sanitized as typed refusal', defectFrame);

async function interruptedFrame() {
  function* exercise() {
    const waiting = Effect.sleep(1000000);
    const input = Stream.fromEffect(waiting.pipe(Effect.map(() => new Uint8Array())));
    const fiber = yield* Effect.forkChild(readReadinessFrame(input));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(fiber);
    expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test('frame interruption remains an interruption', interruptedFrame);

async function canonicalFrames() {
  const spoofed = [
    encoded.replace('"version":1', '"version":1,"version":1'),
    encoded.replace('"mnt":"Unknown"', '"mnt":"WellFormed","mnt":"Unknown"'),
    encoded.replace('"version":1', '"version" : 1'),
    encoded.replace('"version":1', '"\\u0076ersion":1'),
    encoded.replace(
      '"version":1,"qualificationReceipt":"NotProduced"',
      '"qualificationReceipt":"NotProduced","version":1',
    ),
    ` ${encoded}`,
  ];
  for (const candidate of spoofed) expect((await read(stream(candidate)))._tag).toBe('Failure');
}
test('rejects duplicate members and noncanonical worker frames', canonicalFrames);

async function bomFrame() {
  const input = Stream.fromIterable([
    new Uint8Array([0xef]),
    new Uint8Array([0xbb, 0xbf]),
    bytes(encoded),
  ]);
  expect((await read(input))._tag).toBe('Failure');
}
test('rejects a split UTF-8 BOM before a canonical frame', bomFrame);

async function exactFrameLimit() {
  const padded = `${encoded.slice(0, -1)}${' '.repeat(262144 - encoded.length)}\n`;
  expect(bytes(padded)).toHaveLength(262144);
  expect((await read(stream(padded)))._tag).toBe('Failure');
  expect((await read(stream(` ${padded}`)))._tag).toBe('Failure');
}
test('rejects padding at the byte limit and oversized frames', exactFrameLimit);

type Options = {
  create?: 'fail' | 'hang';
  channelMismatch?: boolean;
  ownerMismatch?: boolean;
  ownerTagMismatch?: boolean;
  removeFail?: boolean;
  readback?: 'Absent' | 'Present' | 'Unknown' | 'fail';
  readbackMismatch?: boolean;
  readbackIdentityMismatch?: boolean;
  output?: Stream.Stream<Uint8Array>;
};
function fake(options: Options = {}) {
  const calls: string[] = [];
  const identity = {};
  let removed = false;
  function chooseSession(session: object, mismatch: boolean | undefined) {
    return Match.value(mismatch).pipe(
      Match.when(true, () => ({})),
      Match.orElse(() => session),
    );
  }
  function create(session: object) {
    calls.push('create');
    const created = {
      session: chooseSession(session, options.channelMismatch),
      identity,
      output: options.output ?? stream(encoded),
    };
    function delayed() {
      const waiting = Effect.sleep(1000000);
      const workflow = waiting.pipe(Effect.map(() => created));
      return workflow;
    }
    const workflow = Match.value(options.create).pipe(
      Match.when('fail', () => Effect.fail(new Error('lost acknowledgement'))),
      Match.when('hang', delayed),
      Match.orElse(() => Effect.sync(() => created)),
    );
    return workflow;
  }
  function inspect(session: object) {
    calls.push('inspect');
    const tag = Match.value(options.ownerTagMismatch).pipe(
      Match.when(true, () => 'Unknown' as 'Owned'),
      Match.orElse(() => 'Owned' as const),
    );
    const observation = {
      _tag: tag,
      session: chooseSession(session, options.ownerMismatch),
      identity,
    };
    const workflow = Effect.sync(() => observation);
    return workflow;
  }
  function remove(_session: object, id: object) {
    calls.push('remove');
    expect(id).toBe(identity);
    function markRemoved() {
      removed = true;
    }
    const workflow = Match.value(options.removeFail).pipe(
      Match.when(true, () => Effect.fail(new Error('remove failed'))),
      Match.orElse(() => Effect.sync(markRemoved)),
    );
    return workflow;
  }
  function readback(session: object, expected: object | undefined) {
    calls.push('readback');
    const fallback = Match.value(removed).pipe(
      Match.when(true, () => 'Absent' as const),
      Match.orElse(() => 'Present' as const),
    );
    const status = Match.value(options.readback).pipe(
      Match.when('Absent', () => 'Absent' as const),
      Match.when('Present', () => 'Present' as const),
      Match.when('Unknown', () => 'Unknown' as const),
      Match.orElse(() => fallback),
    );
    const observation = {
      _tag: status,
      session: chooseSession(session, options.readbackMismatch),
      identity: chooseSession(expected ?? {}, options.readbackIdentityMismatch),
    };
    const workflow = Match.value(options.readback).pipe(
      Match.when('fail', () => Effect.fail(new Error('unavailable'))),
      Match.orElse(() => Effect.sync(() => observation)),
    );
    return workflow;
  }
  const port: CanaryPort = { create, inspect, remove, readback };
  return { port, calls };
}

async function ownedChannel() {
  const { port, calls } = fake();
  const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
  expect(outcome).toMatchObject({
    complete: false,
    authority: 'Unavailable',
    cleanup: 'ConfirmedRemoval',
    readiness: frame,
  });
  expect(calls).toEqual(['create', 'inspect', 'inspect', 'inspect', 'remove', 'readback']);
}
test(
  'a fake owned channel yields only a non-authorizing readiness observation after confirmed cleanup',
  ownedChannel,
);

async function forgedChannel() {
  const forged = fake({ channelMismatch: true });
  const result = await Effect.runPromise(simulateReadinessHandoff(forged.port));
  expect(result.complete).toBe(false);
  expect(result.readiness).toBeUndefined();
  const mismatched = fake({ ownerMismatch: true });
  const outcome = await Effect.runPromise(simulateReadinessHandoff(mismatched.port));
  expect(outcome.cleanup).toBe('Unknown');
  expect(outcome.readiness).toBeUndefined();
  expect(mismatched.calls).not.toContain('remove');
  const invalid = fake({ ownerTagMismatch: true });
  const refused = await Effect.runPromise(simulateReadinessHandoff(invalid.port));
  expect(refused.cleanup).toBe('Unknown');
  expect(refused.readiness).toBeUndefined();
  expect(invalid.calls).not.toContain('remove');
}
test(
  'a forged channel or mismatched owner cannot supply readiness or remove another resource',
  forgedChannel,
);

async function uncertainCleanup() {
  for (const options of [
    { create: 'fail' },
    { removeFail: true },
    { removeFail: true, readback: 'Absent' },
    { readback: 'Present' },
    { readback: 'Unknown' },
    { readback: 'fail' },
    { readbackMismatch: true },
    { readbackIdentityMismatch: true },
  ] as const) {
    const { port } = fake(options);
    const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
    expect(outcome.complete).toBe(false);
    expect(outcome.cleanup).toBe('Unknown');
    expect(outcome.readiness).toBeUndefined();
  }
}
test('lost create acknowledgement and cleanup failures never confirm removal', uncertainCleanup);

type FaultKind = 'defect' | 'throw';
class PortThrow extends Data.TaggedError('PortThrow')<{ readonly detail: string }> {}
function portFault(kind: FaultKind) {
  function throwNow(): never {
    throw new PortThrow({ detail: 'private port throw' });
  }
  const failure = Match.value(kind).pipe(
    Match.when('throw', throwNow),
    Match.orElse(() => Effect.die(new Error('private port defect'))),
  );
  return failure;
}

async function cleanupDefects() {
  for (const kind of ['defect', 'throw'] as const) {
    for (const stage of [
      'create',
      'inspectStart',
      'inspectCleanup',
      'remove',
      'readback',
    ] as const) {
      const base = fake({ readback: 'Absent' });
      let inspections = 0;
      let readbacks = 0;
      function create(session: object) {
        const workflow = Match.value(stage).pipe(
          Match.when('create', () => portFault(kind)),
          Match.orElse(() => base.port.create(session)),
        );
        return workflow;
      }
      function inspect(session: object) {
        inspections += 1;
        const isStart = Schema.is(Schema.Literal('inspectStart'));
        const isCleanup = Schema.is(Schema.Literal('inspectCleanup'));
        const fail = [
          isStart(stage) && inspections === 1,
          isCleanup(stage) && inspections === 3,
        ].some(Boolean);
        const workflow = Match.value(fail).pipe(
          Match.when(true, () => portFault(kind)),
          Match.orElse(() => base.port.inspect(session)),
        );
        return workflow;
      }
      function remove(session: object, identity: object) {
        const workflow = Match.value(stage).pipe(
          Match.when('remove', () => portFault(kind)),
          Match.orElse(() => base.port.remove(session, identity)),
        );
        return workflow;
      }
      function readback(session: object, identity: object | undefined) {
        readbacks += 1;
        const workflow = Match.value(stage).pipe(
          Match.when('readback', () => portFault(kind)),
          Match.orElse(() => base.port.readback(session, identity)),
        );
        return workflow;
      }
      const port: CanaryPort = { create, inspect, remove, readback };
      const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
      const expectedCleanup = Match.value(stage).pipe(
        Match.when('inspectStart', () => 'ConfirmedRemoval' as const),
        Match.orElse(() => 'Unknown' as const),
      );
      expect(outcome.cleanup).toBe(expectedCleanup);
      expect(outcome.readiness).toBeUndefined();
      expect(readbacks).toBe(1);
    }
  }
}
test('port defects and synchronous throws preserve independent cleanup readback', cleanupDefects);

async function invalidCreation() {
  for (const choice of [
    'nullIdentity',
    'stringIdentity',
    'numberIdentity',
    'booleanIdentity',
    'arrayIdentity',
    'functionIdentity',
    'missingIdentity',
    'nullResult',
    'undefinedResult',
    'forgedSession',
    'forgedMissingOutput',
  ] as const) {
    let inspectedIdentity: unknown;
    let removals = 0;
    const untouched = {};
    let readbackIdentity: unknown = untouched;
    function create(session: object) {
      const output = stream(encoded);
      const response = Match.value(choice).pipe(
        Match.when('nullIdentity', () => ({ session, identity: null, output })),
        Match.when('stringIdentity', () => ({ session, identity: 'claimed', output })),
        Match.when('numberIdentity', () => ({ session, identity: 42, output })),
        Match.when('booleanIdentity', () => ({ session, identity: false, output })),
        Match.when('arrayIdentity', () => ({ session, identity: [], output })),
        Match.when('functionIdentity', () => ({ session, identity: () => undefined, output })),
        Match.when('missingIdentity', () => ({ session, output })),
        Match.when('nullResult', () => null),
        Match.when('undefinedResult', () => undefined),
        Match.when('forgedSession', () => ({ session: {}, identity: {}, output })),
        Match.when('forgedMissingOutput', () => ({ session: {}, identity: {} })),
        Match.exhaustive,
      );
      inspectedIdentity = Reflect.get(response ?? {}, 'identity');
      const holder = Object.create(null);
      Reflect.set(holder, 'value', response);
      const untyped = Reflect.get(holder, 'value');
      const workflow = Effect.sync(() => untyped);
      return workflow;
    }
    function inspect(session: object) {
      const holder = Object.create(null);
      Reflect.set(holder, 'value', { _tag: 'Owned', session, identity: inspectedIdentity });
      const untyped = Reflect.get(holder, 'value');
      const workflow = Effect.sync(() => untyped);
      return workflow;
    }
    function remove() {
      const workflow = Effect.sync(() => {
        removals += 1;
      });
      return workflow;
    }
    function readback(session: object, identity: object | undefined) {
      readbackIdentity = identity;
      const workflow = Effect.sync(() => ({ _tag: 'Absent' as const, session, identity }));
      return workflow;
    }
    const port: CanaryPort = { create, inspect, remove, readback };
    const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
    expect(outcome.cleanup).toBe('Unknown');
    expect(outcome.readiness).toBeUndefined();
    expect(removals).toBe(0);
    expect(readbackIdentity).toBeUndefined();
  }
}
test('invalid create acknowledgements never establish an owned identity', invalidCreation);

async function malformedOutputCleanup() {
  for (const output of ['missing', 'invalid'] as const) {
    const base = fake();
    function create(session: object) {
      function replace(created: Effect.Success<ReturnType<CanaryPort['create']>>) {
        const holder = Object.create(null);
        const response = Match.value(output).pipe(
          Match.when('missing', () => ({ session: created.session, identity: created.identity })),
          Match.orElse(() => ({
            session: created.session,
            identity: created.identity,
            output: 'invalid',
          })),
        );
        Reflect.set(holder, 'value', response);
        return Reflect.get(holder, 'value');
      }
      const workflow = base.port.create(session).pipe(Effect.map(replace));
      return workflow;
    }
    const port: CanaryPort = {
      create,
      inspect: base.port.inspect,
      remove: base.port.remove,
      readback: base.port.readback,
    };
    const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
    expect(outcome.readiness).toBeUndefined();
    expect(outcome.complete).toBe(false);
    expect(outcome.cleanup).toBe('ConfirmedRemoval');
    expect(base.calls).toEqual(['create', 'inspect', 'remove', 'readback']);
  }
}
test('valid owned identity is cleaned after missing or invalid output', malformedOutputCleanup);

async function changingOutput() {
  const base = fake();
  let reads = 0;
  function create(session: object) {
    function replace(created: Effect.Success<ReturnType<CanaryPort['create']>>) {
      const response = { session: created.session, identity: created.identity };
      function output() {
        reads += 1;
        return Match.value(reads).pipe(
          Match.when(1, () => created.output),
          Match.orElse(() => stream('{invalid}\n')),
        );
      }
      Reflect.defineProperty(response, 'output', { get: output });
      const holder = Object.create(null);
      Reflect.set(holder, 'value', response);
      return Reflect.get(holder, 'value');
    }
    const workflow = base.port.create(session).pipe(Effect.map(replace));
    return workflow;
  }
  const port: CanaryPort = {
    create,
    inspect: base.port.inspect,
    remove: base.port.remove,
    readback: base.port.readback,
  };
  const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
  expect(outcome.readiness).toEqual(frame);
  expect(reads).toBe(1);
}
test('consumes the same output stream that was validated', changingOutput);

async function changingIdentity() {
  const base = fake();
  let reads = 0;
  function create(session: object) {
    function replace(created: Effect.Success<ReturnType<CanaryPort['create']>>) {
      const response = { session: created.session, output: created.output };
      function identity() {
        reads += 1;
        return Match.value(reads <= 2).pipe(
          Match.when(true, () => created.identity),
          Match.orElse(() => 'forged'),
        );
      }
      Reflect.defineProperty(response, 'identity', { get: identity });
      const holder = Object.create(null);
      Reflect.set(holder, 'value', response);
      return Reflect.get(holder, 'value');
    }
    const workflow = base.port.create(session).pipe(Effect.map(replace));
    return workflow;
  }
  const port: CanaryPort = {
    create,
    inspect: base.port.inspect,
    remove: base.port.remove,
    readback: base.port.readback,
  };
  const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
  expect(outcome.cleanup).toBe('ConfirmedRemoval');
  expect(outcome.readiness).toEqual(frame);
  expect(reads).toBe(2);
}
test('retains the same session-bound identity that was validated', changingIdentity);

async function changedOwnership() {
  const base = fake({ readback: 'Absent' });
  let inspections = 0;
  function inspect(session: object) {
    inspections += 1;
    const workflow = Match.value(inspections).pipe(
      Match.when(3, () => Effect.succeed({ _tag: 'Owned' as const, session, identity: {} })),
      Match.orElse(() => base.port.inspect(session)),
    );
    return workflow;
  }
  const port: CanaryPort = {
    create: base.port.create,
    remove: base.port.remove,
    readback: base.port.readback,
    inspect,
  };
  const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
  expect(outcome.cleanup).toBe('Unknown');
  expect(outcome.readiness).toBeUndefined();
  expect(base.calls).not.toContain('remove');
}
test(
  'ownership changing before cleanup forbids removal even if absence is reported',
  changedOwnership,
);

async function malformedPortResults() {
  const base = fake();
  function inspect() {
    const invalid = Reflect.get(Object.create(null), 'missing');
    const workflow = Effect.sync(() => invalid);
    return workflow;
  }
  const port: CanaryPort = {
    create: base.port.create,
    inspect,
    remove: base.port.remove,
    readback: base.port.readback,
  };
  const outcome = await Effect.runPromise(simulateReadinessHandoff(port));
  expect(outcome.cleanup).toBe('Unknown');
  expect(outcome.readiness).toBeUndefined();
  expect(base.calls).toContain('readback');
  expect(base.calls).not.toContain('remove');
  const other = fake();
  function readback() {
    const invalid = Reflect.get(Object.create(null), 'missing');
    const workflow = Effect.sync(() => invalid);
    return workflow;
  }
  const badReadback: CanaryPort = {
    create: other.port.create,
    inspect: other.port.inspect,
    remove: other.port.remove,
    readback,
  };
  const uncertain = await Effect.runPromise(simulateReadinessHandoff(badReadback));
  expect(uncertain.cleanup).toBe('Unknown');
  expect(uncertain.readiness).toBeUndefined();
}
test(
  'malformed ownership and readback results remain unknown without skipping cleanup',
  malformedPortResults,
);

async function cleanupDeadline() {
  function* exercise() {
    const started = yield* Deferred.make<void>();
    const base = fake();
    function* waitForRemoval() {
      yield* Deferred.succeed(started, undefined);
      yield* Effect.sleep(1000000);
    }
    function remove() {
      const workflow = Effect.gen(waitForRemoval);
      return workflow;
    }
    const port: CanaryPort = {
      create: base.port.create,
      inspect: base.port.inspect,
      readback: base.port.readback,
      remove,
    };
    const fiber = yield* Effect.forkChild(simulateReadinessHandoff(port));
    yield* Deferred.await(started).pipe(Effect.timeout(200000));
    yield* TestClock.adjust(90001);
    const outcome = yield* Fiber.join(fiber);
    expect(outcome.cleanup).toBe('Unknown');
    expect(outcome.readiness).toBeUndefined();
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test('a stuck cleanup expires and never confirms removal', cleanupDeadline);

async function reservedReadbackWindows() {
  for (const stage of ['inspect', 'remove'] as const) {
    function* exercise() {
      const started = yield* Deferred.make<void>();
      const base = fake();
      let inspections = 0;
      let readbacks = 0;
      let finished = false;
      function* hang() {
        yield* Deferred.succeed(started, undefined);
        yield* Effect.sleep(1000000);
      }
      function inspect(session: object) {
        inspections += 1;
        const isInspect = Schema.is(Schema.Literal('inspect'));
        const stall = isInspect(stage) && inspections === 3;
        function delayed() {
          const waiting = Effect.gen(hang);
          const workflow = waiting.pipe(Effect.andThen(base.port.inspect(session)));
          return workflow;
        }
        const workflow = Match.value(stall).pipe(
          Match.when(true, delayed),
          Match.orElse(() => base.port.inspect(session)),
        );
        return workflow;
      }
      function remove(session: object, identity: object) {
        const workflow = Match.value(stage).pipe(
          Match.when('remove', () => Effect.gen(hang)),
          Match.orElse(() => base.port.remove(session, identity)),
        );
        return workflow;
      }
      function readback() {
        readbacks += 1;
        const waiting = Effect.sleep(1000000);
        const workflow = waiting.pipe(Effect.andThen(base.port.readback({}, undefined)));
        return workflow;
      }
      const port: CanaryPort = { create: base.port.create, inspect, remove, readback };
      function markFinished() {
        finished = true;
      }
      const workflow = simulateReadinessHandoff(port).pipe(
        Effect.tap(() => Effect.sync(markFinished)),
      );
      const fiber = yield* Effect.forkChild(workflow);
      yield* Deferred.await(started).pipe(Effect.timeout(40000));
      yield* TestClock.adjust(19999);
      const before = readbacks;
      yield* TestClock.adjust(1);
      const atTwenty = readbacks;
      yield* TestClock.adjust(10000);
      const finishedAtThirty = finished;
      yield* TestClock.adjust(70000);
      const outcome = yield* Fiber.join(fiber);
      expect(before).toBe(0);
      expect(atTwenty).toBe(1);
      expect(finishedAtThirty).toBe(true);
      expect(outcome.cleanup).toBe('Unknown');
      expect(outcome.readiness).toBeUndefined();
    }
    const workflow = Effect.gen(exercise);
    const clock = Effect.provide(TestClock.layer());
    await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
  }
}
test('reserves an independent readback window within the cleanup budget', reservedReadbackWindows);

async function uninterruptibleRemovalFinalizer() {
  function* exercise() {
    const started = yield* Deferred.make<void>();
    const base = fake({ readback: 'Absent' });
    let finished = false;
    let readbacks = 0;
    function* removal() {
      yield* Effect.addFinalizer(() => Effect.sleep(15000));
      yield* Deferred.succeed(started, undefined);
      yield* Effect.sleep(1000000);
    }
    function remove() {
      const workflow = Effect.gen(removal);
      return workflow.pipe(Effect.scoped);
    }
    function readback(session: object, identity: object | undefined) {
      readbacks += 1;
      return base.port.readback(session, identity);
    }
    const port: CanaryPort = {
      create: base.port.create,
      inspect: base.port.inspect,
      remove,
      readback,
    };
    function markFinished() {
      finished = true;
    }
    const workflow = simulateReadinessHandoff(port).pipe(
      Effect.tap(() => Effect.sync(markFinished)),
    );
    const fiber = yield* Effect.forkChild(workflow);
    yield* Deferred.await(started).pipe(Effect.timeout(40000));
    yield* TestClock.adjust(20000);
    const atTwenty = readbacks;
    yield* TestClock.adjust(10000);
    const atThirty = finished;
    yield* TestClock.adjust(5000);
    const atThirtyFive = finished;
    yield* TestClock.adjust(25000);
    const outcome = yield* Fiber.join(fiber);
    expect(atTwenty).toBe(1);
    expect(atThirty).toBe(false);
    expect(atThirtyFive).toBe(true);
    expect(outcome.cleanup).toBe('Unknown');
    expect(outcome.readiness).toBeUndefined();
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test(
  'readback proceeds independently of an uninterruptible removal finalizer',
  uninterruptibleRemovalFinalizer,
);

async function interruptedUninterruptibleRemoval() {
  function* exercise() {
    const started = yield* Deferred.make<void>();
    const waiting = Effect.sleep(1000000);
    const output = Stream.fromEffect(waiting.pipe(Effect.map(() => new Uint8Array())));
    const base = fake({ output, readback: 'Absent' });
    let readbacks = 0;
    let interrupted = false;
    function* removal() {
      yield* Effect.addFinalizer(() => Effect.sleep(15000));
      yield* Deferred.succeed(started, undefined);
      yield* Effect.sleep(1000000);
    }
    function remove() {
      const workflow = Effect.gen(removal);
      return workflow.pipe(Effect.scoped);
    }
    function readback(session: object, identity: object | undefined) {
      readbacks += 1;
      return base.port.readback(session, identity);
    }
    const port: CanaryPort = {
      create: base.port.create,
      inspect: base.port.inspect,
      remove,
      readback,
    };
    const fiber = yield* Effect.forkChild(simulateReadinessHandoff(port));
    yield* Effect.yieldNow;
    function markInterrupted() {
      interrupted = true;
    }
    const cancel = Fiber.interrupt(fiber).pipe(Effect.tap(() => Effect.sync(markInterrupted)));
    const cancelling = yield* Effect.forkChild(cancel);
    yield* Deferred.await(started).pipe(Effect.timeout(40000));
    yield* TestClock.adjust(20000);
    const atTwenty = readbacks;
    yield* TestClock.adjust(10000);
    const atThirty = interrupted;
    yield* TestClock.adjust(5000);
    const atThirtyFive = interrupted;
    yield* Fiber.join(cancelling);
    expect(atTwenty).toBe(1);
    expect(atThirty).toBe(false);
    expect(atThirtyFive).toBe(true);
    expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test(
  'parent interruption waits for the scoped finalizer while readback proceeds',
  interruptedUninterruptibleRemoval,
);

async function earlyAbsenceCannotConfirmRemoval() {
  function* exercise() {
    const started = yield* Deferred.make<void>();
    const base = fake({ readback: 'Absent' });
    let removed = false;
    let readbacks = 0;
    function* delayedRemoval() {
      yield* Deferred.succeed(started, undefined);
      yield* Effect.sleep(25000);
      removed = true;
    }
    function remove() {
      const workflow = Effect.gen(delayedRemoval);
      return workflow.pipe(Effect.uninterruptible);
    }
    function readback(session: object, identity: object | undefined) {
      readbacks += 1;
      return base.port.readback(session, identity);
    }
    const port: CanaryPort = {
      create: base.port.create,
      inspect: base.port.inspect,
      remove,
      readback,
    };
    const fiber = yield* Effect.forkChild(simulateReadinessHandoff(port));
    yield* Deferred.await(started).pipe(Effect.timeout(40000));
    yield* TestClock.adjust(20000);
    const earlyReadbacks = readbacks;
    const earlyRemoval = removed;
    yield* TestClock.adjust(5000);
    const outcome = yield* Fiber.join(fiber);
    expect(earlyReadbacks).toBe(1);
    expect(earlyRemoval).toBe(false);
    expect(removed).toBe(true);
    expect(outcome.cleanup).toBe('Unknown');
    expect(outcome.readiness).toBeUndefined();
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test(
  'an absent readback before removal finishes cannot confirm cleanup',
  earlyAbsenceCannotConfirmRemoval,
);

async function readbackFollowsSuccessfulRemoval() {
  function* exercise() {
    const started = yield* Deferred.make<void>();
    const base = fake();
    let readbacks = 0;
    function remove(session: object, identity: object) {
      function* delayed() {
        yield* Deferred.succeed(started, undefined);
        yield* Effect.sleep(10000);
        yield* base.port.remove(session, identity);
      }
      const workflow = Effect.gen(delayed);
      return workflow;
    }
    function readback(session: object, identity: object | undefined) {
      readbacks += 1;
      return base.port.readback(session, identity);
    }
    const port: CanaryPort = {
      create: base.port.create,
      inspect: base.port.inspect,
      remove,
      readback,
    };
    const fiber = yield* Effect.forkChild(simulateReadinessHandoff(port));
    yield* Deferred.await(started).pipe(Effect.timeout(40000));
    yield* TestClock.adjust(9999);
    expect(readbacks).toBe(0);
    yield* TestClock.adjust(1);
    const outcome = yield* Fiber.join(fiber);
    expect(readbacks).toBe(1);
    expect(outcome.cleanup).toBe('ConfirmedRemoval');
    expect(outcome.readiness).toEqual(frame);
    expect(base.calls.slice(-2)).toEqual(['remove', 'readback']);
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test(
  'readback after successful removal can confirm fake cleanup',
  readbackFollowsSuccessfulRemoval,
);

async function scopedCleanupCharacterization() {
  function* exercise() {
    const started = yield* Deferred.make<void>();
    let readbacks = 0;
    let finished = false;
    function* removal() {
      yield* Effect.addFinalizer(() => Effect.sleep(15000));
      yield* Deferred.succeed(started, undefined);
      yield* Effect.sleep(1000000);
    }
    function* independentReadback() {
      yield* Effect.sleep(20000);
      readbacks += 1;
    }
    const removing = Effect.gen(removal);
    const worker = removing.pipe(Effect.scoped, Effect.timeout(20000), Effect.result);
    const reader = Effect.gen(independentReadback);
    const both = Effect.all([worker, reader], { concurrency: 2 });
    const bounded = both.pipe(Effect.timeout(30000), Effect.result);
    function markFinished() {
      finished = true;
    }
    const observing = bounded.pipe(Effect.tap(() => Effect.sync(markFinished)));
    const fiber = yield* Effect.forkChild(observing);
    yield* Deferred.await(started).pipe(Effect.timeout(40000));
    yield* TestClock.adjust(20000);
    const atTwenty = readbacks;
    yield* TestClock.adjust(10000);
    const atThirty = finished;
    yield* TestClock.adjust(5000);
    const atThirtyFive = finished;
    const outcome = yield* Fiber.join(fiber);
    expect(atTwenty).toBe(1);
    expect(atThirty).toBe(false);
    expect(atThirtyFive).toBe(true);
    expect(outcome._tag).toBe('Failure');
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test(
  'scoped concurrent readback runs while the timeout waits for a finalizer',
  scopedCleanupCharacterization,
);

async function interruptedStalledCleanup() {
  for (const stage of ['inspect', 'remove'] as const) {
    function* exercise() {
      const started = yield* Deferred.make<void>();
      const waiting = Effect.sleep(1000000);
      const output = Stream.fromEffect(waiting.pipe(Effect.map(() => new Uint8Array())));
      const base = fake({ output });
      let inspections = 0;
      function* hang() {
        yield* Deferred.succeed(started, undefined);
        yield* Effect.sleep(1000000);
      }
      function inspect(session: object) {
        inspections += 1;
        const isInspect = Schema.is(Schema.Literal('inspect'));
        const stall = isInspect(stage) && inspections === 2;
        function delayed() {
          const waiting = Effect.gen(hang);
          const workflow = waiting.pipe(Effect.andThen(base.port.inspect(session)));
          return workflow;
        }
        const workflow = Match.value(stall).pipe(
          Match.when(true, delayed),
          Match.orElse(() => base.port.inspect(session)),
        );
        return workflow;
      }
      function remove(session: object, identity: object) {
        const workflow = Match.value(stage).pipe(
          Match.when('remove', () => Effect.gen(hang)),
          Match.orElse(() => base.port.remove(session, identity)),
        );
        return workflow;
      }
      const port: CanaryPort = {
        create: base.port.create,
        inspect,
        remove,
        readback: base.port.readback,
      };
      const fiber = yield* Effect.forkChild(simulateReadinessHandoff(port));
      yield* Effect.yieldNow;
      const first = yield* Effect.forkChild(Fiber.interrupt(fiber));
      yield* Deferred.await(started).pipe(Effect.timeout(40000));
      const second = yield* Effect.forkChild(Fiber.interrupt(fiber));
      yield* TestClock.adjust(20000);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
      expect(base.calls).toContain('readback');
    }
    const workflow = Effect.gen(exercise);
    const clock = Effect.provide(TestClock.layer());
    await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
  }
}
test(
  'concurrent cancellation still reaches readback after a stalled cleanup phase',
  interruptedStalledCleanup,
);

async function createDeadline() {
  function* exercise() {
    const { port, calls } = fake({ create: 'hang' });
    const fiber = yield* Effect.forkChild(simulateReadinessHandoff(port));
    yield* TestClock.adjust(90001);
    const outcome = yield* Fiber.join(fiber);
    expect(outcome.cleanup).toBe('Unknown');
    expect(outcome.complete).toBe(false);
    expect(calls).toContain('readback');
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test(
  'deadline during create still runs cleanup and cannot confirm ambiguous creation',
  createDeadline,
);

async function concurrentInterruption() {
  function* exercise() {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const waiting = Effect.sleep(1000000);
    const output = Stream.fromEffect(waiting.pipe(Effect.map(() => new Uint8Array())));
    const base = fake({ output });
    function remove(session: object, id: object) {
      function* delayed() {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release).pipe(Effect.timeout(200000));
        yield* base.port.remove(session, id);
      }
      const workflow = Effect.gen(delayed);
      return workflow;
    }
    const port: CanaryPort = {
      create: base.port.create,
      inspect: base.port.inspect,
      readback: base.port.readback,
      remove,
    };
    const fiber = yield* Effect.forkChild(simulateReadinessHandoff(port));
    yield* Effect.yieldNow;
    const first = yield* Effect.forkChild(Fiber.interrupt(fiber));
    yield* Deferred.await(started).pipe(Effect.timeout(200000));
    const second = yield* Effect.forkChild(Fiber.interrupt(fiber));
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
    expect(base.calls).toContain('remove');
    expect(base.calls).toContain('readback');
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test(
  'concurrent interruption waits for cleanup even when interrupted again',
  concurrentInterruption,
);

async function interruptWithCleanupDefect() {
  function* exercise() {
    const waiting = Effect.sleep(1000000);
    const output = Stream.fromEffect(waiting.pipe(Effect.map(() => new Uint8Array())));
    const base = fake({ output });
    function remove() {
      const workflow = Effect.die(new Error('private cleanup defect'));
      return workflow;
    }
    const port: CanaryPort = {
      create: base.port.create,
      inspect: base.port.inspect,
      readback: base.port.readback,
      remove,
    };
    const fiber = yield* Effect.forkChild(simulateReadinessHandoff(port));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(fiber);
    expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
    expect(base.calls).toContain('readback');
  }
  const workflow = Effect.gen(exercise);
  const clock = Effect.provide(TestClock.layer());
  await Effect.runPromise(workflow.pipe(Effect.scoped, clock));
}
test(
  'interruption remains interruption when cleanup defects and readback still runs',
  interruptWithCleanupDefect,
);
