import { InflateRaw } from '../../node_modules/npm/node_modules/minizlib/dist/esm/index.js';
import { Header } from '../../node_modules/npm/node_modules/tar/dist/esm/header.js';
import { Parser, type ReadEntry } from '../../node_modules/npm/node_modules/tar/dist/esm/parse.js';
import { isInertArchiveOwnership, type InertArchiveOwnership } from '../inert-archive-ownership.ts';

export const archiveLimits = {
  artifactBytes: 67108864,
  totalArtifactBytes: 536870912,
  expandedPackageBytes: 268435456,
  expandedEntryBytes: 201326592,
  totalExpandedBytes: 2147483648,
  packageEntries: 10000,
  totalEntries: 200000,
  pathBytes: 512,
} as const;
export type ArchiveLimits = { readonly [K in keyof typeof archiveLimits]: number };
export type ArchiveBudget = { raw: number; expanded: number; entries: number };
export function limitsFit(limits: ArchiveLimits) {
  return (
    Object.entries(limits).length === Object.keys(archiveLimits).length &&
    Object.entries(limits).every(
      ([key, value]) =>
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= archiveLimits[key as keyof ArchiveLimits],
    )
  );
}
function safePath(path: string, directory: boolean, maximum: number) {
  const name = path.replace(/\/$/, '');
  const parts = name.split('/');
  function safeCharacter(character: string) {
    const code = character.codePointAt(0)!;
    return code >= 32 && (code < 127 || code > 159) && !'\\%:'.includes(character);
  }
  const safeCharacters = Array.from(path).every(safeCharacter);
  return (
    new TextEncoder().encode(path).length <= maximum &&
    path.normalize('NFC') === path &&
    safeCharacters &&
    parts[0] === 'package' &&
    (directory || parts.length > 1) &&
    parts.every(
      (part) => part.length > 0 && part !== '.' && part !== '..' && !/^[\s]|[\s.]$/u.test(part),
    ) &&
    (directory || !path.endsWith('/'))
  );
}
// Basic, single-member gzip envelope only. Deflate and tar decoding use pinned npm libraries.
function crc32(crc: number, bytes: Uint8Array) {
  let next = crc;
  for (const byte of bytes) {
    next ^= byte;
    for (let bit = 0; bit < 8; bit++) next = (next >>> 1) ^ (0xedb88320 & -(next & 1));
  }
  return next >>> 0;
}
function strictOctalField(bytes: Uint8Array) {
  let terminated = false;
  let digits = 0;
  for (const byte of bytes) {
    if (byte === 0 || byte === 32) terminated = true;
    else if (!terminated && byte >= 48 && byte <= 55) digits++;
    else return false;
  }
  return digits > 0 || bytes.every((byte) => byte === 0 || byte === 32);
}
function octalFieldValue(bytes: Buffer) {
  if (bytes.every((byte) => byte === 0 || byte === 32)) return 0;
  return Number.parseInt(bytes.toString('ascii'), 8);
}
function exactChecksum(raw: Buffer) {
  const field = raw.subarray(148, 156);
  if (!strictOctalField(field)) return false;
  let checksum = 0;
  for (let index = 0; index < 512; index++) {
    checksum += index >= 148 && index < 156 ? 32 : raw[index]!;
  }
  return octalFieldValue(field) === checksum;
}
// USTAR permits different octal widths/padding. Keep every nonnumeric byte exact.
function equivalentHeader(raw: Buffer, canonical: Buffer) {
  if (!exactChecksum(raw)) return false;
  if (raw.equals(canonical)) return true;
  const normalized = Buffer.from(raw);
  const fields = [
    [100, 8],
    [108, 8],
    [116, 8],
    [124, 12],
    [136, 12],
    [148, 8],
    [329, 8],
    [337, 8],
  ] as const;
  for (const [offset, length] of fields) {
    const actual = raw.subarray(offset, offset + length);
    const expected = canonical.subarray(offset, offset + length);
    if (!actual.equals(expected)) {
      if (!strictOctalField(actual)) return false;
      // A directory's nonzero wire size must not disappear through codec normalization.
      if (offset !== 148) {
        const value = octalFieldValue(actual);
        const canonicalValue = octalFieldValue(expected);
        if (!Number.isSafeInteger(value) || value !== canonicalValue) return false;
      }
      canonical.copy(normalized, offset, offset, offset + length);
    }
  }
  return normalized.equals(canonical);
}
function parserState(
  limits: ArchiveLimits,
  budget: ArchiveBudget,
  ownership?: InertArchiveOwnership,
) {
  const inert = isInertArchiveOwnership(ownership);
  const allowedId = (id: number | undefined) =>
    id === undefined ||
    id === 0 ||
    (inert && Number.isSafeInteger(id) && id >= 0 && id <= 4294967294);
  let invalid = false;
  let expanded = 0;
  let crc = 0xffffffff;
  let count = 0;
  let nullBlocks = 0;
  let eof = false;
  let ended = false;
  let active: ReadEntry | undefined;
  let block = Buffer.alloc(512);
  let filled = 0;
  const destinations = new Map<string, 'File' | 'Directory'>();
  const parents = new Set<string>();
  const paths: string[] = [];
  function filter(path: string, entry: ReadEntry) {
    const header = entry.header;
    const directory = entry.type === 'Directory';
    const canonical = Buffer.alloc(512);
    const extended = new Header({ ...header, type: entry.type }).encode(canonical);
    const name = path.replace(/\/$/, '').toLowerCase();
    const parts = name.split('/');
    const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
    const allowed =
      !invalid &&
      nullBlocks === 0 &&
      !extended &&
      equivalentHeader(block, canonical) &&
      (entry.type === 'File' || directory) &&
      safePath(path, directory, limits.pathBytes) &&
      allowedId(header.uid) &&
      allowedId(header.gid) &&
      !header.uname &&
      !header.gname &&
      !header.linkpath &&
      !header.devmaj &&
      !header.devmin &&
      Number.isSafeInteger(header.mode) &&
      header.mode >= 0 &&
      header.mode <= 0o777 &&
      Number.isSafeInteger(entry.size) &&
      entry.size >= 0 &&
      entry.size <= limits.expandedEntryBytes &&
      !destinations.has(name) &&
      !ancestors.some((parent) => destinations.get(parent) === 'File') &&
      (directory || !parents.has(name)) &&
      count < limits.packageEntries &&
      budget.entries < limits.totalEntries;
    if (!allowed) {
      invalid = true;
      return false;
    }
    count++;
    budget.entries++;
    destinations.set(name, directory ? 'Directory' : 'File');
    for (const ancestor of ancestors) parents.add(ancestor);
    paths.push(path);
    active = entry;
    entry.on('end', () => {
      active = undefined;
    });
    entry.resume();
    return true;
  }
  const parser = new Parser({
    strict: true,
    brotli: false,
    zstd: false,
    maxMetaEntrySize: 1,
    filter,
  });
  const fail = () => {
    invalid = true;
  };
  parser.on('error', fail).on('warn', fail).on('ignoredEntry', fail).on('meta', fail);
  parser.on('nullBlock', () => {
    nullBlocks++;
  });
  parser.on('eof', () => {
    eof = true;
  });
  parser.on('end', () => {
    ended = true;
  });
  function push(bytes: Uint8Array) {
    if (invalid) return;
    // Reserve all stream bytes, including metadata/headers/padding, before parser acceptance.
    const fits =
      bytes.length <= limits.expandedPackageBytes - expanded &&
      bytes.length <= limits.totalExpandedBytes - budget.expanded;
    if (!fits) {
      invalid = true;
      return;
    }
    expanded += bytes.length;
    budget.expanded += bytes.length;
    crc = crc32(crc, bytes);
    for (const byte of bytes) {
      if (eof || invalid) {
        invalid = true;
        return;
      }
      block[filled++] = byte;
      if (filled === 512) {
        // Parser skips zero-size extended headers without an event. Inspect each
        // header with its own proven codec before allowing that normalization.
        if (!active && block.some((value) => value !== 0)) {
          const header = new Header(block);
          if (header.type !== 'File' && header.type !== 'Directory') {
            invalid = true;
            return;
          }
        }
        const badPadding =
          active &&
          active.remain < 512 &&
          block.subarray(active.remain).some((value) => value !== 0);
        if (badPadding) {
          invalid = true;
          return;
        }
        parser.write(block);
        block = Buffer.alloc(512);
        filled = 0;
      }
    }
  }
  function finish() {
    parser.end();
    return {
      valid: !invalid && filled === 0 && eof && ended && nullBlocks === 1 && count > 0,
      expandedBytes: expanded,
      entries: count,
      paths,
      crc: (crc ^ 0xffffffff) >>> 0,
    };
  }
  return { push, finish, invalid: () => invalid };
}

// Synchronous streaming codec adapter; the owning Effect acquires/releases its native handle.
export function makeArchiveInspector(
  size: number,
  limits: ArchiveLimits,
  budget: ArchiveBudget,
  ownership?: InertArchiveOwnership,
) {
  const state = parserState(limits, budget, ownership);
  const inflate = new InflateRaw({ chunkSize: 512 });
  let position = 0;
  let invalid = false;
  const header = new Uint8Array(10);
  const footer = new Uint8Array(8);
  inflate.on('data', state.push);
  inflate.on('error', () => {
    invalid = true;
  });
  function write(chunk: Uint8Array) {
    if (chunk.length > size - position) return false;
    for (let offset = 0; offset < chunk.length;) {
      if (position < 10) {
        header[position++] = chunk[offset++]!;
        continue;
      }
      if (position >= size - 8) {
        footer[position++ - (size - 8)] = chunk[offset++]!;
        continue;
      }
      const supported =
        header[0] === 0x1f && header[1] === 0x8b && header[2] === 8 && header[3] === 0;
      if (!supported) return false;
      // At most 64 input bytes per native call bounds temporary expansion work/buffering.
      const length = Math.min(64, chunk.length - offset, size - 8 - position);
      inflate.write(chunk.subarray(offset, offset + length));
      if (invalid || state.invalid() || inflate.handle?.bytesWritten !== length) return false;
      offset += length;
      position += length;
    }
    return true;
  }
  function finish() {
    inflate.end();
    const result = state.finish();
    const trailer = new DataView(footer.buffer);
    return {
      ...result,
      valid:
        position === size &&
        !invalid &&
        result.valid &&
        trailer.getUint32(0, true) === result.crc &&
        trailer.getUint32(4, true) === result.expandedBytes,
    };
  }
  return { write, finish, close: () => inflate.close() };
}
