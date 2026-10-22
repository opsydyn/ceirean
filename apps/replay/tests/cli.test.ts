import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import * as Domain from '@ceirean/domain';
import { Effect, Result, Schema } from 'effect';

import { runCli } from '../src/cli.ts';
import * as Reader from '../src/reader.ts';

afterEach(() => mock.restore());
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
async function validInspection() {
  const output = await Effect.runPromise(runCli(['inspect']));
  expect(output.exitCode).toBe(2);
  expect(output.stderr).toBe('');
  expect(output.stdout.split('\n')).toHaveLength(2);
  const report = decode(output.stdout);
  expect(report).toMatchObject({
    _tag: 'InspectionReport',
    profileOrigin: 'UnverifiedWorkingTree',
    report: {
      _tag: 'Blocked',
      canExecute: false,
      repository: { slug: 'opsydyn/fold-kit-experiments' },
      blockers: [
        'ProfileRevisionUnverified',
        'HostUnqualified',
        'ImageUnqualified',
        'ToolchainUnqualified',
        'AcceptanceUnqualified',
        'ExecutionUnapproved',
        'ModelPolicyUnapproved',
      ],
    },
  });
  expect(new TextEncoder().encode(output.stdout).byteLength).toBeLessThanOrEqual(16384);
}
test('valid draft produces one bounded JSON line and expected blocked exit 2', validInspection);

async function argsBeforeRead() {
  const read = spyOn(Reader, 'readDraftProfile');
  for (const args of [
    [],
    ['run'],
    ['inspect', '--profile', 'SECRET_SENTINEL'],
    ['inspect', '--api-key', 'SECRET_SENTINEL'],
    ['inspect', 'extra'],
  ]) {
    const output = await Effect.runPromise(runCli(args));
    expect(output).toEqual({ exitCode: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
  }
  expect(read).not.toHaveBeenCalled();
  await Effect.runPromise(runCli(['inspect']));
  expect(read).toHaveBeenCalledTimes(1);
}
test('unsupported modes and flags reject before any reader call', argsBeforeRead);

async function redactedReadFailure() {
  const read = Reader.readDraftProfile;
  spyOn(Reader, 'readDraftProfile').mockImplementation(() =>
    read('/synthetic/SECRET_SENTINEL/missing'),
  );
  const output = await Effect.runPromise(runCli(['inspect']));
  expect(output).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"InspectionFailed","code":"ReadFailed"}\n',
  });
}
test('read failures emit only a finite code, never paths or native errors', redactedReadFailure);

async function invalidReport() {
  const inspect = Domain.inspectReplayRequest;
  function changeReport(report: Domain.ReplayInspection) {
    Reflect.set(report.checkIds, '0', 'SECRET_SENTINEL'.repeat(3000));
    return report;
  }
  function oversized(...args: Parameters<typeof inspect>) {
    return inspect(...args).pipe(Result.map(changeReport));
  }
  spyOn(Domain, 'inspectReplayRequest').mockImplementation(oversized);
  const output = await Effect.runPromise(runCli(['inspect']));
  expect(output).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"InspectionFailed","code":"InvalidReport"}\n',
  });
}
test(
  'oversized or malformed internal reports fail without partial JSON or raw contents',
  invalidReport,
);
