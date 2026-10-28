import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getEventListeners, once } from 'node:events';
import { Writable } from 'node:stream';

import { MAX_STDIN_BYTES, writeBuilderStdin } from '../scripts/builder-stdin-platform';

const sink = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

function endWithError(this: Writable) {
  this.emit('error', new Error('immediate failure'));
  return this;
}

function pendingEnd(this: Writable, calls: number[]) {
  calls.push(1);
  return this;
}

test('writes a snapshot and resolves only after finish', async () => {
  let complete: (() => void) | undefined;
  let received: Buffer | undefined;
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      received = chunk;
      complete = callback;
    },
  });
  const input = new Uint8Array([1, 2, 3]);
  const controller = new AbortController();
  let settled = false;
  const result = writeBuilderStdin(stream, input, controller.signal).then(() => {
    settled = true;
  });
  input.fill(9);
  await Promise.resolve();
  expect(settled).toBe(false);
  expect([...received!]).toEqual([1, 2, 3]);
  complete!();
  await result;
  expect(stream.writableFinished).toBe(true);
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
});

test('snapshots only the real view even when its metadata properties are shadowed', async () => {
  const received: number[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      received.push(...chunk);
      callback();
    },
  });
  const input = new Uint8Array(new Uint8Array([9, 1, 2, 8]).buffer, 1, 2);
  Object.defineProperty(input, 'buffer', {
    get: () => {
      throw new Error('shadow buffer');
    },
  });
  Object.defineProperty(input, 'byteOffset', {
    get: () => {
      throw new Error('shadow offset');
    },
  });
  Object.defineProperty(input, 'byteLength', {
    get: () => {
      throw new Error('shadow length');
    },
  });
  await writeBuilderStdin(stream, input);
  expect(received).toEqual([1, 2]);
});

test('rejects oversized input without ending the stream', async () => {
  const stream = sink();
  await expect(writeBuilderStdin(stream, new Uint8Array(MAX_STDIN_BYTES + 1))).rejects.toThrow();
  expect(stream.writableEnded).toBe(false);
  stream.destroy();
});

test('does not let a shadowed byteLength bypass the input limit', async () => {
  const stream = sink();
  const input = new Uint8Array(MAX_STDIN_BYTES + 1);
  Object.defineProperty(input, 'byteLength', { get: () => 1 });
  await expect(writeBuilderStdin(stream, input)).rejects.toThrow();
  expect(stream.writableEnded).toBe(false);
  stream.destroy();
});

test('rejects shared input before writing', async () => {
  const stream = sink();
  await expect(
    writeBuilderStdin(stream, new Uint8Array(new SharedArrayBuffer(1))),
  ).rejects.toThrow();
  expect(stream.writableEnded).toBe(false);
  stream.destroy();
});

test('rejects a shared backing store even when its prototype and input properties are spoofed', async () => {
  const stream = sink();
  const shared = new SharedArrayBuffer(8);
  const input = new Uint8Array(shared);
  Object.setPrototypeOf(shared, ArrayBuffer.prototype);
  Object.defineProperty(input, 'buffer', { value: new ArrayBuffer(8) });
  await expect(writeBuilderStdin(stream, input)).rejects.toThrow();
  expect(stream.writableEnded).toBe(false);
  stream.destroy();
});

test('rejects a resizable backing store', async () => {
  const stream = sink();
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  await expect(writeBuilderStdin(stream, new Uint8Array(buffer))).rejects.toThrow();
  expect(stream.writableEnded).toBe(false);
  stream.destroy();
});

test('rejects a forged Uint8Array instance without invoking a write', async () => {
  const stream = sink();
  const input = Object.create(Uint8Array.prototype) as Uint8Array;
  await expect(writeBuilderStdin(stream, input)).rejects.toThrow();
  expect(stream.writableEnded).toBe(false);
  stream.destroy();
});

test('rejects a different typed array even with a Uint8Array prototype', async () => {
  const stream = sink();
  const input = new Uint8ClampedArray([1]);
  Object.setPrototypeOf(input, Uint8Array.prototype);
  await expect(writeBuilderStdin(stream, input as unknown as Uint8Array)).rejects.toThrow();
  expect(stream.writableEnded).toBe(false);
  stream.destroy();
});

test('rejects close before finish and preserves existing listeners', async () => {
  const stream = new Writable({ write() {} });
  const onClose = () => {};
  stream.on('close', onClose);
  const result = writeBuilderStdin(stream, new Uint8Array([1]));
  stream.destroy();
  await expect(result).rejects.toThrow();
  expect(stream.writableFinished).toBe(false);
  expect(stream.listeners('close')).toEqual([onClose]);
  expect(stream.listenerCount('finish')).toBe(0);
  expect(stream.listenerCount('error')).toBe(0);
});

test('rejects an emitted error and removes its own listeners', async () => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('write failed'));
    },
  });
  const result = writeBuilderStdin(stream, new Uint8Array([1]));
  await expect(result).rejects.toThrow('write failed');
  expect(stream.listenerCount('finish')).toBe(0);
  expect(stream.listenerCount('error')).toBe(0);
  expect(stream.listenerCount('close')).toBe(0);
});

test('rejects synchronous end throws and restores listeners', async () => {
  const stream = sink();
  stream.end = () => {
    throw new Error('end failed');
  };
  await expect(writeBuilderStdin(stream, new Uint8Array([1]))).rejects.toThrow('end failed');
  expect(stream.listenerCount('finish')).toBe(0);
  expect(stream.listenerCount('error')).toBe(0);
  expect(stream.listenerCount('close')).toBe(0);
  stream.destroy();
});

test('observes a synchronous error emitted by end', async () => {
  const stream = sink();
  stream.end = endWithError.bind(stream);
  await expect(writeBuilderStdin(stream, new Uint8Array([1]))).rejects.toThrow('immediate failure');
  stream.destroy();
});

test('abort rejects without destroying the caller-owned stream', async () => {
  let complete: (() => void) | undefined;
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      complete = callback;
    },
  });
  const controller = new AbortController();
  const result = writeBuilderStdin(stream, new Uint8Array([1]), controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(stream.destroyed).toBe(false);
  expect(stream.listenerCount('finish')).toBe(0);
  expect(stream.listenerCount('close')).toBe(0);
  expect(stream.listenerCount('error')).toBe(0);
  complete!();
  await once(stream, 'finish');
});

test('abort does not allow another attempt while the original end remains pending', async () => {
  const stream = sink();
  const calls: number[] = [];
  stream.end = pendingEnd.bind(stream, calls);
  const firstController = new AbortController();
  const first = writeBuilderStdin(stream, new Uint8Array([1]), firstController.signal);
  firstController.abort();
  await expect(first).rejects.toThrow();
  const secondController = new AbortController();
  const second = writeBuilderStdin(stream, new Uint8Array([2]), secondController.signal);
  secondController.abort();
  await expect(second).rejects.toThrow();
  expect(calls).toHaveLength(1);
  stream.destroy();
});

test('abort is observed even when an earlier listener stops immediate propagation', async () => {
  const stream = new Writable({ write() {} });
  const controller = new AbortController();
  const suppress = (event: Event) => event.stopImmediatePropagation();
  controller.signal.addEventListener('abort', suppress);
  const result = writeBuilderStdin(stream, new Uint8Array([1]), controller.signal, {
    timeoutMs: 200,
  });
  const observed = result.then(
    () => 'resolved',
    (error: Error) => error.message,
  );
  controller.abort();
  expect(await Promise.race([observed, Bun.sleep(50).then(() => 'still pending')])).toBe(
    'stdin write aborted',
  );
  expect(getEventListeners(controller.signal, 'abort')).toEqual([suppress]);
  expect(stream.listenerCount('finish')).toBe(0);
  expect(stream.listenerCount('close')).toBe(0);
  expect(stream.listenerCount('error')).toBe(0);
  stream.destroy();
});

test('a destroyed stream without a close event rejects within the observation budget', async () => {
  const stream = new Writable({ emitClose: false, write() {} });
  const controller = new AbortController();
  const result = writeBuilderStdin(stream, new Uint8Array([1]), controller.signal, {
    timeoutMs: 10,
  });
  const observed = result.then(
    () => 'resolved',
    (error: Error) => error.message,
  );
  stream.destroy();
  expect(await Promise.race([observed, Bun.sleep(100).then(() => 'still pending')])).toBe(
    'stdin closed before finish',
  );
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  expect(stream.listenerCount('finish')).toBe(0);
  expect(stream.listenerCount('close')).toBe(0);
  expect(stream.listenerCount('error')).toBe(0);
});

test('an observation timeout rejects without destroying or reusing the stream', async () => {
  const stream = new Writable({ emitClose: false, write() {} });
  const controller = new AbortController();
  const result = writeBuilderStdin(stream, new Uint8Array([1]), controller.signal, {
    timeoutMs: 10,
  });
  const observed = result.then(
    () => 'resolved',
    (error: Error) => error.message,
  );
  expect(await Promise.race([observed, Bun.sleep(100).then(() => 'still pending')])).toBe(
    'stdin observation timed out',
  );
  expect(stream.destroyed).toBe(false);
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  expect(stream.listenerCount('finish')).toBe(0);
  expect(stream.listenerCount('close')).toBe(0);
  expect(stream.listenerCount('error')).toBe(0);
  await expect(writeBuilderStdin(stream, new Uint8Array([2]))).rejects.toThrow();
  stream.destroy();
});

test('invalid observation budgets reject before ending the stream', async () => {
  for (const invalid of [0, -1, 1.5, 30001, Infinity, NaN, null, '10', true]) {
    const stream = sink();
    const timeoutMs = invalid as unknown as number;
    await expect(
      writeBuilderStdin(stream, new Uint8Array([1]), undefined, { timeoutMs }),
    ).rejects.toThrow();
    expect(stream.writableEnded).toBe(false);
    stream.destroy();
  }
});

test('late errors after abort remain the responsibility of the caller', async () => {
  let complete: ((error?: Error | null) => void) | undefined;
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      complete = callback;
    },
  });
  const errors: Error[] = [];
  stream.on('error', (error: Error) => {
    errors.push(error);
  });
  const controller = new AbortController();
  const result = writeBuilderStdin(stream, new Uint8Array([1]), controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow();
  const closed = new Promise<void>((resolve) => stream.once('close', resolve));
  complete!(new Error('late failure'));
  await closed;
  expect(errors.map((error) => error.message)).toEqual(['late failure']);
});

test('late errors after timeout remain the responsibility of the caller', async () => {
  let complete: ((error?: Error | null) => void) | undefined;
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      complete = callback;
    },
  });
  const errors: Error[] = [];
  stream.on('error', (error: Error) => {
    errors.push(error);
  });
  await expect(
    writeBuilderStdin(stream, new Uint8Array([1]), undefined, { timeoutMs: 10 }),
  ).rejects.toThrow('stdin observation timed out');
  expect(stream.destroyed).toBe(false);
  const closed = new Promise<void>((resolve) => stream.once('close', resolve));
  complete!(new Error('late timeout failure'));
  await closed;
  expect(errors.map((error) => error.message)).toEqual(['late timeout failure']);
});

test('an already aborted signal and an already closed stream reject before writing', async () => {
  const controller = new AbortController();
  controller.abort();
  const stream = sink();
  await expect(writeBuilderStdin(stream, new Uint8Array([1]), controller.signal)).rejects.toThrow();
  expect(stream.writableEnded).toBe(false);
  stream.destroy();
  await expect(writeBuilderStdin(stream, new Uint8Array([1]))).rejects.toThrow();
});

test('rejects concurrent writes to the same stream but allows independent streams', async () => {
  let complete: (() => void) | undefined;
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      complete = callback;
    },
  });
  const first = writeBuilderStdin(stream, new Uint8Array([1]));
  await expect(writeBuilderStdin(stream, new Uint8Array([2]))).rejects.toThrow();
  await writeBuilderStdin(sink(), new Uint8Array([3]));
  complete!();
  await first;
});

test('a harmless child reads the exact bytes to EOF and reports their digest', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "const {createHash}=require('node:crypto');const h=createHash('sha256');process.stdin.on('data',x=>h.update(x));process.stdin.on('end',()=>process.stdout.write(h.digest('hex')));",
    ],
    {
      env: {},
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
  const output: string[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output.push(chunk);
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  void closed.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await (async () => {
    const input = new TextEncoder().encode('bounded stdin\n');
    await writeBuilderStdin(child.stdin, input);
    expect(await closed).toBe(0);
    expect(output.join('')).toBe(createHash('sha256').update('bounded stdin\n').digest('hex'));
  })().finally(async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
});

test('/usr/bin/true closing its stdin without finish cannot be reported as success', async () => {
  const child = spawn('/usr/bin/true', [], { env: {}, stdio: ['pipe', 'ignore', 'ignore'] });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  void closed.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await (async () => {
    await expect(writeBuilderStdin(child.stdin, new Uint8Array(MAX_STDIN_BYTES))).rejects.toThrow();
    expect(await closed).toBe(0);
    expect(child.stdin.writableFinished).toBe(false);
  })().finally(async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
});
