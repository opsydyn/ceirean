import { Database } from 'bun:sqlite';
import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import { AdmissionRecord, Digest, AdmissionDraft, type CommitReply } from '@leviathan/domain';
import { CommandInboxError, type CommandInboxDriver } from '@leviathan/engine';
import { Cause, Effect, Exit, Match, Option, Result, Schema } from 'effect';

import { authorityFixture, draftFixture } from '../src/fixture.ts';
import { makeSqliteInbox, type SqliteFaultPoint } from '../src/sqlite-inbox.ts';
import { cleanFiles, corruptFile, fileFixture } from './native-files.test.ts';

afterEach(cleanFiles);
afterEach(() => mock.restore());
function config(file = fileFixture()) {
  return {
    file,
    create: true,
    ingressScopeId: 'fixture-app',
    initialAuthority: authorityFixture().state,
    limits: { decisions: 256, receipts: 1024, authorityRevisions: 256 },
    nowMs: () => 1000,
  };
}
function counts(file: string) {
  const db = new Database(file, { readonly: true });
  const decisions = db.query<{ n: number }, []>('SELECT count(*) AS n FROM decisions').get()!.n;
  const receipts = db.query<{ n: number }, []>('SELECT count(*) AS n FROM receipts').get()!.n;
  const authority = db
    .query<{ revision: string; clock_floor: number }, []>(
      'SELECT revision, clock_floor FROM authority',
    )
    .get()!;
  db.close();
  return { decisions, receipts, ...authority };
}
function changed(draft: AdmissionDraft, id: number): AdmissionDraft {
  const decision = Match.value(draft.decision).pipe(
    Match.tag('AdmittedPreview', (value) => ({ ...value, commandKey: `[11,22,${id}]` })),
    Match.orElse((value) => value),
  );
  return {
    ...draft,
    verified: {
      ...draft.verified,
      receipt: { ...draft.verified.receipt, deliveryId: `delivery-${id}` },
      candidate: { ...draft.verified.candidate, commentId: id },
    },
    decision,
  };
}
function record(reply: CommitReply) {
  return Match.value(reply).pipe(
    Match.tag('Recorded', 'Duplicate', (value) => value.record),
    Match.orElse(() => {
      throw new CommandInboxError({ operation: 'commit', code: 'InvalidData' });
    }),
  );
}
function faultAt(point: SqliteFaultPoint) {
  const failure = Match.value(point).pipe(
    Match.when('Close', () => new CommandInboxError({ operation: 'close', code: 'CloseFailed' })),
    Match.orElse(() => new CommandInboxError({ operation: 'commit', code: 'CommitFailed' })),
  );
  function fault(at: SqliteFaultPoint) {
    const failed = Match.value(at).pipe(
      Match.when(point, () => {
        throw failure;
      }),
      Match.orElse(() => undefined),
    );
    void failed;
  }
  return fault;
}

function originalAndReopen() {
  const options = config();
  function* firstSession() {
    const { driver } = yield* makeSqliteInbox(options);
    const first = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(first._tag).toBe('Recorded');
    const original = structuredClone(record(first));
    Reflect.set(record(first).candidate, 'ownerLogin', 'mutated');
    const second = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(second).toEqual({ _tag: 'Duplicate', record: original });
    const valid = Schema.is(AdmissionRecord)(record(second));
    expect(valid).toBe(true);
    return original;
  }
  const first = Effect.gen(firstSession);
  const original = Effect.runSync(first.pipe(Effect.scoped));
  const reopenOptions = {
    ...options,
    create: false,
    initialAuthority: { _tag: 'Unavailable' as const, revision: 'do-not-reseed' },
  };
  function* secondSession() {
    const { driver } = yield* makeSqliteInbox(reopenOptions);
    const reply = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(reply).toEqual({ _tag: 'Duplicate', record: original });
    const authority = driver.loadAuthority('fixture-app').pipe(Result.getOrThrow);
    expect(authority.state.revision).toBe('authority-1');
  }
  const second = Effect.gen(secondSession);
  Effect.runSync(second.pipe(Effect.scoped));
  expect(counts(options.file)).toEqual({
    decisions: 1,
    receipts: 1,
    revision: 'authority-1',
    clock_floor: 1000,
  });
}
test(
  'record once; duplicate original survives reopen and returns detached schema-valid record',
  originalAndReopen,
  30000,
);

function deliveryConflicts() {
  const options = config();
  const draft = draftFixture();
  const conflict = changed(draft, 56);
  const sameDelivery = {
    ...conflict,
    verified: { ...conflict.verified, receipt: draft.verified.receipt },
  };
  const renamed = {
    ...draft,
    verified: {
      ...draft.verified,
      candidate: { ...draft.verified.candidate, ownerLogin: 'renamed' },
    },
  };
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    const first = driver.commit(draft).pipe(Result.getOrThrow);
    const conflictReply = driver.commit(sameDelivery).pipe(Result.getOrThrow);
    expect(conflictReply).toMatchObject({
      _tag: 'Unrecorded',
      decision: { reason: 'DeliveryConflict' },
    });
    const renameReply = driver.commit(renamed).pipe(Result.getOrThrow);
    expect(record(renameReply)).toEqual(record(first));
    expect(renameReply._tag).toBe('Duplicate');
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(counts(options.file).decisions).toBe(1);
}
test(
  'conflicting delivery cannot overwrite and names alone preserve historical original',
  deliveryConflicts,
  30000,
);

function revisionBarrier() {
  const options = config();
  const nextState = { _tag: 'Unavailable', revision: 'authority-2' };
  function* program() {
    const { driver, installAuthority } = yield* makeSqliteInbox(options);
    const installed = installAuthority({ expectedRevision: 'authority-1', nextState }).pipe(
      Result.getOrThrow,
    );
    expect(installed).toEqual({ _tag: 'Installed' });
    const unchanged = installAuthority({ expectedRevision: 'authority-2', nextState }).pipe(
      Result.getOrThrow,
    );
    expect(unchanged).toEqual({ _tag: 'Unchanged' });
    const reused = installAuthority({
      expectedRevision: 'authority-2',
      nextState: authorityFixture().state,
    }).pipe(Result.getOrThrow);
    expect(reused).toEqual({ _tag: 'Refused', reason: 'RevisionReused' });
    const reply = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(reply).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'AuthorityChanged' } });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(counts(options.file).decisions).toBe(0);
}
test(
  'stale authority cannot commit; used revisions cannot restore authority',
  revisionBarrier,
  30000,
);

function rollback(point: 'BeforeRecord' | 'AfterDecision' | 'BeforeCommit') {
  const options = config();
  const faultOptions = { ...options, fault: faultAt(point) };
  function* program() {
    const { driver } = yield* makeSqliteInbox(faultOptions);
    const commitExit = driver.commit(draftFixture());
    expect(commitExit._tag).toBe('Failure');
    expect(counts(options.file)).toEqual({
      decisions: 0,
      receipts: 0,
      revision: 'authority-1',
      clock_floor: 0,
    });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test.each(['BeforeRecord', 'AfterDecision', 'BeforeCommit'] as const)(
  'rollback at %s leaves no partial rows or floor updates',
  rollback,
  30000,
);

function twoHandles() {
  const options = config();
  let contender = Option.none<CommandInboxDriver>();
  let interleaved = Option.none<ReturnType<CommandInboxDriver['commit']>>();
  function attemptContender() {
    const driver = Option.getOrThrow(contender);
    const attempt = driver.commit(draftFixture());
    interleaved = Option.some(attempt);
  }
  function fault(point: SqliteFaultPoint) {
    const attempted = Match.value(point).pipe(
      Match.when('BeforeRecord', attemptContender),
      Match.orElse(() => undefined),
    );
    void attempted;
  }
  const firstOptions = { ...options, fault };
  function* program() {
    const first = yield* makeSqliteInbox(firstOptions);
    const second = yield* makeSqliteInbox(options);
    contender = Option.some(second.driver);
    const original = first.driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(original._tag).toBe('Recorded');
    const busy = Option.getOrThrow(interleaved);
    expect(busy).toMatchObject({ _tag: 'Failure', failure: { operation: 'commit', code: 'Busy' } });
    const retry = second.driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(retry._tag).toBe('Duplicate');
    expect(record(retry)).toEqual(record(original));
    expect(counts(options.file)).toMatchObject({ decisions: 1, receipts: 1 });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'two native connections contend inside a transaction; deliberate retry converges to the original',
  twoHandles,
  30000,
);

function responseLoss() {
  const options = config();
  const lossOptions = { ...options, fault: faultAt('AfterCommit') };
  function* loseReply() {
    const { driver } = yield* makeSqliteInbox(lossOptions);
    expect(driver.commit(draftFixture())._tag).toBe('Failure');
  }
  const loss = Effect.gen(loseReply);
  Effect.runSync(loss.pipe(Effect.scoped));
  expect(counts(options.file)).toMatchObject({ decisions: 1, receipts: 1, clock_floor: 1000 });
  function* recover() {
    const { driver } = yield* makeSqliteInbox(options);
    const reply = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(reply._tag).toBe('Duplicate');
    expect(record(reply).decisionId).toBe('1');
  }
  const recovery = Effect.gen(recover);
  Effect.runSync(recovery.pipe(Effect.scoped));
}
test('post-commit reply loss retains original across native reopen', responseLoss, 30000);

function capacities() {
  const options = config();
  const draft = draftFixture();
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    for (let id = 1; id <= 256; id++) {
      const reply = driver.commit(changed(draft, id)).pipe(Result.getOrThrow);
      expect(reply._tag).toBe('Recorded');
    }
    const refused = driver.commit(changed(draft, 257)).pipe(Result.getOrThrow);
    expect(refused).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'CapacityExceeded' } });
    for (let id = 257; id <= 1024; id++) {
      const input = {
        ...draft,
        verified: {
          ...draft.verified,
          candidate: changed(draft, 1).verified.candidate,
          receipt: { ...draft.verified.receipt, deliveryId: `delivery-${id}` },
        },
      };
      const reply = driver.commit(input).pipe(Result.getOrThrow);
      expect(reply._tag).toBe('Duplicate');
    }
    const duplicate = driver.commit(changed(draft, 1)).pipe(Result.getOrThrow);
    expect(duplicate._tag).toBe('Duplicate');
    const newReceipt = {
      ...draft,
      verified: {
        ...draft.verified,
        receipt: { ...draft.verified.receipt, deliveryId: 'overflow' },
      },
    };
    const overflow = driver.commit(newReceipt).pipe(Result.getOrThrow);
    expect(overflow).toMatchObject({
      _tag: 'Unrecorded',
      decision: { reason: 'CapacityExceeded' },
    });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(counts(options.file)).toMatchObject({ decisions: 256, receipts: 1024 });
}
test(
  'native 256 decision / 1024 receipt capacities preserve originals without eviction',
  capacities,
  30000,
);

function revisionCapacity() {
  const options = config();
  function* program() {
    const { installAuthority } = yield* makeSqliteInbox(options);
    for (let id = 2; id <= 256; id++) {
      const reply = installAuthority({
        expectedRevision: `authority-${id - 1}`,
        nextState: { _tag: 'Unavailable', revision: `authority-${id}` },
      }).pipe(Result.getOrThrow);
      expect(reply._tag).toBe('Installed');
    }
    const overflow = installAuthority({
      expectedRevision: 'authority-256',
      nextState: { _tag: 'Unavailable', revision: 'authority-257' },
    }).pipe(Result.getOrThrow);
    expect(overflow).toEqual({ _tag: 'Refused', reason: 'CapacityExceeded' });
    const idempotent = installAuthority({
      expectedRevision: 'authority-256',
      nextState: { _tag: 'Unavailable', revision: 'authority-256' },
    }).pipe(Result.getOrThrow);
    expect(idempotent).toEqual({ _tag: 'Unchanged' });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'revision history capacity never evicts and idempotency survives saturation',
  revisionCapacity,
  30000,
);

function timeBarriers() {
  const options = config();
  let now = 1000;
  const timed = { ...options, nowMs: () => now };
  function* program() {
    const { driver } = yield* makeSqliteInbox(timed);
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    now = 999;
    const fresh = changed(draftFixture(), 56);
    const rollback = driver.commit(fresh).pipe(Result.getOrThrow);
    expect(rollback).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'InvalidClock' } });
    now = 2000;
    const expired = driver.commit(fresh).pipe(Result.getOrThrow);
    expect(expired).toMatchObject({ _tag: 'Unrecorded', decision: { reason: 'AuthorityExpired' } });
    const historical = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(historical._tag).toBe('Duplicate');
    now = Number.NaN;
    expect(driver.commit(fresh).pipe(Result.getOrThrow)).toMatchObject({
      decision: { reason: 'InvalidClock' },
    });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(counts(options.file)).toMatchObject({ decisions: 1, receipts: 1, clock_floor: 1000 });
}
test(
  'persisted floor, rollback, nonfinite clock and exclusive expiry refuse fresh previews',
  timeBarriers,
  30000,
);

function noDefaultAuthority() {
  const options = config();
  const unavailable = { ...options, initialAuthority: undefined };
  function* program() {
    const { driver } = yield* makeSqliteInbox(unavailable);
    const observation = driver.loadAuthority('fixture-app').pipe(Result.getOrThrow);
    expect(observation.state).toEqual({ _tag: 'Unavailable', revision: 'unavailable-initial' });
    expect(driver.loadAuthority('other-app')).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'InvalidData' },
    });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'no initial fixture has unavailable authority and another scope cannot inherit it',
  noDefaultAuthority,
  30000,
);

function invalidDatabase() {
  const missing = config();
  const absent = makeSqliteInbox({ ...missing, create: false });
  const missingExit = Effect.runSyncExit(absent.pipe(Effect.scoped));
  expect(missingExit._tag).toBe('Failure');
  const corrupt = config();
  corruptFile(corrupt.file);
  const acquisition = makeSqliteInbox(corrupt);
  const corruptExit = Effect.runSyncExit(acquisition.pipe(Effect.scoped));
  expect(corruptExit._tag).toBe('Failure');
}
test('missing create:false and corrupt files are visible failures', invalidDatabase, 30000);

function readTampering() {
  const options = config();
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    expect(driver.commit(draftFixture()).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    const native = new Database(options.file);
    native.query('UPDATE decisions SET record=?').run('{"bad":"secret marker"}');
    native.close();
    const reply = driver.commit(draftFixture());
    expect(reply).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidData' } });
    const safe = Schema.encodeSync(Schema.Unknown)(reply);
    expect(String(safe)).not.toContain('secret marker');
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'invalid stored record schema refuses historical evidence without leaking stored text',
  readTampering,
  30000,
);

function pragmaAndConstraints() {
  const options = config();
  function* program() {
    yield* makeSqliteInbox(options);
    const native = new Database(options.file);
    expect(native.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    native.run('PRAGMA foreign_keys=ON');
    expect(() => native.query('INSERT INTO receipts VALUES (?,?,?)').run('x', 999, '{}')).toThrow();
    native.close();
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'native WAL is persistent and receipt foreign key constraints reject orphan rows',
  pragmaAndConstraints,
  30000,
);

function digestConflict() {
  const options = config();
  const draft = draftFixture();
  const changedDigest = {
    ...draft,
    verified: {
      ...draft.verified,
      receipt: { ...draft.verified.receipt, rawBodyDigest: Digest.make('b'.repeat(64)) },
    },
  };
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    expect(driver.commit(draft).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    const conflict = driver.commit(changedDigest).pipe(Result.getOrThrow);
    expect(conflict).toMatchObject({ decision: { reason: 'DeliveryConflict' } });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'different digest under identical delivery cannot replace original receipt',
  digestConflict,
  30000,
);

function cleanupCauses() {
  const evidence = nativeHandleObservation();
  const options = config();
  const brokenInit = {
    ...options,
    initialAuthority: { ...authorityFixture().state, ingressScopeId: 'wrong-scope' },
    fault: faultAt('Close'),
  };
  const acquisition = makeSqliteInbox(brokenInit);
  const exit = Effect.runSyncExit(acquisition.pipe(Effect.scoped));
  const reasons = Exit.match(exit, { onSuccess: () => [], onFailure: (cause) => cause.reasons });
  expect(reasons).toHaveLength(2);
  expect(reasons.filter(Cause.isFailReason)).toHaveLength(1);
  expect(reasons.filter(Cause.isDieReason)).toHaveLength(1);
  const errors = reasons.map((reason) =>
    Match.value(reason).pipe(
      Match.when(Cause.isFailReason, (value) => value.error),
      Match.when(Cause.isDieReason, (value) => value.defect),
      Match.orElse(() => undefined),
    ),
  );
  expect(errors).toContainEqual(new CommandInboxError({ operation: 'open', code: 'InvalidData' }));
  expect(errors).toContainEqual(new CommandInboxError({ operation: 'close', code: 'CloseFailed' }));
  expect(evidence.closed).toHaveLength(1);
  for (const db of new Set(evidence.observed)) expect(() => db.query('SELECT 1').get()).toThrow();
}
test('initialization plus close failure preserves both sanitized causes', cleanupCauses, 30000);

function nativeHandleObservation() {
  const observed: Database[] = [];
  const closed: Database[] = [];
  const pragmas: unknown[] = [];
  const nativeRun = Database.prototype.run;
  const nativeClose = Database.prototype.close;
  function observeClose(this: Database, ...args: Parameters<typeof nativeClose>) {
    closed.push(this);
    nativeClose.apply(this, args);
  }
  function observe(this: Database, ...args: Parameters<typeof nativeRun>) {
    const result = nativeRun.apply(this, args);
    observed.push(this);
    const captured = Match.value(args[0]).pipe(
      Match.when('PRAGMA busy_timeout = 0', () => {
        pragmas.push(
          this.query('PRAGMA journal_mode').get(),
          this.query('PRAGMA synchronous').get(),
          this.query('PRAGMA foreign_keys').get(),
          this.query('PRAGMA busy_timeout').get(),
        );
      }),
      Match.orElse(() => undefined),
    );
    void captured;
    return result;
  }
  spyOn(Database.prototype, 'run').mockImplementation(observe);
  spyOn(Database.prototype, 'close').mockImplementation(observeClose);
  return { observed, pragmas, closed };
}

function scopedHandles() {
  const evidence = nativeHandleObservation();
  const options = config();
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    expect(driver.loadAuthority('fixture-app')._tag).toBe('Success');
    expect(evidence.closed).toHaveLength(0);
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(evidence.pragmas).toEqual([
    { journal_mode: 'wal' },
    { synchronous: 2 },
    { foreign_keys: 1 },
    { timeout: 0 },
  ]);
  expect(evidence.observed.length).toBeGreaterThan(0);
  expect(evidence.closed).toHaveLength(1);
  for (const db of new Set(evidence.observed)) expect(() => db.query('SELECT 1').get()).toThrow();
}
test(
  'adapter handle has actual WAL/FULL/FK/zero-timeout values and caller scope closes it',
  scopedHandles,
  30000,
);

function immediateInitCleanup() {
  const evidence = nativeHandleObservation();
  const options = config();
  const broken = {
    ...options,
    initialAuthority: { ...authorityFixture().state, ingressScopeId: 'wrong-scope' },
  };
  function* program() {
    const result = yield* makeSqliteInbox(broken).pipe(Effect.result);
    expect(result._tag).toBe('Failure');
    expect(evidence.observed.length).toBeGreaterThan(0);
    expect(evidence.closed).toHaveLength(1);
    for (const db of new Set(evidence.observed)) expect(() => db.query('SELECT 1').get()).toThrow();
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(evidence.closed).toHaveLength(1);
}
test(
  'failed initialization closes its native handle before returning to an open caller scope',
  immediateInitCleanup,
  30000,
);

function closeFaultCloses() {
  const evidence = nativeHandleObservation();
  const options = { ...config(), fault: faultAt('Close') };
  const acquire = makeSqliteInbox(options);
  const exit = Effect.runSyncExit(acquire.pipe(Effect.scoped));
  expect(exit._tag).toBe('Failure');
  const reasons = Exit.match(exit, { onSuccess: () => [], onFailure: (cause) => cause.reasons });
  expect(reasons.filter(Cause.isFailReason)).toHaveLength(0);
  expect(reasons.filter(Cause.isDieReason)).toHaveLength(1);
  expect(evidence.closed).toHaveLength(1);
  for (const db of new Set(evidence.observed)) expect(() => db.query('SELECT 1').get()).toThrow();
}
test(
  'synthetic Close fault remains visible but actual native handle is closed',
  closeFaultCloses,
  30000,
);

function rejectedHistory() {
  const options = config();
  const revoked = { ...authorityFixture().state, access: 'Revoked' as const };
  const revokedOptions = { ...options, initialAuthority: revoked };
  const draft = {
    ...draftFixture(),
    decision: { _tag: 'Rejected' as const, reason: 'AccessRevoked' as const },
  };
  const restored = { ...authorityFixture().state, revision: 'authority-2' };
  function* program() {
    const { driver, installAuthority } = yield* makeSqliteInbox(revokedOptions);
    const rejection = driver.commit(draft).pipe(Result.getOrThrow);
    expect(rejection._tag).toBe('Recorded');
    const installed = installAuthority({
      expectedRevision: 'authority-1',
      nextState: restored,
    }).pipe(Result.getOrThrow);
    expect(installed._tag).toBe('Installed');
    const historical = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(record(historical).decision).toEqual({ _tag: 'Rejected', reason: 'AccessRevoked' });
    const next = changed(draftFixture(), 56);
    const fresh = {
      ...next,
      expectedAuthorityRevision: 'authority-2',
      decision: { ...next.decision, evidenceRevision: 'authority-2' },
    };
    expect(driver.commit(fresh).pipe(Result.getOrThrow)._tag).toBe('Recorded');
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'prior rejection stays historical after authority change while a new comment may admit',
  rejectedHistory,
  30000,
);

function staleInstalls() {
  const options = config();
  const sameRevisionChanged = { ...authorityFixture().state, access: 'Revoked' as const };
  function* program() {
    const { installAuthority } = yield* makeSqliteInbox(options);
    const conflict = installAuthority({
      expectedRevision: 'authority-1',
      nextState: sameRevisionChanged,
    }).pipe(Result.getOrThrow);
    expect(conflict).toEqual({ _tag: 'Refused', reason: 'RevisionReused' });
    const stale = installAuthority({
      expectedRevision: 'authority-0',
      nextState: { _tag: 'Unavailable', revision: 'authority-2' },
    }).pipe(Result.getOrThrow);
    expect(stale).toEqual({ _tag: 'Refused', reason: 'AuthorityChanged' });
    const wrongScope = installAuthority({
      expectedRevision: 'authority-1',
      nextState: {
        ...authorityFixture().state,
        ingressScopeId: 'other-app',
        revision: 'authority-2',
      },
    });
    expect(wrongScope).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidData' } });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(counts(options.file).revision).toBe('authority-1');
}
test(
  'stale expected install, changed same revision and cross-scope snapshot cannot replace authority',
  staleInstalls,
  30000,
);

function persistedFloorOnReopen() {
  const options = config();
  function* recordFirst() {
    const { driver } = yield* makeSqliteInbox(options);
    const reply = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(reply._tag).toBe('Recorded');
  }
  const first = Effect.gen(recordFirst);
  Effect.runSync(first.pipe(Effect.scoped));
  const older = { ...changed(draftFixture(), 56), evaluatedAtMs: 999 };
  const reopened = { ...options, nowMs: () => 999 };
  function* retry() {
    const { driver } = yield* makeSqliteInbox(reopened);
    const reply = driver.commit(older).pipe(Result.getOrThrow);
    expect(reply).toMatchObject({ decision: { reason: 'InvalidClock' } });
  }
  const second = Effect.gen(retry);
  Effect.runSync(second.pipe(Effect.scoped));
  expect(counts(options.file)).toMatchObject({ decisions: 1, receipts: 1, clock_floor: 1000 });
}
test(
  'native reopen preserves floor even when draft evaluation is also rolled back',
  persistedFloorOnReopen,
  30000,
);

function forgedDrafts() {
  const options = config();
  const draft = draftFixture();
  const forged = { ...draft, decision: { ...draft.decision, profileRevision: 'forged-profile' } };
  const wrongFacts = {
    ...draft,
    verified: { ...draft.verified, candidate: { ...draft.verified.candidate, operatorId: 67 } },
  };
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    const forgedReply = driver.commit(forged).pipe(Result.getOrThrow);
    expect(forgedReply).toMatchObject({ decision: { reason: 'AuthorityChanged' } });
    const deniedReply = driver.commit(wrongFacts).pipe(Result.getOrThrow);
    expect(deniedReply).toMatchObject({ decision: { reason: 'OperatorDenied' } });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(counts(options.file)).toMatchObject({ decisions: 0, receipts: 0, clock_floor: 0 });
}
test(
  'native current policy rejects forged preview and changed candidate without relabeling a fresh record',
  forgedDrafts,
  30000,
);

function missingRowNoReseed() {
  const options = config();
  const initial = makeSqliteInbox(options);
  Effect.runSync(initial.pipe(Effect.scoped));
  deleteAuthority(options.file);
  const reopen = makeSqliteInbox(options);
  const exit = Effect.runSyncExit(reopen.pipe(Effect.scoped));
  expect(exit._tag).toBe('Failure');
}
function deleteAuthority(file: string) {
  const native = new Database(file);
  native.run('DELETE FROM authority');
  native.close();
}
test(
  'reopening an existing database cannot reseed deleted authority from a new fixture',
  missingRowNoReseed,
  30000,
);

function receiptRelationalTampering() {
  const options = config();
  const draft = draftFixture();
  const corrupt = { ...draft.verified, candidate: { ...draft.verified.candidate, operatorId: 67 } };
  const encode = Schema.encodeSync(Schema.fromJsonString(AdmissionDraft.fields.verified));
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    expect(driver.commit(draft).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    const native = new Database(options.file);
    native.query('UPDATE receipts SET verified=?').run(encode(corrupt));
    native.close();
    const reply = driver.commit(draft);
    expect(reply).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidData' } });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'schema-valid receipt with inconsistent immutable facts cannot become historical evidence',
  receiptRelationalTampering,
  30000,
);

function externalBusyLock() {
  const options = config();
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    const native = new Database(options.file);
    native.run('BEGIN IMMEDIATE');
    const blocked = driver.commit(draftFixture());
    native.run('ROLLBACK');
    native.close();
    expect(blocked).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'Busy', operation: 'commit' },
    });
    expect(counts(options.file)).toMatchObject({ decisions: 0, receipts: 0, clock_floor: 0 });
    const retry = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(retry._tag).toBe('Recorded');
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'external native write lock is explicit Busy with no partial rows and no automatic retry',
  externalBusyLock,
  30000,
);

function normalizedStorageOnly() {
  const options = config();
  const draft = draftFixture();
  Reflect.set(draft, 'rawBody', 'synthetic-private-body-marker');
  Reflect.set(draft.verified.receipt, 'signature', 'synthetic-private-signature-marker');
  Reflect.set(draft.verified.candidate, 'commentBody', 'synthetic-private-comment-marker');
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    expect(driver.commit(draft).pipe(Result.getOrThrow)._tag).toBe('Recorded');
    Reflect.set(draft.verified.candidate, 'operatorId', 999);
    const native = new Database(options.file);
    const decision = native.query<{ record: string }, []>('SELECT record FROM decisions').get()!;
    const receipt = native.query<{ verified: string }, []>('SELECT verified FROM receipts').get()!;
    native.close();
    expect(decision.record).not.toContain('private-');
    expect(receipt.verified).not.toContain('private-');
    const original = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(record(original).candidate.operatorId).toBe(66);
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'persisted fields are normalized and detached from caller extras and later mutation',
  normalizedStorageOnly,
  30000,
);

function constructionLimitMutation() {
  const options = config();
  options.limits.decisions = 1;
  function* program() {
    const { driver } = yield* makeSqliteInbox(options);
    options.limits.decisions = 10000;
    const first = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(first._tag).toBe('Recorded');
    const next = changed(draftFixture(), 56);
    const overflow = driver.commit(next).pipe(Result.getOrThrow);
    expect(overflow).toMatchObject({ decision: { reason: 'CapacityExceeded' } });
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(counts(options.file)).toMatchObject({ decisions: 1, receipts: 1 });
}
test(
  'caller config mutation cannot raise the acquired decision capacity',
  constructionLimitMutation,
  30000,
);

function constructionScopeMutation() {
  const options = config();
  function* program() {
    const { driver, installAuthority } = yield* makeSqliteInbox(options);
    options.ingressScopeId = 'other-app';
    const observation = driver.loadAuthority('fixture-app').pipe(Result.getOrThrow);
    expect(observation.state.revision).toBe('authority-1');
    expect(driver.loadAuthority('other-app')).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'InvalidData' },
    });
    const installed = installAuthority({
      expectedRevision: 'authority-1',
      nextState: { _tag: 'Unavailable', revision: 'authority-2' },
    }).pipe(Result.getOrThrow);
    expect(installed._tag).toBe('Installed');
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
  expect(counts(options.file).revision).toBe('authority-2');
}
test(
  'caller config mutation cannot retarget the acquired authority scope',
  constructionScopeMutation,
  30000,
);

function constructionSnapshotTiming() {
  const options = config();
  const acquire = makeSqliteInbox(options);
  Reflect.set(options.initialAuthority, 'access', 'Revoked');
  Reflect.set(options, 'fault', faultAt('BeforeRecord'));
  options.nowMs = () => 2000;
  function* program() {
    const { driver } = yield* acquire;
    const reply = driver.commit(draftFixture()).pipe(Result.getOrThrow);
    expect(reply._tag).toBe('Recorded');
    expect(record(reply).committedAtMs).toBe(1000);
  }
  const effect = Effect.gen(program);
  Effect.runSync(effect.pipe(Effect.scoped));
}
test(
  'construction snapshots initial authority and callable identities before acquisition runs',
  constructionSnapshotTiming,
  30000,
);
