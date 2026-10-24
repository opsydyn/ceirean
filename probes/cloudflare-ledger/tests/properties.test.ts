import { expect } from 'bun:test';

import {
  decideMigrationLedger,
  migrationLedgerEncoding,
  type MigrationLedgerEvent,
  type MigrationLedgerState,
} from '@ceirean/engine/journal-policy';
import { Arbitrary, Array, Effect, Option, Result, Schema } from 'effect';

import { commands, encodeReply, encodeState } from './fixtures.ts';
import { commit, local, request } from './harness.ts';

const indices = Schema.Array(Schema.Literals([0, 1, 2])).check(Schema.isMaxLength(11));
const sequences = Arbitrary.schema(indices);
const eventRow = Schema.Struct({ sequence: Schema.Number, payload: Schema.String });
const eventsCodec = Schema.fromJsonString(Schema.Array(eventRow));
const encodeEvents = Schema.encodeUnknownSync(eventsCodec);

function parity(values: ReadonlyArray<number>) {
  function* checkSequence() {
    const name = crypto.randomUUID();
    const c = commands();
    const pool = [c.register, c.worker, c.cancel];
    let expected: MigrationLedgerState = { sequence: 0, runs: [], workers: [] };
    let history: ReadonlyArray<typeof eventRow.Type> = [];
    let checks: ReadonlyArray<boolean> = [];
    for (const index of [0, ...values]) {
      const command = Option.getOrThrow(Option.fromUndefinedOr(pool[index]));
      const decision = Result.getOrThrow(decideMigrationLedger(expected, command));
      const actual = yield* commit(name, command);
      expected = decision.next;
      function appendEvent(event: MigrationLedgerEvent) {
        const payload = Result.getOrThrow(migrationLedgerEncoding.event(event));
        return Array.append(history, { sequence: event.sequence, payload });
      }
      history = Option.match(decision.event, { onNone: () => history, onSome: appendEvent });
      const state = yield* request('read', name);
      const audit = yield* request('audit', name);
      const comparisons = [
        actual === encodeReply(decision.reply),
        state === encodeState(expected),
        audit === encodeEvents(history),
      ];
      checks = Array.append(checks, comparisons.every(Boolean));
    }
    return checks.every(Boolean);
  }
  const checking = Effect.gen(checkSequence);
  return checking;
}

for (const seed of [0, 1, 163]) {
  function* verifySeed() {
    const result = yield* Arbitrary.checkEffect(sequences, parity, {
      seed,
      runs: 50,
      size: 12,
      maxShrinks: 100,
      maxDiscards: 1000,
    });
    expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
    expect(result).toMatchObject({ runs: 50 });
  }
  local.test(`actual workerd sequence refinement; seed ${seed}; 50 cases`, Effect.gen(verifySeed));
}
