import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';

import { runPreparationProcess } from '../src/preparation-process.ts';
import { readPinnedSource, reconstructSourceTree, sourcePins } from '../src/source-payload.ts';

function writeLoose(repository: string, oid: string, kind: string, content: Uint8Array) {
  function* write() {
    const fs = yield* FileSystem.FileSystem;
    const directory = `${repository}/objects/${oid.slice(0, 2)}`;
    yield* fs.makeDirectory(directory, { recursive: true });
    const header = Buffer.from(`${kind} ${content.length}\0`);
    const object = Buffer.concat([header, content]);
    const compressed = deflateSync(object);
    yield* fs.writeFile(`${directory}/${oid.slice(2)}`, compressed);
  }
  const workflow = Effect.gen(write);
  return workflow;
}
function* rejectsForgedTree() {
  const fs = yield* FileSystem.FileSystem;
  const repository = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-forged-git-' });
  yield* fs.makeDirectory(`${repository}/refs`);
  yield* fs.writeFileString(`${repository}/HEAD`, 'ref: refs/heads/main\n');
  yield* fs.writeFileString(
    `${repository}/config`,
    '[core]\nrepositoryformatversion = 0\nbare = true\n',
  );
  const blob = {
    objectId: 'ce013625030ba8dba906f756967f9e9ca394464a',
    bytes: Buffer.from('hello\n'),
  };
  yield* writeLoose(repository, blob.objectId, 'blob', blob.bytes);
  const tree = Buffer.concat([
    Buffer.from('100644 hello.txt\0'),
    Buffer.from(blob.objectId, 'hex'),
  ]);
  yield* writeLoose(repository, sourcePins.tree, 'tree', tree);
  const commit = Buffer.from(
    `tree ${sourcePins.tree}\nauthor Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nforged\n`,
  );
  yield* writeLoose(repository, sourcePins.revision, 'commit', commit);
  const reading = readPinnedSource(repository).pipe(Effect.result);
  const result = yield* reading;
  const treeReading = runPreparationProcess(
    '/usr/bin/git',
    ['-C', repository, 'ls-tree', '-r', sourcePins.tree],
    repository,
    repository,
  ).pipe(Effect.result);
  const treeResult = yield* treeReading;
  const treeHeader = Buffer.from(`tree ${tree.length}\0`);
  const treeObject = Buffer.concat([treeHeader, tree]);
  const validId = createHash('sha1').update(treeObject).digest('hex');
  yield* writeLoose(repository, validId, 'tree', tree);
  const validReading = runPreparationProcess(
    '/usr/bin/git',
    ['-C', repository, 'ls-tree', '-r', validId],
    repository,
    repository,
  );
  const valid = yield* validReading;
  expect(result._tag).toBe('Failure');
  expect(treeResult._tag).toBe('Failure');
  expect(new TextDecoder().decode(valid)).toContain(`${blob.objectId}\thello.txt`);
}
async function checkForgery() {
  const workflow = Effect.gen(rejectsForgedTree);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, BunServices.layer);
  await Effect.runPromise(provided);
}
test(
  'valid blob bytes under a forged pinned-tree object cannot become a trusted source payload',
  checkForgery,
);

async function bindsTreeMembership() {
  const fixture = [
    {
      path: 'test.txt',
      mode: '100644',
      objectId: '83baae61804e65cc73a7201a7252750c76066a30',
      size: 10,
    },
  ];
  const reconstruction = reconstructSourceTree(fixture);
  const provided = Effect.provide(reconstruction, BunServices.layer);
  const tree = await Effect.runPromise(provided);
  expect(tree).toBe('d8329fc1cc938780ffdd9f94e0d364e0ea74f579');
  const changed = reconstructSourceTree([{ ...fixture[0], mode: '100755' }]);
  const changedProvided = Effect.provide(changed, BunServices.layer);
  const changedTree = await Effect.runPromise(changedProvided);
  expect(changedTree).not.toBe(tree);
}
test(
  'isolated index reconstruction binds path, mode and blob membership to a known Git tree',
  bindsTreeMembership,
);
