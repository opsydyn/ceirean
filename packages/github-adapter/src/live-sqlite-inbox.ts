import { Database } from 'bun:sqlite';

import {
  AdmissionDecision,
  AuthorityRevision,
  ClockReading,
  IngressScopeId,
  LiveAdmissionDraft,
  LiveAdmissionRecord,
  LocalIngressPolicy,
  VerifiedCommand,
  commandKey,
  decideLiveAdmission,
  transportKey,
  type AdmissionReason,
  type LiveAdmissionReply,
  type ReplayResolution,
} from '@leviathan/domain';
import { LiveInboxError, sameCommandFacts, type LiveInboxDriver } from '@leviathan/engine';
import { Cause, Effect, Exit, Match, Option, Predicate, Result, Schema, Scope } from 'effect';

import {
  applicationId,
  checkSchema,
  counts,
  eligibleProvenance,
  encodeEvidence,
  encodePolicy,
  encodeRecord,
  encodeVerified,
  found,
  ledgerTables,
  ownershipSchema,
  readPolicy,
  readReceipt,
  readRecord,
  requireData,
  sanitized,
  validateLedger,
} from './live-sqlite-storage.ts';
import { LocalStatePolicy, prepareLocalState } from './local-state.ts';

export type LiveSqliteFaultPoint =
  | 'AfterDecision'
  | 'AfterEvidence'
  | 'AfterReceipt'
  | 'BeforeCommit'
  | 'AfterCommit'
  | 'Close';
export interface LiveInboxConfig {
  readonly file: string;
  readonly ingressScopeId: string;
  readonly initialPolicy?: LocalIngressPolicy;
  readonly pathPolicy: LocalStatePolicy;
  readonly limits: {
    readonly decisions: number;
    readonly receipts: number;
    readonly authorityRevisions: number;
  };
  readonly clock: () => ClockReading;
  readonly testFault?: (point: LiveSqliteFaultPoint) => void;
}
function capacity(maximum: number) {
  return Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum }));
}
const configData = Schema.Struct({
  file: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  ingressScopeId: IngressScopeId,
  initialPolicy: Schema.optional(LocalIngressPolicy),
  pathPolicy: LocalStatePolicy,
  limits: Schema.Struct({
    decisions: capacity(256),
    receipts: capacity(1024),
    authorityRevisions: capacity(256),
  }),
});
function snapshot(input: LiveInboxConfig) {
  return Result.try({
    try: () => {
      const data = Schema.decodeUnknownSync(configData)(
        structuredClone({
          file: input.file,
          ingressScopeId: input.ingressScopeId,
          initialPolicy: input.initialPolicy,
          pathPolicy: input.pathPolicy,
          limits: input.limits,
        }),
      );
      requireData(Predicate.isFunction(input.clock));
      requireData(
        input.testFault === undefined || Schema.is(LocalStatePolicy.members[1])(data.pathPolicy),
      );
      return { ...data, clock: input.clock, testFault: input.testFault };
    },
    catch: (error) => sanitized(error, 'open', 'InvalidData'),
  });
}
type Config = Result.Result.Success<ReturnType<typeof snapshot>>;
type Paths = { readonly file: string; readonly guard: string; readonly identity: string };
function unrecorded(reason: AdmissionReason): LiveAdmissionReply {
  return { _tag: 'Unrecorded', decision: { _tag: 'Rejected', reason } };
}
function safeCall<A>(operation: LiveInboxError['operation'], action: () => A) {
  return Result.try({ try: action, catch: (error) => sanitized(error, operation, 'InvalidData') });
}
function finishCleanup(outcomes: ReadonlyArray<Result.Result<unknown, LiveInboxError>>) {
  const failures = outcomes.filter(Result.isFailure).map((outcome) => outcome.failure);
  const finished = Match.value(failures.length).pipe(
    Match.when(0, () => Result.succeed(undefined)),
    Match.when(1, () => Result.fail(failures[0])),
    Match.orElse(() => Result.fail(new AggregateError(failures, 'SQLite cleanup failed'))),
  );
  Result.getOrThrow(finished);
}
function ownedDatabase(file: string, readonly: boolean, config: Config) {
  const opening = Effect.try({
    try: () => new Database(file, { create: false, readonly, readwrite: !readonly, strict: true }),
    catch: (error) => sanitized(error, 'open', 'OpenFailed'),
  });
  const owned = Effect.acquireRelease(opening, (db) =>
    Effect.sync(() => {
      const outcomes = [
        safeCall('close', () => config.testFault?.('Close')),
        safeCall('close', () => db.close(true)),
      ];
      finishCleanup(outcomes);
    }),
  );
  return owned;
}
function connectionSettings(db: Database) {
  db.run('PRAGMA synchronous=FULL');
  db.run('PRAGMA foreign_keys=ON');
  db.run('PRAGMA busy_timeout=0');
}
function createSchema(db: Database, config: Config, identity: string) {
  const policy = found(config.initialPolicy);
  requireData(policy.ingressScopeId === config.ingressScopeId);
  db.run('PRAGMA journal_mode=WAL');
  connectionSettings(db);
  function create() {
    for (const sql of Object.values(ledgerTables)) db.run(sql);
    db.run(`PRAGMA application_id=${applicationId}`);
    db.run('PRAGMA user_version=1');
    db.query('INSERT INTO metadata VALUES(1,?,?)').run(config.ingressScopeId, identity);
    db.query('INSERT INTO policy_revisions VALUES(?,?)').run(policy.revision, encodePolicy(policy));
    const at = ClockReading.make(config.clock());
    db.query('INSERT INTO policy VALUES(1,?,?)').run(policy.revision, at.wallMs);
  }
  db.transaction(create).immediate();
}
function acquireNative(config: Config, paths: Paths, intent: 'Initialize' | 'Open' | 'Status') {
  const isInitialize = Schema.is(Schema.Literal('Initialize'));
  const isStatus = Schema.is(Schema.Literal('Status'));
  function* holdOwner() {
    const guard = yield* ownedDatabase(paths.guard, false, config);
    function seedOwnership() {
      guard.run('PRAGMA journal_mode=DELETE');
      connectionSettings(guard);
      function seed() {
        guard.run(ownershipSchema.ownership);
        guard.run(`PRAGMA application_id=${applicationId}`);
        guard.run('PRAGMA user_version=1');
        guard.query('INSERT INTO ownership VALUES(1,?)').run(paths.identity);
      }
      guard.transaction(seed).immediate();
    }
    const seeding = Effect.try({
      try: seedOwnership,
      catch: (error) => sanitized(error, 'open', 'OpenFailed'),
    });
    const initializing = Effect.succeed(isInitialize(intent));
    yield* seeding.pipe(Effect.when(initializing));
    function lockOwner() {
      guard.run('PRAGMA busy_timeout=0');
      const lock = Result.try(() => guard.run('BEGIN EXCLUSIVE'));
      function lockError(error: unknown) {
        const failure = sanitized(error, 'open', 'OpenFailed');
        return Match.value(failure.code).pipe(
          Match.when(
            'Busy',
            () => new LiveInboxError({ operation: 'open', code: 'OwnershipBusy' }),
          ),
          Match.orElse(() => failure),
        );
      }
      Result.getOrThrowWith(lock, lockError);
      checkSchema(guard, ownershipSchema);
      const rollbackMode = guard
        .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
        .get()?.journal_mode;
      const isRollback = Schema.is(Schema.Literal('delete'));
      requireData(isRollback(rollbackMode));
      const ownership = guard
        .query<{ identity: string }, []>('SELECT identity FROM ownership')
        .all();
      requireData(ownership.length === 1 && ownership[0]?.identity === paths.identity);
    }
    yield* Effect.try({ try: lockOwner, catch: (error) => sanitized(error, 'open', 'OpenFailed') });
  }
  function readValidation() {
    function* validate() {
      const db = yield* ownedDatabase(paths.file, true, config);
      return yield* Effect.try({
        try: () => validateLedger(db, config.ingressScopeId, paths.identity),
        catch: (error) => sanitized(error, 'open', 'InvalidData'),
      });
    }
    const validation = Effect.gen(validate);
    return validation.pipe(Effect.scoped);
  }
  function* acquire() {
    const ownership = Effect.gen(holdOwner);
    const needsOwner = Effect.sync(() => !isStatus(intent));
    const existing = Effect.sync(() => !isInitialize(intent));
    yield* ownership.pipe(Effect.when(needsOwner));
    yield* readValidation().pipe(Effect.when(existing));
    const db = yield* ownedDatabase(paths.file, isStatus(intent), config);
    function initializeOrOpen() {
      const action = Match.value(intent).pipe(
        Match.when('Initialize', () => () => createSchema(db, config, paths.identity)),
        Match.when('Open', () => () => connectionSettings(db)),
        Match.when('Status', () => () => db.run('PRAGMA busy_timeout=0')),
        Match.exhaustive,
      );
      action();
      validateLedger(db, config.ingressScopeId, paths.identity);
    }
    yield* Effect.try({
      try: initializeOrOpen,
      catch: (error) => sanitized(error, 'open', 'InvalidData'),
    });
    return db;
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}

function makeDriver(db: Database, config: Config) {
  function verifiedInput(input: VerifiedCommand) {
    const verified = Schema.decodeUnknownSync(VerifiedCommand)(structuredClone(input));
    requireData(verified.candidate.ingressScopeId === config.ingressScopeId);
    return verified;
  }
  function insertReceipt(verified: VerifiedCommand, record: LiveAdmissionRecord) {
    db.query('INSERT INTO receipts VALUES(?,?,?)').run(
      transportKey(verified.receipt.ingressScopeId, verified.receipt.deliveryId),
      Number(record.decisionId),
      encodeVerified(verified),
    );
    config.testFault?.('AfterReceipt');
  }
  function resolve(verified: VerifiedCommand): ReplayResolution {
    const receipt = readReceipt(
      db,
      transportKey(verified.receipt.ingressScopeId, verified.receipt.deliveryId),
    );
    const record = readRecord(db, commandKey(verified.candidate));
    function duplicate(original: LiveAdmissionRecord, known: boolean): ReplayResolution {
      function reference(): ReplayResolution {
        const receipt = Option.liftPredicate(verified, () => !known);
        Option.map(receipt, (value) => insertReceipt(value, original));
        return { _tag: 'Duplicate', record: original };
      }
      return Match.value(true).pipe(
        Match.when(
          () => !sameCommandFacts(original.candidate, verified.candidate),
          () => ({ _tag: 'Conflict' as const, reason: 'CommandConflict' as const }),
        ),
        Match.when(
          () => !known && counts(db).receipts >= config.limits.receipts,
          () => ({ _tag: 'CapacityExceeded' as const }),
        ),
        Match.orElse(reference),
      );
    }
    function absent(): ReplayResolution {
      const totals = counts(db);
      return Match.value(
        totals.decisions >= config.limits.decisions || totals.receipts >= config.limits.receipts,
      ).pipe(
        Match.when(true, () => ({ _tag: 'CapacityExceeded' as const })),
        Match.orElse(() => ({ _tag: 'Absent' as const })),
      );
    }
    function known(prior: { verified: VerifiedCommand; record: LiveAdmissionRecord }) {
      const conflict =
        prior.verified.receipt.rawBodyDigest !== verified.receipt.rawBodyDigest ||
        !sameCommandFacts(prior.verified.candidate, verified.candidate);
      return Match.value(conflict).pipe(
        Match.when(true, () => ({
          _tag: 'Conflict' as const,
          reason: 'DeliveryConflict' as const,
        })),
        Match.orElse(() => duplicate(prior.record, true)),
      );
    }
    function command() {
      return Option.match(record, {
        onSome: (original) => duplicate(original, false),
        onNone: absent,
      });
    }
    return Option.match(receipt, { onSome: known, onNone: command });
  }
  function validateFresh(
    draft: LiveAdmissionDraft,
    policy: LocalIngressPolicy,
    floor: number,
    accepted: (now: ClockReading) => LiveAdmissionReply,
  ): LiveAdmissionReply {
    const at = Schema.decodeUnknownResult(ClockReading)(config.clock());
    function evaluate(now: ClockReading): LiveAdmissionReply {
      const evidence = Match.value(draft).pipe(
        Match.when({ provenance: { _tag: 'LiveChecked' } }, (live) =>
          Option.some({
            evidence: live.provenance.evidence,
            startedMonotonicMs: live.startedMonotonicMs,
          }),
        ),
        Match.orElse(() => Option.none()),
      );
      const decision = decideLiveAdmission({ verified: draft.verified, policy, evidence, now });
      function changed(): LiveAdmissionReply {
        return Match.value(decision).pipe(
          Match.tag('Rejected', (refusal) => ({ _tag: 'Unrecorded' as const, decision: refusal })),
          Match.orElse(() => unrecorded('AuthorityChanged')),
        );
      }
      const invalidClock = [
        now.wallMs < floor,
        now.wallMs < draft.evaluatedAtMs,
        now.monotonicMs < draft.evaluatedMonotonicMs,
      ].some(Boolean);
      const sameDecision = Schema.toEquivalence(AdmissionDecision);
      const boundProvenance = eligibleProvenance(draft.verified, policy, draft.provenance, now);
      return Match.value(true).pipe(
        Match.when(
          () => policy.revision !== draft.expectedLocalRevision,
          () => unrecorded('AuthorityChanged'),
        ),
        Match.when(
          () => invalidClock,
          () => unrecorded('InvalidClock'),
        ),
        Match.when(
          () => !boundProvenance,
          () => unrecorded('AuthorityChanged'),
        ),
        Match.when(() => !sameDecision(decision, draft.decision), changed),
        Match.orElse(() => accepted(now)),
      );
    }
    return Result.match(at, { onSuccess: evaluate, onFailure: () => unrecorded('InvalidClock') });
  }
  function recordFresh(draft: LiveAdmissionDraft): LiveAdmissionReply {
    const { policy, floor } = readPolicy(db, config.ingressScopeId);
    function insert(now: ClockReading): LiveAdmissionReply {
      const next = found(
        db.query<{ id: number }, []>('SELECT coalesce(max(id),0)+1 AS id FROM decisions').get(),
      ).id;
      const record = Schema.decodeUnknownSync(LiveAdmissionRecord)({
        decisionId: String(next),
        commandKey: commandKey(draft.verified.candidate),
        candidate: draft.verified.candidate,
        localPolicyRevision: policy.revision,
        provenance: draft.provenance,
        decision: draft.decision,
        evaluatedAtMs: draft.evaluatedAtMs,
        committedAtMs: now.wallMs,
      });
      db.query('INSERT INTO decisions VALUES(?,?,?)').run(
        next,
        record.commandKey,
        encodeRecord(record),
      );
      config.testFault?.('AfterDecision');
      const liveEvidence = Match.value(draft.provenance).pipe(
        Match.tag('LiveChecked', (live) => Option.some(live.evidence)),
        Match.orElse(() => Option.none()),
      );
      Option.map(liveEvidence, (e) =>
        db.query('INSERT INTO evidence VALUES(?,?,?)').run(e.evidenceId, next, encodeEvidence(e)),
      );
      config.testFault?.('AfterEvidence');
      insertReceipt(draft.verified, record);
      db.query('UPDATE policy SET clock_floor=? WHERE id=1').run(now.wallMs);
      return { _tag: 'Recorded', record };
    }
    return validateFresh(draft, policy, floor, insert);
  }
  function resolveReplay(input: VerifiedCommand) {
    function replay() {
      const verified = verifiedInput(input);
      return db.transaction(() => resolve(verified)).immediate();
    }
    return safeCall('replay', replay);
  }
  function finalizeFresh(
    draft: LiveAdmissionDraft,
    record: LiveAdmissionRecord,
  ): LiveAdmissionReply {
    const { policy } = readPolicy(db, config.ingressScopeId);
    function finish(now: ClockReading): LiveAdmissionReply {
      const finalized = Schema.decodeUnknownSync(LiveAdmissionRecord)({
        ...record,
        committedAtMs: now.wallMs,
      });
      db.query('UPDATE decisions SET record=? WHERE id=?').run(
        encodeRecord(finalized),
        Number(record.decisionId),
      );
      db.query('UPDATE policy SET clock_floor=? WHERE id=1').run(now.wallMs);
      return { _tag: 'Recorded', record: finalized };
    }
    return validateFresh(draft, policy, record.committedAtMs, finish);
  }
  function commit(input: LiveAdmissionDraft) {
    function call() {
      const draft = Schema.decodeUnknownSync(LiveAdmissionDraft)(structuredClone(input));
      verifiedInput(draft.verified);
      function transaction() {
        db.run('SAVEPOINT admission_write');
        const resolution = resolve(draft.verified);
        const reply = Match.value(resolution).pipe(
          Match.tag('Absent', () => recordFresh(draft)),
          Match.tag('Duplicate', (duplicate) => duplicate),
          Match.tag('Conflict', ({ reason }) => unrecorded(reason)),
          Match.tag('CapacityExceeded', () => unrecorded('CapacityExceeded')),
          Match.exhaustive,
        );
        config.testFault?.('BeforeCommit');
        const final = Match.value(reply).pipe(
          Match.tag('Recorded', ({ record }) => finalizeFresh(draft, record)),
          Match.orElse((unchanged) => unchanged),
        );
        const refusal = Match.value(final).pipe(
          Match.tag('Unrecorded', (value) => Option.some(value)),
          Match.orElse(() => Option.none()),
        );
        Option.map(refusal, () => db.run('ROLLBACK TO admission_write'));
        db.run('RELEASE admission_write');
        return final;
      }
      const reply = db.transaction(transaction).immediate();
      config.testFault?.('AfterCommit');
      return reply;
    }
    return safeCall('commit', call);
  }
  function loadPolicy(scope: string) {
    function load() {
      requireData(scope === config.ingressScopeId);
      const { policy, floor } = readPolicy(db, scope);
      const at = ClockReading.make(config.clock());
      requireData(at.wallMs >= floor);
      return { policy, at };
    }
    return safeCall('load', load);
  }
  const driver: LiveInboxDriver = { loadPolicy, resolveReplay, commit };
  return driver;
}
const updateInput = Schema.Struct({
  expectedRevision: AuthorityRevision,
  next: LocalIngressPolicy,
});
function policyUpdater(db: Database, config: Config) {
  function updatePolicy(input: unknown) {
    function call() {
      const update = Schema.decodeUnknownSync(updateInput)(structuredClone(input));
      function transaction() {
        requireData(update.next.ingressScopeId === config.ingressScopeId);
        const { policy, floor } = readPolicy(db, config.ingressScopeId);
        const now = ClockReading.make(config.clock());
        requireData(now.wallMs >= floor);
        function install() {
          db.query('INSERT INTO policy_revisions VALUES(?,?)').run(
            update.next.revision,
            encodePolicy(update.next),
          );
          db.query('UPDATE policy SET revision=?,clock_floor=? WHERE id=1').run(
            update.next.revision,
            now.wallMs,
          );
          return { _tag: 'Installed' as const };
        }
        return Match.value(true).pipe(
          Match.when(
            () => policy.revision !== update.expectedRevision,
            () => ({ _tag: 'Refused' as const, reason: 'AuthorityChanged' as const }),
          ),
          Match.when(
            () =>
              db
                .query('SELECT revision FROM policy_revisions WHERE revision=?')
                .get(update.next.revision) !== null,
            () => ({ _tag: 'Refused' as const, reason: 'RevisionReused' as const }),
          ),
          Match.when(
            () => counts(db).authorityRevisions >= config.limits.authorityRevisions,
            () => ({ _tag: 'Refused' as const, reason: 'CapacityExceeded' as const }),
          ),
          Match.orElse(install),
        );
      }
      return db.transaction(transaction).immediate();
    }
    return safeCall('configure', call);
  }
  return updatePolicy;
}

export function openLiveInbox(input: LiveInboxConfig) {
  const construction = snapshot(input);
  function* open() {
    const config = yield* Effect.fromResult(construction);
    const paths = yield* prepareLocalState(config.pathPolicy, config.file, 'Open');
    const parent = yield* Effect.scope;
    const child = yield* Scope.fork(parent);
    function closeFailed(cause: Cause.Cause<LiveInboxError>) {
      return Scope.close(child, Exit.failCause(cause));
    }
    const acquisition = acquireNative(config, paths, 'Open');
    const db = yield* acquisition.pipe(Scope.provide(child), Effect.onError(closeFailed));
    return { driver: makeDriver(db, config), updatePolicy: policyUpdater(db, config) };
  }
  const opening = Effect.gen(open);
  return opening;
}
export function initializeLiveInbox(input: LiveInboxConfig) {
  const construction = snapshot(input);
  function* initialize() {
    const config = yield* Effect.fromResult(construction);
    yield* Effect.try({
      try: () => {
        const policy = found(config.initialPolicy);
        requireData(policy.ingressScopeId === config.ingressScopeId);
        ClockReading.make(config.clock());
      },
      catch: (error) => sanitized(error, 'open', 'InvalidData'),
    });
    const paths = yield* prepareLocalState(config.pathPolicy, config.file, 'Initialize');
    yield* acquireNative(config, paths, 'Initialize');
  }
  const initialization = Effect.gen(initialize);
  return initialization.pipe(Effect.scoped);
}
export function readLiveInboxStatus(input: LiveInboxConfig) {
  const construction = snapshot(input);
  function* read() {
    const config = yield* Effect.fromResult(construction);
    const paths = yield* prepareLocalState(config.pathPolicy, config.file, 'Open');
    const db = yield* acquireNative(config, paths, 'Status');
    return yield* Effect.try({
      try: () => validateLedger(db, config.ingressScopeId, paths.identity),
      catch: (error) => sanitized(error, 'load', 'InvalidData'),
    });
  }
  const reading = Effect.gen(read);
  return reading.pipe(Effect.scoped);
}
