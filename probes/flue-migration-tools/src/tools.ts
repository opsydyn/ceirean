import { Effect, FileSystem, Option } from 'effect';
import { ChildProcess } from 'effect/process';

import {
  contain,
  type MigrationCheck,
  MigrationToolError,
  type MigrationToolPolicy,
  refuse,
  resolveForRead,
  resolveForWrite,
} from './policy.ts';

/**
 * The exit code a timed-out check reports. It matches `TIMEOUT_EXIT_CODE` in
 * `packages/engine/src/migration-sandbox-port.ts` deliberately: when this
 * surface is placed behind that port the two must agree. It is duplicated
 * rather than imported so this probe takes no dependency on the engine.
 */
export const TIMEOUT_EXIT_CODE = 124;

/**
 * How many entries one `search_files` call will consider. A checkout larger than
 * this is reported as truncated rather than scanned, so a single tool call
 * cannot be turned into an unbounded walk by pointing it at a large repository.
 *
 * The worst case is this many files at `readMaximum` bytes each, read one at a
 * time and discarded. That is the recorded bound; it is not a guarantee that a
 * search is cheap.
 */
const SEARCH_ENTRY_LIMIT = 2048;

export type ToolMatch = Readonly<{ path: string; line: number; text: string }>;

/**
 * Cut a line to a byte bound. Decoding the cut non-fatally and dropping a
 * trailing replacement character means a multi-byte character split by the
 * bound disappears rather than arriving corrupted.
 */
function clamp(value: string, maximum: number) {
  const bytes = new TextEncoder().encode(value);
  const cut = new TextDecoder('utf-8').decode(bytes.subarray(0, maximum)).replace(/�+$/u, '');
  const choice = Option.liftPredicate(value, () => bytes.byteLength <= maximum);
  return Option.getOrElse(choice, () => cut);
}

/** `.git` is inside the root, so search has to leave it out explicitly. */
function searchable(entry: string) {
  return !entry.split('/').includes('.git');
}

function byName(left: string, right: string) {
  return left.localeCompare(right);
}

export function openToolSurface(policy: MigrationToolPolicy) {
  function readFile(candidate: string) {
    function* read() {
      const fs = yield* FileSystem.FileSystem;
      const absolute = yield* resolveForRead(policy, candidate);
      const info = yield* fs.stat(absolute);
      yield* refuse(info.size <= BigInt(policy.readMaximum), 'read', 'TooLarge');
      const bytes = yield* fs.readFile(absolute);
      yield* refuse(bytes.byteLength <= policy.readMaximum, 'read', 'TooLarge');
      // Strict decoding, so a binary file is a refusal rather than mojibake.
      const content = yield* Effect.try({
        try: () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
        catch: () => new MigrationToolError({ operation: 'read', code: 'InvalidEncoding' }),
      });
      return { path: candidate, bytes: bytes.byteLength, content };
    }
    const operation = Effect.gen(read);
    return operation.pipe(Effect.mapError(contain('read')));
  }

  function writeFile(candidate: string, content: string) {
    function* write() {
      const fs = yield* FileSystem.FileSystem;
      const bytes = new TextEncoder().encode(content);
      // Bound the content before resolving, so an oversized write is refused
      // without the resolution having created or truncated anything.
      yield* refuse(bytes.byteLength <= policy.writeMaximum, 'write', 'TooLarge');
      const absolute = yield* resolveForWrite(policy, candidate);
      yield* fs.writeFile(absolute, bytes, { flag: 'w', mode: 0o600 });
      return { path: candidate, bytes: bytes.byteLength };
    }
    const operation = Effect.gen(write);
    return operation.pipe(Effect.mapError(contain('write')));
  }

  /**
   * Search for a literal substring. The query is never treated as a pattern: a
   * regular expression composed by a model is a denial-of-service surface, and
   * nothing in the migration task needs one.
   *
   * Every candidate is read through `read_file` rather than through a second
   * filesystem path, so search is confined and bounded by exactly the rules
   * that govern a read. A directory, a symlink out of the checkout and a binary
   * file are not skipped by a special case here: they simply fail to read and
   * so contribute nothing.
   */
  function searchFiles(query: string) {
    const empty: ReadonlyArray<ToolMatch> = [];

    function matching(entry: string, text: string) {
      const found = text
        .split('\n')
        .map((line, index) => ({ path: entry, line: index + 1, text: line }))
        .filter((candidate) => candidate.text.includes(query))
        .map(({ path, line, text: value }) => ({
          path,
          line,
          text: clamp(value, policy.searchMatchBytes),
        }));
      return found as ReadonlyArray<ToolMatch>;
    }

    function accumulate(found: ReadonlyArray<ToolMatch>, entry: string) {
      const read = readFile(entry).pipe(
        Effect.map((file) => found.concat(matching(entry, file.content))),
        Effect.orElseSucceed(() => found),
        // One match beyond the cap is kept so truncation is observed rather
        // than assumed, and the reply stays bounded while scanning continues.
        Effect.map((all) => all.slice(0, policy.searchMatches + 1)),
      );
      return read;
    }

    function* search() {
      const fs = yield* FileSystem.FileSystem;
      yield* refuse(query.length > 0 && !query.includes('\0'), 'search', 'UnsafePath');
      const entries = yield* fs.readDirectory(policy.root, { recursive: true });
      const considered = entries.filter(searchable).sort(byName);
      const scanned = considered.slice(0, SEARCH_ENTRY_LIMIT);
      const found = yield* Effect.reduce(scanned, () => empty, accumulate);
      const truncated =
        considered.length > SEARCH_ENTRY_LIMIT || found.length > policy.searchMatches;
      return { query, truncated, matches: found.slice(0, policy.searchMatches) };
    }
    const operation = Effect.gen(search);
    return operation.pipe(Effect.mapError(contain('search')));
  }

  /**
   * Run one check the policy names. The agent supplies a name, never a command
   * line, so there is no shell, no argument composition and no path lookup.
   *
   * Slice 1 returns an exit code and nothing else. That is the recorded limit,
   * not an omission: an agent cannot tell a lint failure from a test failure
   * from a crash here, which is gap 2 in the design document and the whole
   * subject of slice 2. `stdout` and `stderr` are discarded at the child rather
   * than collected and dropped, so no unredacted output exists to leak.
   */
  function runCheck(name: string) {
    function spawn(check: MigrationCheck) {
      function* run() {
        const child = yield* ChildProcess.make(check.executable, check.args, {
          cwd: policy.root,
          shell: false,
          extendEnv: false,
          env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: policy.root },
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
          killSignal: 'SIGKILL',
          forceKillAfter: 0,
        });
        return yield* child.exitCode;
      }
      const execution = Effect.gen(run);
      // The scope closes on timeout, which is what kills the child.
      const scoped = Effect.scoped(execution);
      const bounded = Effect.timeoutOption(scoped, `${check.timeoutSeconds} seconds`);
      const reported = bounded.pipe(
        Effect.map((code) => ({
          name: check.name,
          exitCode: Number(Option.getOrElse(code, () => TIMEOUT_EXIT_CODE)),
          timedOut: Option.isNone(code),
        })),
      );
      return reported;
    }

    function* select() {
      const named = Option.liftPredicate(
        policy.checks.find((candidate) => candidate.name === name),
        (found) => found !== undefined,
      );
      return yield* Option.match(named, {
        onNone: () =>
          Effect.fail(new MigrationToolError({ operation: 'check', code: 'UnknownCheck' })),
        onSome: spawn,
      });
    }
    const operation = Effect.gen(select);
    return operation.pipe(Effect.mapError(contain('check', 'CheckFailed')));
  }

  return { readFile, writeFile, searchFiles, runCheck };
}
