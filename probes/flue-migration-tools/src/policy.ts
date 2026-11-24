import { Data, Effect, FileSystem, Match, Option, Path, Result, Schema } from 'effect';

export class MigrationToolError extends Data.TaggedError('MigrationToolError')<{
  readonly operation: 'read' | 'write' | 'search' | 'check';
  readonly code:
    | 'InvalidPolicy'
    | 'UnsafePath'
    | 'NotWritable'
    | 'NotRegularFile'
    | 'TooLarge'
    | 'InvalidEncoding'
    | 'UnknownCheck'
    | 'CheckFailed'
    | 'Unavailable';
}> {}

/** One named command the agent may run. The agent chooses a name, never a command line. */
export type MigrationCheck = Readonly<{
  name: string;
  /** An absolute executable path. No shell, so no argument is ever interpreted. */
  executable: string;
  args: ReadonlyArray<string>;
  timeoutSeconds: number;
}>;

export type MigrationToolPolicy = Readonly<{
  /** An absolute, normalized, already-realpath-resolved checkout root. */
  root: string;
  /**
   * Relative path prefixes the agent may write, matched by whole path component,
   * so `src` admits `src/a.ts` and refuses `srcx/a.ts`.
   */
  writable: ReadonlyArray<string>;
  readMaximum: number;
  writeMaximum: number;
  searchMatches: number;
  searchMatchBytes: number;
  checks: ReadonlyArray<MigrationCheck>;
}>;

const isFile = Schema.is(Schema.Struct({ type: Schema.Literal('File') }));

/**
 * Narrow any platform failure to this module's own error, so nothing a tool
 * returns to an agent can carry a filesystem message, an errno or a path. Every
 * cause that is not already one of ours becomes `Unavailable`: the agent learns
 * that the operation did not happen and nothing about the host.
 */
export function contain(
  operation: MigrationToolError['operation'],
  code: MigrationToolError['code'] = 'Unavailable',
) {
  const known = Match.instanceOf(MigrationToolError);
  const fallback = new MigrationToolError({ operation, code });
  const narrow = Match.type<unknown>().pipe(
    Match.when(known, (error) => error),
    Match.orElse(() => fallback),
  );
  return narrow;
}

export function refuse(
  valid: boolean,
  operation: MigrationToolError['operation'],
  code: MigrationToolError['code'],
) {
  const result = Match.value(valid).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.orElse(() => Result.fail(new MigrationToolError({ operation, code }))),
  );
  const validation = Effect.fromResult(result);
  return validation;
}

function components(value: string) {
  return value.split('/').filter((part) => part.length > 0);
}

/**
 * The confinement check, shared by every tool. It is deliberately stricter than
 * "the resolved path starts with the root":
 *
 * - Only relative candidates are accepted. An absolute path is refused even when
 *   it names a file inside the root, because accepting one would mean trusting a
 *   prefix comparison on a string the agent composed.
 * - `resolveWithin` refuses anything that leaves the root at any point, including
 *   a traversal that leaves and returns.
 * - A `.git` component is refused anywhere in the path. It is inside the root and
 *   would otherwise be both readable and, under a writable prefix, writable.
 * - `realPath` equality refuses a symlink at the leaf *and* at every ancestor,
 *   because `realPath` resolves the whole chain. This is what stops a link inside
 *   `src/` from reaching a file outside the checkout.
 *
 * What it does not do: close the window between the check and the caller's own
 * open. A hostile process that can replace a component of this path between the
 * two calls can still redirect it. Closing that needs `openat` with
 * `O_NOFOLLOW` per component, which this runtime does not expose, and the
 * checkout is assumed not to be concurrently writable by another writer.
 */
function confine(
  policy: MigrationToolPolicy,
  candidate: string,
  operation: MigrationToolError['operation'],
) {
  function* resolve() {
    const path = yield* Path.Path;
    const rootValid =
      path.isAbsolute(policy.root) &&
      path.normalize(policy.root) === policy.root &&
      !policy.root.includes('\0');
    yield* refuse(rootValid, operation, 'InvalidPolicy');
    const parts = components(candidate);
    const candidateValid = [
      !candidate.includes('\0'),
      !path.isAbsolute(candidate),
      parts.length > 0,
      !parts.includes('.git'),
    ].every(Boolean);
    yield* refuse(candidateValid, operation, 'UnsafePath');
    const resolved = path.resolveWithin(policy.root, candidate);
    // `resolveWithin` returns the root itself for `.` or `src/..`; a tool always
    // names a file, so the root is not a legitimate target either.
    const within = Option.filter(resolved, (value) => value !== policy.root);
    yield* refuse(Option.isSome(within), operation, 'UnsafePath');
    const absolute = Option.getOrElse(within, () => policy.root);
    // Re-derive the relative path from the resolved one rather than reusing the
    // candidate, so prefix matching cannot be fooled by `.` or `//` segments.
    // `.git` needs no second look here: the check above runs on the raw split,
    // and `resolveWithin` only normalizes, so it can never introduce a component
    // the candidate did not already contain.
    const relative = components(path.relative(policy.root, absolute));
    return { absolute, relative };
  }
  const resolution = Effect.gen(resolve);
  return resolution;
}

function realPathMatches(value: string, operation: MigrationToolError['operation']) {
  function* check() {
    const fs = yield* FileSystem.FileSystem;
    const real = yield* fs.realPath(value).pipe(Effect.option);
    yield* refuse(Option.contains(real, value), operation, 'UnsafePath');
  }
  const verification = Effect.gen(check);
  return verification;
}

/**
 * Resolve a candidate for reading. The file must already exist and be a regular
 * file, so a directory, a device and a dangling link are all refused here rather
 * than at the read.
 */
export function resolveForRead(policy: MigrationToolPolicy, candidate: string) {
  function* resolve() {
    const fs = yield* FileSystem.FileSystem;
    const { absolute } = yield* confine(policy, candidate, 'read');
    const info = yield* fs.stat(absolute).pipe(Effect.option);
    const regular = Option.match(info, { onNone: () => false, onSome: (value) => isFile(value) });
    yield* refuse(regular, 'read', 'NotRegularFile');
    yield* realPathMatches(absolute, 'read');
    return absolute;
  }
  const resolution = Effect.gen(resolve);
  return resolution;
}

/**
 * Resolve a candidate for writing. The file need not exist, so the symlink check
 * falls on the parent directory, and on the file itself when it is already there.
 */
export function resolveForWrite(policy: MigrationToolPolicy, candidate: string) {
  function* resolve() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { absolute, relative } = yield* confine(policy, candidate, 'write');
    function admits(prefix: string) {
      const wanted = components(prefix);
      const covers = wanted.length > 0 && wanted.length <= relative.length;
      const aligns = wanted.every((part, index) => relative[index] === part);
      return covers && aligns;
    }
    const permitted = policy.writable.some(admits);
    yield* refuse(permitted, 'write', 'NotWritable');
    const parent = path.dirname(absolute);
    yield* realPathMatches(parent, 'write');
    const info = yield* fs.stat(absolute).pipe(Effect.option);
    const replaceable = Option.match(info, {
      onNone: () => true,
      onSome: (value) => isFile(value),
    });
    yield* refuse(replaceable, 'write', 'NotRegularFile');
    // Only an existing file can be a symlink, so the check is driven by the
    // stat rather than by a separate predicate effect.
    yield* Option.match(info, {
      onNone: () => Effect.void,
      onSome: () => realPathMatches(absolute, 'write'),
    });
    return absolute;
  }
  const resolution = Effect.gen(resolve);
  return resolution;
}
