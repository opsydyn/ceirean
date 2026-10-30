import { Console, Effect, Ref } from 'effect';

export function releaseRegistryResponse(response: Response, confirmed: Ref.Ref<boolean>) {
  const cancelling = Effect.tryPromise(() => response.body?.cancel() ?? Promise.resolve());
  const bounded = cancelling.pipe(Effect.timeout('1 second'), Effect.interruptible);
  return bounded.pipe(
    Effect.andThen(Ref.set(confirmed, true)),
    Effect.catch(() => Console.warn('{"_tag":"RegistryBodyCancellationUnconfirmed"}')),
  );
}
