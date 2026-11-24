import { Effect, FileSystem, Option, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

import { type Capture, openCapture } from './capture.ts';
import {
  contain,
  type MigrationCheck,
  MigrationToolError,
  type MigrationToolPolicy,
  refuse,
  resolveForRead,
  resolveForWrite,
} from './policy.ts';
import { redactOutput } from './redact.ts';

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

/**
 * The memory ceiling for one captured stream, far above what an agent is shown.
 * `src/capture.ts` explains why there are two bounds and what the ceiling costs.
 */
const CAPTURE_CEILING = 1048576;

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
   * Output is captured, redacted and bounded, per
   * [ADR-0003](../../../docs/decisions/0003-bounded-redacted-check-output.md).
   * Slice 1 discarded both streams at the child; an agent given only an exit
   * code cannot tell a lint failure from a test failure from a crash, and the
   * pilot's real surface was discovered from checker output naming files.
   *
   * Everything a stream produces is drained, including bytes past the ceiling,
   * so a check that writes more than its ceiling fails on its own terms instead
   * of stalling on a full pipe.
   */
  function runCheck(name: string) {
    function drain(stream: Stream.Stream<Uint8Array, unknown>, sink: Capture) {
      function* keep(chunk: Uint8Array) {
        sink.push(chunk);
        // An explicit step rather than `Effect.sync` around the push. The sink
        // enforces its own bound, so there is nothing to decide here and
        // nothing that can fail.
        yield* Effect.void;
      }
      const consumption = Stream.runForEach(stream, (chunk) => Effect.gen(() => keep(chunk)));
      return consumption;
    }

    function reported(sink: Capture) {
      const { bytes, dropped } = sink.taken();
      const bounds = { total: policy.outputMaximum, line: policy.outputLineMaximum };
      const redacted = redactOutput(bytes, policy.root, bounds);
      return { text: redacted.text, omitted: redacted.omitted + dropped };
    }

    function spawn(check: MigrationCheck) {
      // The sinks are created outside the timed effect on purpose. A timeout
      // interrupts the spawn, and anything created inside it goes with it, so
      // a killed check would report nothing — which is the one case where its
      // last output matters most.
      const out = openCapture(CAPTURE_CEILING);
      const error = openCapture(CAPTURE_CEILING);
      function* run() {
        const child = yield* ChildProcess.make(check.executable, check.args, {
          cwd: policy.root,
          shell: false,
          extendEnv: false,
          env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: policy.root },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          killSignal: 'SIGKILL',
          forceKillAfter: 0,
        });
        const [, , code] = yield* Effect.all(
          [drain(child.stdout, out), drain(child.stderr, error), child.exitCode],
          { concurrency: 3 },
        );
        return code;
      }
      const execution = Effect.gen(run);
      // The scope closes on timeout, which is what kills the child.
      const scoped = Effect.scoped(execution);
      const bounded = Effect.timeoutOption(scoped, `${check.timeoutSeconds} seconds`);
      const described = bounded.pipe(
        Effect.map((code) => settle(check, code, reported(out), reported(error))),
      );
      return described;
    }

    function settle(
      check: MigrationCheck,
      code: Option.Option<number>,
      stdout: { text: string; omitted: number },
      stderr: { text: string; omitted: number },
    ) {
      return {
        name: check.name,
        exitCode: Number(Option.getOrElse(code, () => TIMEOUT_EXIT_CODE)),
        timedOut: Option.isNone(code),
        output: {
          stdout: stdout.text,
          stderr: stderr.text,
          omitted: stdout.omitted + stderr.omitted,
        },
      };
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
