import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';

import { packSourceFiles } from '../src/source-payload.ts';

async function preservesSource() {
  const packing = packSourceFiles([
    {
      path: 'script.sh',
      mode: '100755',
      size: 6,
      objectId: 'ce013625030ba8dba906f756967f9e9ca394464a',
      bytes: new TextEncoder().encode('hello\n'),
    },
  ]);
  const provided = Effect.provide(packing, BunServices.layer);
  const report = await Effect.runPromise(provided);
  const files = await new Bun.Archive(report.bytes).files();
  expect([...files.keys()]).toEqual(['script.sh']);
  expect(await files.get('script.sh')?.text()).toBe('hello\n');
  const modeText = new TextDecoder().decode(report.bytes.slice(100, 107));
  const mode = Number.parseInt(modeText, 8);
  expect(mode).toBe(0o755);
  expect(report.activation).toBe('Blocked');
  expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
}
test('trusted source tar contains exact bytes and retains executable mode', preservesSource);
