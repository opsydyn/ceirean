import { expect, test } from 'bun:test';

import { BunFileSystem } from '@effect/platform-bun';
import { Data, Effect, FileSystem } from 'effect';
import { exportPKCS8, generateKeyPair, importPKCS8, jwtVerify, SignJWT } from 'jose';

async function roundtripAppJwt() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const pkcs8 = await exportPKCS8(privateKey);
  const imported = await importPKCS8(pkcs8, 'RS256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer('123456')
    .setIssuedAt(1_000)
    .setExpirationTime(1_540)
    .sign(imported);
  const verified = await jwtVerify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: '123456',
    currentDate: new Date(1_100_000),
  });
  expect(verified.protectedHeader).toEqual({ alg: 'RS256', typ: 'JWT' });
  expect(verified.payload).toEqual({ iss: '123456', iat: 1_000, exp: 1_540 });
  const unrelated = await generateKeyPair('RS256');
  await expect(
    jwtVerify(token, unrelated.publicKey, {
      algorithms: ['RS256'],
      currentDate: new Date(1_100_000),
    }),
  ).rejects.toThrow();
}

test('exact cohort imports a synthetic PKCS8 key and roundtrips an RS256 App JWT', roundtripAppJwt);

test('exact cohort rejects malformed PKCS8 rather than acquiring a signing key', async () => {
  await expect(importPKCS8('not a private key', 'RS256')).rejects.toThrow();
  await expect(
    importPKCS8('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', 'RS256'),
  ).rejects.toThrow();
});

async function protectedScopedFile() {
  function* scenario() {
    const fs = yield* FileSystem.FileSystem;
    function* ownedFiles() {
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'leviathan-compatibility-' });
      yield* fs.chmod(directory, 0o500);
      expect((yield* fs.stat(directory)).mode & 0o777).toBe(0o500);
      yield* fs.chmod(directory, 0o700);
      expect((yield* fs.stat(directory)).mode & 0o777).toBe(0o700);
      const path = `${directory}/synthetic-key`;
      const file = yield* fs.open(path, { flag: 'wx', mode: 0o600 });
      yield* file.writeAll(new TextEncoder().encode('synthetic contents only'));
      expect((yield* fs.stat(path)).mode & 0o777).toBe(0o600);
      yield* fs.chmod(path, 0o400);
      expect((yield* fs.stat(path)).mode & 0o777).toBe(0o400);
      yield* fs.chmod(path, 0o600);
      expect((yield* fs.stat(path)).mode & 0o777).toBe(0o600);
      const duplicateOpen = fs.open(path, { flag: 'wx', mode: 0o600 });
      const duplicate = yield* Effect.flip(duplicateOpen);
      expect(duplicate.reason._tag).toBe('AlreadyExists');
      expect(yield* fs.readFileString(path)).toBe('synthetic contents only');
      return directory;
    }
    const files = Effect.gen(ownedFiles);
    const directory = yield* Effect.scoped(files);
    expect(yield* fs.exists(directory)).toBe(false);
    expect(yield* fs.exists(`${directory}/synthetic-key`)).toBe(false);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, BunFileSystem.layer);
  await Effect.runPromise(provided);
}

test(
  'Bun FileSystem exclusively creates a protected file and removes its scoped directory',
  protectedScopedFile,
);

class SyntheticScopeFailure extends Data.TaggedError('SyntheticScopeFailure')<{
  readonly directory: string;
}> {}

async function failedScopeCleanup() {
  function* scenario() {
    const fs = yield* FileSystem.FileSystem;
    function* ownedFiles() {
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'leviathan-compatibility-' });
      const file = yield* fs.open(`${directory}/synthetic-key`, { flag: 'wx', mode: 0o600 });
      yield* file.writeAll(new TextEncoder().encode('synthetic failure contents'));
      return yield* Effect.fail(new SyntheticScopeFailure({ directory }));
    }
    const files = Effect.gen(ownedFiles);
    const failed = files.pipe(
      Effect.scoped,
      Effect.catchTag('PlatformError', Effect.die),
      Effect.flip,
    );
    const failure = yield* failed;
    expect(failure._tag).toBe('SyntheticScopeFailure');
    expect(yield* fs.exists(failure.directory)).toBe(false);
    expect(yield* fs.exists(`${failure.directory}/synthetic-key`)).toBe(false);
  }
  const program = Effect.gen(scenario);
  const scoped = Effect.scoped(program);
  const provided = Effect.provide(scoped, BunFileSystem.layer);
  await Effect.runPromise(provided);
}

test('Bun FileSystem removes test-owned files when their scope fails', failedScopeCleanup);
