import { expect, test } from 'bun:test';

import { Schema } from 'effect';

const JsonFrame = Schema.fromJsonString(Schema.Unknown);
const decodeFrame = Schema.decodeUnknownSync(JsonFrame);

const script = new URL('../scripts/current-baseline-worker.ts', import.meta.url).pathname;
async function invoke(args: readonly string[]) {
  const child = Bun.spawn([process.execPath, '--no-env-file', '--no-install', script, ...args], {
    cwd: '/tmp',
    env: { PATH: '/usr/bin:/bin', HOME: '/tmp' },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10000,
  });
  const code = await child.exited;
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}
async function checksPreparation() {
  const output = await invoke(['--check']);
  expect(output.code).toBe(2);
  expect(decodeFrame(output.stdout)).toEqual({
    _tag: 'CurrentWorkerPrepared',
    activation: 'Blocked',
    execution: 'Disabled',
    sourceSha: 'be0427e2aba2cf951ef4dbbbe9296e307ed41ad3',
    requiredChecks: 16,
    browserCases: 4,
  });
  expect(output.stderr).toBe('');
}
test('worker check emits preparation facts only from an unrelated cwd', checksPreparation);
test('worker entry refuses native execution before touching the fixed runtime paths', async () => {
  expect(await invoke(['--worker'])).toEqual({
    code: 1,
    stdout: '',
    stderr:
      '{"_tag":"CurrentBaselineIncomplete","activation":"Blocked","reason":"AdmissionUnavailable"}\n',
  });
});
for (const args of [
  [],
  ['--approved'],
  ['--worker', '--approved'],
  ['--worker', '--source', '/tmp'],
]) {
  test(`worker has no CLI activation or source override: ${args}`, async () => {
    expect(await invoke(args)).toEqual({ code: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' });
  });
}
