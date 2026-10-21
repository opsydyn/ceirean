import { Digest } from '@ceirean/domain';
import { Effect, Match, Option, Result, Schema } from 'effect';

export class RequestBodyError extends Schema.TaggedError<RequestBodyError>()('RequestBodyError', {
  code: Schema.Literals(['TooLarge', 'ReadFailed', 'Aborted', 'DigestFailed']),
}) {}

function requireBody(condition: boolean, code: RequestBodyError['code']) {
  return Match.value(condition).pipe(
    Match.when(false, () => {
      throw new RequestBodyError({ code });
    }),
    Match.orElse(() => undefined),
  );
}

export function captureRequestBody(request: Request, limit: number, signal?: AbortSignal) {
  function acquireReader() {
    const reader = request.body?.getReader();
    let lifetime: AbortSignal | undefined;
    let cancellation: Promise<Result.Result<void, RequestBodyError>> | undefined;
    function cancel() {
      cancellation ??= Promise.resolve()
        .then(() => reader?.cancel())
        .then(
          () => Result.succeed(undefined),
          () => Result.fail(new RequestBodyError({ code: 'ReadFailed' })),
        );
      return cancellation;
    }
    function onAbort() {
      void cancel();
    }
    function listen(runtimeSignal: AbortSignal) {
      const signals = [request.signal, runtimeSignal];
      signals.push(...Option.toArray(Option.fromNullishOr(signal)));
      lifetime = AbortSignal.any(signals);
      lifetime.addEventListener('abort', onAbort, { once: true });
      return lifetime;
    }
    function releaseLock() {
      lifetime?.removeEventListener('abort', onAbort);
      reader?.releaseLock();
    }
    return { reader, cancel, listen, releaseLock };
  }
  function useReader(owned: ReturnType<typeof acquireReader>) {
    async function readCapture(runtimeSignal: AbortSignal) {
      const lifetime = owned.listen(runtimeSignal);
      function checkAbort() {
        return requireBody(!lifetime.aborted, 'Aborted');
      }
      checkAbort();
      const reader = owned.reader;
      const chunks: Uint8Array[] = [];
      let total = 0;
      async function readNext(owned: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
        const next = await owned.read();
        checkAbort();
        async function accept({ value }: ReadableStreamReadResult<Uint8Array>) {
          const chunk = Option.getOrThrow(Option.fromNullishOr(value));
          total += chunk.byteLength;
          requireBody(total <= limit, 'TooLarge');
          chunks.push(chunk.slice());
          await readNext(owned);
        }
        return Match.value(next).pipe(
          Match.when({ done: true }, () => undefined),
          Match.orElse(accept),
        );
      }
      function read() {
        requireBody(Number.isSafeInteger(limit) && limit >= 0, 'TooLarge');
        return Option.match(Option.fromNullishOr(reader), {
          onNone: () => Promise.resolve(),
          onSome: readNext,
        });
      }
      await read();
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const hashed = await crypto.subtle.digest('SHA-256', bytes).catch(() => {
        throw new RequestBodyError({ code: 'DigestFailed' });
      });
      checkAbort();
      const hex = Array.from(new Uint8Array(hashed), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      return { bytes, digest: Digest.make(hex) };
    }
    const captured = Effect.tryPromise({ try: readCapture, catch: sanitize });
    return captured;
  }
  function releaseReader(owned: ReturnType<typeof acquireReader>) {
    function* release() {
      const cancelled = yield* Effect.promise(owned.cancel);
      const unlocked = yield* Effect.try({
        try: owned.releaseLock,
        catch: () => new RequestBodyError({ code: 'ReadFailed' }),
      }).pipe(Effect.result);
      yield* Effect.fromResult(cancelled);
      yield* Effect.fromResult(unlocked);
    }
    const cleanup = Effect.gen(release);
    return cleanup;
  }
  const acquisition = Effect.try({ try: acquireReader, catch: sanitize });
  const capture = Effect.acquireUseRelease(acquisition, useReader, releaseReader);
  function sanitize(error: unknown) {
    const code = Match.value(request.signal.aborted || signal?.aborted).pipe(
      Match.when(true, () => 'Aborted' as const),
      Match.orElse(() => 'ReadFailed' as const),
    );
    const knownError = Match.instanceOf(RequestBodyError);
    return Match.value(error).pipe(
      Match.when(knownError, (known) => known),
      Match.orElse(() => new RequestBodyError({ code })),
    );
  }
  return capture;
}
export type CapturedBody = Effect.Success<ReturnType<typeof captureRequestBody>>;
