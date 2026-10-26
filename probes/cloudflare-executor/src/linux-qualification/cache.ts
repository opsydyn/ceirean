import { Context, Data, Effect, FileSystem, Match, Option, Path, Result, Schema } from 'effect';

import { lstatMetadata } from '../../scripts/linux-cache-platform.ts';

export function makeCacheMetadata() {
  function lstat(path: string) {
    const reading = Effect.tryPromise({
      try: () => lstatMetadata(path),
      catch: () => new CacheError({ code: 'CacheRefused' }),
    });
    return reading;
  }
  return { lstat };
}
export class CacheMetadata extends Context.Service<
  CacheMetadata,
  ReturnType<typeof makeCacheMetadata>
>()('ceirean/CacheMetadata') {}

export const cacheLimits = {
  entryBytes: 201326592,
  totalBytes: 2147483648,
  entries: 200000,
  pathBytes: 512,
} as const;
export type CacheLimits = { readonly [K in keyof typeof cacheLimits]: number };
const fields = { path: Schema.String, mode: Schema.Int };
export const CacheEntry = Schema.Union([
  Schema.Struct({ ...fields, type: Schema.Literal('Directory') }),
  Schema.Struct({
    ...fields,
    type: Schema.Literal('File'),
    size: Schema.Int,
    sha256: Schema.String,
  }),
  Schema.Struct({
    ...fields,
    type: Schema.Literal('SymbolicLink'),
    target: Schema.String,
    resolved: Schema.String,
  }),
]);
export type CacheEntry = typeof CacheEntry.Type;
type Metadata = Effect.Success<ReturnType<ReturnType<typeof makeCacheMetadata>['lstat']>>;
type Identity = { readonly dev: bigint; readonly ino: bigint };
export type SealedCache = {
  readonly root: string;
  readonly sha256: string;
  readonly policy: 'CacheModesV1';
  readonly materializedInventory: readonly CacheEntry[];
  readonly inventory: readonly CacheEntry[];
  readonly caseInventory: readonly CacheEntry[];
};
export type CaseCache = {
  readonly root: string;
  readonly seedSha256: string;
  readonly sha256: string;
  readonly inventory: readonly CacheEntry[];
};
type SealState = {
  readonly limits: CacheLimits;
  readonly identities: ReadonlyMap<string, Identity>;
};
const seals = new WeakMap<SealedCache, SealState>();
const copies = new WeakMap<CaseCache, SealedCache>();
const roots = new Set<string>();
const isFile = Schema.is(Schema.Literal('File'));
const isDirectory = Schema.is(Schema.Literal('Directory'));
const isLink = Schema.is(Schema.Literal('SymbolicLink'));
const isRootEntry = Schema.is(Schema.Literal('.'));
const isDotSegment = Schema.is(Schema.Literals(['.', '..']));
const isFilesystemRoot = Schema.is(Schema.Literal('/'));
const Inventory = Schema.Array(CacheEntry);
const InventoryJson = Schema.fromJsonString(Inventory);
const encodeInventory = Schema.encodeSync(InventoryJson);
function order(left: string, right: string) {
  const compared = Match.value(left).pipe(
    Match.when(
      () => left === right,
      () => 0,
    ),
    Match.when(
      () => left < right,
      () => -1,
    ),
    Match.orElse(() => 1),
  );
  return compared;
}

export class CacheError extends Data.TaggedError('CacheError')<{
  readonly code: 'CacheRefused' | 'InputChanged' | 'DestinationRefused';
}> {}
function requireCache(valid: boolean, code: CacheError['code'] = 'CacheRefused') {
  const checked = Result.succeed(true).pipe(
    Result.filterOrFail(
      () => valid,
      () => new CacheError({ code }),
    ),
    Effect.fromResult,
  );
  return checked;
}
function limitsFit(limits: CacheLimits) {
  return (
    Object.keys(limits).length === Object.keys(cacheLimits).length &&
    Object.entries(limits).every(
      ([key, value]) =>
        Number.isSafeInteger(value) && value > 0 && value <= cacheLimits[key as keyof CacheLimits],
    )
  );
}
function safeText(text: string, maximum: number) {
  const lengthFits = text.length > 0 && new TextEncoder().encode(text).length <= maximum;
  const charactersFit = Array.from(text).every(safeCharacter);
  return lengthFits && charactersFit && text.normalize('NFC') === text;
}
function safeCharacter(character: string) {
  const code = character.codePointAt(0)!;
  const printable = code >= 32 && code !== 127;
  const notC1 = code < 128 || code > 159;
  return printable && notC1 && !'\\:'.includes(character);
}
function safeSegment(part: string) {
  return part.length > 0 && !isDotSegment(part) && !/^[\s]|[\s.]$/u.test(part);
}
function safeRelative(path: string, maximum: number) {
  return safeText(path, maximum) && path.split('/').every(safeSegment);
}
const within = (root: string, path: string) => path === root || path.startsWith(`${root}/`);
const overlap = (left: string, right: string) =>
  within(left.toLowerCase(), right.toLowerCase()) ||
  within(right.toLowerCase(), left.toLowerCase());
const absolute = (root: string, entry: CacheEntry) =>
  Match.value(entry.path).pipe(
    Match.when('.', () => root),
    Match.orElse((path) => `${root}/${path}`),
  );
const identityEqual = (left: Identity, right: Identity) =>
  left.dev === right.dev && left.ino === right.ino;
function metadataEqual(left: Metadata, right: Metadata) {
  const typeAndMode = left.type === right.type && left.mode === right.mode;
  const sizeAndLinks = left.size === right.size && left.nlink === right.nlink;
  return identityEqual(left, right) && typeAndMode && sizeAndLinks;
}
async function digest(bytes: Uint8Array) {
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(result, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function hash(bytes: Uint8Array) {
  const hashing = Effect.tryPromise({
    try: () => digest(bytes),
    catch: () => new CacheError({ code: 'InputChanged' }),
  });
  return hashing;
}
function inventoryHash(entries: readonly CacheEntry[]) {
  const json = encodeInventory(entries);
  const bytes = new TextEncoder().encode(json);
  const hashing = hash(bytes);
  return hashing;
}
function readBytes(path: string, expected: Metadata, maximum: number) {
  function* read() {
    const fs = yield* FileSystem.FileSystem;
    yield* requireCache(
      isFile(expected.type) && expected.size >= 0n && expected.size <= BigInt(maximum),
      'InputChanged',
    );
    const file = yield* fs.open(path, { flag: 'r', noFollow: true });
    const before = yield* file.stat;
    const inodeMatches = before.dev === expected.dev && Option.contains(expected.ino)(before.ino);
    const modeMatches =
      (before.mode & 0o7777) === expected.mode && Option.contains(1n)(before.nlink);
    yield* requireCache(
      before.size === expected.size && inodeMatches && modeMatches,
      'InputChanged',
    );
    const bytes = new Uint8Array(Number(expected.size));
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = yield* file.readAlloc(Math.min(65536, bytes.length - offset));
      yield* requireCache(
        Option.isSome(chunk) &&
          chunk.value.length > 0 &&
          chunk.value.length <= bytes.length - offset,
        'InputChanged',
      );
      const data = yield* Effect.fromOption(chunk);
      bytes.set(data, offset);
      offset += data.length;
    }
    yield* requireCache(Option.isNone(yield* file.readAlloc(1)), 'InputChanged');
    const after = yield* file.stat;
    yield* requireCache(
      after.size === expected.size &&
        after.dev === expected.dev &&
        Option.contains(expected.ino)(after.ino),
      'InputChanged',
    );
    return bytes;
  }
  const workflow = Effect.gen(read);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
function validateModes(info: Metadata) {
  const regularPermissions = (info.mode & 0o7000) === 0 && (info.mode & 0o400) === 0o400;
  const independentFile = info.nlink === 1n && info.ino > 0n;
  const allowed = Match.value(info.type).pipe(
    Match.when('Directory', () => (info.mode & 0o7000) === 0 && (info.mode & 0o500) === 0o500),
    Match.when('File', () => regularPermissions && independentFile),
    Match.when('SymbolicLink', () => (info.mode & 0o7000) === 0 && info.nlink === 1n),
    Match.orElse(() => false),
  );
  return allowed;
}
function linkEntry(root: string, name: string, info: Metadata, limits: CacheLimits) {
  function* inspect() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = yield* fs.readLink(`${root}/${name}`);
    const lexical = path.resolve(path.dirname(`${root}/${name}`), target);
    yield* requireCache(safeText(target, limits.pathBytes) && within(root, lexical));
    const targetPath = Match.value(path.isAbsolute(target)).pipe(
      Match.when(true, () => target),
      Match.orElse(() => `${path.dirname(`${root}/${name}`)}/${target}`),
    );
    const resolved = yield* fs.realPath(targetPath);
    yield* requireCache(within(root, resolved));
    const relative = path.relative(root, resolved);
    const destination = Match.value(relative).pipe(
      Match.when('', () => '.'),
      Match.orElse((value) => value),
    );
    return {
      type: 'SymbolicLink' as const,
      path: name,
      mode: info.mode,
      target,
      resolved: destination,
    };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
// A link plus directory-containment edges must remain acyclic, not just resolve once.
function acyclic(entries: readonly CacheEntry[]) {
  const edges = new Map(entries.map((entry) => [entry.path, [] as string[]]));
  const incoming = new Map(entries.map((entry) => [entry.path, 0]));
  for (const entry of entries.filter((value) => !isRootEntry(value.path))) {
    const parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
    const owner = Match.value(entry.path.includes('/')).pipe(
      Match.when(true, () => parent),
      Match.orElse(() => '.'),
    );
    edges.get(owner)?.push(entry.path);
    incoming.set(entry.path, (incoming.get(entry.path) ?? 0) + 1);
  }
  for (const entry of entries) {
    const links = Match.value(entry).pipe(
      Match.when({ type: 'SymbolicLink' }, (value) => [value.resolved]),
      Match.orElse(() => []),
    );
    for (const target of links) {
      edges.get(entry.path)!.push(target);
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }
  const pending = [...incoming].filter(([, count]) => count === 0).map(([name]) => name);
  let visited = 0;
  while (pending.length > 0) {
    const name = pending.pop()!;
    visited++;
    for (const target of edges.get(name) ?? []) {
      const remaining = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, remaining);
      pending.push(...[target].filter(() => remaining === 0));
    }
  }
  return visited === entries.length;
}
function scan(root: string, limits: CacheLimits) {
  function* inspect() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    yield* requireCache(limitsFit(limits) && root.startsWith('/') && !isFilesystemRoot(root));
    yield* requireCache((yield* fs.realPath(root)) === root);
    const rootInfo = yield* metadata.lstat(root);
    yield* requireCache(isDirectory(rootInfo.type));
    const pending = ['.'];
    const entries: CacheEntry[] = [];
    const identities = new Map<string, Metadata>();
    const seen = new Set<string>();
    let total = 0;
    while (pending.length > 0) {
      const name = pending.pop()!;
      const full = absolute(root, { type: 'Directory', path: name, mode: 0 });
      const info = yield* metadata.lstat(full);
      yield* requireCache(validateModes(info) && entries.length < limits.entries);
      identities.set(name, info);
      const reading = Match.value(info.type).pipe(
        Match.when('Directory', () =>
          directoryEntry(root, name, info, limits, pending, seen, entries.length),
        ),
        Match.when('SymbolicLink', () => linkEntry(root, name, info, limits)),
        Match.when('File', () => fileEntry(full, name, info, limits, total)),
        Match.orElse(() => Effect.fail(new CacheError({ code: 'CacheRefused' }))),
      );
      const entry = yield* reading;
      entries.push(entry);
      total += Match.value(entry).pipe(
        Match.when({ type: 'File' }, (value) => value.size),
        Match.orElse(() => 0),
      );
      yield* requireCache(metadataEqual(info, yield* metadata.lstat(full)), 'InputChanged');
    }
    entries.sort((left, right) => order(left.path, right.path));
    const destinations = new Map(entries.map((entry) => [entry.path, entry]));
    const validLinks = entries.every((entry) =>
      Match.value(entry).pipe(
        Match.when(
          { type: 'SymbolicLink' },
          (value) =>
            destinations.has(value.resolved) && !isLink(destinations.get(value.resolved)!.type),
        ),
        Match.orElse(() => true),
      ),
    );
    yield* requireCache(validLinks && acyclic(entries));
    return { entries, identities };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
function directoryEntry(
  root: string,
  name: string,
  info: Metadata,
  limits: CacheLimits,
  pending: string[],
  seen: Set<string>,
  count: number,
) {
  function* inspect() {
    const fs = yield* FileSystem.FileSystem;
    const directory = absolute(root, { type: 'Directory', path: name, mode: info.mode });
    yield* requireCache((yield* fs.realPath(directory)) === directory, 'InputChanged');
    const names = yield* fs.readDirectory(directory);
    yield* requireCache(names.length <= limits.entries - count - pending.length - 1);
    for (const child of names.sort(order).reverse()) {
      const relative = Match.value(name).pipe(
        Match.when('.', () => child),
        Match.orElse(() => `${name}/${child}`),
      );
      const key = relative.toLowerCase();
      yield* requireCache(
        !child.includes('/') && safeRelative(relative, limits.pathBytes) && !seen.has(key),
      );
      seen.add(key);
      pending.push(relative);
    }
    return { type: 'Directory' as const, path: name, mode: info.mode };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
function fileEntry(full: string, name: string, info: Metadata, limits: CacheLimits, total: number) {
  function* inspect() {
    yield* requireCache(info.size >= 0n && info.size <= BigInt(limits.entryBytes));
    yield* requireCache(info.size <= BigInt(limits.totalBytes - total));
    const bytes = yield* readBytes(full, info, limits.entryBytes);
    return {
      type: 'File' as const,
      path: name,
      mode: info.mode,
      size: bytes.length,
      sha256: yield* hash(bytes),
    };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
function freezeInventory(entries: readonly CacheEntry[]) {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}
// No opaque exclusions. Preserve all r/x bits; remove every write bit for the seed.
// Case copies restore original permissions plus owner write (and directory rwx).
function transformedInventory(entries: readonly CacheEntry[], writable: boolean) {
  function transform(entry: CacheEntry) {
    const write = Match.value(isDirectory(entry.type)).pipe(
      Match.when(true, () => 0o700),
      Match.orElse(() => 0o200),
    );
    const mode = Match.value(writable).pipe(
      Match.when(true, () => entry.mode | write),
      Match.orElse(() => entry.mode & ~0o222),
    );
    const transformed = Match.value(entry).pipe(
      Match.when({ type: 'SymbolicLink' }, (value) => value),
      Match.orElse((value) => ({ ...value, mode })),
    );
    return transformed;
  }
  return entries.map(transform);
}
function setModes(root: string, inventory: readonly CacheEntry[]) {
  function* apply() {
    const fs = yield* FileSystem.FileSystem;
    for (const entry of [...inventory].reverse().filter((value) => !isLink(value.type))) {
      yield* fs.chmod(absolute(root, entry), entry.mode);
    }
  }
  const workflow = Effect.gen(apply);
  return workflow;
}
export function sealCache(root: string, limits: CacheLimits = cacheLimits) {
  function* seal() {
    yield* requireCache(
      ![...roots].some((reserved) => overlap(reserved, root)),
      'DestinationRefused',
    );
    const before = yield* scan(root, limits);
    const materializedInventory = freezeInventory(before.entries);
    const expected = transformedInventory(materializedInventory, false);
    yield* setModes(root, expected);
    const after = yield* scan(root, limits);
    yield* requireCache(
      encodeInventory(after.entries) === encodeInventory(expected),
      'InputChanged',
    );
    const path = yield* Path.Path;
    const writable = transformedInventory(materializedInventory, true).map((entry) =>
      Match.value(entry).pipe(
        Match.when({ type: 'SymbolicLink' }, (value) => ({
          ...value,
          target: path.relative(path.dirname(`${root}/${value.path}`), `${root}/${value.resolved}`),
        })),
        Match.orElse((value) => value),
      ),
    );
    const seed: SealedCache = Object.freeze({
      root,
      policy: 'CacheModesV1',
      sha256: yield* inventoryHash(after.entries),
      materializedInventory,
      inventory: freezeInventory(after.entries),
      caseInventory: freezeInventory(writable),
    });
    seals.set(seed, { limits: Object.freeze({ ...limits }), identities: after.identities });
    roots.add(root);
    return seed;
  }
  const workflow = Effect.gen(seal);
  return workflow;
}
export function verifySealedCache(seed: SealedCache) {
  function* verify() {
    const state = yield* Effect.fromNullishOr(seals.get(seed));
    const current = yield* scan(seed.root, state.limits);
    yield* requireCache(
      encodeInventory(current.entries) === encodeInventory(seed.inventory) &&
        (yield* inventoryHash(current.entries)) === seed.sha256,
      'InputChanged',
    );
    for (const [name, info] of current.identities) {
      yield* requireCache(identityEqual(info, state.identities.get(name)!), 'InputChanged');
    }
    return { sha256: seed.sha256 };
  }
  const workflow = Effect.gen(verify);
  return workflow;
}
function freshDestination(seed: SealedCache, destination: string) {
  function* prepare() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* requireCache(
      destination.startsWith('/') &&
        path.normalize(destination) === destination &&
        ![...roots].some((root) => overlap(root, destination)),
      'DestinationRefused',
    );
    yield* requireCache(
      (yield* fs.realPath(path.dirname(destination))) === path.dirname(destination) &&
        !(yield* fs.exists(destination)),
      'DestinationRefused',
    );
    yield* verifySealedCache(seed);
    yield* fs.makeDirectory(destination, { mode: 0o700 });
    yield* fs.chmod(destination, 0o700);
    roots.add(destination);
  }
  const workflow = Effect.gen(prepare);
  return workflow;
}
function copyFile(
  seed: SealedCache,
  entry: Extract<CacheEntry, { type: 'File' }>,
  destination: string,
  state: SealState,
) {
  function* copy() {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* CacheMetadata;
    const source = absolute(seed.root, entry);
    const info = yield* metadata.lstat(source);
    yield* requireCache(identityEqual(info, state.identities.get(entry.path)!), 'InputChanged');
    const bytes = yield* readBytes(source, info, state.limits.entryBytes);
    yield* requireCache((yield* hash(bytes)) === entry.sha256, 'InputChanged');
    const output = yield* fs.open(absolute(destination, entry), {
      flag: 'wx',
      mode: 0o600,
      noFollow: true,
    });
    yield* output.writeAll(bytes);
  }
  const workflow = Effect.gen(copy);
  const scoped = Effect.scoped(workflow);
  return scoped;
}
function makeCaseDirectory(destination: string, entry: CacheEntry) {
  function* create() {
    const fs = yield* FileSystem.FileSystem;
    const directory = absolute(destination, entry);
    yield* fs.makeDirectory(directory, { mode: 0o700 });
    yield* fs.chmod(directory, 0o700);
  }
  const workflow = Effect.gen(create);
  return workflow;
}
export function copyCaseCache(seed: SealedCache, destination: string) {
  function* copy() {
    const state = yield* Effect.fromNullishOr(seals.get(seed));
    yield* freshDestination(seed, destination);
    const fs = yield* FileSystem.FileSystem;
    for (const entry of seed.caseInventory.filter(
      (value) => !isRootEntry(value.path) && !isLink(value.type),
    )) {
      const copying = Match.value(entry).pipe(
        Match.when({ type: 'Directory' }, (value) => makeCaseDirectory(destination, value)),
        Match.when({ type: 'File' }, (value) => copyFile(seed, value, destination, state)),
        Match.orElse(() => Effect.fail(new CacheError({ code: 'CacheRefused' }))),
      );
      yield* copying;
    }
    for (const entry of seed.caseInventory.filter((value) => isLink(value.type))) {
      const link = yield* Schema.decodeUnknownEffect(CacheEntry.members[2])(entry);
      yield* fs.symlink(link.target, absolute(destination, entry));
    }
    yield* setModes(destination, seed.caseInventory);
    const copy: CaseCache = Object.freeze({
      root: destination,
      seedSha256: seed.sha256,
      sha256: yield* inventoryHash(seed.caseInventory),
      inventory: seed.caseInventory,
    });
    copies.set(copy, seed);
    yield* admitCaseCache(seed, copy);
    return copy;
  }
  const workflow = Effect.gen(copy);
  return workflow;
}
function inspectCopy(seed: SealedCache, copy: CaseCache, state: SealState) {
  function* inspect() {
    const current = yield* scan(copy.root, state.limits);
    yield* requireCache(
      copy.seedSha256 === seed.sha256 &&
        encodeInventory(current.entries) === encodeInventory(seed.caseInventory),
      'InputChanged',
    );
    yield* requireCache((yield* inventoryHash(current.entries)) === copy.sha256, 'InputChanged');
    const seedInodes = new Set(
      [...state.identities.values()].map((info) => `${info.dev}:${info.ino}`),
    );
    for (const info of current.identities.values()) {
      yield* requireCache(!seedInodes.has(`${info.dev}:${info.ino}`), 'InputChanged');
    }
    return { sha256: copy.sha256, seedSha256: seed.sha256 };
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
export function admitCaseCache(seed: SealedCache, copy: CaseCache) {
  function* admit() {
    const state = yield* Effect.fromNullishOr(seals.get(seed));
    yield* requireCache(
      copies.get(copy) === seed && !overlap(seed.root, copy.root),
      'DestinationRefused',
    );
    yield* verifySealedCache(seed);
    const result = yield* inspectCopy(seed, copy, state).pipe(Effect.result);
    // Rehash even when copy admission fails. The caller also verifies after each case.
    yield* verifySealedCache(seed);
    return yield* Effect.fromResult(result);
  }
  const workflow = Effect.gen(admit);
  return workflow;
}
