import { Match, Result, Schema } from 'effect';

import { CliError } from './config.ts';

const isWebhook = Schema.is(Schema.Literal('/webhook'));
const isPost = Schema.is(Schema.Literal('POST'));

const FailureCode = Schema.Literals([
  'MalformedInput',
  'InvalidSignature',
  'TooLarge',
  'FieldTooLarge',
  'UnsupportedMediaType',
  'Aborted',
  'ReadFailed',
  'DigestFailed',
  'OperationalFailure',
  'Disposed',
  'Timeout',
  'NotFound',
  'MethodNotAllowed',
  'Saturated',
]);
export function publicFailure(
  status: number,
  code: typeof FailureCode.Type,
  correlationId: string = crypto.randomUUID(),
) {
  return Response.json({ _tag: 'IngressFailure', code, correlationId }, { status });
}
function scheduleNative(callback: () => void, ms: number) {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
}
export function makeBoundedListener(options: {
  readonly fetch: (
    request: Request,
    signal: AbortSignal,
    correlationId: string,
  ) => Promise<Response>;
  readonly clock?: () => number;
  readonly schedule?: (callback: () => void, ms: number) => () => void;
}) {
  const clock = options.clock ?? (() => performance.now());
  const schedule = options.schedule ?? scheduleNative;
  let starts: number[] = [];
  let closed = false;
  let disposal: Promise<void> | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let stopped: Promise<void> | undefined;
  const owners = new Set<{ controller: AbortController; settled: Promise<unknown> }>();
  function execute(request: Request) {
    const correlationId = crypto.randomUUID();
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const aborted = Promise.withResolvers<Response>();
    function onAbort() {
      aborted.resolve(publicFailure(503, 'Aborted', correlationId));
    }
    signal.addEventListener('abort', onAbort, { once: true });
    const cancelTimer = schedule(() => {
      aborted.resolve(publicFailure(503, 'Timeout', correlationId));
      controller.abort();
    }, 8000);
    const started = Result.try(() => options.fetch(request, signal, correlationId));
    const work = Result.match(started, {
      onFailure: () => Promise.resolve(publicFailure(503, 'OperationalFailure', correlationId)),
      onSuccess: (promise) =>
        promise.catch(() => publicFailure(503, 'OperationalFailure', correlationId)),
    });
    const owner = { controller, settled: work };
    owners.add(owner);
    const outcome = Promise.race([work, aborted.promise]);
    function finish() {
      cancelTimer();
      signal.removeEventListener('abort', onAbort);
      owners.delete(owner);
    }
    owner.settled = work.finally(finish);
    return outcome;
  }
  async function fetch(request: Request) {
    const now = clock();
    starts = starts.filter((start) => now - start < 60000);
    function accept() {
      starts.push(now);
      return execute(request);
    }
    return Match.value(true).pipe(
      Match.when(
        () => closed,
        () => publicFailure(503, 'Disposed'),
      ),
      Match.when(
        () => !isWebhook(new URL(request.url).pathname),
        () => publicFailure(404, 'NotFound'),
      ),
      Match.when(
        () => !isPost(request.method),
        () => publicFailure(405, 'MethodNotAllowed'),
      ),
      Match.when(
        () => request.signal.aborted,
        () => publicFailure(400, 'Aborted'),
      ),
      Match.when(
        () => owners.size >= 4 || starts.length >= 60,
        () => publicFailure(429, 'Saturated'),
      ),
      Match.orElse(accept),
    );
  }
  function listen(port = 8787) {
    const available = !closed && server === undefined;
    const checked = Match.value(available).pipe(
      Match.when(false, () => Result.fail(new CliError({ code: 'OperationFailed' }))),
      Match.orElse(() => Result.succeed(true)),
    );
    Result.getOrThrow(checked);
    const started = Bun.serve({ hostname: '127.0.0.1', port, fetch });
    server = started;
    return started;
  }
  function dispose() {
    closed = true;
    stopped ??= server?.stop(false);
    for (const owner of owners) owner.controller.abort();
    disposal ??= Promise.all([...owners].map((owner) => owner.settled)).then(() => stopped);
    return disposal;
  }
  return { fetch, listen, dispose };
}
