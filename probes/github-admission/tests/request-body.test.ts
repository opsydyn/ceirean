import { expect, spyOn, test } from 'bun:test';

import { Digest } from '@leviathan/domain';
import { Effect, Result } from 'effect';

import { captureRequestBody } from '../src/request-body.ts';

function request(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request('http://leviathan.invalid/webhook', { method: 'POST', body, signal });
}
async function runCapture(input: Request) {
  const program = captureRequestBody(input, 65536).pipe(Effect.result);
  const result = await Effect.runPromise(program);
  expect(input.body?.locked).toBe(false);
  return result;
}
async function exactLimit() {
  const bytes = new Uint8Array(65536).fill(65);
  const original = request(
    new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
  );
  const captured = Result.getOrThrow(await runCapture(original));
  const hashed = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const digest = Array.from(hashed, (b) => b.toString(16).padStart(2, '0')).join('');
  expect(captured.bytes).toEqual(bytes);
  expect(captured.digest).toBe(Digest.make(digest));
  expect(original.body?.locked).toBe(false);
}
test('exact byte limit hashes original bytes and releases lock', exactLimit);
async function overflow() {
  let cancelled = 0;
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(65536));
      c.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled++;
    },
  });
  const original = request(body);
  const result = await runCapture(original);
  expect(result).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'RequestBodyError', code: 'TooLarge' },
  });
  expect(cancelled).toBe(1);
  expect(body.locked).toBe(false);
}
test('streamed overflow cancels and releases reader', overflow);
async function readFailure() {
  const body = new ReadableStream({
    pull(c) {
      c.error(new Error('private read failure'));
    },
  });
  const result = await runCapture(request(body));
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'ReadFailed' } });
  expect(body.locked).toBe(false);
  expect(Result.isFailure(result)).toBe(true);
}
test('stream rejection is sanitized and reader lock released', readFailure);
async function abortRead() {
  let cancelled = 0;
  const entered = Promise.withResolvers<void>();
  const controller = new AbortController();
  const body = new ReadableStream({
    pull() {
      entered.resolve();
    },
    cancel() {
      cancelled++;
    },
  });
  const pending = runCapture(request(body, controller.signal));
  await entered.promise;
  controller.abort();
  expect(await pending).toMatchObject({ _tag: 'Failure', failure: { code: 'Aborted' } });
  expect(cancelled).toBe(1);
  expect(body.locked).toBe(false);
}
test('abort during pending read cancels and releases reader', abortRead);
async function digestFailure() {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([1]));
      c.close();
    },
  });
  const digest = spyOn(crypto.subtle, 'digest').mockImplementation(() =>
    Promise.reject(new TypeError('private digest exception')),
  );
  const result = await runCapture(request(body)).finally(() => digest.mockRestore());
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'DigestFailed' } });
}
test('digest failure is sanitized after releasing body reader', digestFailure);
