import { Effect, FileSystem, Match, Option, Path, Result, Schema } from 'effect';

import type { MigrationLedgerConfig } from './config.ts';
import { MigrationStorageError } from './errors.ts';

const identityCodec = Schema.fromJsonString(Schema.Array(Schema.String));
const sidecars = [
  '-wal',
  '-shm',
  '-journal',
  '.owner.sqlite-journal',
  '.owner.sqlite-wal',
  '.owner.sqlite-shm',
];

// The caller trusts local parent directories against concurrent hostile replacement.
// Descriptors and repeated inode checks narrow races; they do not provide openat/VFS isolation.
export function prepareMigrationPaths(config: MigrationLedgerConfig, initialize: boolean) {
  function* prepare() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const policy = config.pathPolicy;
    const root = policy.stateRoot;
    const file = path.join(root, 'migration.sqlite');
    const guard = `${file}.owner.sqlite`;
    function requirePath(valid: boolean) {
      const result = Match.value(valid).pipe(
        Match.when(true, () => Result.succeed(undefined)),
        Match.orElse(() =>
          Result.fail(new MigrationStorageError({ operation: 'open', code: 'UnsafePath' })),
        ),
      );
      const validation = Effect.fromResult(result);
      return validation;
    }
    function absolute(value: string) {
      return path.isAbsolute(value) && path.normalize(value) === value && !value.includes('\0');
    }
    function within(base: string, value: string) {
      const relative = path.relative(base, value);
      const resolved = path.resolveWithin(base, relative);
      return Option.contains(resolved, value);
    }
    yield* requirePath(absolute(root));
    const excluded = Match.value(policy).pipe(
      Match.tag('Production', (p) => [
        ...p.repositoryRoots,
        ...p.buildRoots,
        ...p.temporaryRoots,
        ...p.syncedRoots,
        '/tmp',
        '/private/tmp',
        '/var/tmp',
        '/private/var/tmp',
        '/dev/shm',
        '/var/folders',
        '/private/var/folders',
        path.join(p.homeDirectory, 'Library', 'CloudStorage'),
        path.join(p.homeDirectory, 'Library', 'Mobile Documents'),
      ]),
      Match.tag('TestOwnedTemporary', () => [] as string[]),
      Match.exhaustive,
    );
    yield* requirePath(
      excluded.every(
        (base) =>
          absolute(base) && !within(base, root) && !within(base, file) && !within(base, guard),
      ),
    );
    const policyValid = Match.value(policy).pipe(
      Match.tag('Production', (p) => absolute(p.homeDirectory)),
      Match.tag(
        'TestOwnedTemporary',
        (p) =>
          root === p.ownedTemporaryRoot &&
          ['/private/tmp/', '/tmp/', '/private/var/folders/', '/var/folders/'].some((prefix) =>
            root.startsWith(prefix),
          ),
      ),
      Match.exhaustive,
    );
    yield* requirePath(policyValid);
    const components = root.split('/').filter(Boolean);
    const parents = [
      '/',
      ...components.map((_item, i) => `/${components.slice(0, i + 1).join('/')}`),
    ];
    const testPolicy = Schema.is(Schema.Literal('TestOwnedTemporary'));
    const isTest = testPolicy(policy._tag);
    const isDirectory = Schema.is(Schema.Literal('Directory'));
    const isFile = Schema.is(Schema.Literal('File'));
    for (const parent of parents) {
      function* create() {
        yield* requirePath(initialize && within(root, parent));
        yield* fs.makeDirectory(parent, { mode: 0o700 });
      }
      const creation = Effect.gen(create);
      const missing = fs.exists(parent).pipe(Effect.map((present) => !present));
      yield* creation.pipe(Effect.when(missing));
      yield* requirePath((yield* fs.realPath(parent)) === parent);
      const info = yield* fs.stat(parent);
      const owner = Option.getOrElse(info.uid, () => -1);
      const ancestorMode =
        (info.mode & 0o022) === 0 ||
        (isTest && !within(root, parent) && (info.mode & 0o1000) !== 0);
      const owned = owner === policy.ownerUid && (info.mode & 0o777) === 0o700;
      const ancestor = (owner === 0 || owner === policy.ownerUid) && ancestorMode;
      const safe = Match.value(within(root, parent)).pipe(
        Match.when(true, () => owned),
        Match.orElse(() => ancestor),
      );
      yield* requirePath(isDirectory(info.type) && safe);
      yield* requirePath(!(yield* fs.exists(path.join(parent, '.git'))));
    }
    function exists(value: string) {
      function* inspect() {
        const link = yield* fs.readLink(value).pipe(Effect.result);
        yield* requirePath(Result.isFailure(link));
        return yield* fs.exists(value);
      }
      const inspection = Effect.gen(inspect);
      return inspection;
    }
    // Inspect all names before reservation, including dangling links and known special files.
    for (const name of [file, guard, ...sidecars.map((suffix) => `${file}${suffix}`)]) {
      const present = yield* exists(name);
      const refusal = Effect.fail(
        new MigrationStorageError({ operation: 'initialize', code: 'AlreadyExists' }),
      );
      const alreadyExists = Effect.sync(() => initialize && present);
      yield* refusal.pipe(Effect.when(alreadyExists));
      // These names cannot belong to a healthy WAL ledger / rollback-only guard.
      // Refuse before SQLite could recover a partially initialized journal.
      const unexpected = [
        `${file}-journal`,
        `${guard}-journal`,
        `${guard}-wal`,
        `${guard}-shm`,
      ].includes(name);
      yield* requirePath(!present || !unexpected);
      function* checkFile() {
        const info = yield* fs.stat(name);
        const valid = [
          isFile(info.type),
          (info.mode & 0o777) === 0o600,
          Option.contains(info.uid, policy.ownerUid),
          Option.contains(info.nlink, 1n),
        ].every(Boolean);
        yield* requirePath(valid);
      }
      const inspection = Effect.gen(checkFile);
      const existsNow = Effect.sync(() => present);
      yield* inspection.pipe(Effect.when(existsNow));
    }
    function* reserve() {
      // Retain partial reservations on failure: no automatic repair or deletion.
      for (const name of [file, guard])
        yield* fs.open(name, { flag: 'wx', mode: 0o600, noFollow: true });
    }
    const reservation = Effect.gen(reserve);
    const initializing = Effect.sync(() => initialize);
    yield* reservation.pipe(Effect.when(initializing));
    const identities: string[] = [file];
    const descriptors: FileSystem.File[] = [];
    for (const name of [file, guard]) {
      yield* requirePath((yield* fs.realPath(name)) === name);
      const descriptor = yield* fs.open(name, { flag: 'r', noFollow: true });
      descriptors.push(descriptor);
      const info = yield* descriptor.stat;
      const inode = Option.getOrElse(info.ino, () => -1n);
      const valid = [
        isFile(info.type),
        (info.mode & 0o777) === 0o600,
        Option.contains(info.uid, policy.ownerUid),
        Option.contains(info.nlink, 1n),
        inode >= 0n,
      ].every(Boolean);
      yield* requirePath(valid);
      identities.push(info.dev.toString(), inode.toString());
    }
    const encodeIdentity = Schema.encodeSync(identityCodec);
    return { file, guard, guardFile: descriptors[1], identity: encodeIdentity(identities) };
  }
  function failure(error: unknown) {
    const isKnown = Match.instanceOf(MigrationStorageError);
    return Match.value(error).pipe(
      Match.when(isKnown, (known) => known),
      Match.orElse(() => new MigrationStorageError({ operation: 'open', code: 'UnsafePath' })),
    );
  }
  const preparation = Effect.gen(prepare);
  return preparation.pipe(Effect.mapError(failure));
}
