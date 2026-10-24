import {
  MigrationLedgerReply,
  MigrationLedgerState,
  decideMigrationLedger,
  migrationLedgerBounds,
  migrationLedgerCodecs,
  migrationLedgerDecoding,
  migrationLedgerEncoding,
  migrationPayloadBytes,
  recoverMigrationLedger,
  type MigrationLedgerEvent,
} from '@ceirean/engine/journal-policy';
import type { DurableObjectState } from 'alchemy/Cloudflare/Workers/DurableObjectState';
import { Data, Effect, Match, Option, Result, Schema } from 'effect';

class ProbeStorageError extends Data.TaggedError('ProbeStorageError')<{
  readonly code: 'InvalidData' | 'TransactionFailed';
}> {}

const replyCodec = Schema.fromJsonString(Schema.toCodecJson(MigrationLedgerReply));
const encodeState = Schema.encodeUnknownSync(migrationLedgerCodecs.state, {
  onExcessProperty: 'error',
});
const decodeState = Schema.decodeUnknownSync(migrationLedgerCodecs.state, {
  onExcessProperty: 'error',
});
const empty: MigrationLedgerState = { sequence: 0, runs: [], workers: [] };

function requireValid(value: boolean) {
  const checked = Match.value(value).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () => Result.fail(new ProbeStorageError({ code: 'InvalidData' }))),
    Match.exhaustive,
  );
  Result.getOrThrow(checked);
}

export function makeLedger(storage: DurableObjectState['Service']['raw']['storage']) {
  const sql = storage.sql;
  function initialize() {
    const tables = sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('probe_state','probe_events')",
      )
      .toArray();
    function createTables() {
      sql.exec(
        'CREATE TABLE probe_state(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)',
      );
      sql.exec('CREATE TABLE probe_events(sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
      sql.exec('INSERT INTO probe_state VALUES(1,?)', encodeState(empty));
    }
    const ensureTables = Match.value(tables.length).pipe(
      Match.when(0, () => () => storage.transactionSync(createTables)),
      Match.orElse(() => () => undefined),
    );
    ensureTables();
    requireValid(tables.length === 0 || tables.length === 2);
  }
  function events() {
    return sql
      .exec<{ sequence: number; payload: string }>(
        'SELECT sequence,payload FROM probe_events ORDER BY sequence',
      )
      .toArray();
  }
  function readState() {
    const row = sql.exec<{ payload: string }>('SELECT payload FROM probe_state WHERE id=1').one();
    requireValid(migrationPayloadBytes(row.payload) <= migrationLedgerBounds.maxPayloadBytes);
    const current = decodeState(row.payload);
    Result.getOrThrow(recoverMigrationLedger(current));
    const history = events();
    requireValid(
      history.length <= migrationLedgerBounds.maxEvents && history.length === current.sequence,
    );
    let replay = empty;
    for (const row of history) {
      const event = Result.getOrThrow(migrationLedgerDecoding.event(row.payload));
      const decision = Result.getOrThrow(decideMigrationLedger(replay, event.command));
      const expected = Option.getOrThrow(decision.event);
      requireValid(row.sequence === replay.sequence + 1 && row.sequence === event.sequence);
      requireValid(
        Result.getOrThrow(migrationLedgerEncoding.event(expected)) ===
          Result.getOrThrow(migrationLedgerEncoding.event(event)),
      );
      replay = decision.next;
    }
    requireValid(encodeState(replay) === encodeState(current));
    return current;
  }
  function attempt<A>(operation: () => A) {
    function transact() {
      initialize();
      return storage.transactionSync(operation);
    }
    const transaction = Effect.try({
      try: transact,
      catch: () => new ProbeStorageError({ code: 'TransactionFailed' }),
    });
    return transaction;
  }
  function commit(encodedCommand: string, fault = false) {
    function write() {
      const command = Result.getOrThrow(migrationLedgerDecoding.command(encodedCommand));
      const decided = decideMigrationLedger(readState(), command);
      const decision = Result.getOrThrow(decided);
      function persist(event: MigrationLedgerEvent) {
        const snapshot = encodeState(decision.next);
        const encodedEvent = Result.getOrThrow(migrationLedgerEncoding.event(event));
        const previousBytes = events().reduce(
          (total, event) => total + migrationPayloadBytes(event.payload),
          0,
        );
        requireValid(
          migrationPayloadBytes(snapshot) + previousBytes + migrationPayloadBytes(encodedEvent) <=
            migrationLedgerBounds.maxPayloadBytes,
        );
        sql.exec('UPDATE probe_state SET payload=? WHERE id=1', snapshot);
        requireValid(!fault);
        sql.exec('INSERT INTO probe_events VALUES(?,?)', event.sequence, encodedEvent);
      }
      Option.match(decision.event, { onNone: () => undefined, onSome: persist });
      return Schema.encodeUnknownSync(replyCodec, { onExcessProperty: 'error' })(decision.reply);
    }
    const committing = attempt(write);
    return committing;
  }
  function read() {
    return attempt(() => encodeState(readState()));
  }
  function recover() {
    function recovery() {
      const recovered = recoverMigrationLedger(readState());
      return Schema.encodeUnknownSync(migrationLedgerCodecs.recovery)(Result.getOrThrow(recovered));
    }
    return attempt(recovery);
  }
  function audit() {
    const auditRow = Schema.Struct({ sequence: Schema.Number, payload: Schema.String });
    const codec = Schema.fromJsonString(Schema.Array(auditRow));
    const encodeEvents = Schema.encodeUnknownSync(codec);
    return attempt(() => encodeEvents(events()));
  }
  function corrupt() {
    function writeCorruptState() {
      sql.exec("UPDATE probe_state SET payload='{}' WHERE id=1");
      return '{}';
    }
    return attempt(writeCorruptState);
  }
  return { commit, read, recover, audit, corrupt };
}
