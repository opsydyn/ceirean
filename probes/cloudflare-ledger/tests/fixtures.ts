import { decideCancellation } from '@ceirean/domain';
import {
  MigrationLedgerReply,
  migrationLedgerCodecs,
  type MigrationLedgerCommand,
} from '@ceirean/engine/journal-policy';
import { Match, Result, Schema } from 'effect';

import { makeFrozenRun, makeEvidenceCase } from '../../../packages/domain/tests/fixtures.ts';
import { makeWorkerCase } from '../../../packages/domain/tests/worker-fixtures.ts';

export function commands() {
  const state = makeFrozenRun();
  const c = makeWorkerCase();
  const register: MigrationLedgerCommand = {
    _tag: 'RegisterRun',
    state,
    contract: makeEvidenceCase().contract,
  };
  const worker: MigrationLedgerCommand = {
    _tag: 'EditWorker',
    edit: {
      _tag: 'Register',
      operationId: c.operation.operationId,
      operation: c.operation,
      createdAtMs: c.createdAtMs,
      atMs: c.createdAtMs,
    },
  };
  const cancelled = decideCancellation(state, 999);
  const accepted = Match.value(cancelled).pipe(
    Match.tag('Accepted', (value) => Result.succeed(value)),
    Match.orElse(() => Result.fail(new Error('Invalid fixture'))),
  );
  const decision = Result.getOrThrow(accepted);
  const cancel: MigrationLedgerCommand = {
    _tag: 'ChangeRun',
    change: {
      runId: state.runId,
      expectedRevision: 0,
      state: decision.state,
      facts: decision.facts,
    },
  };
  return { register, worker, cancel };
}
const replyCodec = Schema.fromJsonString(Schema.toCodecJson(MigrationLedgerReply));
export const encodeReply = Schema.encodeUnknownSync(replyCodec);
export const encodeCommand = Schema.encodeUnknownSync(migrationLedgerCodecs.command);
export const encodeState = Schema.encodeUnknownSync(migrationLedgerCodecs.state);
