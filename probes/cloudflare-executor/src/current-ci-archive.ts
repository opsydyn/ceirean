import { Parser, type ReadEntry } from '../node_modules/npm/node_modules/tar/dist/esm/parse.js';
import { cacheLimits, type CacheEntry } from './linux-qualification/cache.ts';

export function archiveReadback(
  entries: readonly CacheEntry[],
  descriptor: { sha256: string; bytes: number },
) {
  const expected = new Map(
    entries.map((entry) => [
      ['portable-bun-seed', entry.path].filter((part) => part !== '.').join('/'),
      entry,
    ]),
  );
  const seen = new Set<string>();
  let invalid = false;
  let ended = false;
  let total = 0;
  function inspect(entry: ReadEntry) {
    const name = entry.path.replace(/\/$/, '');
    const record = expected.get(name);
    const descriptorFile = name === 'bun-seed-descriptor.json';
    invalid ||= seen.has(name) || (record === undefined && !descriptorFile);
    seen.add(name);
    let bytes = 0;
    const hash = new Bun.CryptoHasher('sha256');
    function data(chunk: Uint8Array) {
      bytes += chunk.length;
      total += chunk.length;
      invalid ||= bytes > cacheLimits.entryBytes || total > cacheLimits.totalBytes + 67108864;
      hash.update(chunk);
    }
    function finish() {
      const digest = hash.digest('hex');
      let matching =
        record !== undefined && record.type === entry.type && record.mode === entry.mode;
      if (record?.type === 'File') matching &&= bytes === record.size && digest === record.sha256;
      if (record?.type === 'SymbolicLink') matching &&= entry.linkpath === record.target;
      const matchingDescriptor =
        descriptorFile &&
        entry.type === 'File' &&
        entry.mode === 0o600 &&
        bytes === descriptor.bytes &&
        digest === descriptor.sha256;
      invalid ||= !(matchingDescriptor || matching);
    }
    entry.on('data', data);
    entry.on('end', finish);
    entry.resume();
  }
  const parser = new Parser({
    strict: true,
    brotli: false,
    zstd: false,
    maxMetaEntrySize: 8192,
    onReadEntry: inspect,
  });
  const fail = () => {
    invalid = true;
  };
  parser.on('error', fail).on('warn', fail).on('ignoredEntry', fail);
  parser.on('end', () => {
    ended = true;
  });
  return {
    write: (bytes: Uint8Array) => {
      parser.write(bytes);
      return !invalid;
    },
    finish: () => {
      parser.end();
      return !invalid && ended && seen.size === expected.size + 1;
    },
    close: () => parser.abort(new Error('Closed')),
  };
}
