import { Data, Effect, FileSystem, Match, Option, Result, Schema } from 'effect';

import {
  archiveLimits,
  limitsFit,
  makeArchiveInspector,
  type ArchiveLimits,
  type ArchiveBudget,
} from './npm-tar-parser.ts';
import { PreparedInputs } from './prepared-inputs.ts';

export { archiveLimits } from './npm-tar-parser.ts';
export class ArchiveError extends Data.TaggedError('ArchiveError')<{
  readonly code: 'ArchiveRefused' | 'InputChanged';
}> {}
const refused = () => new ArchiveError({ code: 'ArchiveRefused' });
const isFile = Schema.is(Schema.Literal('File'));
const isRegistry = Schema.is(Schema.Literal('https://registry.npmjs.org'));
function requireArchive(valid: boolean, code: ArchiveError['code'] = 'ArchiveRefused') {
  const result = Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new ArchiveError({ code }),
    ),
    Effect.fromResult,
  );
  return result;
}
export function inspectArchive(
  chunks: Iterable<Uint8Array>,
  size: number,
  limits: ArchiveLimits = archiveLimits,
  budget: ArchiveBudget = { raw: 0, expanded: 0, entries: 0 },
) {
  function* inspect() {
    yield* requireArchive(
      limitsFit(limits) && Number.isSafeInteger(size) && size >= 18 && size <= limits.artifactBytes,
    );
    const acquiring = Effect.try({
      try: () => makeArchiveInspector(size, limits, budget),
      catch: refused,
    });
    const inspector = yield* Effect.acquireRelease(acquiring, (value) => Effect.sync(value.close));
    for (const chunk of chunks) {
      for (let offset = 0; offset < chunk.length; offset += 65536) {
        const accepted = yield* Effect.try({
          try: () => inspector.write(chunk.subarray(offset, offset + 65536)),
          catch: refused,
        });
        yield* requireArchive(accepted);
      }
    }
    const result = yield* Effect.try({ try: inspector.finish, catch: refused });
    yield* requireArchive(result.valid);
    return { expandedBytes: result.expandedBytes, entries: result.entries, paths: result.paths };
  }
  const workflow = Effect.gen(inspect);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
async function digest(bytes: Uint8Array, algorithm: 'SHA-256' | 'SHA-512') {
  return new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(bytes)));
}
function route(url: string) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  const valid =
    isRegistry(parsed.origin) &&
    url === parsed.origin + path &&
    /^\/(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+\/-\/[A-Za-z0-9_.+-]+\.tgz$/.test(path);
  return Match.value(valid).pipe(
    Match.when(true, () => path),
    Match.orElse(() => undefined),
  );
}
function readArtifact(absolute: string, size: number) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(absolute, { flag: 'r', noFollow: true });
    const info = yield* file.stat;
    yield* requireArchive(isFile(info.type) && info.size === BigInt(size), 'InputChanged');
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < bytes.length) {
      const part = yield* file.readAlloc(Math.min(65536, bytes.length - offset));
      yield* requireArchive(
        Option.isSome(part) && part.value.length > 0 && part.value.length <= bytes.length - offset,
        'InputChanged',
      );
      const data = yield* Effect.fromOption(part);
      bytes.set(data, offset);
      offset += data.length;
    }
    yield* requireArchive(Option.isNone(yield* file.readAlloc(1)), 'InputChanged');
    return bytes;
  }
  const workflow = Effect.gen(read);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
export function admitArchives(rawInputs: PreparedInputs, limits: ArchiveLimits = archiveLimits) {
  function* admit() {
    const inputs = yield* Schema.decodeUnknownEffect(PreparedInputs, { onExcessProperty: 'error' })(
      rawInputs,
    );
    yield* requireArchive(limitsFit(limits));
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(inputs.root);
    const boundedInventory =
      inputs.artifacts.length > 0 && inputs.artifacts.length <= limits.totalEntries;
    const validRoot = root === inputs.root && boundedInventory;
    yield* requireArchive(validRoot);
    const budget: ArchiveBudget = { raw: 0, expanded: 0, entries: 0 };
    const blobs = new Map<string, Uint8Array>();
    const identities = new Set<string>();
    for (const [index, artifact] of inputs.artifacts.entries()) {
      const path = yield* Effect.try({ try: () => route(artifact.url), catch: refused });
      const rawFits =
        artifact.size <= limits.artifactBytes &&
        artifact.size <= limits.totalArtifactBytes - budget.raw;
      const validArtifact =
        path !== undefined &&
        !blobs.has(path) &&
        !identities.has(artifact.identity) &&
        artifact.path === `artifacts/${String(index).padStart(4, '0')}.tgz` &&
        rawFits;
      yield* requireArchive(validArtifact, 'InputChanged');
      budget.raw += artifact.size;
      const absolute = `${root}/${artifact.path}`;
      yield* requireArchive((yield* fs.realPath(absolute)) === absolute, 'InputChanged');
      const bytes = yield* readArtifact(absolute, artifact.size);
      const sha256 = yield* Effect.tryPromise({
        try: () => digest(bytes, 'SHA-256'),
        catch: refused,
      });
      const sha512 = yield* Effect.tryPromise({
        try: () => digest(bytes, 'SHA-512'),
        catch: refused,
      });
      yield* requireArchive(
        Array.from(sha256, (byte) => byte.toString(16).padStart(2, '0')).join('') ===
          artifact.sha256 &&
          `sha512-${Buffer.from(sha512).toString('base64')}` === artifact.integrity,
        'InputChanged',
      );
      yield* inspectArchive([bytes], bytes.length, limits, budget);
      blobs.set(path!, bytes);
      identities.add(artifact.identity);
    }
    return Object.freeze({
      summary: Object.freeze({
        artifacts: blobs.size,
        entries: budget.entries,
        expandedBytes: budget.expanded,
        rawBytes: budget.raw,
      }),
      read: (path: string) => blobs.get(path)?.slice(),
    });
  }
  const workflow = Effect.gen(admit);
  return workflow;
}
export type AdmittedArtifacts = Effect.Success<ReturnType<typeof admitArchives>>;
