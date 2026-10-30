import { ManifestInspectionInput } from '@ceirean/domain';
import { Data, Effect, Match, Result, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

import { ManifestBaseline, manifestLimits } from './manifest-baseline.ts';

export class ManifestSourceError extends Data.TaggedError('ManifestSourceError')<{
  readonly code:
    | 'GitFailed'
    | 'MissingObject'
    | 'InvalidTreeEntry'
    | 'InvalidEncoding'
    | 'SourceTooLarge'
    | 'InvalidSource';
}> {}
function refusal(code: ManifestSourceError['code']) {
  return new ManifestSourceError({ code });
}
function requireSource(condition: boolean, code: ManifestSourceError['code']) {
  return Match.value(condition).pipe(
    Match.when(true, () => Effect.succeed(true)),
    Match.orElse(() => Effect.fail(refusal(code))),
  );
}
function collect(stream: Stream.Stream<Uint8Array, unknown>, maximum: number) {
  function* read() {
    const chunks: Uint8Array[] = [];
    let used = 0;
    function append(chunk: Uint8Array) {
      function* bounded() {
        yield* requireSource(chunk.byteLength <= maximum - used, 'SourceTooLarge');
        used += chunk.byteLength;
        chunks.push(new Uint8Array(chunk));
      }
      const workflow = Effect.gen(bounded);
      return workflow;
    }
    yield* Stream.runForEach(stream, append);
    const bytes = new Uint8Array(used);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  const workflow = Effect.gen(read);
  return workflow;
}
function git(root: string, args: ReadonlyArray<string>, maximum: number) {
  function* run() {
    const child = yield* ChildProcess.make(
      '/usr/bin/git',
      ['-c', 'protocol.allow=never', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd: root,
        shell: false,
        extendEnv: false,
        env: {
          PATH: '/usr/bin:/bin',
          LANG: 'C',
          LC_ALL: 'C',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_NO_REPLACE_OBJECTS: '1',
          GIT_NO_LAZY_FETCH: '1',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        killSignal: 'SIGKILL',
        forceKillAfter: 0,
      },
    );
    const [bytes, , code] = yield* Effect.all(
      [collect(child.stdout, maximum), collect(child.stderr, 4096), child.exitCode],
      { concurrency: 3 },
    );
    yield* requireSource(code === 0, 'MissingObject');
    return bytes;
  }
  const workflow = Effect.gen(run);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
function decodeText(bytes: Uint8Array) {
  const decoding = Effect.try({
    try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    catch: () => refusal('InvalidEncoding'),
  });
  return decoding;
}
const TreeText = Schema.String.check(
  Schema.isPattern(/^(100644|100755) blob [0-9a-f]{40}\t[^\0]+\0$/),
);
const SizeText = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,10})\n$/));
const decodeTree = Schema.decodeUnknownResult(TreeText);
const decodeObjectId = Schema.decodeUnknownResult(ManifestInspectionInput.fields.commit);
const decodeBaseline = Schema.decodeUnknownResult(ManifestBaseline, { onExcessProperty: 'error' });
const decodeSize = Schema.decodeUnknownResult(SizeText);
const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));
const decodeInput = Schema.decodeUnknownResult(ManifestInspectionInput);
const isCommit = Schema.is(Schema.Literal('commit\n'));
function treeEntry(text: string, path: string) {
  function* parse() {
    yield* Effect.fromResult(
      decodeTree(text).pipe(Result.mapError(() => refusal('InvalidTreeEntry'))),
    );
    const [header, recordedPath] = text.slice(0, -1).split('\t');
    yield* requireSource(recordedPath === path, 'InvalidTreeEntry');
    const blob = header?.split(' ')[2];
    return yield* Effect.fromResult(
      decodeObjectId(blob).pipe(Result.mapError(() => refusal('InvalidTreeEntry'))),
    );
  }
  const workflow = Effect.gen(parse);
  return workflow;
}
const isSourceError = Schema.is(
  Schema.Struct({
    _tag: Schema.Literal('ManifestSourceError'),
    code: Schema.Literals([
      'GitFailed',
      'MissingObject',
      'InvalidTreeEntry',
      'InvalidEncoding',
      'SourceTooLarge',
      'InvalidSource',
    ]),
  }),
);
function sourceError(error: unknown) {
  return Match.value(error).pipe(
    Match.when(isSourceError, (e) => refusal(e.code)),
    Match.orElse(() => refusal('GitFailed')),
  );
}
export function readPinnedManifests(repositoryPath: string, baseline: ManifestBaseline) {
  function* read() {
    const selected = yield* Effect.fromResult(
      decodeBaseline(baseline).pipe(Result.mapError(() => refusal('InvalidSource'))),
    );
    const typeBytes = yield* git(repositoryPath, ['cat-file', '-t', selected.commit], 32);
    const type = yield* decodeText(typeBytes);
    yield* requireSource(isCommit(type), 'InvalidSource');
    const manifests = [];
    let used = 0;
    for (const path of selected.paths) {
      const treeBytes = yield* git(
        repositoryPath,
        ['ls-tree', '-z', '--full-tree', selected.commit, '--', path],
        4096,
      );
      const tree = yield* decodeText(treeBytes);
      const blob = yield* treeEntry(tree, path);
      const sizeBytes = yield* git(repositoryPath, ['cat-file', '-s', blob], 32);
      const sizeText = yield* decodeText(sizeBytes);
      yield* Effect.fromResult(
        decodeSize(sizeText).pipe(Result.mapError(() => refusal('InvalidSource'))),
      );
      const size = Number(sizeText.trim());
      yield* requireSource(
        size <= manifestLimits.perFile && size <= manifestLimits.source - used,
        'SourceTooLarge',
      );
      const bytes = yield* git(
        repositoryPath,
        ['cat-file', 'blob', blob],
        Math.min(manifestLimits.perFile, manifestLimits.source - used),
      );
      yield* requireSource(bytes.byteLength === size, 'InvalidSource');
      const verifiedBlob = new Bun.CryptoHasher('sha1')
        .update(`blob ${bytes.byteLength}\0`)
        .update(bytes)
        .digest('hex');
      yield* requireSource(verifiedBlob === blob, 'InvalidSource');
      used += bytes.byteLength;
      const text = yield* decodeText(bytes);
      const document = yield* Effect.fromResult(
        decodeJson(text).pipe(Result.mapError(() => refusal('InvalidSource'))),
      );
      const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      manifests.push({ path, blobId: blob, sha256, document });
    }
    return yield* Effect.fromResult(
      decodeInput({
        repository: selected.repository,
        commit: selected.commit,
        manifests,
      }).pipe(Result.mapError(() => refusal('InvalidSource'))),
    );
  }
  const workflow = Effect.gen(read);
  return workflow.pipe(Effect.mapError(sourceError));
}
