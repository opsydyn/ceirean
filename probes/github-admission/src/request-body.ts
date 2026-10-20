import { Digest } from '@leviathan/domain';
import { Effect, Match, Option, Schema } from 'effect';

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
  async function readCapture(runtimeSignal: AbortSignal) {
    const signals = [request.signal, runtimeSignal];
    signals.push(...Option.toArray(Option.fromNullishOr(signal)));
    const lifetime = AbortSignal.any(signals);
    function checkAbort() {
      return requireBody(!lifetime.aborted, 'Aborted');
    }
    checkAbort();
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let cancellation: Promise<void> | undefined;
    function cancel() {
      cancellation ??= reader?.cancel().catch(() => undefined);
    }
    lifetime.addEventListener('abort', cancel, { once: true });
    async function cleanup() {
      lifetime.removeEventListener('abort', cancel);
      cancel();
      await cancellation;
      reader?.releaseLock();
    }
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
    await Promise.resolve().then(read).finally(cleanup);
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
  const capture = Effect.tryPromise({ try: readCapture, catch: sanitize });
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
