import { LiveAuthorityError } from '@ceirean/engine';
import { Match, Option, Result, Schema } from 'effect';

export type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;
type Phase = LiveAuthorityError['phase'];
const responseLimit = 1048576;
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export function requireGitHub(condition: boolean, phase: Phase, code: LiveAuthorityError['code']) {
  return Match.value(condition).pipe(
    Match.when(false, () => {
      throw new LiveAuthorityError({ phase, code });
    }),
    Match.orElse(() => undefined),
  );
}
export function interrupted(signal: AbortSignal, phase: Phase) {
  const knownError = Match.instanceOf(LiveAuthorityError);
  const code = Match.value(signal.reason).pipe(
    Match.when(knownError, (error) => error.code),
    Match.orElse(() => 'Aborted' as const),
  );
  requireGitHub(!signal.aborted, phase, code);
}
export function safeGitHubError(error: unknown, phase: Phase) {
  const knownError = Match.instanceOf(LiveAuthorityError);
  return Match.value(error).pipe(
    Match.when(
      knownError,
      (known) => new LiveAuthorityError({ phase: known.phase, code: known.code }),
    ),
    Match.orElse(() => new LiveAuthorityError({ phase, code: 'Unavailable' })),
  );
}

// This bounds the result only. Its caller must separately retain native settlement.
export function boundedNativeOutcome<A>(
  native: Promise<A>,
  signal: AbortSignal,
  phase: () => Phase,
) {
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      const result = Result.try(() => interrupted(signal, phase()));
      Result.match(result, {
        onFailure: reject,
        onSuccess: () => undefined,
      });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    onAbort();
  });
  return Promise.race([native, aborted]).finally(() =>
    signal.removeEventListener('abort', onAbort),
  );
}
function statusCode(status: number) {
  return Match.value(status).pipe(
    Match.when(401, () => 'Denied' as const),
    Match.when(403, () => 'Denied' as const),
    Match.when(404, () => 'Denied' as const),
    Match.when(429, () => 'RateLimited' as const),
    Match.when(
      (value) => value >= 500,
      () => 'Unavailable' as const,
    ),
    Match.orElse(() => 'InvalidResponse' as const),
  );
}

async function readResponse(
  response: Response,
  signal: AbortSignal,
  phase: Phase,
  expectedStatus: number,
  failed: (error: unknown) => void,
) {
  const reader = response.body?.getReader();
  let cancellation: Promise<Result.Result<void, LiveAuthorityError>> | undefined;
  function cancel() {
    cancellation ??= Promise.resolve()
      .then(() => reader?.cancel())
      .then(
        () => Result.succeed(undefined),
        () => Result.fail(new LiveAuthorityError({ phase: 'body', code: 'Unavailable' })),
      );
    return cancellation;
  }
  function onAbort() {
    void cancel();
  }
  signal.addEventListener('abort', onAbort, { once: true });
  async function release() {
    signal.removeEventListener('abort', onAbort);
    const cancelled = await cancel();
    reader?.releaseLock();
    return cancelled;
  }
  async function read() {
    interrupted(signal, phase);
    requireGitHub(response.status === expectedStatus, phase, statusCode(response.status));
    const length = response.headers.get('content-length');
    requireGitHub(length === null || /^\d+$/.test(length), 'body', 'InvalidResponse');
    requireGitHub(length === null || Number(length) <= responseLimit, 'body', 'TooLarge');
    const owned = Option.getOrThrow(Option.fromNullishOr(reader));
    const chunks: Uint8Array[] = [];
    let size = 0;
    async function next(): Promise<void> {
      const chunk = await owned.read();
      interrupted(signal, phase);
      async function accept(value: ReadableStreamReadResult<Uint8Array>) {
        const bytes = Option.getOrThrow(Option.fromNullishOr(value.value));
        size += bytes.byteLength;
        requireGitHub(size <= responseLimit, 'body', 'TooLarge');
        chunks.push(bytes.slice());
        await next();
      }
      return Match.value(chunk).pipe(
        Match.when({ done: true }, () => undefined),
        Match.orElse(accept),
      );
    }
    await next();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decodeJson(text);
  }
  function invalid(error: unknown) {
    interrupted(signal, phase);
    const knownError = Match.instanceOf(LiveAuthorityError);
    return Match.value(error).pipe(
      Match.when(knownError, (known) => {
        throw known;
      }),
      Match.orElse(() => {
        throw new LiveAuthorityError({ phase: 'body', code: 'InvalidResponse' });
      }),
    );
  }
  const result = await Promise.resolve()
    .then(read)
    .catch(invalid)
    .then(Result.succeed, Result.fail);
  Result.match(result, { onFailure: failed, onSuccess: () => undefined });
  const cleanup = await release();
  const value = Result.getOrThrow(result);
  Result.getOrThrow(cleanup);
  return value;
}

export async function githubRequest(
  fetch: GitHubFetch,
  lifetime: AbortSignal,
  request: {
    readonly phase: Phase;
    readonly path: string;
    readonly token: string;
    readonly body?: string;
  },
  own: (settlement: Promise<void>) => void,
) {
  const attempt = new AbortController();
  const signal = AbortSignal.any([lifetime, attempt.signal]);
  const timer = setTimeout(
    () => attempt.abort(new LiveAuthorityError({ phase: request.phase, code: 'Timeout' })),
    2000,
  );
  let failed = (_error: unknown) => {};
  const primaryFailure = new Promise<never>((_resolve, reject) => {
    failed = (error) => reject(safeGitHubError(error, request.phase));
  });
  async function execute() {
    interrupted(signal, request.phase);
    const method = Match.value(request.body).pipe(
      Match.when(undefined, () => 'GET'),
      Match.orElse(() => 'POST'),
    );
    const expectedStatus = Match.value(method).pipe(
      Match.when('POST', () => 201),
      Match.orElse(() => 200),
    );
    const response = await fetch(`https://api.github.com${request.path}`, {
      method,
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'Ceirean-Local-GitHub-Ingress',
        Authorization: `Bearer ${request.token}`,
        'Content-Type': 'application/json',
      },
      body: request.body,
    });
    const value = await readResponse(response, signal, request.phase, expectedStatus, failed);
    interrupted(signal, request.phase);
    return value;
  }
  function sanitize(error: unknown) {
    interrupted(signal, request.phase);
    throw safeGitHubError(error, request.phase);
  }
  const native = Promise.resolve().then(execute).catch(sanitize);
  // Neither a deadline outcome nor a primary failure releases this ownership.
  own(
    native.then(
      () => undefined,
      () => undefined,
    ),
  );
  const outcome = Promise.race([native, primaryFailure]);
  return boundedNativeOutcome(outcome, signal, () => request.phase).finally(() =>
    clearTimeout(timer),
  );
}
