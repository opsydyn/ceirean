import type { Database } from 'bun:sqlite';

import {
  AdmissionDecision,
  AuthorityRevision,
  ClockReading,
  CommandKey,
  DecisionId,
  DecisionProvenance,
  GitHubId,
  LiveAdmissionRecord,
  LivePermissionEvidence,
  LocalIngressPolicy,
  VerifiedCommand,
  commandKey,
  decideLiveAdmission,
  transportKey,
} from '@ceirean/domain';
import { LiveInboxError, sameCommandFacts } from '@ceirean/engine';
import { Match, Option, Result, Schema } from 'effect';

export const ledgerTables = {
  metadata:
    'CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL, identity TEXT NOT NULL) STRICT',
  policy_revisions:
    'CREATE TABLE policy_revisions (revision TEXT PRIMARY KEY NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot))) STRICT',
  policy:
    'CREATE TABLE policy (id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL REFERENCES policy_revisions(revision), clock_floor INTEGER NOT NULL CHECK(clock_floor>=0 AND clock_floor<=9007199254740991)) STRICT',
  decisions:
    'CREATE TABLE decisions (id INTEGER PRIMARY KEY, command_key TEXT UNIQUE NOT NULL, record TEXT NOT NULL CHECK(json_valid(record))) STRICT',
  evidence:
    'CREATE TABLE evidence (evidence_id TEXT PRIMARY KEY NOT NULL, decision_id INTEGER UNIQUE NOT NULL REFERENCES decisions(id), evidence TEXT NOT NULL CHECK(json_valid(evidence))) STRICT',
  receipts:
    'CREATE TABLE receipts (transport_key TEXT PRIMARY KEY NOT NULL, decision_id INTEGER NOT NULL REFERENCES decisions(id), verified TEXT NOT NULL CHECK(json_valid(verified))) STRICT',
};
export const ownershipSchema = {
  ownership:
    'CREATE TABLE ownership (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL) STRICT',
};
export const applicationId = 0x4c564731;
const policyJson = Schema.fromJsonString(LocalIngressPolicy);
const recordJson = Schema.fromJsonString(LiveAdmissionRecord);
const verifiedJson = Schema.fromJsonString(VerifiedCommand);
const evidenceJson = Schema.fromJsonString(LivePermissionEvidence);
const nonNegative = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const localOutcome = Schema.Struct({
  decisionId: DecisionId,
  commandKey: CommandKey,
  operatorId: GitHubId,
  localPolicyRevision: AuthorityRevision,
  decision: AdmissionDecision,
  provenance: DecisionProvenance,
  evaluatedAtMs: nonNegative,
  committedAtMs: nonNegative,
});
const localStatus = Schema.Struct({
  decisions: nonNegative,
  receipts: nonNegative,
  evidence: nonNegative,
  authorityRevisions: nonNegative,
  revision: AuthorityRevision,
  clockFloor: nonNegative,
  ingressScopeId: LocalIngressPolicy.fields.ingressScopeId,
  policy: LocalIngressPolicy,
  policies: Schema.Array(LocalIngressPolicy).check(Schema.isMaxLength(256)),
  outcomes: Schema.Array(localOutcome).check(Schema.isMaxLength(256)),
});
export const encodePolicy = Schema.encodeSync(policyJson);
export const encodeRecord = Schema.encodeSync(recordJson);
export const encodeVerified = Schema.encodeSync(verifiedJson);
export const encodeEvidence = Schema.encodeSync(evidenceJson);
export const decodePolicy = Schema.decodeUnknownSync(policyJson);
export const decodeRecord = Schema.decodeUnknownSync(recordJson);
export const decodeVerified = Schema.decodeUnknownSync(verifiedJson);
export const decodeEvidence = Schema.decodeUnknownSync(evidenceJson);

export function invalidData(): never {
  throw new LiveInboxError({ operation: 'load', code: 'InvalidData' });
}
export function requireData(valid: boolean) {
  return Match.value(valid).pipe(
    Match.when(false, invalidData),
    Match.orElse(() => undefined),
  );
}
export function found<A>(value: A | null | undefined) {
  return Option.getOrThrowWith(Option.fromNullishOr(value), invalidData);
}
export function eligibleProvenance(
  verified: VerifiedCommand,
  policy: LocalIngressPolicy,
  provenance: DecisionProvenance,
  now: ClockReading,
) {
  const local = decideLiveAdmission({ verified, policy, evidence: Option.none(), now });
  function eligible() {
    return Match.value(local).pipe(
      Match.when({ _tag: 'Rejected', reason: 'AuthorityUnavailable' }, () => true),
      Match.orElse(() => false),
    );
  }
  return Match.value(provenance).pipe(
    Match.tag('LocalPolicy', () => true),
    Match.tag('LiveChecked', eligible),
    Match.exhaustive,
  );
}
const nativeError = Schema.Struct({ code: Schema.String });
export function sanitized(
  error: unknown,
  operation: LiveInboxError['operation'],
  fallback: LiveInboxError['code'],
) {
  const decoded = Schema.decodeUnknownResult(nativeError)(error);
  const busy = Result.match(decoded, {
    onSuccess: ({ code }) => ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(code),
    onFailure: () => false,
  });
  const isKnown = Match.instanceOf(LiveInboxError);
  const code = Match.value(error).pipe(
    Match.when(isKnown, (known) => known.code),
    Match.when(
      () => busy,
      () => 'Busy' as const,
    ),
    Match.orElse(() => fallback),
  );
  return new LiveInboxError({ operation, code });
}
export function readPolicy(db: Database, scope: string) {
  const row = found(
    db
      .query<{ revision: string; snapshot: string; clock_floor: number }, []>(
        'SELECT policy.revision,snapshot,clock_floor FROM policy JOIN policy_revisions USING(revision) WHERE policy.id=1',
      )
      .get(),
  );
  const policy = decodePolicy(row.snapshot);
  requireData(policy.revision === row.revision && policy.ingressScopeId === scope);
  ClockReading.make({ wallMs: row.clock_floor, monotonicMs: 0 });
  return { policy, floor: row.clock_floor };
}
export function counts(db: Database) {
  return found(
    db
      .query<
        { decisions: number; receipts: number; evidence: number; authorityRevisions: number },
        []
      >(
        'SELECT (SELECT count(*) FROM decisions) AS decisions, (SELECT count(*) FROM receipts) AS receipts, (SELECT count(*) FROM evidence) AS evidence, (SELECT count(*) FROM policy_revisions) AS authorityRevisions',
      )
      .get(),
  );
}
export function readRecord(db: Database, key: string) {
  const row = db
    .query<{ id: number; command_key: string; record: string }, [string]>(
      'SELECT id,command_key,record FROM decisions WHERE command_key=?',
    )
    .get(key);
  function decode(value: NonNullable<typeof row>) {
    const record = decodeRecord(value.record);
    const bound = [
      record.decisionId === String(value.id),
      record.commandKey === value.command_key,
      record.commandKey === commandKey(record.candidate),
    ].every(Boolean);
    requireData(bound);
    const evidenceRow = db
      .query<{ evidence_id: string; evidence: string }, [number]>(
        'SELECT evidence_id,evidence FROM evidence WHERE decision_id=?',
      )
      .get(value.id);
    function checkEvidence(evidence: LivePermissionEvidence) {
      const row = found(evidenceRow);
      const stored = decodeEvidence(row.evidence);
      const same = Schema.toEquivalence(LivePermissionEvidence);
      return row.evidence_id === evidence.evidenceId && same(stored, evidence);
    }
    const evidenceBound = Match.value(record.provenance).pipe(
      Match.tag('LocalPolicy', () => evidenceRow === null),
      Match.tag('LiveChecked', (live) => checkEvidence(live.evidence)),
      Match.exhaustive,
    );
    requireData(evidenceBound);
    return record;
  }
  return Option.map(Option.fromNullishOr(row), decode);
}
export function readReceipt(db: Database, key: string) {
  const row = db
    .query<{ decision_id: number; verified: string }, [string]>(
      'SELECT decision_id,verified FROM receipts WHERE transport_key=?',
    )
    .get(key);
  function decode(value: NonNullable<typeof row>) {
    const verified = decodeVerified(value.verified);
    requireData(transportKey(verified.receipt.ingressScopeId, verified.receipt.deliveryId) === key);
    const stored = readRecord(db, commandKey(verified.candidate));
    const record = Option.getOrThrowWith(stored, invalidData);
    requireData(
      String(value.decision_id) === record.decisionId &&
        sameCommandFacts(record.candidate, verified.candidate),
    );
    return { verified, record };
  }
  return Option.map(Option.fromNullishOr(row), decode);
}
export function checkSchema(db: Database, tables: Readonly<Record<string, string>>) {
  function incompatible(): never {
    throw new LiveInboxError({ operation: 'open', code: 'IncompatibleSchema' });
  }
  function requireSchema(valid: boolean) {
    return Match.value(valid).pipe(
      Match.when(false, incompatible),
      Match.orElse(() => undefined),
    );
  }
  const rows = db
    .query<{ name: string; sql: string }, []>(
      "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all();
  requireSchema(
    rows.length === Object.keys(tables).length && rows.every((row) => tables[row.name] === row.sql),
  );
  requireSchema(
    db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version === 1,
  );
  requireSchema(
    db.query<{ application_id: number }, []>('PRAGMA application_id').get()?.application_id ===
      applicationId,
  );
  const isOk = Schema.is(Schema.Literal('ok'));
  requireSchema(
    db
      .query<{ quick_check: string }, []>('PRAGMA quick_check')
      .all()
      .every((row) => isOk(row.quick_check)),
  );
  requireSchema(db.query('PRAGMA foreign_key_check').all().length === 0);
  requireSchema(
    db.query("SELECT name FROM sqlite_master WHERE type IN ('trigger','view')").all().length === 0,
  );
}
function validateRows(db: Database, scope: string, identity: string) {
  checkSchema(db, ledgerTables);
  const mode = db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode;
  const isWal = Schema.is(Schema.Literal('wal'));
  requireData(isWal(mode));
  const metadata = db
    .query<{ scope: string; identity: string }, []>('SELECT scope,identity FROM metadata')
    .all();
  const boundMetadata = [
    metadata.length === 1,
    metadata[0]?.scope === scope,
    metadata[0]?.identity === identity,
  ].every(Boolean);
  requireData(boundMetadata);
  const current = readPolicy(db, scope);
  requireData(db.query('SELECT id FROM policy').all().length === 1);
  const totals = counts(db);
  const bounded = [
    totals.decisions <= 256,
    totals.receipts <= 1024,
    totals.authorityRevisions <= 256,
    totals.authorityRevisions > 0,
  ].every(Boolean);
  requireData(bounded);
  const policies = new Map<string, LocalIngressPolicy>();
  for (const row of db
    .query<{ revision: string; snapshot: string }, []>(
      'SELECT revision,snapshot FROM policy_revisions',
    )
    .all()) {
    const policy = decodePolicy(row.snapshot);
    requireData(policy.revision === row.revision && policy.ingressScopeId === scope);
    policies.set(row.revision, policy);
  }
  const records = new Map<string, LiveAdmissionRecord>();
  for (const row of db
    .query<{ command_key: string }, []>('SELECT command_key FROM decisions')
    .all()) {
    const record = Option.getOrThrowWith(readRecord(db, row.command_key), invalidData);
    const policy = found(policies.get(record.localPolicyRevision));
    requireData(record.candidate.ingressScopeId === scope && record.committedAtMs <= current.floor);
    const evidence = Match.value(record.provenance).pipe(
      Match.tag('LocalPolicy', () => Option.none()),
      Match.tag('LiveChecked', (live) =>
        Option.some({ evidence: live.evidence, startedMonotonicMs: 0 }),
      ),
      Match.exhaustive,
    );
    const storedReceipt = db
      .query<{ verified: string }, [number]>(
        'SELECT verified FROM receipts WHERE decision_id=? LIMIT 1',
      )
      .get(Number(record.decisionId));
    const receiptRow = found(storedReceipt);
    const verified = decodeVerified(receiptRow.verified);
    requireData(sameCommandFacts(verified.candidate, record.candidate));
    const evaluated = { wallMs: record.evaluatedAtMs, monotonicMs: 0 };
    requireData(eligibleProvenance(verified, policy, record.provenance, evaluated));
    // This only validates historical wall-time facts; no lease is returned or reused.
    const decision = decideLiveAdmission({ verified, policy, evidence, now: evaluated });
    const sameDecision = Schema.toEquivalence(AdmissionDecision);
    requireData(sameDecision(decision, record.decision));
    records.set(record.decisionId, record);
  }
  function isLive(record: LiveAdmissionRecord) {
    return Match.value(record.provenance).pipe(
      Match.tag('LiveChecked', () => true),
      Match.orElse(() => false),
    );
  }
  const liveRecords = [...records.values()].filter(isLive);
  requireData(liveRecords.length === totals.evidence);
  for (const row of db
    .query<{ evidence_id: string; decision_id: number; evidence: string }, []>(
      'SELECT evidence_id,decision_id,evidence FROM evidence',
    )
    .all()) {
    const evidence = decodeEvidence(row.evidence);
    const stored = records.get(String(row.decision_id));
    const record = found(stored);
    requireData(evidence.evidenceId === row.evidence_id && isLive(record));
    const same = Match.value(record.provenance).pipe(
      Match.tag('LiveChecked', (live) =>
        Schema.toEquivalence(LivePermissionEvidence)(evidence, live.evidence),
      ),
      Match.orElse(() => false),
    );
    requireData(same);
  }
  const referenced = new Set<string>();
  for (const row of db
    .query<{ transport_key: string }, []>('SELECT transport_key FROM receipts')
    .all()) {
    const receipt = Option.getOrThrowWith(readReceipt(db, row.transport_key), invalidData);
    requireData(receipt.verified.candidate.ingressScopeId === scope);
    referenced.add(receipt.record.decisionId);
  }
  requireData(referenced.size === records.size);
  return Schema.decodeUnknownSync(localStatus)({
    ...totals,
    revision: current.policy.revision,
    clockFloor: current.floor,
    ingressScopeId: scope,
    policy: current.policy,
    policies: [...policies.values()].sort((a, b) => a.revision.localeCompare(b.revision)),
    outcomes: [...records.values()]
      .sort((a, b) => Number(a.decisionId) - Number(b.decisionId))
      .map((record) => ({
        decisionId: record.decisionId,
        commandKey: record.commandKey,
        operatorId: record.candidate.operatorId,
        localPolicyRevision: record.localPolicyRevision,
        decision: record.decision,
        provenance: record.provenance,
        evaluatedAtMs: record.evaluatedAtMs,
        committedAtMs: record.committedAtMs,
      })),
  });
}

export function validateLedger(db: Database, scope: string, identity: string) {
  function snapshot() {
    return validateRows(db, scope, identity);
  }
  return db.transaction(snapshot).deferred();
}
