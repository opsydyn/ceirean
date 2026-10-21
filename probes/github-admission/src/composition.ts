import {
  CommandAdmission,
  CommandInbox,
  CommandInboxErrorCode,
  CommandInboxOperation,
  makeCommandAdmission,
  makeCommandInbox,
} from '@ceirean/engine';
import { Cause, Effect, Exit, Layer, ManagedRuntime, Match, Result, Schema } from 'effect';

import { makeGitHubIngress } from './github-ingress.ts';
import { captureRequestBody } from './request-body.ts';
import { makeSqliteInbox } from './sqlite-inbox.ts';

export type ProbeConfig = Parameters<typeof makeSqliteInbox>[0] & { readonly secret: string };
const LifecycleIssue = Schema.Struct({
  operation: Schema.Union([CommandInboxOperation, Schema.Literal('runtime')]),
  code: Schema.Union([CommandInboxErrorCode, Schema.Literal('RuntimeFailed')]),
});
class ProbeLifecycleError extends Schema.TaggedError<ProbeLifecycleError>()('ProbeLifecycleError', {
  phase: Schema.Literals(['Acquire', 'Dispose']),
  issues: Schema.Array(LifecycleIssue),
}) {}
function issuesFrom(error: unknown): ReadonlyArray<typeof LifecycleIssue.Type> {
  function fromCause(cause: Cause.Cause<unknown>) {
    return cause.reasons.flatMap((reason) =>
      Match.value(reason).pipe(
        Match.when(Cause.isFailReason, ({ error }) => issuesFrom(error)),
        Match.when(Cause.isDieReason, ({ defect }) => issuesFrom(defect)),
        Match.orElse(() => [{ operation: 'runtime' as const, code: 'RuntimeFailed' as const }]),
      ),
    );
  }
  function decode(value: unknown) {
    const decoded = Schema.decodeUnknownResult(LifecycleIssue)(value);
    return Result.match(decoded, {
      onSuccess: (issue) => [issue],
      onFailure: () => [{ operation: 'runtime' as const, code: 'RuntimeFailed' as const }],
    });
  }
  const aggregate = Match.instanceOf(AggregateError);
  return Match.value(error).pipe(
    Match.when(Cause.isCause, fromCause),
    Match.when(aggregate, (value) => value.errors.flatMap(issuesFrom)),
    Match.orElse(decode),
  );
}
function makeAdmissionProbeLayer(config: ProbeConfig) {
  const native = makeSqliteInbox(config);
  const acquiredInbox = native.pipe(Effect.map(({ driver }) => makeCommandInbox(driver)));
  const inbox = Layer.effect(CommandInbox, acquiredInbox);
  const admission = Layer.effect(CommandAdmission, makeCommandAdmission());
  return Layer.provide(admission, inbox);
}
export async function openAdmissionProbe(config: ProbeConfig) {
  const secret = config.secret;
  const ingressScopeId = config.ingressScopeId;
  const layer = makeAdmissionProbeLayer(config);
  const runtime = ManagedRuntime.make(layer);
  let disposed: Promise<void> | undefined;
  function dispose() {
    disposed ??= runtime.dispose().catch((error: unknown) => {
      throw new ProbeLifecycleError({ phase: 'Dispose', issues: issuesFrom(error) });
    });
    return disposed;
  }
  async function failedAcquisition(cause: Cause.Cause<unknown>): Promise<never> {
    const primary = issuesFrom(cause);
    const cleanup = await dispose().then(
      () => [],
      (error: ProbeLifecycleError) => error.issues,
    );
    throw new ProbeLifecycleError({ phase: 'Acquire', issues: [...primary, ...cleanup] });
  }
  const acquired = await runtime.runPromiseExit(CommandAdmission);
  const admission = await Exit.match(acquired, {
    onSuccess: (service) => service,
    onFailure: failedAcquisition,
  });
  const ingress = makeGitHubIngress({
    secret,
    ingressScopeId,
    capture: (request) => runtime.runPromise(captureRequestBody(request, 65536)),
    admit: (command) => runtime.runPromise(admission.admit(command)),
  });
  async function fetch(request: Request) {
    return Match.value(disposed).pipe(
      Match.when(Match.defined, () =>
        Response.json({ _tag: 'IngressFailure', code: 'Disposed' }, { status: 503 }),
      ),
      Match.orElse(() => ingress.fetch(request)),
    );
  }
  return { fetch, dispose };
}
