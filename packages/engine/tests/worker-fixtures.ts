import { WorkerIntentId, WorkerIssuerId, type WorkerIntent } from '@leviathan/domain';
import { Match, Option } from 'effect';

import { makeWorkerCase } from '../../domain/tests/worker-fixtures.ts';
import type { WorkerJournalEdit, WorkerJournalSnapshot } from '../src/worker-contracts.ts';

export { makeWorkerCase };

export function makeWorkerSnapshot(): WorkerJournalSnapshot {
  const { operation } = makeWorkerCase();
  return {
    revision: 7,
    operation,
    createdAtMs: 900,
    editTimeFloorMs: 900,
    outcomeEvidenceFloorMs: 900,
    authority: { identity: operation.identity, cancelledAtMs: Option.none() },
    intents: [],
    containerId: Option.none(),
    readiness: Option.none(),
    executionAuthorizedAtMs: Option.none(),
    cleanup: Option.none(),
  };
}

export function makeWorkerIntent(kind: WorkerIntent['kind'] = 'Create'): WorkerIntent {
  const { operation, containerId } = makeWorkerCase();
  const resource = Match.value(kind).pipe(
    Match.when('Create', () => operation.custody.containerSlot),
    Match.orElse(() => containerId),
  );
  return {
    intentId: WorkerIntentId.make(`intent-${kind}`),
    operationId: operation.operationId,
    issuerId: WorkerIssuerId.make('controller-1'),
    kind,
    resource,
    claimedAtMs: 950,
    outcome: { _tag: 'Claimed' },
  };
}

export function claimEdit(
  snapshot: WorkerJournalSnapshot,
  intent = makeWorkerIntent(),
): Extract<WorkerJournalEdit, { readonly _tag: 'Claim' }> {
  return {
    _tag: 'Claim',
    operationId: snapshot.operation.operationId,
    expectedRevision: snapshot.revision,
    atMs: intent.claimedAtMs,
    intent,
  };
}

export function cleanupEdit(
  snapshot: WorkerJournalSnapshot,
  atMs = 1000,
): Extract<WorkerJournalEdit, { readonly _tag: 'RequestCleanup' }> {
  return {
    _tag: 'RequestCleanup',
    operationId: snapshot.operation.operationId,
    expectedRevision: snapshot.revision,
    atMs,
    cleanupWindowMs: 100,
  };
}
