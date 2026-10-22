import type { WorkerIssuerId } from '@ceirean/domain';
import { Effect, Layer } from 'effect';

import { makeWorkerLifecycle } from '../../engine/src/worker-lifecycle-service.ts';
import { WorkerJournal, WorkerMechanism } from '../../engine/src/worker-ports.ts';
import { openMigrationLedger, type MigrationLedgerConfig } from '../src/index.ts';

function lifecycleServices(
  journal: typeof WorkerJournal.Service,
  mechanism: typeof WorkerMechanism.Service,
) {
  return Layer.mergeAll(
    Layer.succeed(WorkerJournal, journal),
    Layer.succeed(WorkerMechanism, mechanism),
  );
}
function lifecycleWith(
  issuer: WorkerIssuerId,
  journal: typeof WorkerJournal.Service,
  mechanism: typeof WorkerMechanism.Service,
) {
  const services = lifecycleServices(journal, mechanism);
  const program = makeWorkerLifecycle(issuer);
  const provided = Effect.provide(program, services);
  return provided;
}

// Test-only reconstruction of the existing machine; recovery records confer no execution approval.
export function reconstructController(
  config: MigrationLedgerConfig,
  issuer: WorkerIssuerId,
  mechanism: typeof WorkerMechanism.Service,
) {
  function* reconstruct() {
    const ledger = yield* openMigrationLedger(config);
    const recovery = yield* ledger.readRecovery();
    const lifecycle = yield* lifecycleWith(issuer, ledger.workerJournal, mechanism);
    for (const { snapshot } of recovery.workers) yield* lifecycle.acquire(snapshot.operation);
    return { ledger, lifecycle, recovery };
  }
  const program = Effect.gen(reconstruct);
  return program;
}
