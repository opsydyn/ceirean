import type { DurableObjectState } from 'alchemy/Cloudflare/Workers/DurableObjectState';
import { Effect, Match, Option, Result, Schema } from 'effect';

import { Candidate, Job, Policy, admitJob, claimJob } from './job.ts';

const decode = Schema.decodeUnknownEffect(Job, { onExcessProperty: 'error' });
const sameJob = Schema.toEquivalence(Job);
type Running = Extract<Job, { readonly _tag: 'Running' }>;
type Recoverable = Extract<Job, { readonly _tag: 'Running' | 'CleanupRequired' }>;
export type Dispatch =
  | { readonly _tag: 'Run'; readonly job: Running }
  | { readonly _tag: 'Recover'; readonly job: Recoverable }
  | { readonly _tag: 'None' };

export function makeJobStore(storage: DurableObjectState['Service']['storage']) {
  function read() {
    function* readJob() {
      const value = yield* storage.get('readonly-job');
      return yield* Option.match(Option.fromUndefinedOr(value), {
        onNone: () => Effect.succeed(null),
        onSome: decode,
      });
    }
    const reading = Effect.gen(readJob);
    return reading;
  }
  function admit(policy: Policy, candidate: Candidate, now: number) {
    function* register() {
      const existing = yield* read();
      const job = yield* Effect.fromResult(admitJob(policy, candidate, existing, now));
      function* record() {
        yield* storage.put('readonly-job', job);
        yield* storage.setAlarm(now + 1);
      }
      const recording = Effect.gen(record);
      const isNew = Effect.sync(() => existing === null);
      yield* recording.pipe(Effect.when(isNew));
      return job;
    }
    const admission = Effect.gen(register);
    return storage.transaction(admission);
  }
  function take(now: number) {
    function* dispatch() {
      const job = yield* read();
      function* queued(value: Extract<Job, { readonly _tag: 'Queued' }>) {
        const claimed = claimJob(value, now);
        function* run(running: Running) {
          yield* storage.put('readonly-job', running);
          yield* storage.setAlarm(now + 75000);
          return { _tag: 'Run' as const, job: running };
        }
        function* expire() {
          yield* storage.put('readonly-job', {
            ...value,
            _tag: 'Failed',
            code: 'Expired',
          } satisfies Job);
          return { _tag: 'None' as const };
        }
        return yield* Result.match(claimed, {
          onSuccess: (running) => Effect.gen(() => run(running)),
          onFailure: () => Effect.gen(expire),
        });
      }
      function action(value: Job) {
        const attempts = Match.value(value).pipe(
          Match.tag('CleanupRequired', (pending) => pending.cleanupAttempts),
          Match.orElse(() => 0 as const),
        );
        const nextAttempt = Match.value(attempts).pipe(
          Match.when(0, () => 1 as const),
          Match.orElse(() => 2 as const),
        );
        function* recover(recoverable: Recoverable) {
          const pending = {
            ...recoverable,
            _tag: 'CleanupRequired' as const,
            outcome: { _tag: 'Failed' as const, code: 'Interrupted' as const },
            cleanupAttempts: nextAttempt,
          };
          yield* storage.put('readonly-job', pending);
          yield* storage.setAlarm(now + 30000);
          return { _tag: 'Recover' as const, job: pending };
        }
        function recoverOrStop(recoverable: Recoverable) {
          const recovering = Effect.gen(() => recover(recoverable));
          const stopping = storage
            .deleteAlarm()
            .pipe(Effect.map(() => ({ _tag: 'None' as const })));
          return Match.value(attempts).pipe(
            Match.when(2, () => stopping),
            Match.orElse(() => recovering),
          );
        }
        return Match.value(value).pipe(
          Match.tag('Queued', (queuedJob) => Effect.gen(() => queued(queuedJob))),
          Match.tag('Running', 'CleanupRequired', recoverOrStop),
          Match.orElse(() => Effect.succeed({ _tag: 'None' as const })),
        );
      }
      return yield* Option.match(Option.fromNullishOr(job), {
        onNone: () => Effect.succeed({ _tag: 'None' as const }),
        onSome: action,
      });
    }
    const dispatching = Effect.gen(dispatch);
    return storage.transaction(dispatching);
  }
  function finish(job: Job, expected: Recoverable, now: number) {
    function* persist() {
      const current = yield* read();
      // A late worker must not overwrite a recovery result or terminal failure.
      const active = Option.exists(Option.fromNullishOr(current), (value) =>
        sameJob(value, expected),
      );
      function* save() {
        yield* storage.put('readonly-job', job);
        const retryCleanup = Match.value(job).pipe(
          Match.tag('CleanupRequired', (pending) => pending.cleanupAttempts < 2),
          Match.orElse(() => false),
        );
        const scheduling = Match.value(retryCleanup).pipe(
          Match.when(true, () => storage.setAlarm(now + 15000)),
          Match.orElse(() => storage.deleteAlarm()),
        );
        yield* scheduling;
      }
      const saving = Effect.gen(save);
      const canSave = Effect.sync(() => active);
      yield* saving.pipe(Effect.when(canSave));
      return yield* read();
    }
    const persisting = Effect.gen(persist);
    return storage.transaction(persisting);
  }
  return { read, admit, take, finish };
}
