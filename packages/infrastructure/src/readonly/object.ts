import * as Cloudflare from 'alchemy/Cloudflare';
import { Clock, Config, Effect, Match, Schema } from 'effect';

import { makeSmokeContainer } from './container.ts';
import { Policy, finishJob, recoverJob } from './job.ts';
import { makeReadOnlyJobAdmission } from './readiness.ts';
import { cleanupSmoke, runSmoke } from './runner.ts';
import { makeJobStore, type Dispatch } from './store.ts';

export const smokeRuntime = {
  image:
    'docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09',
};
export const SmokeContainer = Cloudflare.Container('ReadOnlyRuntime', {
  schedulingPolicy: 'durable_object',
  image: smokeRuntime.image,
  ssh: { enabled: false },
});
const policyCodec = Schema.fromJsonString(Policy);
const decodePolicy = Schema.decodeUnknownEffect(policyCodec);
function configuredPolicy(value: string) {
  return decodePolicy(value).pipe(Effect.mapError((error) => new Config.ConfigError(error)));
}
export const policyConfiguration = Config.String('CEIREAN_READONLY_POLICY').pipe(
  Config.mapEffect(configuredPolicy),
);
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function* construct() {
  const container = yield* SmokeContainer;
  const policy = yield* policyConfiguration.pipe(Effect.catch((error) => Effect.die(error)));
  function* initialize() {
    const state = yield* Cloudflare.DurableObjectState;
    const store = makeJobStore(state.storage);
    const smoke = makeSmokeContainer(container);
    const admission = makeReadOnlyJobAdmission(policy, store);
    function alarm() {
      function process(dispatch: Dispatch) {
        function* execute(value: Extract<Dispatch, { readonly _tag: 'Run' }>) {
          const result = yield* runSmoke(smoke);
          const job = finishJob(value.job, result.outcome, result.cleaned);
          const now = yield* Clock.currentTimeMillis;
          const stored = yield* store.finish(job, value.job, now);
          yield* Effect.logInfo('Ceirean read-only runtime result', { job: stored });
        }
        function* recover(value: Extract<Dispatch, { readonly _tag: 'Recover' }>) {
          const cleaned = yield* cleanupSmoke(smoke);
          const job = recoverJob(value.job, cleaned);
          const now = yield* Clock.currentTimeMillis;
          const stored = yield* store.finish(job, value.job, now);
          yield* Effect.logWarning('Ceirean read-only runtime recovered without re-execution', {
            job: stored,
          });
        }
        return Match.value(dispatch).pipe(
          Match.tag('Run', (value) => Effect.gen(() => execute(value))),
          Match.tag('Recover', (value) => Effect.gen(() => recover(value))),
          Match.tag('None', () => Effect.void),
          Match.exhaustive,
        );
      }
      function* dispatchAlarm() {
        const now = yield* Clock.currentTimeMillis;
        const dispatch = yield* store.take(now);
        yield* process(dispatch);
      }
      const dispatching = Effect.gen(dispatchAlarm);
      return dispatching.pipe(Effect.catch((error) => Effect.die(error)));
    }
    const status = () => store.read().pipe(Effect.map(encode));
    return { ...admission, status, alarm };
  }
  const initializing = Effect.gen(initialize);
  return initializing;
}
export class ReadOnlyJob extends Cloudflare.DurableObject<ReadOnlyJob>()(
  'ReadOnlyJob',
  Effect.gen(construct),
) {}
