import { Database } from 'bun:sqlite';

import {
  AdmissionDraft,
  AdmissionRecord,
  AuthorityRevision,
  AuthorityState,
  AuthorityObservation,
  IngressScopeId,
  commandKey,
  transportKey,
  decideAssessment,
  type AdmissionReason,
  type CommitReply,
  type VerifiedCommand,
} from '@ceirean/domain';
import { CommandInboxError, sameCommandFacts, type CommandInboxDriver } from '@ceirean/engine';
import { Cause, Effect, Exit, Match, Option, Result, Schema, Scope } from 'effect';

import {
  initialize,
  invalidData,
  readAuthority,
  readReceipt,
  readRecord,
  requireData,
  rowCounts,
  encodeAuthority,
  encodeRecord,
  encodeVerified,
  scopeMatches,
} from './sqlite-storage.ts';

export type SqliteFaultPoint =
  | 'BeforeRecord'
  | 'AfterDecision'
  | 'BeforeCommit'
  | 'AfterCommit'
  | 'Close';
interface SqliteInboxConfig {
  readonly file: string;
  readonly create: boolean;
  readonly ingressScopeId: string;
  readonly initialAuthority?: AuthorityState;
  readonly limits: {
    readonly decisions: number;
    readonly receipts: number;
    readonly authorityRevisions: number;
  };
  readonly nowMs: () => number;
  readonly fault?: (point: SqliteFaultPoint) => void;
}
const sameDecision = Schema.toEquivalence(AdmissionDraft.fields.decision);
const sameAuthority = Schema.toEquivalence(AuthorityState);
const installInput = Schema.Struct({
  expectedRevision: AuthorityRevision,
  nextState: AuthorityState,
});
const nativeError = Schema.Struct({ code: Schema.String });

function sanitized(
  error: unknown,
  operation: CommandInboxError['operation'],
  fallback: CommandInboxError['code'],
) {
  const native = Schema.decodeUnknownResult(nativeError)(error);
  const busy = Result.match(native, {
    onSuccess: ({ code }) => ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(code),
    onFailure: () => false,
  });
  const isKnown = Match.instanceOf(CommandInboxError);
  const code = Match.value(error).pipe(
    Match.when(isKnown, (known) => known.code),
    Match.when(
      () => busy,
      () => 'Busy' as const,
    ),
    Match.orElse(() => fallback),
  );
  return new CommandInboxError({ operation, code });
}
function unrecorded(reason: AdmissionReason): CommitReply {
  return { _tag: 'Unrecorded', decision: { _tag: 'Rejected', reason } };
}

function makeDriver(db: Database, config: SqliteInboxConfig) {
  function insertReceipt(draft: AdmissionDraft, record: AdmissionRecord) {
    db.query('INSERT INTO receipts(transport_key,decision_id,verified) VALUES (?,?,?)').run(
      transportKey(config.ingressScopeId, draft.verified.receipt.deliveryId),
      Number(record.decisionId),
      encodeVerified(draft.verified),
    );
  }
  function recordFresh(draft: AdmissionDraft): CommitReply {
    const { state, floor } = readAuthority(db, config.ingressScopeId);
    const now = config.nowMs();
    const current = decideAssessment({
      candidate: draft.verified.candidate,
      authority: state,
      nowMs: now,
    });
    const evaluated = decideAssessment({
      candidate: draft.verified.candidate,
      authority: state,
      nowMs: draft.evaluatedAtMs,
    });
    function matchesDraft(decision: ReturnType<typeof decideAssessment>) {
      return Match.value(decision).pipe(
        Match.tag('Ignored', () => false),
        Match.orElse((recordable) => sameDecision(recordable, draft.decision)),
      );
    }
    const matches = matchesDraft(current) && matchesDraft(evaluated);
    const counts = rowCounts(db);
    function insert(): CommitReply {
      // Allocation and all dependent writes share the same immediate transaction.
      const sequence = db
        .query<{ next: number }, []>('SELECT coalesce(max(id),0)+1 AS next FROM decisions')
        .get();
      const id = Option.getOrThrowWith(Option.fromNullishOr(sequence), invalidData).next;
      const record = AdmissionRecord.make({
        decisionId: String(id),
        commandKey: commandKey(draft.verified.candidate),
        candidate: draft.verified.candidate,
        decision: draft.decision,
        evaluatedAtMs: draft.evaluatedAtMs,
        committedAtMs: now,
        authorityRevision: state.revision,
      });
      db.query('INSERT INTO decisions(id,command_key,record) VALUES (?,?,?)').run(
        id,
        record.commandKey,
        encodeRecord(record),
      );
      config.fault?.('AfterDecision');
      insertReceipt(draft, record);
      db.query('UPDATE authority SET clock_floor=? WHERE scope=?').run(now, config.ingressScopeId);
      config.fault?.('BeforeCommit');
      return { _tag: 'Recorded', record };
    }
    const changed = Match.value(current).pipe(
      Match.tag('Rejected', 'Ignored', (decision): CommitReply => ({
        _tag: 'Unrecorded',
        decision,
      })),
      Match.orElse(() => unrecorded('AuthorityChanged')),
    );
    const invalidClock = [
      !Number.isSafeInteger(now),
      now < 0,
      now < floor,
      now < draft.evaluatedAtMs,
    ].some(Boolean);
    return Match.value(true).pipe(
      Match.when(
        () => state.revision !== draft.expectedAuthorityRevision,
        () => unrecorded('AuthorityChanged'),
      ),
      Match.when(
        () => invalidClock,
        () => unrecorded('InvalidClock'),
      ),
      Match.when(
        () => !matches,
        () => changed,
      ),
      Match.when(
        () =>
          counts.decisions >= config.limits.decisions || counts.receipts >= config.limits.receipts,
        () => unrecorded('CapacityExceeded'),
      ),
      Match.orElse(insert),
    );
  }
  function resolve(draft: AdmissionDraft): CommitReply {
    const deliveryKey = transportKey(config.ingressScopeId, draft.verified.receipt.deliveryId);
    const receipt = readReceipt(db, deliveryKey);
    const record = readRecord(db, commandKey(draft.verified.candidate));
    function duplicate(original: AdmissionRecord, knownReceipt: boolean): CommitReply {
      function reference(): CommitReply {
        const inserted = Match.value(knownReceipt).pipe(
          Match.when(false, () => insertReceipt(draft, original)),
          Match.orElse(() => undefined),
        );
        void inserted;
        config.fault?.('BeforeCommit');
        return { _tag: 'Duplicate', record: original };
      }
      return Match.value(true).pipe(
        Match.when(
          () => !sameCommandFacts(original.candidate, draft.verified.candidate),
          () => unrecorded('CommandConflict'),
        ),
        Match.when(
          () => !knownReceipt && rowCounts(db).receipts >= config.limits.receipts,
          () => unrecorded('CapacityExceeded'),
        ),
        Match.orElse(reference),
      );
    }
    function known(prior: { verified: VerifiedCommand; record: AdmissionRecord }): CommitReply {
      const conflict =
        prior.verified.receipt.rawBodyDigest !== draft.verified.receipt.rawBodyDigest ||
        prior.verified.receipt.eventName !== draft.verified.receipt.eventName ||
        !sameCommandFacts(prior.verified.candidate, draft.verified.candidate);
      return Match.value(conflict).pipe(
        Match.when(true, () => unrecorded('DeliveryConflict')),
        Match.orElse(() => duplicate(prior.record, true)),
      );
    }
    function command() {
      return Option.match(record, {
        onNone: () => recordFresh(draft),
        onSome: (original) => duplicate(original, false),
      });
    }
    return Option.match(receipt, { onNone: command, onSome: known });
  }
  function commit(input: AdmissionDraft) {
    function call() {
      const draft = Schema.decodeUnknownSync(AdmissionDraft)(structuredClone(input));
      requireData(draft.verified.candidate.ingressScopeId === config.ingressScopeId);
      function transaction() {
        config.fault?.('BeforeRecord');
        return resolve(draft);
      }
      const reply = db.transaction(transaction).immediate();
      config.fault?.('AfterCommit');
      return reply;
    }
    return Result.try({ try: call, catch: (error) => sanitized(error, 'commit', 'CommitFailed') });
  }
  function loadAuthority(scope: string) {
    function load() {
      requireData(scope === config.ingressScopeId);
      const { state } = readAuthority(db, scope);
      const atMs = config.nowMs();
      const decode = Schema.decodeUnknownSync(AuthorityObservation);
      return decode({ state, atMs });
    }
    return Result.try({ try: load, catch: (error) => sanitized(error, 'load', 'InvalidData') });
  }
  const driver: CommandInboxDriver = { commit, loadAuthority };
  return driver;
}

function authorityInstaller(db: Database, config: SqliteInboxConfig) {
  function installAuthority(input: unknown) {
    function transaction() {
      const { expectedRevision, nextState } = Schema.decodeUnknownSync(installInput)(
        structuredClone(input),
      );
      requireData(scopeMatches(nextState, config.ingressScopeId));
      const { state } = readAuthority(db, config.ingressScopeId);
      const used = db
        .query('SELECT revision FROM authority_revisions WHERE scope=? AND revision=?')
        .get(config.ingressScopeId, nextState.revision);
      const n = db
        .query<{ n: number }, [string]>(
          'SELECT count(*) AS n FROM authority_revisions WHERE scope=?',
        )
        .get(config.ingressScopeId);
      function install() {
        db.query('INSERT INTO authority_revisions(scope,revision) VALUES (?,?)').run(
          config.ingressScopeId,
          nextState.revision,
        );
        db.query('UPDATE authority SET revision=?,snapshot=? WHERE scope=?').run(
          nextState.revision,
          encodeAuthority(nextState),
          config.ingressScopeId,
        );
        return { _tag: 'Installed' as const };
      }
      return Match.value(true).pipe(
        Match.when(
          () => expectedRevision !== state.revision,
          () => ({ _tag: 'Refused' as const, reason: 'AuthorityChanged' as const }),
        ),
        Match.when(
          () => sameAuthority(state, nextState),
          () => ({ _tag: 'Unchanged' as const }),
        ),
        Match.when(
          () => used !== null,
          () => ({ _tag: 'Refused' as const, reason: 'RevisionReused' as const }),
        ),
        Match.when(
          () =>
            Option.getOrThrowWith(Option.fromNullishOr(n), invalidData).n >=
            config.limits.authorityRevisions,
          () => ({ _tag: 'Refused' as const, reason: 'CapacityExceeded' as const }),
        ),
        Match.orElse(install),
      );
    }
    function call() {
      return db.transaction(transaction).immediate();
    }
    return Result.try({ try: call, catch: (error) => sanitized(error, 'commit', 'InvalidData') });
  }
  return installAuthority;
}

export function makeSqliteInbox(input: SqliteInboxConfig) {
  function detachConstruction() {
    const limits = Object.freeze({
      decisions: input.limits.decisions,
      receipts: input.limits.receipts,
      authorityRevisions: input.limits.authorityRevisions,
    });
    return Object.freeze({
      file: input.file,
      create: input.create,
      ingressScopeId: input.ingressScopeId,
      initialAuthority: structuredClone(input.initialAuthority),
      limits,
      nowMs: input.nowMs,
      fault: input.fault,
    });
  }
  const construction = Result.try({
    try: detachConstruction,
    catch: (error) => sanitized(error, 'open', 'InvalidData'),
  });
  function open(config: SqliteInboxConfig) {
    const fileBacked = ![':memory:', ''].includes(config.file);
    requireData(fileBacked);
    IngressScopeId.make(config.ingressScopeId);
    for (const [key, maximum] of [
      ['decisions', 256],
      ['receipts', 1024],
      ['authorityRevisions', 256],
    ] as const) {
      requireData(
        Number.isSafeInteger(config.limits[key]) &&
          config.limits[key] > 0 &&
          config.limits[key] <= maximum,
      );
    }
    return new Database(config.file, { create: config.create, readwrite: true, strict: true });
  }
  function init(db: Database, config: SqliteInboxConfig) {
    initialize(db, config.ingressScopeId, config.initialAuthority);
    readAuthority(db, config.ingressScopeId);
  }
  function finishCleanup(outcomes: ReadonlyArray<Result.Result<unknown, CommandInboxError>>) {
    const errors = outcomes.filter(Result.isFailure).map((outcome) => outcome.failure);
    const result = Match.value(errors.length).pipe(
      Match.when(0, () => Result.succeed(undefined)),
      Match.when(1, () => Result.fail(errors[0])),
      Match.orElse(() => Result.fail(new AggregateError(errors, 'SQLite cleanup failed'))),
    );
    // Finalizers require never: only sanitized teardown failures become observable defects.
    Result.getOrThrow(result);
  }
  function attemptCleanup(action: () => unknown) {
    return Result.try({ try: action, catch: (error) => sanitized(error, 'close', 'CloseFailed') });
  }
  function* acquire() {
    const config = yield* Effect.fromResult(construction);
    const parent = yield* Effect.scope;
    const child = yield* Scope.fork(parent);
    const opening = Effect.try({
      try: () => open(config),
      catch: (error) => sanitized(error, 'open', 'OpenFailed'),
    });
    const owned = Effect.acquireRelease(opening, (db) =>
      Effect.sync(() => {
        const outcomes = [
          attemptCleanup(() => config.fault?.('Close')),
          attemptCleanup(() => db.close()),
        ];
        finishCleanup(outcomes);
      }),
    );
    function initializeOwned(db: Database) {
      const initialization = Effect.try({
        try: () => init(db, config),
        catch: (error) => sanitized(error, 'open', 'OpenFailed'),
      });
      return initialization;
    }
    function closeFailed(cause: Cause.Cause<CommandInboxError>) {
      const originalExit = Exit.failCause(cause);
      return Scope.close(child, originalExit);
    }
    const initialized = owned.pipe(
      Effect.tap(initializeOwned),
      Scope.provide(child),
      Effect.onError(closeFailed),
    );
    const db = yield* initialized;
    return { driver: makeDriver(db, config), installAuthority: authorityInstaller(db, config) };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
