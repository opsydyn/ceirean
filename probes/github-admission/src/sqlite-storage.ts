import type { Database } from 'bun:sqlite';

import {
  AdmissionRecord,
  AuthorityState,
  VerifiedCommand,
  commandKey,
  transportKey,
} from '@leviathan/domain';
import { CommandInboxError, sameCommandFacts } from '@leviathan/engine';
import { Match, Option, Result, Schema } from 'effect';

const authorityJson = Schema.fromJsonString(AuthorityState);
const recordJson = Schema.fromJsonString(AdmissionRecord);
const verifiedJson = Schema.fromJsonString(VerifiedCommand);
export const encodeAuthority = Schema.encodeSync(authorityJson);
export const encodeRecord = Schema.encodeSync(recordJson);
export const encodeVerified = Schema.encodeSync(verifiedJson);
function decodeAuthority(input: unknown) {
  return Schema.decodeUnknownResult(authorityJson)(input).pipe(Result.getOrThrowWith(invalidData));
}
function decodeRecord(input: unknown) {
  return Schema.decodeUnknownResult(recordJson)(input).pipe(Result.getOrThrowWith(invalidData));
}
function decodeVerified(input: unknown) {
  return Schema.decodeUnknownResult(verifiedJson)(input).pipe(Result.getOrThrowWith(invalidData));
}

export function scopeMatches(state: AuthorityState, scope: string) {
  return Match.value(state).pipe(
    Match.tag('Unavailable', () => true),
    Match.tag('Available', (available) => available.ingressScopeId === scope),
    Match.exhaustive,
  );
}

export function invalidData(): never {
  throw new CommandInboxError({ operation: 'load', code: 'InvalidData' });
}
export function requireData(valid: boolean) {
  return Match.value(valid).pipe(
    Match.when(false, invalidData),
    Match.orElse(() => undefined),
  );
}

export function initialize(db: Database, scope: string, initial: AuthorityState | undefined) {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = FULL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA busy_timeout = 0');
  function initializeRows() {
    const existing = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='authority'")
      .get();
    db.run(`CREATE TABLE IF NOT EXISTS authority (
      scope TEXT PRIMARY KEY NOT NULL, revision TEXT NOT NULL,
      snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
      clock_floor INTEGER NOT NULL CHECK(clock_floor >= 0 AND clock_floor <= 9007199254740991),
      FOREIGN KEY(scope,revision) REFERENCES authority_revisions(scope,revision)
        DEFERRABLE INITIALLY DEFERRED) STRICT`);
    db.run(`CREATE TABLE IF NOT EXISTS authority_revisions (
      scope TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(scope,revision)) STRICT`);
    db.run(`CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, command_key TEXT UNIQUE NOT NULL,
      record TEXT NOT NULL CHECK(json_valid(record))) STRICT`);
    db.run(`CREATE TABLE IF NOT EXISTS receipts (
      transport_key TEXT PRIMARY KEY NOT NULL, decision_id INTEGER NOT NULL REFERENCES decisions(id),
      verified TEXT NOT NULL CHECK(json_valid(verified))) STRICT`);
    const row = db.query('SELECT scope FROM authority WHERE scope = ?').get(scope);
    function seed() {
      requireData(existing === null);
      const state = Schema.decodeUnknownSync(AuthorityState)(
        initial ?? { _tag: 'Unavailable', revision: 'unavailable-initial' },
      );
      requireData(scopeMatches(state, scope));
      db.query('INSERT INTO authority_revisions(scope,revision) VALUES (?,?)').run(
        scope,
        state.revision,
      );
      db.query('INSERT INTO authority(scope,revision,snapshot,clock_floor) VALUES (?,?,?,0)').run(
        scope,
        state.revision,
        encodeAuthority(state),
      );
    }
    Option.match(Option.fromNullishOr(row), { onNone: seed, onSome: () => undefined });
  }
  db.transaction(initializeRows).immediate();
}

export function readAuthority(db: Database, scope: string) {
  const row = db
    .query<{ revision: string; snapshot: string; clock_floor: number }, [string]>(
      'SELECT revision,snapshot,clock_floor FROM authority WHERE scope = ?',
    )
    .get(scope);
  function decode(found: NonNullable<typeof row>) {
    const state = decodeAuthority(found.snapshot);
    const bound = state.revision === found.revision && scopeMatches(state, scope);
    requireData(bound);
    const validFloor = Number.isSafeInteger(found.clock_floor) && found.clock_floor >= 0;
    requireData(validFloor);
    requireData(
      db
        .query('SELECT revision FROM authority_revisions WHERE scope=? AND revision=?')
        .get(scope, state.revision) !== null,
    );
    return { state, floor: found.clock_floor };
  }
  return Option.match(Option.fromNullishOr(row), { onNone: invalidData, onSome: decode });
}

export function readRecord(db: Database, key: string) {
  const row = db
    .query<{ id: number; command_key: string; record: string }, [string]>(
      'SELECT id,command_key,record FROM decisions WHERE command_key=?',
    )
    .get(key);
  function decode(found: NonNullable<typeof row>) {
    const record = decodeRecord(found.record);
    const bound = [
      record.decisionId === String(found.id),
      record.commandKey === found.command_key,
      record.commandKey === commandKey(record.candidate),
    ].every(Boolean);
    requireData(bound);
    requireData(record.evaluatedAtMs <= record.committedAtMs);
    const decisionBound = Match.value(record.decision).pipe(
      Match.tag('Rejected', () => true),
      Match.tag(
        'AdmittedPreview',
        (decision) =>
          decision.commandKey === key && decision.evidenceRevision === record.authorityRevision,
      ),
      Match.exhaustive,
    );
    requireData(decisionBound);
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
  function decode(found: NonNullable<typeof row>) {
    const verified = decodeVerified(found.verified);
    requireData(transportKey(verified.receipt.ingressScopeId, verified.receipt.deliveryId) === key);
    const command = commandKey(verified.candidate);
    const stored = readRecord(db, command);
    const record = Option.getOrThrowWith(stored, invalidData);
    requireData(String(found.decision_id) === record.decisionId);
    requireData(sameCommandFacts(record.candidate, verified.candidate));
    return { verified, record };
  }
  return Option.map(Option.fromNullishOr(row), decode);
}

export function rowCounts(db: Database) {
  const row = db
    .query<{ decisions: number; receipts: number }, []>(
      'SELECT (SELECT count(*) FROM decisions) AS decisions, (SELECT count(*) FROM receipts) AS receipts',
    )
    .get();
  return Option.getOrThrowWith(Option.fromNullishOr(row), invalidData);
}
