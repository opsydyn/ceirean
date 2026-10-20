import { expect, test } from 'bun:test';

import {
  CandidateIdentity,
  WorkerObservation,
  WorkerReadyReceipt,
  WorkerIntentId,
  WorkerIssuerId,
  validateWorkerReadiness,
  validateWorkerCustody,
  type WorkerIntent,
  type WorkerCleanup,
} from '@leviathan/domain';
import { createEffectActor, join } from '@xstate/effect';
import { Arbitrary, Effect, Fiber, Match, Option, Queue, Ref, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { validateCheckResult } from '../../domain/tests/properties.ts';
import type { WorkerJournalSnapshot } from '../src/worker-contracts.ts';
import {
  WorkerJournalError,
  WorkerMechanismError,
  WorkerLifecycleRuntimeError,
} from '../src/worker-errors.ts';
import { workerLifecycleMachine } from '../src/worker-lifecycle.ts';
import { makeWorkerCase } from './worker-fixtures.ts';
import {
  PropertyFixture,
  closePropertyOwner,
  openPropertyOwner,
  propertyFixtureLayer,
  waitForPropertyEdit,
  type Evidence,
} from './worker-property-fixture.ts';

const actionSchema = Schema.Union([
  Schema.TaggedStruct('Acquire', {}),
  Schema.TaggedStruct('Execute', {}),
  Schema.TaggedStruct('Cancel', {}),
  Schema.TaggedStruct('Replace', {}),
  Schema.TaggedStruct('Advance', { ms: Schema.Literals([0, 1, 10, 50]) }),
  Schema.TaggedStruct('Readback', {
    mode: Schema.Literals([
      'Valid',
      'Absent',
      'NotRunning',
      'Foreign',
      'Replacement',
      'Retained',
      'Mismatch',
      'Malformed',
      'StagingPresent',
    ]),
  }),
  Schema.TaggedStruct('Outcome', {
    mode: Schema.Literals(['Completed', 'Failed', 'Unknown', 'Lost']),
  }),
  Schema.TaggedStruct('Reconcile', {}),
  Schema.TaggedStruct('Reconstruct', {}),
  Schema.TaggedStruct('Shutdown', {}),
]);
const purposeArbitrary = Arbitrary.schema(
  Schema.Literals(['Baseline', 'Candidate', 'Verification']),
);
const operationArbitrary = Arbitrary.map(purposeArbitrary, (purpose) => ({
  ...makeWorkerCase().operation,
  purpose,
}));
const scenarioArbitrary = Arbitrary.all({
  operation: operationArbitrary,
  bootstrap: Arbitrary.schema(Schema.Literals(['Completed', 'Unknown', 'FailedStart'])),
  actions: Arbitrary.array(Arbitrary.schema(actionSchema), { maxLength: 45 }),
});
type Scenario = typeof scenarioArbitrary extends Arbitrary.Arbitrary<infer A> ? A : never;
const constructiveActionSchema = Schema.Literals(['Acquire', 'Read', 'Advance']);
const constructiveAction = Arbitrary.schema(constructiveActionSchema);
const constructiveActions = Arbitrary.array(constructiveAction, { maxLength: 40 });
const constructiveArbitrary = Arbitrary.all({
  operation: operationArbitrary,
  actions: constructiveActions,
});
type Constructive = typeof constructiveArbitrary extends Arbitrary.Arbitrary<infer A> ? A : never;
const sameIdentity = Schema.toEquivalence(CandidateIdentity);
const sameReceipt = Schema.toEquivalence(WorkerReadyReceipt);
const c = makeWorkerCase();
type Owner = Effect.Success<ReturnType<typeof openPropertyOwner>>;
type Acquisition = Effect.Success<ReturnType<Owner['service']['acquire']>>;

function requireAcquisition(result: Acquisition) {
  const validation = Match.value(result).pipe(
    Match.tag('Accepted', () => Result.succeed(undefined)),
    Match.tag('Refused', ({ refusal }) => Result.fail(refusal)),
    Match.exhaustive,
  );
  const program = Effect.fromResult(validation);
  return program;
}

function unresolvedCreation(snapshot: WorkerJournalSnapshot) {
  function unresolved(intent: WorkerIntent) {
    const materializes = Match.value(intent.kind).pipe(
      Match.whenOr('Create', 'Start', () => true),
      Match.orElse(() => false),
    );
    const pending = Match.value(intent.outcome).pipe(
      Match.tag('Claimed', 'Unknown', () => true),
      Match.orElse(() => false),
    );
    return materializes && pending;
  }
  return snapshot.intents.some(unresolved);
}

function current(snapshot: WorkerJournalSnapshot) {
  return (
    sameIdentity(snapshot.operation.identity, snapshot.authority.identity) &&
    Option.isNone(snapshot.authority.cancelledAtMs)
  );
}

function isCommit(entry: Evidence): entry is Extract<Evidence, { readonly _tag: 'Commit' }> {
  return Match.value(entry).pipe(
    Match.tag('Commit', () => true),
    Match.orElse(() => false),
  );
}
function committed(entries: readonly Evidence[]) {
  return entries.filter(isCommit).filter((entry) =>
    Match.value(entry.result).pipe(
      Match.tag('Committed', () => true),
      Match.orElse(() => false),
    ),
  );
}
function mutations(entries: readonly Evidence[]) {
  return entries.flatMap((entry) =>
    Match.value(entry).pipe(
      Match.when({ _tag: 'Call', call: { kind: 'mutate' } }, (entry) => [entry]),
      Match.orElse(() => []),
    ),
  );
}
function executions(entries: readonly Evidence[]) {
  return entries.flatMap((entry) =>
    Match.value(entry).pipe(
      Match.when({ _tag: 'Call', call: { kind: 'execute' } }, (entry) => [entry]),
      Match.orElse(() => []),
    ),
  );
}

function priorClaimLaw(entries: readonly Evidence[]) {
  function hasPriorClaim(entry: ReturnType<typeof mutations>[number]) {
    const index = entries.indexOf(entry);
    const request = entry.call.request;
    const claims = committed(entries.slice(0, index)).filter((prior) =>
      Match.value(prior.edit).pipe(
        Match.tag(
          'Claim',
          ({ intent }) =>
            intent.intentId === request.intent.intentId &&
            intent.issuerId === request.intent.issuerId,
        ),
        Match.orElse(() => false),
      ),
    );
    function matchesClaim(intent: WorkerIntent) {
      const claimed = Match.value(intent.outcome).pipe(
        Match.tag('Claimed', () => true),
        Match.orElse(() => false),
      );
      return (
        intent.intentId === request.intent.intentId &&
        intent.issuerId === request.intent.issuerId &&
        claimed
      );
    }
    return claims.length === 1 && entry.before.intents.some(matchesClaim);
  }
  return mutations(entries).every(hasPriorClaim);
}

function uniqueActionLaw(entries: readonly Evidence[]) {
  const calls = mutations(entries).map((entry) => entry.call.request.intent);
  const claims = committed(entries).flatMap((entry) =>
    Match.value(entry.edit).pipe(
      Match.tag('Claim', ({ intent }) => [intent]),
      Match.orElse(() => []),
    ),
  );
  function unique(intents: readonly WorkerIntent[]) {
    const keys = intents.map((intent) => `${intent.operationId}:${intent.kind}:${intent.resource}`);
    return new Set(keys).size === keys.length;
  }
  return unique(calls) && unique(claims) && executions(entries).length <= 1;
}

function authorizationLaw(entries: readonly Evidence[]) {
  function mutationAuthorized({ before, call }: ReturnType<typeof mutations>[number]) {
    return Match.value(call.request.intent.kind).pipe(
      Match.whenOr('Create', 'Start', () => current(before) && Option.isNone(before.cleanup)),
      Match.orElse(() => true),
    );
  }
  return entries.every((entry) =>
    Match.value(entry).pipe(
      Match.when(
        { _tag: 'Commit', edit: { _tag: 'AuthorizeExecution' }, result: { _tag: 'Committed' } },
        ({ before }) => current(before) && Option.isNone(before.cleanup),
      ),
      Match.when(
        { _tag: 'Call', call: { kind: 'execute' } },
        ({ before, call }) =>
          current(before) &&
          Option.isNone(before.cleanup) &&
          Option.contains(before.executionAuthorizedAtMs, call.request.authorizedAtMs),
      ),
      Match.when({ _tag: 'Call', call: { kind: 'mutate' } }, mutationAuthorized),
      Match.orElse(() => true),
    ),
  );
}

const isPublicFailure = Schema.is(
  Schema.Union([
    Schema.instanceOf(WorkerJournalError),
    Schema.instanceOf(WorkerMechanismError),
    Schema.instanceOf(WorkerLifecycleRuntimeError),
  ]),
);
function publicFailureLaw(entries: readonly Evidence[]) {
  function sanitized({ error }: Extract<Evidence, { readonly _tag: 'PublicFailure' }>) {
    return isPublicFailure(error) && !('cause' in error);
  }
  return entries.every((entry) =>
    Match.value(entry).pipe(
      Match.tag('PublicFailure', sanitized),
      Match.orElse(() => true),
    ),
  );
}

function readinessLaw(entries: readonly Evidence[]) {
  function validReadiness(entry: Extract<Evidence, { readonly _tag: 'Commit' }>) {
    return Match.value(entry).pipe(
      Match.when(
        { edit: { _tag: 'RecordReadiness' }, result: { _tag: 'Committed' } },
        validateReceipt,
      ),
      Match.orElse(() => true),
    );
  }
  function validateReceipt(
    entry: Extract<Evidence, { readonly _tag: 'Commit' }> & {
      readonly edit: Extract<
        Extract<Evidence, { readonly _tag: 'Commit' }>['edit'],
        { readonly _tag: 'RecordReadiness' }
      >;
    },
  ) {
    const edit = entry.edit;
    const index = entries.indexOf(entry);
    const observation = entries.slice(0, index).findLast((prior) =>
      Match.value(prior).pipe(
        Match.tag('Readback', () => true),
        Match.orElse(() => false),
      ),
    );
    function validate(value: unknown) {
      const decoded = Schema.decodeUnknownResult(WorkerObservation)(value);
      const validated = decoded.pipe(
        Result.flatMap((value) =>
          validateWorkerReadiness(
            entry.before.operation,
            Option.getOrThrow(entry.before.containerId),
            value,
            entry.before.createdAtMs,
            edit.atMs,
          ),
        ),
      );
      return Result.match(validated, {
        onFailure: () => false,
        onSuccess: (receipt) => sameReceipt(receipt, edit.receipt),
      });
    }
    const matching = Match.value(observation).pipe(
      Match.when({ _tag: 'Readback' }, ({ value }) => validate(value)),
      Match.orElse(() => false),
    );
    return current(entry.before) && matching;
  }
  return committed(entries).every(validReadiness);
}

function cleanupLaw(entries: readonly Evidence[]) {
  function completeAbsence({
    observation,
  }: Extract<
    Extract<Evidence, { readonly _tag: 'Commit' }>['edit'],
    { readonly _tag: 'RecordCleanup' }
  >) {
    const stagingAbsent = Match.value(observation.staging).pipe(
      Match.when('Absent', () => true),
      Match.orElse(() => false),
    );
    return observation.resources.length === 0 && stagingAbsent;
  }
  function validCleanup(entry: Extract<Evidence, { readonly _tag: 'Commit' }>) {
    function validate(snapshot: WorkerJournalSnapshot) {
      const confirmed = Option.exists(snapshot.cleanup, isConfirmed);
      const absence = Match.value(entry.edit).pipe(
        Match.tag('RecordCleanup', completeAbsence),
        Match.orElse(() => true),
      );
      return !confirmed || (!unresolvedCreation(snapshot) && absence);
    }
    return Match.value(entry.result).pipe(
      Match.tag('Committed', ({ snapshot }) => validate(snapshot)),
      Match.orElse(() => true),
    );
  }
  return committed(entries).every(validCleanup);
}

function isConfirmed(cleanup: WorkerCleanup) {
  return Match.value(cleanup).pipe(
    Match.tag('CleanupConfirmed', () => true),
    Match.orElse(() => false),
  );
}

function custodyLaw(entries: readonly Evidence[]) {
  function cleanupReadback(entry: ReturnType<typeof mutations>[number]) {
    const index = entries.indexOf(entry);
    const latest = entries.slice(0, index).findLast((prior) =>
      Match.value(prior).pipe(
        Match.tag('Readback', () => true),
        Match.orElse(() => false),
      ),
    );
    function validate(value: unknown) {
      const decoded = Schema.decodeUnknownResult(WorkerObservation)(value);
      function checkObservation(observation: WorkerObservation) {
        return validateWorkerCustody(entry.before.operation, observation).pipe(
          Result.map(() =>
            observation.resources.some(
              (resource) => resource.containerId === entry.call.request.intent.resource,
            ),
          ),
        );
      }
      const owned = decoded.pipe(Result.flatMap(checkObservation));
      return Result.getOrElse(owned, () => false);
    }
    return Match.value(latest).pipe(
      Match.when({ _tag: 'Readback' }, ({ value }) => validate(value)),
      Match.orElse(() => false),
    );
  }
  function owned(entry: ReturnType<typeof mutations>[number]) {
    const { intent, operation } = entry.call.request;
    const resource = Match.value(intent.kind).pipe(
      Match.when('Create', () => operation.custody.containerSlot),
      Match.orElse(() => Option.getOrThrow(entry.before.containerId)),
    );
    const bound = Match.value(intent.kind).pipe(
      Match.when('Create', () => true),
      Match.orElse(() => intent.resource === c.containerId),
    );
    const observedCustody = Match.value(intent.kind).pipe(
      Match.whenOr('Stop', 'Remove', () => cleanupReadback(entry)),
      Match.orElse(() => true),
    );
    return [
      intent.resource === resource,
      !operation.custody.retainedArtifacts.includes(intent.resource),
      operation.operationId === c.operation.operationId,
      operation.hostId === c.operation.hostId,
      operation.daemonId === c.operation.daemonId,
      bound,
      observedCustody,
    ].every(Boolean);
  }
  return mutations(entries).every(owned);
}

function boundsLaw(entries: readonly Evidence[]) {
  let cleanupDeadline = Number.MAX_SAFE_INTEGER;
  function resultSnapshot({ result }: Extract<Evidence, { readonly _tag: 'Commit' }>) {
    return Match.value(result).pipe(
      Match.tag('Committed', ({ snapshot }) => Option.some(snapshot)),
      Match.orElse(() => Option.none()),
    );
  }
  function bounded(entry: Evidence) {
    const snapshot = Match.value(entry).pipe(
      Match.tag('Snapshot', ({ snapshot }) => Option.some(snapshot)),
      Match.tag('Commit', resultSnapshot),
      Match.orElse(() => Option.none()),
    );
    function noIncrease(value: WorkerJournalSnapshot) {
      const deadline = Option.getOrElse(
        Option.map(value.cleanup, (cleanup) => cleanup.deadlineMs),
        () => cleanupDeadline,
      );
      const okay = [
        deadline <= cleanupDeadline,
        value.operation.limits.deadlineMs === 1000,
        value.operation.limits.spentMicros === 17,
        value.operation.limits.repairs === 1,
        value.createdAtMs === 900,
      ].every(Boolean);
      cleanupDeadline = deadline;
      return okay;
    }
    return Option.match(snapshot, { onNone: () => true, onSome: noIncrease });
  }
  return entries.every(bounded);
}

function interpretScenario(input: Scenario) {
  function* interpret() {
    const fixture = yield* PropertyFixture;
    yield* TestClock.setTime(950);
    yield* fixture.startResponders;
    yield* Ref.set(fixture.outcome, input.bootstrap);
    let owner = yield* openPropertyOwner();
    yield* owner.service.acquire(input.operation).pipe(Effect.flatMap(requireAcquisition));
    function* waitForFailedStartup() {
      yield* waitForPropertyEdit('RecordOutcome');
      const isFailedStart = Match.value(input.bootstrap).pipe(
        Match.when('FailedStart', () => true),
        Match.orElse(() => false),
      );
      const failedStart = Effect.sync(() => isFailedStart);
      yield* waitForPropertyEdit('RecordOutcome').pipe(Effect.when(failedStart));
    }
    const failed = Effect.gen(waitForFailedStartup);
    yield* Match.value(input.bootstrap).pipe(
      Match.when('Completed', () => waitForPropertyEdit('RecordReadiness')),
      Match.orElse(() => failed),
    );
    yield* fixture.checkpoint();
    let drained = false;
    for (const action of input.actions) {
      const id = c.operation.operationId;
      const service = owner.service;
      const operation = Match.value(action).pipe(
        Match.tag('Acquire', () => service.acquire(input.operation)),
        Match.tag('Execute', () => service.requestExecution(id)),
        Match.tag('Cancel', () => service.cancel(id)),
        Match.tag('Replace', () =>
          fixture.journal.replaceAuthority(
            id,
            { ...c.operation.identity, generation: c.operation.identity.generation + 1 },
            Option.none(),
          ),
        ),
        Match.tag('Advance', ({ ms }) => TestClock.adjust(ms)),
        Match.tag('Readback', ({ mode }) => Ref.set(fixture.readback, mode)),
        Match.tag('Outcome', ({ mode }) => Ref.set(fixture.outcome, mode)),
        Match.tag('Reconcile', () => service.reconcile(id)),
        Match.tag('Reconstruct', () => Effect.void),
        Match.tag('Shutdown', () => Effect.void),
        Match.exhaustive,
      );
      yield* operation.pipe(Effect.tapError(fixture.recordFailure), Effect.result);
      function* rebuild() {
        yield* closePropertyOwner(owner);
        // Journal, external Ref, responders and complete audit remain case-owned.
        owner = yield* openPropertyOwner();
        drained = false;
        yield* owner.service.acquire(input.operation).pipe(Effect.flatMap(requireAcquisition));
      }
      function* shutdown() {
        yield* Queue.clear(fixture.committed);
        const draining = yield* owner.service
          .shutdown()
          .pipe(Effect.tapError(fixture.recordFailure), Effect.result, Effect.forkScoped);
        function* advanceDrain() {
          yield* waitForPropertyEdit('RequestCleanup');
          yield* TestClock.adjust(100);
        }
        const advance = Effect.gen(advanceDrain);
        const firstDrain = Effect.sync(() => !drained);
        yield* advance.pipe(Effect.when(firstDrain));
        yield* Fiber.join(draining);
        drained = true;
      }
      const rebuilding = Effect.gen(rebuild);
      const shuttingDown = Effect.gen(shutdown);
      const rebuilt = Match.value(action).pipe(
        Match.tag('Reconstruct', () => true),
        Match.orElse(() => false),
      );
      const shouldShutdown = Match.value(action).pipe(
        Match.tag('Shutdown', () => true),
        Match.orElse(() => false),
      );
      const rebuildSelected = Effect.sync(() => rebuilt);
      const shutdownSelected = Effect.sync(() => shouldShutdown);
      yield* rebuilding.pipe(Effect.when(rebuildSelected));
      yield* shuttingDown.pipe(Effect.when(shutdownSelected));
      yield* fixture.checkpoint(rebuilt);
      const observed = yield* owner.service
        .read(id)
        .pipe(Effect.tapError(fixture.recordFailure), Effect.result);
      function recordObserved(value: Result.Result.Success<typeof observed>) {
        return Match.value(value).pipe(
          Match.tag('Observed', ({ snapshot }) => fixture.recordSnapshot(snapshot, rebuilt)),
          Match.tag('Refused', () => fixture.checkpoint(rebuilt)),
          Match.exhaustive,
        );
      }
      yield* Result.match(observed, {
        onSuccess: recordObserved,
        onFailure: () => fixture.checkpoint(rebuilt),
      });
    }
    yield* closePropertyOwner(owner);
    yield* fixture.checkpoint();
    return yield* Ref.get(fixture.evidence);
  }
  const program = Effect.gen(interpret);
  return program;
}

function constructiveTrace(input: Constructive, target: 'Readiness' | 'Execution' | 'Release') {
  function* construct() {
    const fixture = yield* PropertyFixture;
    yield* TestClock.setTime(950);
    yield* fixture.startResponders;
    const owner = yield* openPropertyOwner();
    yield* owner.service.acquire(input.operation).pipe(Effect.flatMap(requireAcquisition));
    yield* waitForPropertyEdit('RecordReadiness');
    for (const action of input.actions) {
      yield* Match.value(action).pipe(
        Match.when('Acquire', () => owner.service.acquire(input.operation)),
        Match.when('Read', () => owner.service.read(c.operation.operationId)),
        Match.when('Advance', () => TestClock.adjust(1)),
        Match.exhaustive,
      );
    }
    const ready = yield* fixture.readSnapshot;
    function* executeAndRelease() {
      const authorized = yield* owner.service.requestExecution(c.operation.operationId);
      const accepted = Match.value(authorized).pipe(
        Match.tag('Observed', () => true),
        Match.orElse(() => false),
      );
      yield* waitForPropertyEdit('RequestCleanup');
      const shouldRelease = Match.value(target).pipe(
        Match.when('Release', () => true),
        Match.orElse(() => false),
      );
      const release = Effect.sync(() => shouldRelease);
      const drained = yield* owner.service.shutdown().pipe(Effect.result, Effect.when(release));
      const drainSucceeded = Option.match(drained, {
        onNone: () => true,
        onSome: Result.isSuccess,
      });
      const entries = yield* Ref.get(fixture.evidence);
      const final = yield* fixture.readSnapshot;
      const released = Match.value(target).pipe(
        Match.when('Release', () => Option.exists(final.cleanup, isConfirmed)),
        Match.orElse(() => true),
      );
      return (
        accepted &&
        drainSucceeded &&
        executions(entries).length === 1 &&
        authorizationLaw(entries) &&
        priorClaimLaw(entries) &&
        released
      );
    }
    const execute = Effect.gen(executeAndRelease);
    const readiness = Ref.get(fixture.evidence).pipe(Effect.map(readinessLaw));
    const valid = yield* Match.value(target).pipe(
      Match.when('Readiness', () => readiness),
      Match.orElse(() => execute),
    );
    return Option.isSome(ready.readiness) && valid;
  }
  const program = Effect.gen(construct);
  return program;
}

const safetyLaws = {
  'unique prior claim': priorClaimLaw,
  'one issuer and call per action': uniqueActionLaw,
  'cancellation replacement authorization': authorizationLaw,
  'full matching current readiness': readinessLaw,
  'complete absence without unresolved creation': cleanupLaw,
  'foreign replacement retained custody': custodyLaw,
  'reconstructed immutable limits and deadlines': boundsLaw,
};

for (const [name, law] of Object.entries(safetyLaws)) {
  for (const seed of [0, 1, 163]) {
    async function checkSeed() {
      function scenarioLaw(input: Scenario) {
        const program = interpretScenario(input).pipe(
          Effect.map((entries) => law(entries) && publicFailureLaw(entries)),
        );
        const scoped = Effect.scoped(program);
        const provided = Effect.provide(scoped, propertyFixtureLayer(input.operation));
        return provided;
      }
      const checking = Arbitrary.checkEffect(scenarioArbitrary, scenarioLaw, {
        seed,
        runs: 1000,
        size: 50,
        maxShrinks: 1000,
        maxDiscards: 10000,
      });
      function verifyResult(result: Arbitrary.CheckResult<unknown, unknown>) {
        const validation = validateCheckResult(name, seed, result, 1000);
        const program = Effect.fromResult(validation);
        return program;
      }
      const verified = checking.pipe(Effect.tap(verifyResult));
      const result = await Effect.runPromise(verified);
      expect(result).toMatchObject({ _tag: 'Passed', runs: 1000 });
    }
    test(`stateful ${name}; seed ${seed}`, checkSeed);
  }
}

for (const target of ['Readiness', 'Execution', 'Release'] as const) {
  for (const seed of [0, 1, 163]) {
    async function checkConstructiveSeed() {
      function constructiveLaw(input: Constructive) {
        const program = constructiveTrace(input, target);
        const scoped = Effect.scoped(program);
        const provided = Effect.provide(scoped, propertyFixtureLayer(input.operation));
        return provided;
      }
      const name = `constructive ${target}`;
      const checking = Arbitrary.checkEffect(constructiveArbitrary, constructiveLaw, {
        seed,
        runs: 1000,
        size: 50,
        maxShrinks: 1000,
        maxDiscards: 10000,
      });
      function verifyResult(result: Arbitrary.CheckResult<unknown, unknown>) {
        const validation = validateCheckResult(name, seed, result, 1000);
        const program = Effect.fromResult(validation);
        return program;
      }
      const verified = checking.pipe(Effect.tap(verifyResult));
      const result = await Effect.runPromise(verified);
      expect(result).toMatchObject({ _tag: 'Passed', runs: 1000 });
    }
    test(`constructive ${target}; seed ${seed}`, checkConstructiveSeed);
  }
}

async function rootMachineFailure() {
  function* scenario() {
    const fixture = yield* PropertyFixture;
    yield* TestClock.setTime(950);
    yield* Ref.set(fixture.rootFault, true);
    const owner = yield* openPropertyOwner();
    yield* owner.service.acquire(c.operation).pipe(Effect.result);
    yield* waitForPropertyEdit('Claim');
    const stored = yield* fixture.readSnapshot;
    expect(stored.intents).toHaveLength(1);
    expect(stored.intents[0]?.outcome._tag).toBe('Claimed');
    const expected = expect.objectContaining({
      _tag: 'WorkerLifecycleRuntimeError',
      operationId: c.operation.operationId,
      code: 'ActorFailed',
    });
    const read = yield* owner.service.read(c.operation.operationId).pipe(Effect.result);
    expect(Result.getFailure(read)).toEqual(Option.some(expected));
    const shutdown = yield* owner.service.shutdown().pipe(Effect.result);
    expect(Result.getFailure(shutdown)).toEqual(Option.some(expected));
    expect(yield* owner.service.shutdown().pipe(Effect.result)).toEqual(shutdown);
    expect(
      Result.getFailure(yield* owner.service.read(c.operation.operationId).pipe(Effect.result)),
    ).toEqual(Option.some(expected));
    expect(yield* Ref.get(fixture.fake.calls)).toEqual([]);
    const failure = Option.getOrThrow(Result.getFailure(read));
    expect('cause' in failure).toBe(false);
    expect(failure.message).not.toContain('getOrThrow');
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, propertyFixtureLayer());
  await Effect.runPromise(provided);
}
test(
  'root transition input failure is sanitized and retained, distinct from invoked taskError',
  rootMachineFailure,
);

async function actualRootFailureChannel() {
  function* scenario() {
    const fixture = yield* PropertyFixture;
    yield* TestClock.setTime(950);
    yield* Ref.set(fixture.rootFault, true);
    const input = { operationId: c.operation.operationId, issuerId: c.reply.issuerId };
    const actor = yield* createEffectActor(workerLifecycleMachine, { input });
    const result = yield* join(actor).pipe(Effect.result);
    expect(Result.isFailure(result)).toBe(true);
    expect(actor.getSnapshot().status).toBe('error');
    expect(actor.getSnapshot().context.taskError).toBeNull();
    expect(actor.getSnapshot().context.issue).toBeNull();
    expect(yield* Ref.get(fixture.fake.calls)).toEqual([]);
    expect((yield* fixture.readSnapshot).intents[0]?.outcome._tag).toBe('Claimed');
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, propertyFixtureLayer());
  await Effect.runPromise(provided);
}
test(
  'actual lifecycle root join fails with taskError null for missing mutation input',
  actualRootFailureChannel,
);

async function secondIssuerCannotReclaimStart() {
  function* scenario() {
    const fixture = yield* PropertyFixture;
    yield* TestClock.setTime(950);
    yield* fixture.startResponders;
    yield* Ref.set(fixture.outcome, 'FailedStart');
    const first = yield* openPropertyOwner();
    yield* first.service.acquire(c.operation);
    yield* waitForPropertyEdit('RecordOutcome');
    yield* waitForPropertyEdit('RecordOutcome');
    yield* closePropertyOwner(first);
    const second = yield* openPropertyOwner();
    yield* second.service.acquire(c.operation);
    const before = yield* fixture.readSnapshot;
    const selectedStart = before.intents.find((intent) =>
      Match.value(intent.kind).pipe(
        Match.when('Start', () => true),
        Match.orElse(() => false),
      ),
    );
    const start = Option.getOrThrow(Option.fromNullishOr(selectedStart));
    expect(start.outcome._tag).toBe('Failed');
    const result = yield* fixture.journalService.commit({
      _tag: 'Claim',
      operationId: c.operation.operationId,
      expectedRevision: before.revision,
      atMs: 950,
      intent: {
        ...start,
        intentId: WorkerIntentId.make('second-start'),
        issuerId: WorkerIssuerId.make('controller-2'),
        outcome: { _tag: 'Claimed' },
      },
    });
    expect(result).toEqual({
      _tag: 'Refused',
      refusal: { _tag: 'AlreadyClaimed', operationId: c.operation.operationId },
    });
    expect((yield* fixture.readSnapshot).intents).toHaveLength(2);
    expect(uniqueActionLaw(yield* Ref.get(fixture.evidence))).toBe(true);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, propertyFixtureLayer());
  await Effect.runPromise(provided);
}
test(
  'literal resolved Start cannot be claimed by a second issuer after service reconstruction',
  secondIssuerCannotReclaimStart,
);
