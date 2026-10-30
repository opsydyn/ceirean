import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import * as Domain from '@ceirean/domain';
import { BunServices } from '@effect/platform-bun';
import { Deferred, Effect, Fiber, Layer, Match, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { runCli } from '../src/cli.ts';
import { runManifestReport } from '../src/manifest-cli.ts';
import * as Source from '../src/manifest-git-source.ts';
import { fakeManifestSource } from './manifest-fixtures.ts';

afterEach(() => mock.restore());
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Domain.ManifestDeclarationReport));
const withClock = Effect.provide(TestClock.layer());
function fakeRead() {
  return spyOn(Source, 'readPinnedManifests').mockImplementation(() =>
    Effect.sync(fakeManifestSource),
  );
}
async function success() {
  const read = fakeRead();
  const output = await Effect.runPromise(runCli(['manifests', '--repository', '/synthetic/repo']));
  expect(output.exitCode).toBe(0);
  expect(output.stderr).toBe('');
  expect(output.stdout.split('\n')).toHaveLength(2);
  const report = decode(output.stdout);
  expect(report.coverage).toHaveLength(14);
  expect(report.provenance).toBe('LocalGitObjects');
  expect(report.commit).toBe('1183e3c067f873fdd29f14f06030515929c1b956');
  expect(read).toHaveBeenCalledTimes(1);
}
test('manifest command emits one validated pinned report with success exit zero', success);

async function invalidArguments() {
  const read = fakeRead();
  for (const argv of [
    ['manifests'],
    ['manifests', '--repository', 'relative'],
    ['manifests', '--repository', '/tmp/x\0bad'],
    ['manifests', '--repository', '/tmp/x\nbad'],
    ['manifests', '--repository', '/tmp', '--ref', 'main'],
    ['manifests', '--url', 'https://example.invalid'],
  ]) {
    expect(await Effect.runPromise(runCli(argv))).toEqual({
      exitCode: 64,
      stdout: '',
      stderr: '{"_tag":"UsageError"}\n',
    });
  }
  expect(read).not.toHaveBeenCalled();
}
test('invalid arguments refuse before source acquisition', invalidArguments);

async function sanitizedFailures() {
  spyOn(Source, 'readPinnedManifests').mockImplementation(() =>
    Effect.fail(new Source.ManifestSourceError({ code: 'SourceTooLarge' })),
  );
  expect(await Effect.runPromise(runManifestReport('/synthetic/SECRET_SENTINEL'))).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"SourceTooLarge"}\n',
  });
  spyOn(Source, 'readPinnedManifests').mockImplementation(() => Effect.die('SECRET_SENTINEL'));
  expect(await Effect.runPromise(runManifestReport('/synthetic/SECRET_SENTINEL'))).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"GitFailed"}\n',
  });
}
test('source failures and defects produce only finite sanitized failure codes', sanitizedFailures);

async function invalidReports() {
  fakeRead();
  const report = Domain.inspectManifestDocuments(fakeManifestSource()).pipe(Result.getOrThrow);
  const inspect = spyOn(Domain, 'inspectManifestDocuments');
  inspect.mockImplementation(() => Result.succeed({ ...report, secret: 'SECRET_SENTINEL' }));
  expect(await Effect.runPromise(runManifestReport('/synthetic/repo'))).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"InvalidReport"}\n',
  });
  const oversized = structuredClone(report);
  Reflect.set(
    oversized.manifests[0] ?? {},
    'dependencies',
    Array.from({ length: 100 }, (_, i) => ({
      section: 'dependencies',
      name: `p${i}`,
      declared: 'x'.repeat(4000),
      catalog: null,
    })),
  );
  inspect.mockImplementation(() => Result.succeed(oversized));
  expect(await Effect.runPromise(runManifestReport('/synthetic/repo'))).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"OutputTooLarge"}\n',
  });
  inspect.mockImplementation(() => Result.succeed({ ...report, commit: 'f'.repeat(40) }));
  expect(await Effect.runPromise(runManifestReport('/synthetic/repo'))).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"InvalidReport"}\n',
  });
}
test('invalid, oversized or wrong-baseline reports never partially emit', invalidReports);

async function deadline() {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  const state = { cleaned: false };
  const waiting = Deferred.await(release);
  const cleanup = Effect.sync(() => {
    state.cleaned = true;
  });
  const acquisition = Deferred.succeed(entered, undefined).pipe(
    Effect.andThen(waiting),
    Effect.ensuring(cleanup),
  );
  const platform = Layer.merge(BunServices.layer, Layer.effectDiscard(acquisition));
  fakeRead();
  function* scenario() {
    const fiber = yield* runManifestReport('/synthetic/repo', platform).pipe(Effect.forkScoped);
    yield* Deferred.await(entered);
    yield* TestClock.adjust(15001);
    return yield* Fiber.join(fiber);
  }
  const workflow = Effect.gen(scenario);
  const scoped = Effect.scoped(workflow);
  const output = await Effect.runPromise(scoped.pipe(withClock));
  expect(output).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"TimedOut"}\n',
  });
  expect(state.cleaned).toBe(true);
}
test('deadline encloses runtime layer acquisition and cleanup', deadline);

async function workDeadline() {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  const state = { cleaned: false };
  function* read() {
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        state.cleaned = true;
      }),
    );
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    return fakeManifestSource();
  }
  function mockedRead() {
    const workflow = Effect.gen(read);
    const scoped = Effect.scoped(workflow);
    return scoped;
  }
  spyOn(Source, 'readPinnedManifests').mockImplementation(mockedRead);
  function* scenario() {
    const fiber = yield* runManifestReport('/synthetic/repo').pipe(Effect.forkScoped);
    yield* Deferred.await(entered);
    yield* TestClock.adjust(15001);
    return yield* Fiber.join(fiber);
  }
  const workflow = Effect.gen(scenario);
  const scoped = Effect.scoped(workflow);
  const output = await Effect.runPromise(scoped.pipe(withClock));
  expect(output).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"TimedOut"}\n',
  });
  expect(state.cleaned).toBe(true);
}
test('deadline cancels report work and joins owned finalizers', workDeadline);

async function disposalDeadline() {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  const state = { cleaned: false };
  function* cleanup() {
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    state.cleaned = true;
  }
  const closing = Effect.gen(cleanup);
  const acquiring = Effect.succeed(true);
  const resource = Effect.acquireRelease(acquiring, () => closing);
  const platform = Layer.merge(BunServices.layer, Layer.effectDiscard(resource));
  fakeRead();
  function* scenario() {
    const fiber = yield* runManifestReport('/synthetic/repo', platform).pipe(Effect.forkScoped);
    yield* Deferred.await(entered);
    yield* TestClock.adjust(15001);
    expect(fiber.pollUnsafe()).toBeUndefined();
    yield* Deferred.succeed(release, undefined);
    return yield* Fiber.join(fiber);
  }
  const workflow = Effect.gen(scenario);
  const scoped = Effect.scoped(workflow);
  const output = await Effect.runPromise(scoped.pipe(withClock));
  expect(output).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"TimedOut"}\n',
  });
  expect(state.cleaned).toBe(true);
}
test(
  'cooperative deadline waits for delayed runtime disposal and emits no success',
  disposalDeadline,
);

async function outputByteBoundary() {
  fakeRead();
  const report = Domain.inspectManifestDocuments(fakeManifestSource()).pipe(Result.getOrThrow);
  const entries = Array.from({ length: 64 }, (_, i) => ({
    section: 'dependencies',
    name: `p${i}`,
    declared: 'x',
    catalog: null,
  }));
  Reflect.set(report.manifests[0] ?? {}, 'dependencies', entries);
  const encode = Schema.encodeSync(Schema.fromJsonString(Domain.ManifestDeclarationReport));
  const encoder = new TextEncoder();
  const base = `${encode(report)}\n`;
  const remaining = 262144 - encoder.encode(base).byteLength;
  const perEntry = Math.floor(remaining / entries.length);
  const remainder = remaining % entries.length;
  for (const [index, entry] of entries.entries()) {
    const extra = Match.value(index < remainder).pipe(
      Match.when(true, () => 1),
      Match.orElse(() => 0),
    );
    const bytes = 1 + perEntry + extra;
    entry.declared = `${'é'.repeat(Math.floor(bytes / 2))}${'x'.repeat(bytes % 2)}`;
  }
  spyOn(Domain, 'inspectManifestDocuments').mockImplementation(() => Result.succeed(report));
  const exact = await Effect.runPromise(runManifestReport('/synthetic/repo'));
  expect(exact.exitCode).toBe(0);
  expect(encoder.encode(exact.stdout).byteLength).toBe(262144);
  const first = entries[0];
  Reflect.set(first ?? {}, 'declared', `${first?.declared}x`);
  expect(await Effect.runPromise(runManifestReport('/synthetic/repo'))).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"OutputTooLarge"}\n',
  });
}
test(
  'output cap counts UTF-8 bytes including newline at exact limit and one byte over',
  outputByteBoundary,
);
