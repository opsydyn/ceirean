import { Effect, FileSystem } from 'effect';

import { Header } from '../node_modules/npm/node_modules/tar/dist/esm/header.js';
import type { PreparedInputs } from '../src/linux-qualification/prepared-inputs.ts';
import { inputPins, toolPins } from '../src/linux-qualification/tool-pins.ts';

export const encode = (text: string) => new TextEncoder().encode(text);
export async function hash(bytes: Uint8Array, algorithm = 'SHA-256') {
  return new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(bytes)));
}
export const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
export function join(chunks: readonly Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export type FixtureEntry = {
  path: string;
  type?: string;
  content?: string;
  size?: number;
  mode?: number;
  uid?: number;
  uname?: string;
  linkpath?: string;
};
export function tar(entries: readonly FixtureEntry[], tail = new Uint8Array(1024)) {
  function makeEntry(entry: FixtureEntry) {
    const data = encode(entry.content ?? '');
    const header = new Header({
      path: entry.path,
      type: entry.type ?? 'File',
      mode: entry.mode ?? 0o644,
      uid: entry.uid ?? 0,
      gid: 0,
      uname: entry.uname ?? '',
      gname: '',
      size: entry.size ?? data.length,
      linkpath: entry.linkpath ?? '',
    });
    const block = Buffer.alloc(512);
    header.encode(block);
    return [block, data, new Uint8Array((512 - (data.length % 512)) % 512)];
  }
  return join([...entries.flatMap(makeEntry), tail]);
}
export async function gzip(bytes: Uint8Array) {
  return new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
}
export const goodTar = () => tar([{ path: 'package/a.txt', content: 'hello' }]);
export async function digest(bytes: Uint8Array, index = 0) {
  return {
    identity: `fixture-${index}@1.0.0`,
    url: `https://registry.npmjs.org/fixture-${index}/-/fixture-${index}-1.0.0.tgz`,
    integrity: `sha512-${Buffer.from(await hash(bytes, 'SHA-512')).toString('base64')}`,
    path: `artifacts/${String(index).padStart(4, '0')}.tgz`,
    size: bytes.length,
    sha256: hex(await hash(bytes)),
  };
}
export function stage(blobs: readonly Uint8Array[]) {
  function* prepareStage() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-task3-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.makeDirectory(`${root}/artifacts`);
    const artifacts = [];
    for (const [index, bytes] of blobs.entries()) {
      const entry = yield* Effect.promise(() => digest(bytes, index));
      yield* fs.writeFile(`${root}/${entry.path}`, bytes);
      artifacts.push(entry);
    }
    const sha = 'a'.repeat(64);
    const limits = {
      jobMs: 900000,
      qualificationMs: 540000,
      commandMs: 90000,
      cleanupMs: 30000,
      jobs: 1,
      automaticRetries: 0,
      cpus: 2,
      memoryBytes: 4294967296,
      swapBytes: 4294967296,
      pids: 128,
      tmpfsBytes: 3221225472,
      artifactBytes: 67108864,
      totalArtifactBytes: 536870912,
      expandedPackageBytes: 268435456,
      expandedEntryBytes: 201326592,
      totalExpandedBytes: 2147483648,
      packageEntries: 10000,
      totalEntries: 200000,
      pathBytes: 512,
      evidenceBytes: 16777216,
      streamBytes: 262144,
      retentionDays: 7,
    } as const;
    const inputs: PreparedInputs = {
      activation: 'Blocked',
      root,
      artifacts,
      admission: {
        request: {
          authority: 'RequiresRunWorksheet',
          ceireanRevision: 'a'.repeat(40),
          lockBlob: 'b'.repeat(40),
          harnessSha256: sha,
          toolCapsuleSha256: sha,
          sourceRevision: inputPins.sourceRevision,
          sourceTree: inputPins.sourceTree,
          inventorySha256: inputPins.inventorySha256,
          registry: 'http://127.0.0.1:4873',
          run: { runner: 'ubuntu-24.04', runId: 'synthetic-task3', attempt: 1 },
          tools: toolPins,
          limits,
        },
        source: {
          provenance: 'ValidatedInputBoundary',
          revision: inputPins.sourceRevision,
          tree: inputPins.sourceTree,
          inventorySha256: inputPins.inventorySha256,
          sha256: sha,
        },
      },
      source: { files: [], sha256: sha },
      catalog: { path: 'catalog/inventory.lock', sha256: sha, inputs: [] },
      tools: {
        files: [],
        sha256: sha,
        lockBlob: 'b'.repeat(40),
        lockSha256: sha,
        nodeConfigSha256: sha,
      },
      readbacks: {
        os: 'Linux',
        git: { path: '/usr/bin/git', version: 'fixture' },
        docker: { path: '/usr/bin/docker', version: 'fixture' },
      },
    };
    return inputs;
  }
  const workflow = Effect.gen(prepareStage);
  return workflow;
}
