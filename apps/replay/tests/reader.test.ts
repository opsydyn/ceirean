import { expect, test } from 'bun:test';

import { BunFileSystem } from '@effect/platform-bun';
import { Effect, FileSystem, Result, Schema } from 'effect';

import { validDraft } from '../../../packages/domain/tests/replay-fixtures.ts';
import { readDraftProfile } from '../src/reader.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function* createFixture() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped();
  return { fs, root, path: `${root}/profile.json` };
}
function fixture() {
  const program = Effect.gen(createFixture);
  return program;
}
async function originalBytes() {
  function* scenario() {
    const { fs, path } = yield* fixture();
    const bytes = new TextEncoder().encode(`${encode(validDraft())}\n  `);
    yield* fs.writeFile(path, bytes);
    const result = yield* readDraftProfile(path);
    const expected = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const wire = encode(validDraft());
    const normalized = new Bun.CryptoHasher('sha256').update(wire).digest('hex');
    expect(expected).toBe(result.sourceDigest);
    expect(normalized).not.toBe(result.sourceDigest);
    expect(result.profile.repository.slug).toBe('opsydyn/fold-kit-experiments');
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunFileSystem.layer);
  await Effect.runPromise(provided);
}
test('reads a regular profile and hashes original bytes, not reserialization', originalBytes);

async function invalidFiles() {
  function* scenario() {
    const { fs, path, root } = yield* fixture();
    const cases = [
      { bytes: new TextEncoder().encode('{SECRET_SENTINEL'), code: 'InvalidProfile' },
      { bytes: new Uint8Array([0xff]), code: 'InvalidEncoding' },
      {
        bytes: new TextEncoder().encode(encode({ ...validDraft(), apiKey: 'SECRET_SENTINEL' })),
        code: 'InvalidProfile',
      },
      { bytes: new Uint8Array(262145), code: 'ProfileTooLarge' },
    ];
    for (const c of cases) {
      yield* fs.writeFile(path, c.bytes);
      const result = yield* readDraftProfile(path).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: 'Failure', failure: { code: c.code } });
      const diagnostic = encode(result);
      expect(diagnostic).not.toContain('SECRET_SENTINEL');
      expect(diagnostic).not.toContain(root);
      expect(diagnostic).not.toContain('ENOENT');
    }
    const missing = yield* readDraftProfile(`${root}/missing`).pipe(Effect.result);
    expect(missing).toMatchObject({ _tag: 'Failure', failure: { code: 'ReadFailed' } });
    const directory = yield* readDraftProfile(root).pipe(Effect.result);
    expect(directory).toMatchObject({ _tag: 'Failure', failure: { code: 'NotRegular' } });
    const wire = encode(validDraft());
    yield* fs.writeFileString(path, wire);
    yield* fs.symlink(path, `${root}/link`);
    const link = yield* readDraftProfile(`${root}/link`).pipe(Effect.result);
    expect(link).toMatchObject({ _tag: 'Failure', failure: { code: 'ReadFailed' } });
    yield* fs.chmod(path, 0o000);
    const unreadable = yield* readDraftProfile(path).pipe(Effect.result);
    expect(unreadable).toMatchObject({ _tag: 'Failure', failure: { code: 'ReadFailed' } });
    yield* fs.chmod(path, 0o600);
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunFileSystem.layer);
  await Effect.runPromise(provided);
}
test(
  'invalid, unreadable, missing, nonregular, symlink and oversized files fail with finite redacted codes',
  invalidFiles,
);

async function exactCap() {
  function* scenario() {
    const { fs, path } = yield* fixture();
    const text = encode(validDraft()).padEnd(262144, ' ');
    yield* fs.writeFileString(path, text);
    const atCap = yield* readDraftProfile(path).pipe(Effect.result);
    expect(Result.isSuccess(atCap)).toBe(true);
    yield* fs.writeFileString(path, `${text} `);
    const over = yield* readDraftProfile(path).pipe(Effect.result);
    expect(over).toMatchObject({ _tag: 'Failure', failure: { code: 'ProfileTooLarge' } });
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunFileSystem.layer);
  await Effect.runPromise(provided);
}
test('accepts exactly 262144 bytes and rejects one byte more', exactCap);

async function growingDescriptor() {
  function* scenario() {
    const { fs, path } = yield* fixture();
    const wire = encode(validDraft());
    yield* fs.writeFileString(path, wire);
    const requests: number[] = [];
    function grow() {
      return fs.writeFile(path, new Uint8Array(300000));
    }
    function observeFile(file: FileSystem.File) {
      const stat = file.stat.pipe(Effect.tap(grow));
      return {
        ...file,
        stat,
        readAlloc(size: number) {
          requests.push(size);
          return file.readAlloc(size);
        },
      };
    }
    function open(...args: Parameters<typeof fs.open>) {
      expect(args[1]?.noFollow).toBe(true);
      return fs.open(...args).pipe(Effect.map(observeFile));
    }
    const observed = { ...fs, open };
    const reading = readDraftProfile(path).pipe(Effect.result);
    const provided = Effect.provideService(reading, FileSystem.FileSystem, observed);
    const result = yield* provided;
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'ProfileTooLarge' } });
    expect(requests.length).toBeGreaterThan(0);
    expect(Math.max(...requests)).toBeLessThanOrEqual(262145);
    expect(requests.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(262145);
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunFileSystem.layer);
  await Effect.runPromise(provided);
}
test('a file growing after descriptor stat cannot bypass the hard read bound', growingDescriptor);

async function partialReads() {
  function* scenario() {
    const { fs, path } = yield* fixture();
    const wire = encode(validDraft());
    yield* fs.writeFileString(path, wire);
    function open(...args: Parameters<typeof fs.open>) {
      return fs.open(...args).pipe(
        Effect.map((file) => ({
          ...file,
          stat: file.stat,
          readAlloc: (size: number) => file.readAlloc(Math.min(size, 17)),
        })),
      );
    }
    const observed = { ...fs, open };
    const reading = readDraftProfile(path);
    const provided = Effect.provideService(reading, FileSystem.FileSystem, observed);
    const result = yield* provided;
    expect(result.profile.profileId).toBe('foldkit-0166-replay');
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunFileSystem.layer);
  await Effect.runPromise(provided);
}
test('short descriptor reads are accumulated until EOF', partialReads);

async function fifoBeforeOpen() {
  function* scenario() {
    const { fs, path } = yield* fixture();
    const wire = encode(validDraft());
    yield* fs.writeFileString(path, wire);
    const info = yield* fs.stat(path);
    let opens = 0;
    const fifoInfo = Effect.succeed({ ...info, type: 'FIFO' as const });
    function stat() {
      return fifoInfo;
    }
    function open(...args: Parameters<typeof fs.open>) {
      opens += 1;
      const delayed = fs.open(...args).pipe(Effect.delay('1 second'));
      return delayed;
    }
    const observed = { ...fs, stat, open };
    const reading = readDraftProfile(path).pipe(Effect.timeout('100 millis'), Effect.result);
    const provided = Effect.provideService(reading, FileSystem.FileSystem, observed);
    const result = yield* provided;
    expect(result).toMatchObject({ _tag: 'Failure', failure: { code: 'NotRegular' } });
    expect(opens).toBe(0);
  }
  const workflow = Effect.gen(scenario);
  const program = Effect.scoped(workflow);
  const provided = Effect.provide(program, BunFileSystem.layer);
  await Effect.runPromise(provided);
}
test('FIFO metadata rejects before a blocking open, within a bounded deadline', fifoBeforeOpen);
