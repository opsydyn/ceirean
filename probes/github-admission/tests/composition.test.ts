import { Database } from 'bun:sqlite';
import { afterEach, expect, spyOn, test } from 'bun:test';

import { ManagedRuntime, Match, Struct } from 'effect';

import { openAdmissionProbe } from '../src/composition.ts';
import { authorityFixture } from '../src/fixture.ts';
import { cleanFiles, fileFixture } from './native-files.test.ts';

afterEach(cleanFiles);
function options() {
  return {
    file: fileFixture(),
    create: true,
    secret: 'synthetic-lifetime-secret',
    ingressScopeId: 'fixture-app',
    initialAuthority: authorityFixture().state,
    limits: { decisions: 256, receipts: 1024, authorityRevisions: 256 },
    nowMs: () => 1000,
  };
}
async function ownedRuntime() {
  const make = spyOn(ManagedRuntime, 'make');
  const close = spyOn(Database.prototype, 'close');
  const app = await openAdmissionProbe(options());
  await app.dispose();
  await app.dispose();
  expect(make).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect((await app.fetch(new Request('http://ceirean.invalid/webhook'))).status).toBe(503);
  make.mockRestore();
  close.mockRestore();
}
test(
  'one runtime and native handle are acquired once and disposed once; late calls fail',
  ownedRuntime,
);
async function combinedFailure() {
  const config = options();
  const initialAuthority = Struct.evolve(config.initialAuthority, {
    ingressScopeId: () => 'wrong-scope',
  });
  const fault = () => {
    throw new TypeError('private acquisition cleanup exception');
  };
  const failure = await openAdmissionProbe({ ...config, initialAuthority, fault }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({
    _tag: 'ProbeLifecycleError',
    phase: 'Acquire',
    issues: expect.arrayContaining([
      { operation: 'open', code: 'InvalidData' },
      { operation: 'close', code: 'CloseFailed' },
    ]),
  });
  expect(String(failure)).not.toContain('private acquisition cleanup exception');
}
test(
  'acquisition and initialization cleanup failures retain sanitized primary and teardown evidence',
  combinedFailure,
);
async function disposalFailure() {
  const config = options();
  function fault(point: string) {
    return Match.value(point).pipe(
      Match.when('Close', () => {
        throw new TypeError('private close failure');
      }),
      Match.orElse(() => undefined),
    );
  }
  const app = await openAdmissionProbe({ ...config, fault });
  const first = app.dispose();
  expect(app.dispose()).toBe(first);
  const failure = await first.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({
    _tag: 'ProbeLifecycleError',
    phase: 'Dispose',
    issues: [{ operation: 'close', code: 'CloseFailed' }],
  });
  expect(String(failure)).not.toContain('private close failure');
}
test('dispose failure stays observable and idempotent without raw exception text', disposalFailure);
