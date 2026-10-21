import { expect, test } from 'bun:test';

import {
  WorkerContainerId,
  WorkerDaemonId,
  WorkerHostId,
  WorkerIntentId,
  WorkerIssuerId,
  WorkerOperationId,
  type WorkerIntent,
  type WorkerMutationReply,
  type WorkerReadyReceipt,
} from '@ceirean/domain';
import { Deferred, Effect, Fiber, Match, Option, Result, Schema } from 'effect';

import {
  WorkerJournalSnapshot,
  type WorkerJournalEdit,
  type WorkerJournalResult,
} from '../src/worker-contracts.ts';
import { WorkerJournalError } from '../src/worker-errors.ts';
import {
  claimEdit,
  cleanupEdit,
  makeWorkerCase,
  makeWorkerIntent,
  makeWorkerSnapshot,
} from './worker-fixtures.ts';
import { makeMemoryWorkerJournal } from './worker-memory-journal.ts';

function committed(result: WorkerJournalResult) {
  return Match.value(result).pipe(
    Match.tag('Committed', ({ snapshot }) => snapshot),
    Match.orElse(() => {
      throw new TypeError('Expected commit');
    }),
  );
}

function outcomeEdit(
  snapshot: WorkerJournalSnapshot,
  reply: WorkerMutationReply,
  atMs = reply.atMs,
): WorkerJournalEdit {
  return {
    _tag: 'RecordOutcome',
    operationId: snapshot.operation.operationId,
    expectedRevision: snapshot.revision,
    atMs,
    reply,
  };
}

function claimedSeed(kind: WorkerIntent['kind'] = 'Create') {
  const snapshot = makeWorkerSnapshot();
  const intent = makeWorkerIntent(kind);
  const containerId = Match.value(kind).pipe(
    Match.when('Create', () => Option.none()),
    Match.orElse(() => Option.some(makeWorkerCase().containerId)),
  );
  return {
    ...snapshot,
    intents: [intent],
    containerId,
  };
}

function replyFor(kind: WorkerIntent['kind'] = 'Create'): WorkerMutationReply {
  const c = makeWorkerCase();
  return { ...c.reply, intentId: makeWorkerIntent(kind).intentId };
}

function readinessAt(observedAtMs: number): WorkerReadyReceipt {
  const { operation, containerId } = makeWorkerCase();
  return {
    operationId: operation.operationId,
    identity: operation.identity,
    hostId: operation.hostId,
    daemonId: operation.daemonId,
    containerId,
    imageDigest: operation.imageDigest,
    sourceDigest: operation.sourceDigest,
    policyDigest: operation.policyDigest,
    configDigest: operation.configDigest,
    configuration: operation.configuration,
    observedAtMs,
  };
}

async function startClaimInvalidatesReadiness() {
  function* scenario() {
    const c = makeWorkerCase();
    const seed = {
      ...makeWorkerSnapshot(),
      containerId: Option.some(c.containerId),
      readiness: Option.some(readinessAt(940)),
    };
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const startIntent = makeWorkerIntent('Start');
    const started = committed(yield* journal.service.commit(claimEdit(seed, startIntent)));
    expect(started.readiness).toEqual(Option.none());
    const failedReply = {
      ...replyFor('Start'),
      atMs: 951,
      outcome: { _tag: 'Failed' as const, reason: { _tag: 'NotFound' as const } },
    };
    const failed = committed(yield* journal.service.commit(outcomeEdit(started, failedReply)));
    const recovered = yield* makeMemoryWorkerJournal([failed]);
    const authorization: WorkerJournalEdit = {
      _tag: 'AuthorizeExecution',
      operationId: seed.operation.operationId,
      expectedRevision: failed.revision,
      atMs: 952,
    };
    expect((yield* recovered.service.commit(authorization))._tag).toBe('Refused');
    const stale = { ...failed, readiness: Option.some(readinessAt(940)) };
    const restoredStale = yield* makeMemoryWorkerJournal([stale]);
    expect((yield* restoredStale.service.commit(authorization))._tag).toBe('Refused');
    const fresh = committed(
      yield* recovered.service.commit({
        _tag: 'RecordReadiness',
        operationId: seed.operation.operationId,
        expectedRevision: failed.revision,
        atMs: 952,
        receipt: readinessAt(952),
      }),
    );
    const authorized = committed(
      yield* recovered.service.commit({
        ...authorization,
        expectedRevision: fresh.revision,
        atMs: 953,
      }),
    );
    expect(authorized.executionAuthorizedAtMs).toEqual(Option.some(953));
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'I1 Start claim clears pre-action readiness and failed Start needs fresh readback after reconstruction',
  startClaimInvalidatesReadiness,
);

for (const outcomeTag of ['Failed', 'Unknown'] as const) {
  async function nonCompletedOutcomeOrdering() {
    function* scenario() {
      const c = makeWorkerCase();
      const seed = { ...makeWorkerSnapshot(), containerId: Option.some(c.containerId) };
      const journal = yield* makeMemoryWorkerJournal([seed]);
      const startIntent = makeWorkerIntent('Start');
      const claimed = committed(yield* journal.service.commit(claimEdit(seed, startIntent)));
      const outcome = Match.value(outcomeTag).pipe(
        Match.when('Failed', () => ({
          _tag: 'Failed' as const,
          reason: { _tag: 'NotFound' as const },
        })),
        Match.when('Unknown', () => ({
          _tag: 'Unknown' as const,
          reason: { _tag: 'UnresolvedIntent' as const },
        })),
        Match.exhaustive,
      );
      const reply = { ...replyFor('Start'), atMs: 990, outcome };
      const recorded = committed(yield* journal.service.commit(outcomeEdit(claimed, reply)));
      const recovered = yield* makeMemoryWorkerJournal([recorded]);
      const stale: WorkerJournalResult = {
        _tag: 'Refused',
        refusal: { _tag: 'StaleObservation', operationId: seed.operation.operationId },
      };
      const readiness: WorkerJournalEdit = {
        _tag: 'RecordReadiness',
        operationId: seed.operation.operationId,
        expectedRevision: recorded.revision,
        atMs: 991,
        receipt: readinessAt(980),
      };
      expect(yield* recovered.service.commit(readiness)).toEqual(stale);
      expect(yield* recovered.service.commit(cleanupEdit(recorded, 960))).toEqual(stale);
      expect(
        yield* recovered.service.commit(outcomeEdit(recorded, { ...reply, atMs: 989 }, 991)),
      ).toEqual(stale);
      const forged = { ...recorded, readiness: Option.some(readinessAt(980)) };
      const staleRestored = yield* makeMemoryWorkerJournal([forged]);
      expect(
        yield* staleRestored.service.commit({
          _tag: 'AuthorizeExecution',
          operationId: seed.operation.operationId,
          expectedRevision: recorded.revision,
          atMs: 992,
        }),
      ).toEqual(stale);
      expect(yield* recovered.inspect(seed.operation.operationId)).toEqual(Option.some(recorded));
      expect(recorded.editTimeFloorMs).toBe(990);
      expect(recorded.outcomeEvidenceFloorMs).toBe(990);
      const equal = committed(yield* recovered.service.commit(outcomeEdit(recorded, reply)));
      expect(equal.editTimeFloorMs).toBe(990);
      expect(equal.outcomeEvidenceFloorMs).toBe(990);
      const newer = committed(
        yield* recovered.service.commit(outcomeEdit(equal, { ...reply, atMs: 991 })),
      );
      expect(newer.editTimeFloorMs).toBe(991);
      expect(newer.outcomeEvidenceFloorMs).toBe(991);
      const reconstructed = yield* makeMemoryWorkerJournal([newer]);
      expect(
        (yield* reconstructed.service.commit({
          ...readiness,
          expectedRevision: newer.revision,
          atMs: 991,
          receipt: readinessAt(991),
        }))._tag,
      ).toBe(
        Match.value(outcomeTag).pipe(
          Match.when('Failed', () => 'Committed' as const),
          Match.when('Unknown', () => 'Refused' as const),
          Match.exhaustive,
        ),
      );
    }
    const program = Effect.gen(scenario);
    await Effect.runPromise(program);
  }
  test(
    `I2 ${outcomeTag} reply time fences older readiness, authorization and edits after reconstruction`,
    nonCompletedOutcomeOrdering,
  );
}

async function separateAdministrativeAndOutcomeFloors() {
  function* scenario() {
    const seed = {
      ...makeWorkerSnapshot(),
      containerId: Option.some(makeWorkerCase().containerId),
    };
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const ready = committed(
      yield* journal.service.commit({
        _tag: 'RecordReadiness',
        operationId: seed.operation.operationId,
        expectedRevision: seed.revision,
        atMs: 995,
        receipt: readinessAt(990),
      }),
    );
    const recovered = yield* makeMemoryWorkerJournal([ready]);
    expect((yield* recovered.service.commit(cleanupEdit(ready, 994)))._tag).toBe('Refused');
    expect(ready.editTimeFloorMs).toBe(995);
    expect(ready.outcomeEvidenceFloorMs).toBe(990);
    const newer = committed(
      yield* recovered.service.commit({
        _tag: 'RecordReadiness',
        operationId: seed.operation.operationId,
        expectedRevision: ready.revision,
        atMs: 996,
        receipt: readinessAt(991),
      }),
    );
    expect(newer.editTimeFloorMs).toBe(996);
    expect(newer.outcomeEvidenceFloorMs).toBe(991);
    const authorized = committed(
      yield* recovered.service.commit({
        _tag: 'AuthorizeExecution',
        operationId: seed.operation.operationId,
        expectedRevision: newer.revision,
        atMs: 996,
      }),
    );
    expect(authorized.executionAuthorizedAtMs).toEqual(Option.some(996));
    expect(authorized.outcomeEvidenceFloorMs).toBe(991);
    const afterAuthorization = yield* makeMemoryWorkerJournal([authorized]);
    expect(
      (yield* afterAuthorization.service.commit({
        _tag: 'AuthorizeExecution',
        operationId: seed.operation.operationId,
        expectedRevision: authorized.revision,
        atMs: 997,
      }))._tag,
    ).toBe('Refused');
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'I2 administrative edits and post-action readiness retain distinct durable time floors',
  separateAdministrativeAndOutcomeFloors,
);

async function freshReadinessAfterUnknownResolution() {
  function* scenario() {
    const seed = {
      ...makeWorkerSnapshot(),
      containerId: Option.some(makeWorkerCase().containerId),
    };
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const intent = makeWorkerIntent('Start');
    const claimed = committed(yield* journal.service.commit(claimEdit(seed, intent)));
    const uncertainReply = {
      ...replyFor('Start'),
      atMs: 990,
      outcome: { _tag: 'Unknown' as const, reason: { _tag: 'UnresolvedIntent' as const } },
    };
    const uncertain = committed(
      yield* journal.service.commit(outcomeEdit(claimed, uncertainReply)),
    );
    const recovered = yield* makeMemoryWorkerJournal([uncertain]);
    expect(
      (yield* recovered.service.commit({
        _tag: 'RecordReadiness',
        operationId: seed.operation.operationId,
        expectedRevision: uncertain.revision,
        atMs: 991,
        receipt: readinessAt(991),
      }))._tag,
    ).toBe('Refused');
    const c = makeWorkerCase();
    const reply = {
      ...replyFor('Start'),
      atMs: 992,
      outcome: { _tag: 'Completed' as const, observation: { ...c.observation, atMs: 992 } },
    };
    const resolved = committed(yield* recovered.service.commit(outcomeEdit(uncertain, reply)));
    expect(resolved.outcomeEvidenceFloorMs).toBe(992);
    const ready = committed(
      yield* recovered.service.commit({
        _tag: 'RecordReadiness',
        operationId: seed.operation.operationId,
        expectedRevision: resolved.revision,
        atMs: 992,
        receipt: readinessAt(992),
      }),
    );
    const authorized = committed(
      yield* recovered.service.commit({
        _tag: 'AuthorizeExecution',
        operationId: seed.operation.operationId,
        expectedRevision: ready.revision,
        atMs: 992,
      }),
    );
    expect(authorized.executionAuthorizedAtMs).toEqual(Option.some(992));
    expect(authorized.editTimeFloorMs).toBe(992);
    expect(authorized.outcomeEvidenceFloorMs).toBe(992);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'I2 Unknown requires matching newer completion before equal-time readiness and execution can succeed',
  freshReadinessAfterUnknownResolution,
);

for (const outcomeTag of ['Completed', 'Failed', 'Unknown'] as const) {
  async function lateOutcomeFloors() {
    function* scenario() {
      const seed = makeWorkerSnapshot();
      const journal = yield* makeMemoryWorkerJournal([seed]);
      const claimed = committed(yield* journal.service.commit(claimEdit(seed)));
      const cancelled = committed(
        yield* journal.service.commit({ ...cleanupEdit(claimed), _tag: 'RequestCancellation' }),
      );
      const c = makeWorkerCase();
      const outcome = Match.value(outcomeTag).pipe(
        Match.when('Completed', () => ({
          _tag: 'Completed' as const,
          observation: { ...c.observation, atMs: 998 },
        })),
        Match.when('Failed', () => ({
          _tag: 'Failed' as const,
          reason: { _tag: 'NotFound' as const },
        })),
        Match.when('Unknown', () => ({
          _tag: 'Unknown' as const,
          reason: { _tag: 'UnresolvedIntent' as const },
        })),
        Match.exhaustive,
      );
      const reply = { ...replyFor(), atMs: 999, outcome };
      const recorded = committed(
        yield* journal.service.commit(outcomeEdit(cancelled, reply, 1002)),
      );
      expect(recorded.editTimeFloorMs).toBe(1002);
      expect(recorded.outcomeEvidenceFloorMs).toBe(999);
      expect(recorded.operation.limits).toEqual({ deadlineMs: 1000, spentMicros: 17, repairs: 1 });
      expect(recorded.authority.cancelledAtMs).toEqual(Option.some(1000));
      const recovered = yield* makeMemoryWorkerJournal([recorded]);
      expect((yield* recovered.service.commit(cleanupEdit(recorded, 1001)))._tag).toBe('Refused');
      const repeated = committed(yield* recovered.service.commit(cleanupEdit(recorded, 1002)));
      expect(repeated.editTimeFloorMs).toBe(1002);
      expect(repeated.outcomeEvidenceFloorMs).toBe(999);
      expect(Option.getOrThrow(repeated.cleanup).deadlineMs).toBe(1100);
    }
    const program = Effect.gen(scenario);
    await Effect.runPromise(program);
  }
  test(
    `I2 late truthful ${outcomeTag} evidence can predate cancellation without moving the edit clock backward`,
    lateOutcomeFloors,
  );
}

async function requiredPersistedFloors() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    expect(seed.editTimeFloorMs).toBe(900);
    expect(seed.outcomeEvidenceFloorMs).toBe(900);
    const journal = yield* makeMemoryWorkerJournal([]);
    const registered = committed(
      yield* journal.service.commit({
        _tag: 'Register',
        operationId: seed.operation.operationId,
        operation: seed.operation,
        createdAtMs: 900,
        atMs: 920,
      }),
    );
    expect(registered.editTimeFloorMs).toBe(920);
    expect(registered.outcomeEvidenceFloorMs).toBe(900);
    const error = new WorkerJournalError({ operation: 'load', code: 'InvalidData' });
    for (const field of ['editTimeFloorMs', 'outcomeEvidenceFloorMs'] as const) {
      const missing = { ...seed };
      Reflect.deleteProperty(missing, field);
      expect(yield* Effect.result(makeMemoryWorkerJournal([missing]))).toEqual(Result.fail(error));
      for (const invalid of [undefined, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const malformed = { ...seed };
        Reflect.set(malformed, field, invalid);
        expect(yield* Effect.result(makeMemoryWorkerJournal([malformed]))).toEqual(
          Result.fail(error),
        );
      }
    }
    Reflect.set(registered, 'editTimeFloorMs', 0);
    const loaded = Option.getOrThrow(yield* journal.inspect(seed.operation.operationId));
    expect(loaded.editTimeFloorMs).toBe(920);
    const recovered = yield* makeMemoryWorkerJournal([loaded]);
    Reflect.set(loaded, 'outcomeEvidenceFloorMs', 0);
    const inspected = Option.getOrThrow(yield* recovered.service.load(seed.operation.operationId));
    expect(inspected.editTimeFloorMs).toBe(920);
    expect(inspected.outcomeEvidenceFloorMs).toBe(900);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'I2 persisted time floors are required safe integers and detach without reconstruction defaults',
  requiredPersistedFloors,
);

async function authorityPreservesOrderingFloors() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const sibling = { ...siblingSnapshot(seed), editTimeFloorMs: 995, outcomeEvidenceFloorMs: 990 };
    const control = yield* makeMemoryWorkerJournal([seed, sibling]);
    yield* control.replaceAuthority(
      seed.operation.operationId,
      { ...seed.operation.identity, generation: 4 },
      Option.none(),
    );
    const controlTarget = Option.getOrThrow(yield* control.inspect(seed.operation.operationId));
    const controlPeer = Option.getOrThrow(yield* control.inspect(sibling.operation.operationId));
    expect(controlTarget.editTimeFloorMs).toBe(900);
    expect(controlPeer.editTimeFloorMs).toBe(995);
    expect(controlPeer.outcomeEvidenceFloorMs).toBe(990);
    const journal = yield* makeMemoryWorkerJournal([seed, sibling]);
    expect(
      (yield* journal.service.commit({ ...cleanupEdit(seed, 994), _tag: 'RequestCancellation' }))
        ._tag,
    ).toBe('Refused');
    expect(yield* journal.inspect(seed.operation.operationId)).toEqual(Option.some(seed));
    const cancelled = committed(
      yield* journal.service.commit({ ...cleanupEdit(seed, 995), _tag: 'RequestCancellation' }),
    );
    const peer = Option.getOrThrow(yield* journal.inspect(sibling.operation.operationId));
    expect(cancelled.editTimeFloorMs).toBe(995);
    expect(peer.editTimeFloorMs).toBe(995);
    expect(peer.outcomeEvidenceFloorMs).toBe(990);
    const replacement = { ...seed.operation.identity, generation: 4 };
    yield* journal.replaceAuthority(seed.operation.operationId, replacement, Option.none());
    const replaced = Option.getOrThrow(yield* journal.inspect(sibling.operation.operationId));
    expect(replaced.editTimeFloorMs).toBe(995);
    expect(replaced.outcomeEvidenceFloorMs).toBe(990);
    yield* journal.replaceAuthority(seed.operation.operationId, replacement, Option.some(997));
    const suppliedTime = Option.getOrThrow(yield* journal.inspect(sibling.operation.operationId));
    expect(suppliedTime.editTimeFloorMs).toBe(997);
    expect(suppliedTime.outcomeEvidenceFloorMs).toBe(990);
    const operation = {
      ...seed.operation,
      operationId: WorkerOperationId.make('worker-3'),
      identity: replacement,
    };
    expect(
      (yield* journal.service.commit({
        _tag: 'Register',
        operationId: operation.operationId,
        operation,
        createdAtMs: 900,
        atMs: 996,
      }))._tag,
    ).toBe('Refused');
    const registered = committed(
      yield* journal.service.commit({
        _tag: 'Register',
        operationId: operation.operationId,
        operation,
        createdAtMs: 900,
        atMs: 998,
      }),
    );
    expect(registered.editTimeFloorMs).toBe(998);
    expect(registered.outcomeEvidenceFloorMs).toBe(990);
    const recovered = yield* makeMemoryWorkerJournal([registered]);
    expect((yield* recovered.service.commit(cleanupEdit(registered, 996)))._tag).toBe('Refused');
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'I2 run authority fan-out, replacement and registration preserve affected record ordering',
  authorityPreservesOrderingFloors,
);

function siblingSnapshot(seed: WorkerJournalSnapshot): WorkerJournalSnapshot {
  return {
    ...seed,
    operation: { ...seed.operation, operationId: WorkerOperationId.make('worker-2') },
  };
}

for (const action of ['replace', 'cancel'] as const) {
  async function sharedRunAuthority() {
    function* scenario() {
      const seed = makeWorkerSnapshot();
      const sibling = siblingSnapshot(seed);
      const journal = yield* makeMemoryWorkerJournal([seed, sibling]);
      const replaced = journal
        .replaceAuthority(
          seed.operation.operationId,
          { ...seed.operation.identity, generation: 4 },
          Option.none(),
        )
        .pipe(Effect.asVoid);
      const cancelled = journal.service
        .commit({ ...cleanupEdit(seed, 960), _tag: 'RequestCancellation' })
        .pipe(Effect.asVoid);
      yield* Match.value(action).pipe(
        Match.when('replace', () => replaced),
        Match.when('cancel', () => cancelled),
        Match.exhaustive,
      );
      const other = Option.getOrThrow(yield* journal.service.load(sibling.operation.operationId));
      expect(other.revision).toBe(8);
      const changed = Option.getOrThrow(yield* journal.service.load(seed.operation.operationId));
      expect(other.authority).toEqual(changed.authority);
      const intent = { ...makeWorkerIntent(), operationId: other.operation.operationId };
      expect((yield* journal.service.commit(claimEdit(other, intent)))._tag).toBe('Refused');
      const c = makeWorkerCase();
      const receipt = {
        ...c.resource,
        operationId: other.operation.operationId,
        hostId: c.operation.hostId,
        daemonId: c.operation.daemonId,
        observedAtMs: 959,
      };
      const bound = {
        ...other,
        containerId: Option.some(c.containerId),
        readiness: Option.some(receipt),
      };
      const recovered = yield* makeMemoryWorkerJournal([changed, bound]);
      const start = {
        ...makeWorkerIntent('Start'),
        operationId: other.operation.operationId,
        claimedAtMs: 961,
      };
      expect((yield* recovered.service.commit(claimEdit(bound, start)))._tag).toBe('Refused');
      expect(
        (yield* recovered.service.commit({
          _tag: 'AuthorizeExecution',
          operationId: other.operation.operationId,
          expectedRevision: 8,
          atMs: 961,
        }))._tag,
      ).toBe('Refused');
      expect(other.operation).toEqual(sibling.operation);
    }
    const program = Effect.gen(scenario);
    await Effect.runPromise(program);
  }
  test(
    `same-run ${action} fences sibling Create/Start/AuthorizeExecution atomically`,
    sharedRunAuthority,
  );
}

async function supersededCancellation() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const sibling = siblingSnapshot(seed);
    const journal = yield* makeMemoryWorkerJournal([seed, sibling]);
    const replacement = { ...seed.operation.identity, generation: 4 };
    yield* journal.replaceAuthority(seed.operation.operationId, replacement, Option.none());
    const old = Option.getOrThrow(yield* journal.service.load(seed.operation.operationId));
    expect(
      (yield* journal.service.commit({ ...cleanupEdit(old, 960), _tag: 'RequestCancellation' }))
        ._tag,
    ).toBe('Refused');
    const peer = Option.getOrThrow(yield* journal.service.load(sibling.operation.operationId));
    expect(peer.authority).toEqual({ identity: replacement, cancelledAtMs: Option.none() });
    expect((yield* journal.service.commit(cleanupEdit(old, 960)))._tag).toBe('Committed');
    const inconsistent = { ...sibling, authority: { ...sibling.authority, identity: replacement } };
    expect(yield* Effect.result(makeMemoryWorkerJournal([seed, inconsistent]))).toEqual(
      Result.fail(new WorkerJournalError({ operation: 'load', code: 'InvalidData' })),
    );
    expect(yield* Effect.result(makeMemoryWorkerJournal([seed, seed]))).toEqual(
      Result.fail(new WorkerJournalError({ operation: 'load', code: 'InvalidData' })),
    );
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'superseded cancellation cannot cancel replacement authority; same-run seed disagreement is rejected',
  supersededCancellation,
);

async function atomicAuthorityExhaustion() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const sibling = { ...siblingSnapshot(seed), revision: Number.MAX_SAFE_INTEGER };
    const journal = yield* makeMemoryWorkerJournal([seed, sibling]);
    const error = new WorkerJournalError({ operation: 'commit', code: 'RevisionExhausted' });
    const replacing = journal.replaceAuthority(
      seed.operation.operationId,
      { ...seed.operation.identity, generation: 4 },
      Option.none(),
    );
    expect(yield* Effect.result(replacing)).toEqual(Result.fail(error));
    const cancelling = journal.service.commit({
      ...cleanupEdit(seed, 960),
      _tag: 'RequestCancellation',
    });
    expect(yield* Effect.result(cancelling)).toEqual(Result.fail(error));
    expect(yield* journal.inspect(seed.operation.operationId)).toEqual(Option.some(seed));
    expect(yield* journal.inspect(sibling.operation.operationId)).toEqual(Option.some(sibling));
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'peer revision exhaustion rolls back the entire shared-run authority edit',
  atomicAuthorityExhaustion,
);

async function registrationSharesCancellation() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const cancelled = committed(
      yield* journal.service.commit({ ...cleanupEdit(seed, 960), _tag: 'RequestCancellation' }),
    );
    const sibling = siblingSnapshot(seed);
    const registered = committed(
      yield* journal.service.commit({
        _tag: 'Register',
        operationId: sibling.operation.operationId,
        operation: sibling.operation,
        createdAtMs: 900,
        atMs: 960,
      }),
    );
    expect(registered.authority).toEqual(cancelled.authority);
    const intent = {
      ...makeWorkerIntent(),
      operationId: sibling.operation.operationId,
      claimedAtMs: 961,
    };
    expect((yield* journal.service.commit(claimEdit(registered, intent)))._tag).toBe('Refused');
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'later same-run registration inherits cancellation rather than resetting run authority',
  registrationSharesCancellation,
);

async function replacementCancellationScope() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    yield* journal.service.commit({ ...cleanupEdit(seed, 960), _tag: 'RequestCancellation' });
    const identity = { ...seed.operation.identity, generation: 4 };
    yield* journal.replaceAuthority(seed.operation.operationId, identity, Option.none());
    const old = Option.getOrThrow(yield* journal.inspect(seed.operation.operationId));
    expect(old.authority).toEqual({ identity, cancelledAtMs: Option.none() });
    expect(
      (yield* journal.service.commit({ ...cleanupEdit(old, 970), _tag: 'RequestCancellation' }))
        ._tag,
    ).toBe('Refused');
    const sibling = siblingSnapshot(seed);
    const operation = { ...sibling.operation, identity };
    const registered = committed(
      yield* journal.service.commit({
        _tag: 'Register',
        operationId: operation.operationId,
        operation,
        createdAtMs: 970,
        atMs: 970,
      }),
    );
    const intent = { ...makeWorkerIntent(), operationId: operation.operationId, claimedAtMs: 971 };
    expect((yield* journal.service.commit(claimEdit(registered, intent)))._tag).toBe('Committed');
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'replacement receives its own cancellation authority, never the cancelled old generation',
  replacementCancellationScope,
);

async function backwardClaimAndOutcome() {
  function* scenario() {
    const c = makeWorkerCase();
    const receipt = {
      operationId: c.operation.operationId,
      identity: c.operation.identity,
      hostId: c.operation.hostId,
      daemonId: c.operation.daemonId,
      containerId: c.containerId,
      imageDigest: c.operation.imageDigest,
      sourceDigest: c.operation.sourceDigest,
      policyDigest: c.operation.policyDigest,
      configDigest: c.operation.configDigest,
      configuration: c.operation.configuration,
      observedAtMs: 999,
    };
    const seed = {
      ...makeWorkerSnapshot(),
      containerId: Option.some(c.containerId),
      readiness: Option.some(receipt),
    };
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const startIntent = makeWorkerIntent('Start');
    expect((yield* journal.service.commit(claimEdit(seed, startIntent)))._tag).toBe('Refused');
    const issued = { ...seed, intents: [makeWorkerIntent('Start')] };
    const recovered = yield* makeMemoryWorkerJournal([issued]);
    const stale = {
      ...replyFor('Start'),
      outcome: { _tag: 'Completed' as const, observation: { ...c.observation, atMs: 998 } },
    };
    expect((yield* recovered.service.commit(outcomeEdit(issued, stale)))._tag).toBe('Refused');
    expect(yield* recovered.inspect(seed.operation.operationId)).toEqual(Option.some(issued));
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'claims and completion cannot move behind retained readiness evidence',
  backwardClaimAndOutcome,
);

async function concurrentClaims() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const first = claimEdit(seed);
    const second = claimEdit(seed, {
      ...makeWorkerIntent(),
      intentId: WorkerIntentId.make('other'),
      issuerId: WorkerIssuerId.make('controller-2'),
    });
    const results = yield* Effect.all(
      [journal.service.commit(first), journal.service.commit(second)],
      { concurrency: 'unbounded' },
    );
    expect(results.map((result) => result._tag).sort()).toEqual(['Committed', 'Conflict']);
    const stored = Option.getOrThrow(yield* journal.service.load(seed.operation.operationId));
    expect(stored.revision).toBe(8);
    expect(stored.intents).toHaveLength(1);
    expect(stored.intents[0]?.outcome).toEqual({ _tag: 'Claimed' });
    const recovered = yield* makeMemoryWorkerJournal([stored]);
    expect(yield* recovered.service.commit({ ...second, expectedRevision: 8 })).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'AlreadyClaimed', operationId: seed.operation.operationId },
    });
    expect(yield* recovered.inspect(seed.operation.operationId)).toEqual(Option.some(stored));
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'concurrent Create claims have one issuer; fresh IDs and issuers cannot replay after reload',
  concurrentClaims,
);

async function insertOnlyRegistration() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const journal = yield* makeMemoryWorkerJournal([]);
    const edit: WorkerJournalEdit = {
      _tag: 'Register',
      operationId: seed.operation.operationId,
      operation: seed.operation,
      createdAtMs: 900,
      atMs: 900,
    };
    const registered = committed(yield* journal.service.commit(edit));
    expect(registered.revision).toBe(0);
    expect((yield* journal.service.commit(edit))._tag).toBe('Conflict');
    expect(
      yield* journal.service.commit({
        ...edit,
        operation: { ...seed.operation, limits: { ...seed.operation.limits, repairs: 2 } },
      }),
    ).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'ConflictingOperation', operationId: seed.operation.operationId },
    });
    expect(yield* journal.inspect(seed.operation.operationId)).toEqual(Option.some(registered));
    expect(
      (yield* journal.service.commit({ ...edit, operationId: WorkerOperationId.make('wrong') }))
        ._tag,
    ).toBe('Refused');
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test('Register is insert-only and rejects different immutable input', insertOnlyRegistration);

async function exhaustedRevision() {
  function* scenario() {
    const seed = { ...makeWorkerSnapshot(), revision: Number.MAX_SAFE_INTEGER };
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const error = new WorkerJournalError({ operation: 'commit', code: 'RevisionExhausted' });
    expect(yield* Effect.result(journal.service.commit(claimEdit(seed)))).toEqual(
      Result.fail(error),
    );
    expect(
      yield* Effect.result(
        journal.replaceAuthority(
          seed.operation.operationId,
          seed.operation.identity,
          Option.none(),
        ),
      ),
    ).toEqual(Result.fail(error));
    expect(yield* journal.inspect(seed.operation.operationId)).toEqual(Option.some(seed));
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'revision exhaustion is a tagged failure for edits and authority replacement',
  exhaustedRevision,
);

for (const kind of ['Create', 'Start'] as const) {
  async function executionClaimFences() {
    function* scenario() {
      const c = makeWorkerCase();
      const base = makeWorkerSnapshot();
      const containerId = Match.value(kind).pipe(
        Match.when('Start', () => Option.some(c.containerId)),
        Match.when('Create', () => Option.none()),
        Match.exhaustive,
      );
      const seed = { ...base, containerId };
      const invalidSeeds = [
        { ...seed, authority: { ...seed.authority, cancelledAtMs: Option.some(940) } },
        {
          ...seed,
          authority: { ...seed.authority, identity: { ...seed.operation.identity, generation: 4 } },
        },
        {
          ...seed,
          operation: {
            ...seed.operation,
            custody: { ...seed.operation.custody, stagingDirectory: '/outside' },
          },
        },
      ];
      for (const invalid of invalidSeeds) {
        const journal = yield* makeMemoryWorkerJournal([invalid]);
        const intent = makeWorkerIntent(kind);
        expect((yield* journal.service.commit(claimEdit(invalid, intent)))._tag).toBe('Refused');
        expect(yield* journal.inspect(seed.operation.operationId)).toEqual(Option.some(invalid));
      }
      const journal = yield* makeMemoryWorkerJournal([seed]);
      expect(
        (yield* journal.service.commit(
          claimEdit(seed, { ...makeWorkerIntent(kind), claimedAtMs: 1000 }),
        ))._tag,
      ).toBe('Refused');
      expect(
        (yield* journal.service.commit(
          claimEdit(seed, {
            ...makeWorkerIntent(kind),
            outcome: { _tag: 'Completed', observation: c.observation },
          }),
        ))._tag,
      ).toBe('Refused');
    }
    const program = Effect.gen(scenario);
    await Effect.runPromise(program);
  }
  test(
    `${kind} refuses cancellation, replacement, deadline equality, missing custody and fabricated completed claims`,
    executionClaimFences,
  );
}

for (const kind of ['Create', 'Start', 'Stop', 'Remove'] as const) {
  async function actionSpecificCompletion() {
    function* scenario() {
      const seed = claimedSeed(kind);
      const c = makeWorkerCase();
      const journal = yield* makeMemoryWorkerJournal([seed]);
      const resources = Match.value(kind).pipe(
        Match.when('Remove', () => []),
        Match.when('Stop', () => [{ ...c.resource, running: false }]),
        Match.whenOr('Create', 'Start', () => [c.resource]),
        Match.exhaustive,
      );
      const observation = { ...c.observation, resources };
      const valid = { ...replyFor(kind), outcome: { _tag: 'Completed' as const, observation } };
      const empty = { ...observation, resources: [] };
      const replacement = {
        ...observation,
        resources: [{ ...c.resource, containerId: WorkerContainerId.make('replacement') }],
      };
      const invalidObservations = Match.value(kind).pipe(
        Match.when('Create', () => [empty]),
        Match.when('Remove', () => [c.observation]),
        Match.when('Start', () => [empty, replacement]),
        Match.when('Stop', () => [empty, replacement, c.observation]),
        Match.exhaustive,
      );
      for (const invalid of invalidObservations) {
        expect(
          (yield* journal.service.commit(
            outcomeEdit(seed, { ...valid, outcome: { _tag: 'Completed', observation: invalid } }),
          ))._tag,
        ).toBe('Refused');
      }
      const stored = committed(yield* journal.service.commit(outcomeEdit(seed, valid)));
      expect(stored.intents[0]?.outcome._tag).toBe('Completed');
      expect(stored.containerId).toEqual(Option.some(c.containerId));
      expect(
        (yield* journal.service.commit(
          outcomeEdit(stored, {
            ...valid,
            outcome: { _tag: 'Failed', reason: { _tag: 'NotFound' } },
          }),
        ))._tag,
      ).toBe('Refused');
      expect(yield* journal.inspect(seed.operation.operationId)).toEqual(Option.some(stored));
    }
    const program = Effect.gen(scenario);
    await Effect.runPromise(program);
  }
  test(
    `${kind} completion is action-specific, exact-bound and immutable once terminal`,
    actionSpecificCompletion,
  );
}

async function uncertainOutcomes() {
  function* scenario() {
    for (const kind of ['Create', 'Start'] as const) {
      const base = claimedSeed(kind);
      const seed = {
        ...base,
        intents: base.intents.map((intent) => ({
          ...intent,
          outcome: { _tag: 'Unknown' as const, reason: { _tag: 'UnresolvedIntent' as const } },
        })),
      };
      const journal = yield* makeMemoryWorkerJournal([seed]);
      const reply = replyFor(kind);
      const empty = { ...makeWorkerCase().observation, resources: [] };
      expect(
        (yield* journal.service.commit(
          outcomeEdit(seed, { ...reply, outcome: { _tag: 'Completed', observation: empty } }),
        ))._tag,
      ).toBe('Refused');
      expect(
        (yield* journal.service.commit(
          outcomeEdit(seed, {
            ...reply,
            outcome: { _tag: 'Failed', reason: { _tag: 'NotFound' } },
          }),
        ))._tag,
      ).toBe('Refused');
      const retry = { ...makeWorkerIntent(kind), intentId: WorkerIntentId.make('retry') };
      expect((yield* journal.service.commit(claimEdit(seed, retry)))._tag).toBe('Refused');
      expect((yield* journal.service.commit(outcomeEdit(seed, reply)))._tag).toBe('Committed');
    }
    const seed = claimedSeed();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const failedReply = {
      ...replyFor(),
      outcome: { _tag: 'Failed' as const, reason: { _tag: 'NotFound' as const } },
    };
    const failed = committed(yield* journal.service.commit(outcomeEdit(seed, failedReply)));
    const contradictory = replyFor();
    expect((yield* journal.service.commit(outcomeEdit(failed, contradictory)))._tag).toBe(
      'Refused',
    );
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'Unknown Create/Start cannot resolve from absence or be reissued; Failed cannot become Completed',
  uncertainOutcomes,
);

async function foreignEvidence() {
  function* scenario() {
    const seed = claimedSeed('Start');
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const c = makeWorkerCase();
    const reply = replyFor('Start');
    const invalidReplies = [
      { ...reply, issuerId: WorkerIssuerId.make('other') },
      { ...reply, intentId: WorkerIntentId.make('other') },
      { ...reply, operationId: WorkerOperationId.make('other') },
      { ...reply, hostId: WorkerHostId.make('other') },
      { ...reply, daemonId: WorkerDaemonId.make('other') },
      { ...reply, identity: { ...reply.identity, generation: 4 } },
      { ...reply, atMs: 949 },
      { ...reply, atMs: 1001 },
      {
        ...reply,
        outcome: { _tag: 'Completed' as const, observation: { ...c.observation, atMs: 949 } },
      },
      {
        ...reply,
        outcome: {
          _tag: 'Completed' as const,
          observation: {
            ...c.observation,
            resources: [
              { ...c.resource, configuration: { ...c.resource.configuration, network: 'wrong' } },
            ],
          },
        },
      },
    ];
    for (const invalid of invalidReplies) {
      expect((yield* journal.service.commit(outcomeEdit(seed, invalid, 999)))._tag).toBe('Refused');
      expect(yield* journal.inspect(seed.operation.operationId)).toEqual(Option.some(seed));
    }
    expect((yield* journal.service.commit({ ...cleanupEdit(seed), atMs: 899 }))._tag).toBe(
      'Refused',
    );
    for (const atMs of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        Result.isFailure(
          yield* Effect.result(journal.service.commit({ ...cleanupEdit(seed), atMs })),
        ),
      ).toBe(true);
    }
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'foreign subjects/issuers, invalid times, stale evidence and mismatched pinned values are inert',
  foreignEvidence,
);

async function lateIssuedOutcome() {
  function* scenario() {
    const seed = claimedSeed();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const cancelled = committed(
      yield* journal.service.commit({ ...cleanupEdit(seed), _tag: 'RequestCancellation' }),
    );
    const c = makeWorkerCase();
    const late = {
      ...replyFor(),
      atMs: 1002,
      outcome: { _tag: 'Completed' as const, observation: { ...c.observation, atMs: 1001 } },
    };
    const stored = committed(yield* journal.service.commit(outcomeEdit(cancelled, late)));
    expect(stored.operation.limits).toEqual({ deadlineMs: 1000, spentMicros: 17, repairs: 1 });
    expect(stored.authority.cancelledAtMs).toEqual(Option.some(1000));
    expect(
      (yield* journal.service.commit({
        _tag: 'AuthorizeExecution',
        operationId: seed.operation.operationId,
        expectedRevision: stored.revision,
        atMs: 1002,
      }))._tag,
    ).toBe('Refused');
    expect(
      (yield* journal.service.commit(
        claimEdit(stored, { ...makeWorkerIntent('Start'), claimedAtMs: 1002 }),
      ))._tag,
    ).toBe('Refused');
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'late issued outcomes remain recordable after cancellation and execution expiry without renewing authority',
  lateIssuedOutcome,
);

async function delayedPreCancellationEvidence() {
  function* scenario() {
    const seed = claimedSeed();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const cancelled = committed(
      yield* journal.service.commit({ ...cleanupEdit(seed), _tag: 'RequestCancellation' }),
    );
    const reply = { ...replyFor(), atMs: 1002 };
    const recorded = committed(yield* journal.service.commit(outcomeEdit(cancelled, reply)));
    expect(recorded.intents[0]?.outcome._tag).toBe('Completed');
    expect(recorded.executionAuthorizedAtMs).toEqual(Option.none());
    expect(recorded.authority.cancelledAtMs).toEqual(Option.some(1000));
    expect(recorded.operation.limits.deadlineMs).toBe(1000);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'late delivery may truthfully record matching observation made before cancellation',
  delayedPreCancellationEvidence,
);

async function oldOwnedCleanup() {
  function* scenario() {
    const c = makeWorkerCase();
    const base = makeWorkerSnapshot();
    const seed = {
      ...base,
      containerId: Option.some(c.containerId),
      authority: {
        identity: { ...c.operation.identity, generation: 4 },
        cancelledAtMs: Option.some(999),
      },
    };
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const pending = committed(yield* journal.service.commit(cleanupEdit(seed)));
    const stop = { ...makeWorkerIntent('Stop'), claimedAtMs: 1001 };
    for (const resource of [
      'replacement',
      c.operation.custody.retainedArtifacts[0]!,
      c.operation.custody.containerSlot,
    ]) {
      expect((yield* journal.service.commit(claimEdit(pending, { ...stop, resource })))._tag).toBe(
        'Refused',
      );
    }
    const claimed = committed(yield* journal.service.commit(claimEdit(pending, stop)));
    const stoppedReply = {
      ...replyFor('Stop'),
      atMs: 1002,
      outcome: {
        _tag: 'Completed' as const,
        observation: {
          ...c.observation,
          atMs: 1002,
          resources: [{ ...c.resource, running: false }],
        },
      },
    };
    const stopped = committed(yield* journal.service.commit(outcomeEdit(claimed, stoppedReply)));
    expect(
      (yield* journal.service.commit(
        claimEdit(stopped, { ...makeWorkerIntent('Remove'), claimedAtMs: 1100 }),
      ))._tag,
    ).toBe('Refused');
    expect(
      (yield* journal.service.commit(
        claimEdit(stopped, { ...makeWorkerIntent('Remove'), claimedAtMs: 1003 }),
      ))._tag,
    ).toBe('Committed');
    expect(stopped.operation).toEqual(c.operation);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'old authority can clean only its bound resource in the separately anchored window',
  oldOwnedCleanup,
);

async function cleanupEvidence() {
  function* scenario() {
    const c = makeWorkerCase();
    for (const kind of ['Create', 'Start', 'Stop', 'Remove'] as const) {
      const seed = claimedSeed(kind);
      const journal = yield* makeMemoryWorkerJournal([seed]);
      const pending = committed(yield* journal.service.commit(cleanupEdit(seed)));
      const edit: WorkerJournalEdit = {
        _tag: 'RecordCleanup',
        operationId: seed.operation.operationId,
        expectedRevision: pending.revision,
        atMs: 1001,
        observation: { ...c.observation, atMs: 1001, staging: 'Absent', resources: [] },
      };
      const stored = committed(yield* journal.service.commit(edit));
      const expected = Match.value(kind).pipe(
        Match.whenOr('Create', 'Start', () => 'CleanupUnknown' as const),
        Match.whenOr('Stop', 'Remove', () => 'CleanupConfirmed' as const),
        Match.exhaustive,
      );
      expect(Option.getOrThrow(stored.cleanup)._tag).toBe(expected);
      expect(stored.operation.custody.retainedArtifacts).toEqual([
        '/synthetic/evidence/worker-1.json',
      ]);
    }
    for (const staging of ['Unknown', 'Present'] as const) {
      const seed = makeWorkerSnapshot();
      const journal = yield* makeMemoryWorkerJournal([seed]);
      const pending = committed(yield* journal.service.commit(cleanupEdit(seed)));
      const stored = committed(
        yield* journal.service.commit({
          _tag: 'RecordCleanup',
          operationId: seed.operation.operationId,
          expectedRevision: pending.revision,
          atMs: 1001,
          observation: { ...c.observation, atMs: 1001, resources: [], staging },
        }),
      );
      expect(Option.getOrThrow(stored.cleanup)._tag).toBe('CleanupUnknown');
    }
    const seed = claimedSeed('Stop');
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const pending = committed(yield* journal.service.commit(cleanupEdit(seed)));
    expect(
      (yield* journal.service.commit(
        claimEdit(pending, { ...makeWorkerIntent('Remove'), claimedAtMs: 1001 }),
      ))._tag,
    ).toBe('Refused');
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'cleanup confirms full disposable absence only, never unresolved Create/Start or unknown/present staging',
  cleanupEvidence,
);

async function anchoredCleanupDeadline() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const pending = committed(yield* journal.service.commit(cleanupEdit(seed)));
    expect(Option.getOrThrow(pending.cleanup)).toEqual({
      _tag: 'CleanupPending',
      requestedAtMs: 1000,
      deadlineMs: 1100,
    });
    const repeated = committed(
      yield* journal.service.commit({ ...cleanupEdit(pending, 1020), _tag: 'RequestCancellation' }),
    );
    expect(Option.getOrThrow(repeated.cleanup).deadlineMs).toBe(1100);
    const recovered = yield* makeMemoryWorkerJournal([repeated]);
    const again = committed(
      yield* recovered.service.commit({
        ...cleanupEdit(repeated, 1030),
        _tag: 'RequestCancellation',
      }),
    );
    expect(again.authority.cancelledAtMs).toEqual(Option.some(1020));
    expect(Option.getOrThrow(again.cleanup).deadlineMs).toBe(1100);
    for (const cleanupWindowMs of [NaN, -1, Infinity, Number.MAX_SAFE_INTEGER]) {
      const result = yield* Effect.result(
        recovered.service.commit({ ...cleanupEdit(again, 1040), cleanupWindowMs }),
      );
      function wasRefused(value: WorkerJournalResult) {
        return Match.value(value).pipe(
          Match.tag('Refused', () => true),
          Match.orElse(() => false),
        );
      }
      const refused = Result.match(result, { onFailure: () => true, onSuccess: wasRefused });
      expect(refused).toBe(true);
      expect(yield* recovered.inspect(seed.operation.operationId)).toEqual(Option.some(again));
    }
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'cleanup checked addition and earliest deadlines survive repeated requests and reconstruction',
  anchoredCleanupDeadline,
);

async function detachedOptions() {
  const isSnapshot = Schema.is(WorkerJournalSnapshot);
  const decodeSnapshot = Schema.decodeUnknownResult(WorkerJournalSnapshot);
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const seededMount = seed.operation.configuration.mounts[0]!;
    Reflect.set(seededMount, 'source', '/corrupt');
    Reflect.set(seed.authority.identity, 'generation', 99);
    const stored = Option.getOrThrow(yield* journal.service.load(seed.operation.operationId));
    const storedMount = stored.operation.configuration.mounts[0];
    expect(storedMount?.source).toBe('/synthetic/ceirean/worker-1');
    expect(isSnapshot(stored)).toBe(true);
    const decodedStored = decodeSnapshot(stored);
    expect(Result.isSuccess(decodedStored)).toBe(true);
    expect(stored.authority.identity.generation).toBe(3);
    Reflect.set(stored.operation.limits, 'repairs', 99);
    const fresh = Option.getOrThrow(yield* journal.inspect(seed.operation.operationId));
    const claimed = committed(yield* journal.service.commit(claimEdit(fresh)));
    const reply = replyFor();
    const done = committed(yield* journal.service.commit(outcomeEdit(claimed, reply)));
    const decodedDone = decodeSnapshot(done);
    expect(Result.isSuccess(decodedDone)).toBe(true);
    Reflect.set(reply.outcome, '_tag', 'Failed');
    Reflect.set(done.intents[0]!, 'resource', 'corrupt');
    const loaded = Option.getOrThrow(yield* journal.inspect(seed.operation.operationId));
    expect(loaded.intents[0]?.resource).toBe('slot-1');
    const loadedIntent = loaded.intents[0];
    expect(loadedIntent?.outcome._tag).toBe('Completed');
    expect(Option.isOption(loaded.containerId)).toBe(true);
    const c = makeWorkerCase();
    const receipt = {
      ...c.operation,
      ...c.resource,
      hostId: c.operation.hostId,
      daemonId: c.operation.daemonId,
      observedAtMs: 999,
    };
    const allSome = {
      ...loaded,
      authority: { ...loaded.authority, cancelledAtMs: Option.some(999) },
      readiness: Option.some(receipt),
      executionAuthorizedAtMs: Option.some(999),
      cleanup: Option.some({
        _tag: 'CleanupUnknown' as const,
        requestedAtMs: 1000,
        deadlineMs: 1100,
        reason: { _tag: 'UnresolvedIntent' as const },
      }),
    };
    const recovered = yield* makeMemoryWorkerJournal([allSome]);
    Reflect.set(allSome.authority.cancelledAtMs, 'value', 1002);
    Reflect.set(allSome.executionAuthorizedAtMs, 'value', 1002);
    Reflect.set(allSome.containerId, 'value', 'replacement');
    const seededSecurity = receipt.configuration.security;
    Reflect.set(seededSecurity, 'user', 'root');
    const copy = Option.getOrThrow(yield* recovered.service.load(seed.operation.operationId));
    expect(isSnapshot(copy)).toBe(true);
    const decodedCopy = decodeSnapshot(copy);
    expect(Result.isSuccess(decodedCopy)).toBe(true);
    expect(copy.containerId).toEqual(Option.some(c.containerId));
    expect(copy.authority.cancelledAtMs).toEqual(Option.some(999));
    expect(copy.executionAuthorizedAtMs).toEqual(Option.some(999));
    const copyReceipt = Option.getOrThrow(copy.readiness);
    expect(copyReceipt.configuration.security.user).toBe('1000:1000');
    Reflect.set(copyReceipt.configuration.security, 'user', 'root');
    Reflect.set(Option.getOrThrow(copy.cleanup), 'deadlineMs', 9999);
    const inspected = Option.getOrThrow(yield* recovered.inspect(seed.operation.operationId));
    expect(isSnapshot(inspected)).toBe(true);
    const decodedInspected = decodeSnapshot(inspected);
    expect(Result.isSuccess(decodedInspected)).toBe(true);
    const inspectedReceipt = Option.getOrThrow(inspected.readiness);
    expect(inspectedReceipt.configuration.security.user).toBe('1000:1000');
    expect(Option.getOrThrow(inspected.cleanup).deadlineMs).toBe(1100);
    expect(inspected.operation.limits.repairs).toBe(1);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'Some/None wrappers stay schema-valid; seed/load/edit/commit/inspect/reconstruction detach every payload',
  detachedOptions,
);

async function singleExecutionAuthorization() {
  function* scenario() {
    const seed = {
      ...makeWorkerSnapshot(),
      containerId: Option.some(makeWorkerCase().containerId),
    };
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const c = makeWorkerCase();
    const receipt = {
      ...c.operation,
      ...c.resource,
      hostId: c.operation.hostId,
      daemonId: c.operation.daemonId,
      observedAtMs: 998,
    };
    const edit: WorkerJournalEdit = {
      _tag: 'RecordReadiness',
      operationId: seed.operation.operationId,
      expectedRevision: 7,
      atMs: 999,
      receipt,
    };
    expect(
      (yield* journal.service.commit({
        _tag: 'AuthorizeExecution',
        operationId: seed.operation.operationId,
        expectedRevision: 7,
        atMs: 999,
      }))._tag,
    ).toBe('Refused');
    expect(
      (yield* journal.service.commit({
        ...edit,
        receipt: { ...receipt, containerId: WorkerContainerId.make('other') },
      }))._tag,
    ).toBe('Refused');
    const ready = committed(yield* journal.service.commit(edit));
    expect(
      (yield* journal.service.commit({
        ...edit,
        expectedRevision: ready.revision,
        receipt: { ...receipt, observedAtMs: 997 },
      }))._tag,
    ).toBe('Refused');
    const authorized = committed(
      yield* journal.service.commit({
        _tag: 'AuthorizeExecution',
        operationId: seed.operation.operationId,
        expectedRevision: ready.revision,
        atMs: 999,
      }),
    );
    const recovered = yield* makeMemoryWorkerJournal([authorized]);
    expect(
      (yield* recovered.service.commit({
        _tag: 'AuthorizeExecution',
        operationId: seed.operation.operationId,
        expectedRevision: authorized.revision,
        atMs: 999,
      }))._tag,
    ).toBe('Refused');
    yield* recovered.replaceAuthority(
      seed.operation.operationId,
      { ...seed.operation.identity, generation: 4 },
      Option.none(),
    );
    const replaced = Option.getOrThrow(yield* recovered.inspect(seed.operation.operationId));
    expect(replaced.operation).toEqual(seed.operation);
    expect(
      (yield* recovered.service.commit({ ...edit, expectedRevision: replaced.revision }))._tag,
    ).toBe('Refused');
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'readiness and execution require current exact evidence and execution authorization is single-use',
  singleExecutionAuthorization,
);

async function cancellationBeforeClaim() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    function* delayedClaim() {
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release).pipe(Effect.timeout('2 seconds'));
      const current = Option.getOrThrow(yield* journal.service.load(seed.operation.operationId));
      return yield* journal.service.commit(claimEdit(current));
    }
    const claiming = Effect.gen(delayedClaim);
    const caller = yield* Effect.forkChild(claiming);
    yield* Deferred.await(entered).pipe(Effect.timeout('2 seconds'));
    const current = Option.getOrThrow(yield* journal.inspect(seed.operation.operationId));
    yield* journal.service.commit({ ...cleanupEdit(current, 960), _tag: 'RequestCancellation' });
    yield* Deferred.succeed(release, undefined);
    expect((yield* Fiber.join(caller))._tag).toBe('Refused');
    const stored = Option.getOrThrow(yield* journal.inspect(seed.operation.operationId));
    expect(Option.getOrThrow(stored.cleanup)._tag).toBe('CleanupPending');
    expect(stored.authority.cancelledAtMs).toEqual(Option.some(960));
    expect(stored.intents).toHaveLength(0);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program.pipe(Effect.scoped, Effect.timeout('2 seconds')));
}
test(
  'atomic cancellation before claim is visible to the claimant final read',
  cancellationBeforeClaim,
);

async function cancellationAfterClaim() {
  function* scenario() {
    const seed = makeWorkerSnapshot();
    const journal = yield* makeMemoryWorkerJournal([seed]);
    const claimed = committed(yield* journal.service.commit(claimEdit(seed)));
    const cancelled = committed(
      yield* journal.service.commit({ ...cleanupEdit(claimed, 960), _tag: 'RequestCancellation' }),
    );
    const readback = Option.getOrThrow(yield* journal.service.load(seed.operation.operationId));
    expect(readback.revision).toBe(9);
    expect(readback.authority.cancelledAtMs).toEqual(Option.some(960));
    expect(readback.intents[0]?.outcome).toEqual({ _tag: 'Claimed' });
    expect(Option.getOrThrow(readback.cleanup)._tag).toBe('CleanupPending');
    expect(readback).toEqual(cancelled);
  }
  const program = Effect.gen(scenario);
  await Effect.runPromise(program);
}
test(
  'cancellation after claim preserves unresolved intent and fences the final read',
  cancellationAfterClaim,
);
