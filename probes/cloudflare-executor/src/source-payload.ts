import { Effect, FileSystem, Match, Schema } from 'effect';

import { digestBytes, inspectSourceFiles, requirePayload } from './payload.ts';
import { runPreparationProcess } from './preparation-process.ts';
import { validateSourceInventory } from './preparation.ts';

export const sourcePins = {
  revision: 'b7484cb46e66b162c8afddcfba235c9507b4f0ab',
  tree: '8fcd5b7960541679a163dcbfbf60393e1e256241',
} as const;
function decodeText(bytes: Uint8Array) {
  const workflow = Effect.try(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return workflow;
}
const isBlob = Schema.is(Schema.Literal('blob'));
const TreeEntry = Schema.Struct({
  mode: Schema.Literals(['100644', '100755']),
  objectId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1048576 })),
  path: Schema.String,
});

export function reconstructSourceTree(input: unknown) {
  function* reconstruct() {
    const Entries = Schema.Array(TreeEntry).check(Schema.isMinLength(1), Schema.isMaxLength(4096));
    const entries = yield* Schema.decodeUnknownEffect(Entries)(input);
    yield* validateSourceInventory(entries.map(({ path }) => ({ path, kind: 'File' })));
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-tree-identity-' });
    yield* fs.chmod(home, 0o700);
    const templates = `${home}/templates`;
    yield* fs.makeDirectory(templates);
    const store = `${home}/tree.git`;
    yield* runPreparationProcess(
      '/usr/bin/git',
      ['init', '--bare', '--quiet', `--template=${templates}`, store],
      home,
      home,
      4096,
    );
    const indexInfo = entries
      .map(({ mode, objectId, path }) => `${mode} ${objectId}\t${path}\0`)
      .join('');
    const bytes = new TextEncoder().encode(indexInfo);
    yield* runPreparationProcess(
      '/usr/bin/git',
      ['--git-dir', store, 'update-index', '--add', '--info-only', '-z', '--index-info'],
      home,
      home,
      4096,
      bytes,
    );
    const treeBytes = yield* runPreparationProcess(
      '/usr/bin/git',
      ['--git-dir', store, 'write-tree', '--missing-ok'],
      home,
      home,
      128,
    );
    const tree = yield* decodeText(treeBytes);
    return tree.trim();
  }
  const workflow = Effect.gen(reconstruct);
  const scoped = Effect.scoped(workflow);
  return scoped;
}

export function readPinnedSource(repository: string) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-source-reader-' });
    yield* fs.chmod(home, 0o700);
    function git(args: ReadonlyArray<string>, maximum?: number) {
      return runPreparationProcess(
        '/usr/bin/git',
        [
          '--no-replace-objects',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'protocol.allow=never',
          '-C',
          repository,
          ...args,
        ],
        home,
        home,
        maximum,
      );
    }
    const tree = yield* decodeText(yield* git(['rev-parse', `${sourcePins.revision}^{tree}`], 128));
    yield* requirePayload(tree.trim() === sourcePins.tree);
    const listing = yield* decodeText(
      yield* git(
        [
          'ls-tree',
          '-r',
          '-z',
          '--format=%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(objectsize)%x09%(path)',
          sourcePins.revision,
        ],
        2097152,
      ),
    );
    yield* requirePayload(listing.endsWith('\0'));
    const rows = listing.slice(0, -1).split('\0');
    yield* requirePayload(rows.length > 0 && rows.length <= 4096);
    const entries = [];
    for (const row of rows) {
      const [mode, kind, objectId, size, path, ...rest] = row.split('\t');
      yield* requirePayload(isBlob(kind) && rest.length === 0);
      entries.push(
        yield* Schema.decodeUnknownEffect(TreeEntry)({ mode, objectId, size: Number(size), path }),
      );
    }
    yield* requirePayload(entries.reduce((sum, entry) => sum + entry.size, 0) <= 33554432);
    yield* validateSourceInventory(entries.map(({ path }) => ({ path, kind: 'File' })));
    const reconstructed = yield* reconstructSourceTree(entries);
    yield* requirePayload(reconstructed === sourcePins.tree);
    const files = yield* Effect.forEach(
      entries,
      (entry) =>
        git(['cat-file', 'blob', entry.objectId]).pipe(
          Effect.map((bytes) => ({ ...entry, bytes })),
        ),
      { concurrency: 8 },
    );
    return files;
  }
  const workflow = Effect.gen(read);
  const scoped = Effect.scoped(workflow);
  return scoped;
}

export function packSourceFiles(input: unknown) {
  function* pack() {
    const inspected = yield* inspectSourceFiles(input);
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-source-pack-' });
    yield* fs.chmod(home, 0o700);
    const stage = `${home}/tree`;
    yield* fs.makeDirectory(stage, { mode: 0o700 });
    const files = [...inspected.files].sort((left, right) =>
      left.path.localeCompare(right.path, 'en'),
    );
    for (const file of files) {
      const parent = file.path.split('/').slice(0, -1).join('/');
      yield* fs.makeDirectory(`${stage}/${parent}`, { recursive: true });
      yield* fs.writeFile(`${stage}/${file.path}`, file.bytes, { flag: 'wx' });
      const mode = Match.value(file.mode).pipe(
        Match.when('100755', () => 0o755),
        Match.orElse(() => 0o644),
      );
      yield* fs.chmod(`${stage}/${file.path}`, mode);
      yield* fs.utimes(`${stage}/${file.path}`, 0, 0);
    }
    const archive = `${home}/source.tar`;
    yield* runPreparationProcess(
      '/usr/bin/tar',
      [
        '--format=ustar',
        '--uid',
        '0',
        '--gid',
        '0',
        '--uname',
        'root',
        '--gname',
        'root',
        '-cf',
        archive,
        '-C',
        stage,
        '--',
        ...files.map(({ path }) => path),
      ],
      home,
      home,
      4096,
    );
    const info = yield* fs.stat(archive);
    yield* requirePayload(info.size > 0n && info.size <= 67108864n, 'ArchiveRefused');
    const bytes = yield* fs.readFile(archive);
    const inventory = files.map(({ path, mode, objectId, size, sha256 }) => ({
      path,
      mode,
      objectId,
      size,
      sha256,
    }));
    return { activation: 'Blocked' as const, bytes, inventory, sha256: yield* digestBytes(bytes) };
  }
  const workflow = Effect.gen(pack);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
