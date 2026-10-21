import { LiveInboxError } from '@ceirean/engine';
import { Effect, FileSystem, Match, Option, Path, Result, Schema } from 'effect';

const uid = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: 9007199254740991 }),
);
const common = { stateRoot: Schema.NonEmptyString, ownerUid: uid };
export const LocalStatePolicy = Schema.Union([
  Schema.TaggedStruct('Production', {
    ...common,
    homeDirectory: Schema.NonEmptyString,
    repositoryRoots: Schema.Array(Schema.NonEmptyString),
    buildRoots: Schema.Array(Schema.NonEmptyString),
    temporaryRoots: Schema.Array(Schema.NonEmptyString),
    syncedRoots: Schema.Array(Schema.NonEmptyString),
    filesystem: Schema.Literal('OperatorDeclaredLocalNonSynced'),
  }),
  Schema.TaggedStruct('TestOwnedTemporary', {
    ...common,
    ownedTemporaryRoot: Schema.NonEmptyString,
  }),
]);
export type LocalStatePolicy = typeof LocalStatePolicy.Type;

function requirePath(valid: boolean) {
  const result = Match.value(valid).pipe(
    Match.when(true, () => Result.succeed(true)),
    Match.orElse(() => Result.fail(new LiveInboxError({ operation: 'open', code: 'UnsafePath' }))),
  );
  const validation = Effect.fromResult(result);
  return validation;
}
const isDirectory = Schema.is(Schema.Literal('Directory'));
const isFile = Schema.is(Schema.Literal('File'));
const isTestPolicy = Schema.is(LocalStatePolicy.members[1]);
const initializeMode = Schema.is(Schema.Literal('Initialize'));
const identityJson = Schema.fromJsonString(
  Schema.Tuple([Schema.String, Schema.Array(Schema.String), Schema.Array(Schema.String)]),
);
const encodeIdentity = Schema.encodeSync(identityJson);

// Paths are explicit application input. This adapter neither reads environment nor
// claims it can identify arbitrary sync clients or network mounts from a name.
export function prepareLocalState(
  input: LocalStatePolicy,
  file: string,
  mode: 'Initialize' | 'Open',
) {
  function* prepare() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const policy = yield* Schema.decodeUnknownEffect(LocalStatePolicy)(structuredClone(input));
    const root = policy.stateRoot;
    function absolute(value: string) {
      return path.isAbsolute(value) && path.normalize(value) === value && !value.includes('\0');
    }
    function within(base: string, value: string) {
      const relative = path.relative(base, value);
      const resolved = path.resolveWithin(base, relative);
      return Option.contains(resolved, value);
    }
    yield* requirePath(absolute(root) && absolute(file) && file !== root && within(root, file));
    const components = path.dirname(file).split('/').filter(Boolean);
    const parents = [
      '/',
      ...components.map((_component, index) => `/${components.slice(0, index + 1).join('/')}`),
    ];
    const restrictions = Match.value(policy).pipe(
      Match.tag('Production', (production) => [
        ...production.repositoryRoots,
        ...production.buildRoots,
        ...production.temporaryRoots,
        ...production.syncedRoots,
        '/tmp',
        '/private/tmp',
        '/var/tmp',
        '/private/var/tmp',
        '/dev/shm',
        '/var/folders',
        '/private/var/folders',
        path.join(production.homeDirectory, 'Library', 'CloudStorage'),
        path.join(production.homeDirectory, 'Library', 'Mobile Documents'),
      ]),
      Match.tag('TestOwnedTemporary', () => [] as string[]),
      Match.exhaustive,
    );
    function outsideExcludedRoot(base: string) {
      return [absolute(base), !within(base, root), !within(base, file)].every(Boolean);
    }
    yield* requirePath(restrictions.every(outsideExcludedRoot));
    const testRootValid = Match.value(policy).pipe(
      Match.tag('Production', () => true),
      Match.tag(
        'TestOwnedTemporary',
        (test) =>
          root === test.ownedTemporaryRoot &&
          ['/private/tmp/', '/tmp/', '/private/var/folders/', '/var/folders/'].some((base) =>
            root.startsWith(base),
          ),
      ),
      Match.exhaustive,
    );
    yield* requirePath(testRootValid);
    for (const parent of parents) {
      function* createParent() {
        yield* requirePath(initializeMode(mode) && within(root, parent));
        yield* fs.makeDirectory(parent, { mode: 0o700 });
      }
      const creation = Effect.gen(createParent);
      const missing = fs.exists(parent).pipe(Effect.map((exists) => !exists));
      yield* creation.pipe(Effect.when(missing));
      yield* requirePath((yield* fs.realPath(parent)) === parent);
      const info = yield* fs.stat(parent);
      const owner = Option.getOrElse(info.uid, () => -1);
      const testAncestor = isTestPolicy(policy) && !within(root, parent);
      yield* requirePath(isDirectory(info.type));
      const safeOwned = owner === policy.ownerUid && (info.mode & 0o777) === 0o700;
      const safeOwner = owner === 0 || owner === policy.ownerUid;
      const safeMode = (info.mode & 0o022) === 0 || (testAncestor && (info.mode & 0o1000) !== 0);
      const safeAncestor = safeOwner && safeMode;
      const safe = Match.value(within(root, parent)).pipe(
        Match.when(true, () => safeOwned),
        Match.orElse(() => safeAncestor),
      );
      yield* requirePath(safe);
      yield* requirePath(!(yield* fs.exists(path.join(parent, '.git'))));
    }
    function inspectFile(value: string) {
      function* inspect() {
        yield* requirePath((yield* fs.realPath(value)) === value);
        const info = yield* fs.stat(value);
        const safe = [
          isFile(info.type),
          (info.mode & 0o777) === 0o600,
          Option.contains(info.uid, policy.ownerUid),
          Option.contains(info.nlink, 1n),
        ].every(Boolean);
        yield* requirePath(safe);
        const ino = yield* Effect.fromOption(info.ino).pipe(
          Effect.mapError(() => new LiveInboxError({ operation: 'open', code: 'UnsafePath' })),
        );
        return [info.dev.toString(), ino.toString()];
      }
      const inspection = Effect.gen(inspect);
      return inspection;
    }
    const guard = `${file}.owner.sqlite`;
    function* reserveFiles() {
      // Never unlink on a partial initialization. Recovery belongs to the operator.
      yield* requirePath(!(yield* fs.exists(file)) && !(yield* fs.exists(guard)));
      yield* fs.open(file, { flag: 'wx', mode: 0o600, noFollow: true }).pipe(Effect.scoped);
      yield* fs.open(guard, { flag: 'wx', mode: 0o600, noFollow: true }).pipe(Effect.scoped);
    }
    const reservation = Effect.gen(reserveFiles);
    const initializing = Effect.succeed(initializeMode(mode));
    yield* reservation.pipe(Effect.when(initializing));
    const databaseIdentity = yield* inspectFile(file);
    const guardIdentity = yield* inspectFile(guard);
    for (const suffix of [
      '-wal',
      '-shm',
      '-journal',
      '.owner.sqlite-journal',
      '.owner.sqlite-wal',
      '.owner.sqlite-shm',
    ]) {
      const sidecar = `${file}${suffix}`;
      const link = yield* fs.readLink(sidecar).pipe(Effect.result);
      yield* requirePath(Result.isFailure(link));
      const present = fs.exists(sidecar);
      yield* inspectFile(sidecar).pipe(Effect.when(present));
    }
    return { file, guard, identity: encodeIdentity([file, databaseIdentity, guardIdentity]) };
  }
  const preparation = Effect.gen(prepare);
  return preparation.pipe(
    Effect.mapError(() => new LiveInboxError({ operation: 'open', code: 'UnsafePath' })),
  );
}
