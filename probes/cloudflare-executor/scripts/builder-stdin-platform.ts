import { Buffer } from 'node:buffer';
import { addAbortListener } from 'node:events';
import type { Writable } from 'node:stream';

export const MAX_STDIN_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 30_000;

const usedStreams = new WeakSet<Writable>();
const typedArrayPrototype: object = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayTag = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)!.get!;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const typedArrayOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const arrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)!.get!;
const arrayBufferResizable = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'resizable',
)?.get;

/**
 * Resolves only when this Writable emits finish; it does not attest that a child
 * read or consumed the bytes. The caller must exclusively own writes and retain
 * responsibility for the stream and its error handling, including late errors
 * after abort or timeout. Both stop observation only: writes may continue, and
 * neither retracts bytes nor destroys the stream or cleans up a child or OS
 * resources. The timeout is cooperative and may run late if the event loop is
 * blocked. A started stream is never reused.
 */
export const writeBuilderStdin = (
  stream: Writable,
  input: Uint8Array,
  signal?: AbortSignal,
  options?: { readonly timeoutMs?: number },
): Promise<void> => {
  const requestedTimeout = options?.timeoutMs;
  const timeoutMs = requestedTimeout === undefined ? DEFAULT_TIMEOUT_MS : requestedTimeout;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    return Promise.reject(new Error('stdin observation timeout must be 1 to 30000 ms'));
  }
  if (signal?.aborted) return Promise.reject(new Error('stdin write aborted'));
  if (usedStreams.has(stream)) return Promise.reject(new Error('stdin write already attempted'));
  if (stream.destroyed || stream.closed || stream.writableEnded || !stream.writable) {
    return Promise.reject(new Error('stdin is not writable'));
  }

  let cleanup = () => {};
  return new Promise<void>((resolve, reject) => {
    if (Reflect.apply(typedArrayTag, input, []) !== 'Uint8Array') {
      reject(new Error('stdin input must be a Uint8Array'));
      return;
    }
    const buffer: ArrayBuffer = Reflect.apply(typedArrayBuffer, input, []);
    const offset: number = Reflect.apply(typedArrayOffset, input, []);
    const length: number = Reflect.apply(typedArrayLength, input, []);
    // The ArrayBuffer intrinsic performs a brand check that rejects shared stores.
    Reflect.apply(arrayBufferLength, buffer, []);
    if (!arrayBufferResizable || Reflect.apply(arrayBufferResizable, buffer, [])) {
      reject(new Error('resizable stdin input is not supported'));
      return;
    }
    if (length > MAX_STDIN_BYTES) {
      reject(new Error('stdin input exceeds the bounded byte limit'));
      return;
    }
    const snapshot = Buffer.from(new Uint8Array(buffer, offset, length));
    usedStreams.add(stream);
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortListener: ReturnType<typeof addAbortListener> | undefined;
    cleanup = () => {
      stream.removeListener('finish', onFinish);
      stream.removeListener('close', onClose);
      stream.removeListener('error', onError);
      abortListener?.[Symbol.dispose]();
      if (timeout !== undefined) clearTimeout(timeout);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onFinish = () => settle();
    const onClose = () => settle(new Error('stdin closed before finish'));
    const onError = (error: Error) => settle(error);
    const onAbort = () => settle(new Error('stdin write aborted'));
    const onTimeout = () =>
      settle(
        stream.destroyed || stream.closed
          ? new Error('stdin closed before finish')
          : new Error('stdin observation timed out'),
      );

    stream.once('finish', onFinish);
    stream.once('close', onClose);
    stream.once('error', onError);
    if (signal) abortListener = addAbortListener(signal, onAbort);
    timeout = setTimeout(onTimeout, timeoutMs);
    if (signal?.aborted) onAbort();
    else {
      stream.end(snapshot);
      if (stream.destroyed || stream.closed) onClose();
    }
  }).finally(() => cleanup());
};
