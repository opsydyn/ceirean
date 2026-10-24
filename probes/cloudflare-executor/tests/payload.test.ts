import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Result, Schema } from 'effect';

import { inspectSourceFiles } from '../src/payload.ts';

const file = {
  path: 'script.sh',
  mode: '100755',
  objectId: 'ce013625030ba8dba906f756967f9e9ca394464a',
  size: 6,
  bytes: new TextEncoder().encode('hello\n'),
};
test('source inspection binds bytes, preserves executable metadata and remains blocked', async () => {
  const report = await Effect.runPromise(inspectSourceFiles([file]));
  expect(report).toMatchObject({
    activation: 'Blocked',
    files: [{ path: 'script.sh', mode: '100755', size: 6 }],
  });
});
test('tracked Astro catch-all route names are preserved literally', async () => {
  const report = await Effect.runPromise(
    inspectSourceFiles([{ ...file, path: 'src/pages/[...path].astro' }]),
  );
  expect(report.files[0]?.path).toBe('src/pages/[...path].astro');
});

for (const [name, files] of [
  ['changed blob', [{ ...file, bytes: new TextEncoder().encode('other\n') }]],
  ['wrong size', [{ ...file, size: 5 }]],
  ['empty source', []],
  ['duplicate path', [file, file]],
  ['secret name', [{ ...file, path: '.env' }]],
  ['traversal', [{ ...file, path: '../script.sh' }]],
  ['symlink mode', [{ ...file, mode: '120000' }]],
  ['file parent', [file, { ...file, path: 'script.sh/child' }]],
] as const) {
  test(`source preparation refuses ${name}`, async () => {
    const result = await Effect.runPromise(inspectSourceFiles(files).pipe(Effect.result));
    expect(result._tag).toBe('Failure');
  });
}

function mutationLaw(seed: number) {
  async function run() {
    const Byte = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }));
    const inputs = Arbitrary.schema(Byte);
    function mutationFails(byte: number) {
      const changed = { ...file, bytes: new Uint8Array([...file.bytes, byte]), size: 7 };
      const workflow = inspectSourceFiles([changed]);
      return workflow.pipe(Effect.result, Effect.map(Result.isFailure));
    }
    const law = Arbitrary.checkEffect(inputs, mutationFails, { seed, runs: 100, maxShrinks: 100 });
    const result = await Effect.runPromise(law);
    expect(result).toMatchObject({ _tag: 'Passed', runs: 100 });
  }
  return run;
}
for (const seed of [0, 1, 163])
  test(`changed byte cannot retain a Git blob identity; seed ${seed}`, mutationLaw(seed));
