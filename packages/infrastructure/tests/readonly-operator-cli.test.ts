import { expect, test } from 'bun:test';

const entrypoint = new URL('../src/readonly/operator/main.ts', import.meta.url).pathname;

async function disabledProcess() {
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', entrypoint, 'probe'],
    {
      env: {
        CF_TOKEN: 'SECRET must never be used',
        CEIREAN_OPERATOR_POLICY_FILE: '/SECRET/no-policy',
      },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5000,
    },
  );
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  expect({ exitCode, stdout, stderr }).toEqual({
    exitCode: 2,
    stdout: '',
    stderr: '{"_tag":"OperatorRefused","code":"Disabled"}\n',
  });
}
test(
  'actual CLI defaults to disabled without reading policy or credentials',
  disabledProcess,
  7000,
);

async function rejectsBeforeSyntheticGuard() {
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', entrypoint, 'probe', '--target=other'],
    {
      env: { CEIREAN_OPERATOR_PREVIEW: 'approved', CF_TOKEN: 'SECRET not a real token' },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5000,
    },
  );
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  expect({ exitCode, stdout, stderr }).toEqual({
    exitCode: 64,
    stdout: '',
    stderr: '{"_tag":"OperatorRefused","code":"Usage"}\n',
  });
}
test(
  'actual CLI rejects target selectors before evaluating a guard',
  rejectsBeforeSyntheticGuard,
  7000,
);
