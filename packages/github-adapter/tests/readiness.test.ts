import { expect, test } from 'bun:test';

import { Match } from 'effect';

import { readBoundedLine } from './readiness.ts';

function reader(chunks: ReadonlyArray<string>, close = true) {
  function start(controller: ReadableStreamDefaultController<Uint8Array>) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    const closing = Match.value(close).pipe(
      Match.when(true, () => controller.close()),
      Match.orElse(() => undefined),
    );
    void closing;
  }
  return new ReadableStream<Uint8Array>({ start }).getReader();
}
async function splitChunks() {
  const split = reader(['{"pha', 'se":"After', 'Commit"}', '\n']);
  expect(await readBoundedLine(split, () => {})).toBe('{"phase":"AfterCommit"}');
  split.releaseLock();
  const bytes = new TextEncoder().encode('é\n');
  const utf8 = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 1));
      controller.enqueue(bytes.slice(1));
      controller.close();
    },
  }).getReader();
  expect(await readBoundedLine(utf8, () => {})).toBe('é');
  utf8.releaseLock();
}
test('M3 readiness accumulates split JSON and split UTF-8 through newline', splitChunks);
async function boundedBytes() {
  const eof = reader(['OWN']);
  await expect(readBoundedLine(eof, () => {})).rejects.toMatchObject({ reason: 'Eof', bytes: 3 });
  eof.releaseLock();
  const oversized = reader(['a'.repeat(4097), '\n']);
  await expect(readBoundedLine(oversized, () => {})).rejects.toMatchObject({
    reason: 'TooLarge',
    bytes: 4097,
  });
  oversized.releaseLock();
}
test('M3 readiness refuses EOF without newline and byte overflow', boundedBytes);
async function watchdog() {
  const pending = reader([], false);
  let fired = false;
  await expect(
    readBoundedLine(
      pending,
      () => {
        fired = true;
      },
      10,
    ),
  ).rejects.toMatchObject({ reason: 'Timeout', bytes: 0 });
  expect(fired).toBe(true);
  pending.releaseLock();
}
test('M3 readiness watchdog bounds an unclosed pipe', watchdog);
