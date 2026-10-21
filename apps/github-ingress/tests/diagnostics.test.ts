import { expect, test } from 'bun:test';

import { LiveAuthorityErrorCode, LiveAuthorityPhase } from '@ceirean/engine';
import { Arbitrary, Cause, Effect, Schema } from 'effect';

import { runCli } from '../src/cli.ts';
import { operationalDiagnostic } from '../src/diagnostics.ts';
import { argv, initialize, withFixture, type Fixture } from './fixtures.ts';

const phases = ['installation', 'token', 'repository', 'user', 'permission'] as const;
const ChildOutput = Schema.Struct({
  status: Schema.Number,
  calls: Schema.Number,
  elapsedMs: Schema.Number,
  body: Schema.Struct({
    _tag: Schema.String,
    code: Schema.String,
    correlationId: Schema.String,
  }),
});
const ChildOutputJson = Schema.fromJsonString(ChildOutput);
const decodeOutput = Schema.decodeUnknownSync(ChildOutputJson);
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const cases = [
  ...phases.map((phase, index) => ({ phase, index, stalled: false })),
  { phase: 'installation', index: 0, stalled: true },
];
for (const { index, phase, stalled } of cases) {
  async function exercise(fixture: Fixture) {
    await initialize(fixture);
    const child = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '--no-install',
        `${import.meta.dir}/diagnostic-child.ts`,
        fixture.root,
        String(index + 1),
        String(stalled),
      ],
      { env: {}, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    );
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    const outputText = await stdout;
    const output = decodeOutput(outputText);
    const diagnosticText = await stderr;
    const lines = diagnosticText.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const diagnostic = decodeJson(lines[0]);
    expect(output.status).toBe(503);
    expect(output.elapsedMs).toBeLessThan(1000);
    expect(output.calls).toBe(index + 1);
    expect(output.body).toEqual({
      _tag: 'IngressFailure',
      code: 'OperationalFailure',
      correlationId: expect.any(String),
    });
    expect(diagnostic).toEqual({
      _tag: 'IngressOperationalFailure',
      source: 'Authority',
      phase,
      code: 'Denied',
      correlationId: output.body.correlationId,
    });
    expect(output.body.correlationId).toMatch(/^[a-f0-9-]{36}$/);
    for (const value of [
      'sensitive-response-must-not-leak',
      'synthetic-token',
      'PRIVATE KEY',
      'authorization',
      'stack',
      fixture.root,
    ]) {
      expect(diagnosticText).not.toContain(value);
      expect(outputText).not.toContain(value);
    }
    const status = await runCli(argv(fixture, 'status'), { host: fixture.host, silent: true });
    expect(status.output).toMatchObject({
      decisions: 0,
      receipts: 0,
      evidence: 0,
      authorityRevisions: 1,
    });
  }
  test(`offline ${phase} failure, stalled stderr ${stalled}, retains only local finite diagnostics and no admission`, () =>
    Effect.runPromise(withFixture(exercise)));
}

function authorityProjectionLaw({
  phase,
  code,
  extra,
}: {
  phase: typeof LiveAuthorityPhase.Type;
  code: typeof LiveAuthorityErrorCode.Type;
  extra: string;
}) {
  const correlationId = crypto.randomUUID();
  const cause = Cause.fail({
    _tag: 'LiveAuthorityError',
    phase,
    code,
    message: extra,
    stack: extra,
    token: extra,
    headers: { Authorization: extra },
  });
  const diagnostic = operationalDiagnostic(cause, correlationId);
  expect(diagnostic).toEqual({
    _tag: 'IngressOperationalFailure',
    correlationId,
    source: 'Authority',
    phase,
    code,
  });
  return true;
}
async function redactionLaw() {
  const input = Arbitrary.all({
    phase: Arbitrary.schema(LiveAuthorityPhase),
    code: Arbitrary.schema(LiveAuthorityErrorCode),
    extra: Arbitrary.schema(Schema.String),
  });
  const result = await Effect.runPromise(
    Arbitrary.checkEffect(input, authorityProjectionLaw, {
      seed: 503,
      runs: 100,
      size: 50,
      maxShrinks: 1000,
      maxDiscards: 100,
    }),
  );
  expect(result._tag).toBe('Passed');
}
test(
  'diagnostic projection drops arbitrary extras for every finite authority phase and code',
  redactionLaw,
);

function unknownFailures() {
  const correlationId = crypto.randomUUID();
  const unknown = {
    _tag: 'IngressOperationalFailure',
    correlationId,
    source: 'Unknown',
    code: 'UnexpectedFailure',
  } as const;
  const defect = Cause.die(new Error('sensitive-native-error'));
  const forged = Cause.fail({
    _tag: 'LiveAuthorityError',
    phase: 'secret-phase',
    code: 'secret-code',
  });
  const inbox = Cause.fail({
    _tag: 'LiveInboxError',
    operation: 'commit',
    code: 'Busy',
    token: 'secret',
  });
  expect(operationalDiagnostic(defect, correlationId)).toEqual(unknown);
  expect(operationalDiagnostic(forged, correlationId)).toEqual(unknown);
  expect(operationalDiagnostic(inbox, correlationId)).toEqual({
    _tag: 'IngressOperationalFailure',
    correlationId,
    source: 'Inbox',
    operation: 'commit',
    code: 'Busy',
  });
}
test('diagnostic projection never prints defects or forged finite error fields', unknownFailures);
