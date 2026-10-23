import { Data, Effect, FileSystem, Match, Option, Path, Result, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

export type ToolId = 'Colima' | 'Docker';
export type ReadId = 'ColimaConfig';
export interface HostReaderConfig {
  readonly colimaRoot: string;
  readonly home: string;
  readonly parentDirectoriesTrusted: boolean;
  readonly executableCandidates: Readonly<
    Record<
      ToolId,
      {
        readonly path: string;
        readonly semantics: 'ClientOnlyVersion' | 'Unsupported';
      }
    >
  >;
  readonly now: () => number;
}

export class HostReadError extends Data.TaggedError('HostReadError')<{
  readonly code:
    | 'InvalidRequest'
    | 'InvalidConfiguration'
    | 'UntrustedParents'
    | 'ReadFailed'
    | 'NotRegular'
    | 'FileChanged'
    | 'FileTooLarge'
    | 'InvalidEncoding'
    | 'UnsupportedSemantics'
    | 'Unavailable'
    | 'CommandFailed'
    | 'NonzeroExit'
    | 'OutputTooLarge'
    | 'TimedOut';
  readonly truncated: boolean;
}> {}

const fileCap = 262144;
const outputCap = 65536;

function failure(code: HostReadError['code'], truncated = false) {
  return new HostReadError({ code, truncated });
}

function decode(bytes: Uint8Array) {
  const program = Effect.try({
    try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    catch: () => failure('InvalidEncoding'),
  });
  return program;
}

function sameFile(before: FileSystem.File.Info, after: FileSystem.File.Info) {
  return (
    before.dev === after.dev &&
    Option.isSome(before.ino) &&
    Option.isSome(after.ino) &&
    before.ino.value === after.ino.value
  );
}

function sameSnapshot(before: FileSystem.File.Info, after: FileSystem.File.Info) {
  const stableTime = Option.makeEquivalence((a: Date, b: Date) => a.getTime() === b.getTime());
  return (
    sameFile(before, after) &&
    before.size === after.size &&
    Option.isSome(before.mtime) &&
    Option.isSome(after.mtime) &&
    stableTime(before.mtime, after.mtime)
  );
}

function requireCondition(condition: boolean, code: HostReadError['code'], truncated = false) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.orElse(() => Result.fail(failure(code, truncated))),
  );
}

function regular(info: FileSystem.File.Info) {
  return Match.value(info.type).pipe(
    Match.when('File', () => Result.succeed(undefined)),
    Match.orElse(() => Result.fail(failure('NotRegular'))),
  );
}

function readBytes(file: FileSystem.File) {
  function* read() {
    const buffer = new Uint8Array(fileCap + 1);
    let used = 0;
    let ended = false;
    while (used < buffer.length && !ended) {
      const part = yield* file
        .readAlloc(buffer.length - used)
        .pipe(Effect.mapError(() => failure('ReadFailed')));
      const bytes = Option.getOrElse(part, () => new Uint8Array());
      buffer.set(bytes, used);
      used += bytes.length;
      ended = bytes.length === 0;
    }
    yield* Effect.fromResult(requireCondition(used <= fileCap, 'FileTooLarge', true));
    return buffer.slice(0, used);
  }
  const program = Effect.gen(read);
  return program;
}

/** Construction is trusted composition, never CLI input. Parent directories and
 * executable identities must be owner-controlled, including throughout each read.
 * noFollow protects the final component only; this is not a hostile-tree reader.
 */
export function makeHostReader(config: HostReaderConfig) {
  // Snapshot trusted configuration so callers cannot change the allowlist mid-read.
  const colimaRoot = config.colimaRoot;
  const home = config.home;
  const trusted = config.parentDirectoriesTrusted;
  const now = config.now;
  const candidates = {
    Colima: { ...config.executableCandidates.Colima },
    Docker: { ...config.executableCandidates.Docker },
  };

  function* read(request: ReadId) {
    const accepted = Match.value(request).pipe(
      Match.when('ColimaConfig', () => true),
      Match.orElse(() => false),
    );
    yield* Effect.fromResult(requireCondition(accepted, 'InvalidRequest'));
    yield* Effect.fromResult(requireCondition(trusted, 'UntrustedParents'));
    const paths = yield* Path.Path;
    yield* Effect.fromResult(
      requireCondition(paths.isAbsolute(colimaRoot), 'InvalidConfiguration'),
    );
    const path = paths.join(colimaRoot, 'ceirean', 'colima.yaml');
    const fs = yield* FileSystem.FileSystem;
    const before = yield* fs.stat(path).pipe(Effect.mapError(() => failure('ReadFailed')));
    yield* Effect.fromResult(regular(before));
    const file = yield* fs
      .open(path, { flag: 'r', noFollow: true })
      .pipe(Effect.mapError(() => failure('ReadFailed')));
    const opened = yield* file.stat.pipe(Effect.mapError(() => failure('ReadFailed')));
    yield* Effect.fromResult(regular(opened));
    yield* Effect.fromResult(requireCondition(sameSnapshot(before, opened), 'FileChanged'));
    const bytes = yield* readBytes(file);
    const after = yield* file.stat.pipe(Effect.mapError(() => failure('ReadFailed')));
    yield* Effect.fromResult(regular(after));
    const current = yield* fs.stat(path).pipe(Effect.mapError(() => failure('ReadFailed')));
    const unchanged =
      sameSnapshot(opened, after) &&
      sameSnapshot(opened, current) &&
      opened.size === BigInt(bytes.length);
    yield* Effect.fromResult(requireCondition(unchanged, 'FileChanged'));
    const text = yield* decode(bytes);
    return { bytes, text, truncated: false as const, observedAtMs: now() };
  }
  function readRegular(request: ReadId) {
    const program = Effect.gen(() => read(request));
    const scoped = Effect.scoped(program);
    return scoped;
  }

  function* version(request: ToolId) {
    const accepted = Match.value(request).pipe(
      Match.when('Colima', () => true),
      Match.when('Docker', () => true),
      Match.orElse(() => false),
    );
    yield* Effect.fromResult(requireCondition(accepted, 'InvalidRequest'));
    yield* Effect.fromResult(requireCondition(trusted, 'UntrustedParents'));
    const candidate = candidates[request];
    const clientOnly = Match.value(candidate.semantics).pipe(
      Match.when('ClientOnlyVersion', () => true),
      Match.orElse(() => false),
    );
    yield* Effect.fromResult(requireCondition(clientOnly, 'UnsupportedSemantics'));
    const paths = yield* Path.Path;
    yield* Effect.fromResult(
      requireCondition(
        paths.isAbsolute(candidate.path) && paths.isAbsolute(home),
        'InvalidConfiguration',
      ),
    );
    const command = ChildProcess.make(candidate.path, ['--version'], {
      env: { HOME: home },
      extendEnv: false,
      shell: false,
      cwd: home,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      killSignal: 'SIGKILL',
      forceKillAfter: 0,
    });
    const child = yield* command.pipe(Effect.mapError(() => failure('Unavailable')));
    const buffer = new Uint8Array(outputCap);
    let used = 0;
    function* appendChunk(chunk: Uint8Array) {
      yield* Effect.fromResult(
        requireCondition(chunk.length <= buffer.length - used, 'OutputTooLarge', true),
      );
      buffer.set(chunk, used);
      used += chunk.length;
      return used;
    }
    function append(chunk: Uint8Array) {
      const program = Effect.gen(() => appendChunk(chunk));
      return program;
    }
    const output = child.all.pipe(Stream.mapError(() => failure('CommandFailed')));
    const collect = Stream.runForEach(output, append);
    yield* collect;
    const exitCode = yield* child.exitCode.pipe(Effect.mapError(() => failure('CommandFailed')));
    yield* Effect.fromResult(requireCondition(exitCode === 0, 'NonzeroExit'));
    const bytes = buffer.slice(0, used);
    const text = yield* decode(bytes);
    return { bytes, text, truncated: false as const, observedAtMs: now() };
  }
  function runVersion(request: ToolId) {
    const program = Effect.gen(() => version(request));
    const bounded = program.pipe(
      Effect.timeout('5 seconds'),
      Effect.catchTag('TimeoutError', () => Effect.fail(failure('TimedOut'))),
    );
    const scoped = Effect.scoped(bounded);
    return scoped;
  }
  return { readRegular, runVersion };
}
