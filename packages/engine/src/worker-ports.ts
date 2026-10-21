import { Context } from 'effect';

import { makeWorkerJournal, makeWorkerMechanism } from './worker-service-factories.ts';

export class WorkerJournal extends Context.Service<
  WorkerJournal,
  ReturnType<typeof makeWorkerJournal>
>()('@ceirean/engine/WorkerJournal') {}

export class WorkerMechanism extends Context.Service<
  WorkerMechanism,
  ReturnType<typeof makeWorkerMechanism>
>()('@ceirean/engine/WorkerMechanism') {}
