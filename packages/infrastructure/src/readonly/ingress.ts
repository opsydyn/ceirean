import type { VerifiedCommand } from '@ceirean/domain';
import {
  captureRequestBody,
  makeVerifiedGitHubIngress,
  type CapturedBody,
  type RequestBodyError,
} from '@ceirean/github-adapter/protocol';
import { Clock, Effect, Match, Option, Redacted } from 'effect';

import { admitJob, type Policy } from './job.ts';
import type { ReadOnlyJob } from './object.ts';

type Namespace = Effect.Success<typeof ReadOnlyJob>;
type Enqueue = ReturnType<Namespace['getByName']>['enqueue'];

function inspectWebhook(
  request: Request,
  captured: CapturedBody,
  secret: Redacted.Redacted<string>,
  scope: string,
) {
  let verified = Option.none<VerifiedCommand>();
  function record(command: VerifiedCommand) {
    verified = Option.some(command);
    return Promise.resolve(new Response(null, { status: 202 }));
  }
  const ingress = makeVerifiedGitHubIngress({
    secret: Redacted.value(secret),
    ingressScopeId: scope,
    capture: () => Promise.resolve(captured),
    onVerified: record,
  });
  function inspected(response: Response) {
    return { response, verified };
  }
  return ingress.fetch(request).then(inspected);
}

export function handleReadOnlyRequest(
  request: Request,
  policy: Policy,
  secret: Redacted.Redacted<string>,
  enqueue: Enqueue,
) {
  function* receive() {
    const captured = yield* captureRequestBody(request, 65536).pipe(Effect.timeout('10 seconds'));
    const inspected = yield* Effect.tryPromise(() =>
      inspectWebhook(request, captured, secret, `readonly-${policy.sessionId}`),
    );
    function* accept(command: VerifiedCommand) {
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.fromResult(admitJob(policy, command.candidate, null, now));
      const job = yield* enqueue(command.candidate);
      return new Response(job, { status: 202, headers: { 'content-type': 'application/json' } });
    }
    return yield* Option.match(inspected.verified, {
      onNone: () => Effect.sync(() => inspected.response),
      onSome: (command) => Effect.gen(() => accept(command)),
    });
  }
  function* refuse(_error: unknown) {
    yield* Effect.logWarning('Ceirean read-only ingress refused', {
      code: 'ReadOnlyIngressFailed',
    });
    return Response.json({ _tag: 'ReadOnlyRefusal' }, { status: 503 });
  }
  function* forbidden() {
    yield* Effect.logInfo('Ceirean read-only command outside rehearsal policy');
    return Response.json({ _tag: 'NotAllowed' }, { status: 403 });
  }
  function bodyFailure(error: RequestBodyError) {
    function* rejectedBody() {
      yield* Effect.logInfo('Ceirean read-only request body refused', { code: error.code });
      const status = Match.value(error.code).pipe(
        Match.when('TooLarge', () => 413),
        Match.orElse(() => 400),
      );
      return Response.json({ _tag: 'BodyRefused', code: error.code }, { status });
    }
    const rejecting = Effect.gen(rejectedBody);
    return rejecting;
  }
  const receiving = Effect.gen(receive);
  function refusal(error: unknown) {
    const refusing = Effect.gen(() => refuse(error));
    return refusing;
  }
  return receiving.pipe(
    Effect.catchTag('RequestBodyError', bodyFailure),
    Effect.catchTag('JobRefusal', () => Effect.gen(forbidden)),
    Effect.catch(refusal),
  );
}
