import { Resolver } from 'node:dns/promises';
import { createConnection } from 'node:net';

import { Result, Schema } from 'effect';

export const NetworkObservation = Schema.Union([
  Schema.TaggedStruct('Connected', {}),
  Schema.TaggedStruct('Rejected', { code: Schema.String }),
]);
const ErrorCode = Schema.Struct({ code: Schema.String });
const decodeCode = Schema.decodeUnknownResult(ErrorCode);
export function networkRejection(error: unknown) {
  const code = Result.match(decodeCode(error), {
    onSuccess: (value) => value.code,
    onFailure: () => 'Unexpected',
  });
  return { _tag: 'Rejected' as const, code };
}
const connected = () => ({ _tag: 'Connected' as const });
// These are negative measurements only. No caller can choose a resolver, host,
// port, payload or timeout, and ordinary tests never invoke these operations.
export async function probeFixedDns(signal: AbortSignal) {
  signal.throwIfAborted();
  const resolver = new Resolver({ timeout: 1000, tries: 1 });
  resolver.setServers(['1.1.1.1']);
  const cancel = () => resolver.cancel();
  const timer = setTimeout(cancel, 3000);
  signal.addEventListener('abort', cancel, { once: true });
  const result = await resolver.resolve4('example.com').then(connected, networkRejection);
  clearTimeout(timer);
  signal.removeEventListener('abort', cancel);
  resolver.cancel();
  return result;
}
export function probeFixedTcp(signal: AbortSignal) {
  signal.throwIfAborted();
  const result = new Promise<typeof NetworkObservation.Type>((resolve) => {
    const socket = createConnection({ host: '1.1.1.1', port: 443 });
    const timer = setTimeout(() => finish({ _tag: 'Rejected', code: 'Timeout' }), 3000);
    const abort = () => finish({ _tag: 'Rejected', code: 'Aborted' });
    signal.addEventListener('abort', abort, { once: true });
    function finish(value: typeof NetworkObservation.Type) {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    }
    socket.once('connect', () => finish(connected()));
    socket.once('error', (error) => finish(networkRejection(error)));
  });
  return result;
}
