import {
  decideReplay,
  ReplayDecision,
  ReplayState,
  type InspectionReceipt,
} from '@ceirean/cloudflare-executor-probe/replay';
import type { DurableObjectState } from 'alchemy/Cloudflare/Workers/DurableObjectState';
import { Data, Effect, Match, Result, Schema } from 'effect';

export class ReplayStorageError extends Data.TaggedError('ReplayStorageError')<{
  readonly code: 'TransactionFailed';
}> {}
const strict = { onExcessProperty: 'error' } as const;
const stateCodec = Schema.fromJsonString(ReplayState);
const encodeState = Schema.encodeUnknownSync(stateCodec, strict);
const decodeState = Schema.decodeUnknownSync(stateCodec, strict);
const encodeDecision = Schema.encodeUnknownSync(Schema.fromJsonString(ReplayDecision), strict);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function requireValid(value: boolean) {
  const checked = Result.succeed(true).pipe(
    Result.filterOrFail(
      () => value,
      () => new ReplayStorageError({ code: 'TransactionFailed' }),
    ),
  );
  Result.getOrThrow(checked);
}
export function makeReplayStore(storage: DurableObjectState['Service']['raw']['storage']) {
  const sql = storage.sql;
  function initialize() {
    const count = sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('inspection_state','inspection_events')",
      )
      .one().count;
    function create() {
      sql.exec(
        'CREATE TABLE inspection_state(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)',
      );
      sql.exec(
        'CREATE TABLE inspection_events(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)',
      );
      sql.exec('INSERT INTO inspection_state VALUES(1,?)', encodeState({ _tag: 'Empty' }));
    }
    const selected = Match.value(count).pipe(
      Match.when(0, () => () => storage.transactionSync(create)),
      Match.orElse(() => () => undefined),
    );
    selected();
    requireValid(count === 0 || count === 2);
  }
  function readState() {
    const current = sql
      .exec<{ payload: string }>('SELECT payload FROM inspection_state LIMIT 2')
      .toArray();
    requireValid(current.length === 1);
    const payload = current[0]?.payload ?? '';
    requireValid(payload.length <= 2048);
    const state = decodeState(payload);
    const events = sql
      .exec<{ payload: string }>('SELECT payload FROM inspection_events LIMIT 2')
      .toArray();
    const valid = Match.value(state).pipe(
      Match.tag('Empty', () => events.length === 0),
      Match.tag('Recorded', () => events.length === 1 && events[0]?.payload === encodeState(state)),
      Match.exhaustive,
    );
    requireValid(valid);
    return { state, eventCount: events.length, activation: 'Blocked' as const };
  }
  function attempt<A>(body: () => A) {
    function transact() {
      initialize();
      return storage.transactionSync(body);
    }
    const operation = Effect.try({
      try: transact,
      catch: () => new ReplayStorageError({ code: 'TransactionFailed' }),
    });
    return operation;
  }
  function record(receipt: InspectionReceipt, fault = false) {
    function write() {
      const { state } = readState();
      const decision = decideReplay(state, receipt);
      function persist() {
        const payload = encodeState(decision.state);
        sql.exec('UPDATE inspection_state SET payload=? WHERE id=1', payload);
        requireValid(!fault);
        sql.exec('INSERT INTO inspection_events VALUES(1,?)', payload);
      }
      const selected = Match.value(decision.disposition).pipe(
        Match.when('Recorded', () => persist),
        Match.orElse(() => () => undefined),
      );
      selected();
      return encodeDecision(decision);
    }
    return attempt(write);
  }
  function read() {
    const operation = attempt(() => encodeJson(readState()));
    return operation;
  }
  function corrupt() {
    function damage() {
      sql.exec("UPDATE inspection_state SET payload='{}' WHERE id=1");
      return encodeJson({ _tag: 'CorruptedLocally' });
    }
    const operation = attempt(damage);
    return operation;
  }
  return { record, read, corrupt };
}
