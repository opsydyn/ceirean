import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcessSpawner } from 'effect/process';

import { runCli, serializeReport } from '../src/cli.ts';
import { PreflightReport } from '../src/contracts.ts';
import { collectHostObservations } from '../src/host-observations.ts';
import { HostReadError } from '../src/host-reader.ts';
import { productionDependencies } from '../src/main.ts';
import { inspectHost } from '../src/preflight.ts';

function fixture() {
  const calls: unknown[] = [];
  const text = ['runtime: docker', 'mounts: []', 'forwardAgent: false', ''].join('\n');
  const reader = {
    readRegular: () =>
      Effect.succeed({
        text,
        bytes: new TextEncoder().encode(text),
        truncated: false as const,
        observedAtMs: 1,
      }),
    runVersion: () =>
      Effect.fail(new HostReadError({ code: 'UnsupportedSemantics', truncated: false })),
  };
  const dependencies = {
    collectHost: (home: string) => {
      calls.push({ home });
      const program = Effect.succeed({
        architecture: 'arm64' as const,
        totalMemoryBytes: 100000,
        freeMemoryBytes: 50000,
        cpuCount: 8,
      });
      return program;
    },
    makeReader: (root: string, home: string) => {
      calls.push({ root, home });
      return reader;
    },
    inspect: inspectHost,
  };
  return { calls, dependencies };
}
const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(PreflightReport), {
  onExcessProperty: 'error',
});

async function usage() {
  const f = fixture();
  for (const argv of [
    [],
    ['activate'],
    ['preflight'],
    ['preflight', '--config', 'relative'],
    ['preflight', '--config', '/tmp/x/ceirean/colima.yaml', '--unsafe'],
    ['preflight', '--config=/tmp/x/ceirean/colima.yaml'],
    ['preflight', '--config', '/tmp/x/../ceirean/colima.yaml'],
    ['preflight', '--config', '/tmp/x/wrong.yaml'],
  ]) {
    const program = runCli(argv, f.dependencies);
    const provided = Effect.provide(program, BunServices.layer);
    const output = await Effect.runPromise(provided);
    expect(output).toEqual({ exitCode: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
  }
  expect(f.calls).toEqual([]);
}
test('usage errors including activate perform zero dependency calls', usage);

async function report() {
  const f = fixture();
  const program = runCli(
    ['preflight', '--config', '/private/tmp/owned/ceirean/colima.yaml'],
    f.dependencies,
  );
  const provided = Effect.provide(program, BunServices.layer);
  const output = await Effect.runPromise(provided);
  expect(output.exitCode).toBe(2);
  expect(output.stderr).toBe('');
  expect(decodeReport(output.stdout)).toMatchObject({
    canExecuteReplay: false,
    nativeReadiness: 'Unqualified',
    config: { proposedEndpoint: { endpoint: 'unix:///private/tmp/owned/ceirean/docker.sock' } },
    host: { cpuCount: { _tag: 'Known', value: 8 } },
  });
  const home = (f.calls[0] as { home: string }).home;
  expect(home).toStartWith('/private/tmp/ceirean-preflight-home-');
  expect(f.calls).toEqual([{ home }, { root: '/private/tmp/owned', home }]);
  const filesystem = Effect.provide(FileSystem.FileSystem, BunServices.layer);
  const fs = await Effect.runPromise(filesystem);
  expect(await Effect.runPromise(fs.exists(home))).toBe(false);
}
test('one config-derived root binds reader and InspectRequest; valid report exits 2', report);

async function failures() {
  const f = fixture();
  const homes: string[] = [];
  function collectHost(home: string) {
    homes.push(home);
    const program = Effect.die('PRIVATE_DIAGNOSTIC');
    return program;
  }
  const dependencies = { ...f.dependencies, collectHost };
  const program = runCli(['preflight', '--config', '/tmp/owned/ceirean/colima.yaml'], dependencies);
  const provided = Effect.provide(program, BunServices.layer);
  expect(await Effect.runPromise(provided)).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"PreflightFailed","code":"CollectionFailed"}\n',
  });
  const filesystem = Effect.provide(FileSystem.FileSystem, BunServices.layer);
  const fs = await Effect.runPromise(filesystem);
  expect(homes.length).toBe(1);
  expect(await Effect.runPromise(fs.exists(homes[0]!))).toBe(false);
  for (const value of [{ raw: 'PRIVATE_DIAGNOSTIC' }, { raw: 'x'.repeat(262144) }]) {
    const result = await Effect.runPromise(serializeReport(value));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('PRIVATE_DIAGNOSTIC');
  }
  expect((await Effect.runPromise(serializeReport({ raw: 'x'.repeat(262144) }))).stderr).toContain(
    'OutputTooLarge',
  );
}
test(
  'collection/strict encoding failures and excessive serialized output fail finitely without partial JSON',
  failures,
);

async function exactOutputCap() {
  for (const [length, code] of [
    [262141, 'InvalidReport'],
    [262142, 'OutputTooLarge'],
  ] as const) {
    const result = await Effect.runPromise(serializeReport('x'.repeat(length)));
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(code);
  }
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const result = await Effect.runPromise(serializeReport(cyclic));
  expect(result).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"PreflightFailed","code":"InvalidReport"}\n',
  });
}
test(
  'serialized byte cap includes newline and encoding cycles fail without stacks',
  exactOutputCap,
);

async function productionGuards() {
  function* scenario() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    let calls = 0;
    function spawn() {
      calls += 1;
      const program = Effect.die('INSTALLED_CLIENT_MUST_NOT_RUN');
      return program;
    }
    const reader = productionDependencies.makeReader('/private/tmp/owned', '/private/tmp/home');
    for (const tool of ['Colima', 'Docker'] as const) {
      const reading = reader.runVersion(tool).pipe(Effect.result);
      const result = yield* Effect.provideService(
        reading,
        ChildProcessSpawner.ChildProcessSpawner,
        { ...spawner, spawn },
      );
      expect(result).toMatchObject({ failure: { code: 'UnsupportedSemantics' } });
    }
    expect(calls).toBe(0);
    expect(productionDependencies.collectHost).toBe(collectHostObservations);
    expect(productionDependencies.inspect).toBe(inspectHost);
  }
  const program = Effect.gen(scenario);
  const provided = Effect.provide(program, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'production uses actual collector but blocks unreviewed installed clients before any execution',
  productionGuards,
);
