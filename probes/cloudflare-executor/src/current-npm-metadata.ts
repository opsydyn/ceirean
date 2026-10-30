import { Effect, Match, Order, Ref, Schema, Stream } from 'effect';

import { InventoryError, registryIdentity, requireInventory } from './dependency-inventory.ts';
import { encodeInventory } from './frozen-dependencies.ts';
import { readCachedMetadata } from './npm-cache-store.ts';
import { digestBytes } from './payload.ts';
import { sha256, validateRegistryRequest } from './preparation.ts';
import { releaseRegistryResponse } from './registry-response.ts';

const strings = Schema.Record(Schema.String, Schema.String);
const platform = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
const peer = Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) });
const peerMap = Schema.Record(Schema.String, peer);
const isEmptyUrl = Schema.is(Schema.Literal(''));
export const CurrentVersion = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  dependencies: Schema.optionalKey(strings),
  optionalDependencies: Schema.optionalKey(strings),
  peerDependencies: Schema.optionalKey(strings),
  peerDependenciesMeta: Schema.optionalKey(peerMap),
  engines: Schema.optionalKey(strings),
  os: Schema.optionalKey(platform),
  cpu: Schema.optionalKey(platform),
  libc: Schema.optionalKey(platform),
  bin: Schema.optionalKey(Schema.Union([Schema.String, strings])),
  hasInstallScript: Schema.optionalKey(Schema.Boolean),
  dist: Schema.Struct({
    tarball: Schema.String,
    integrity: Schema.String.check(Schema.isPattern(/^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/)),
  }),
});
const MetadataInput = Schema.Struct({
  ...CurrentVersion.fields,
  scripts: Schema.optionalKey(strings),
});
const decodeMetadata = Schema.decodeUnknownEffect(Schema.fromJsonString(MetadataInput));
export type CurrentVersionRecord = typeof CurrentVersion.Type;
export function fetchCurrentVersion(
  artifact: { identity: string; integrity?: string },
  request: (url: string, init: RequestInit) => Promise<Response>,
  spent: Ref.Ref<number>,
) {
  function* acquire(confirmed: Ref.Ref<boolean>) {
    const identity = yield* registryIdentity(artifact.identity);
    const url = `https://registry.npmjs.org/${identity.name.replace('/', '%2f')}/${identity.version}`;
    yield* validateRegistryRequest(url, 'GET', [url]);
    const requesting = Effect.tryPromise({
      try: (signal) =>
        request(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal }),
      catch: () => new InventoryError({ code: 'ResolutionRefused' }),
    });
    const acquiring = Effect.interruptible(requesting);
    const response = yield* Effect.acquireRelease(acquiring, (response) =>
      releaseRegistryResponse(response, confirmed),
    );
    const validResponse = [
      response.status === 200,
      !response.redirected,
      isEmptyUrl(response.url) || response.url === url,
    ].every(Boolean);
    yield* requireInventory(validResponse, 'ResolutionRefused');
    const body = yield* Effect.fromNullishOr(response.body);
    const stream = Stream.fromReadableStream({
      evaluate: () => body,
      onError: () => new InventoryError({ code: 'ResolutionRefused' }),
      releaseLockOnEnd: true,
    });
    const chunks: Uint8Array[] = [];
    let used = 0;
    function* append(chunk: Uint8Array) {
      yield* requireInventory(chunk.length <= 2097152 - used, 'ResolutionRefused');
      function reserve(total: number): readonly [boolean, number] {
        const allowed = chunk.length <= 16777216 - total;
        return [allowed, total + Number(allowed) * chunk.length];
      }
      yield* requireInventory(yield* Ref.modify(spent, reserve), 'ResolutionRefused');
      used += chunk.length;
      chunks.push(new Uint8Array(chunk));
    }
    yield* Stream.runForEach(stream, (chunk) => Effect.gen(() => append(chunk)));
    const bytes = new Uint8Array(used);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const raw = yield* decodeMetadata(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const validIdentity = [
      raw.name === identity.name,
      raw.version === identity.version,
      raw.dist.tarball === identity.url,
      artifact.integrity === undefined || raw.dist.integrity === artifact.integrity,
    ].every(Boolean);
    yield* requireInventory(validIdentity, 'InputChanged');
    const version = yield* Schema.decodeUnknownEffect(CurrentVersion)(raw);
    const hasInstallScript = ['preinstall', 'install', 'postinstall'].some(
      (key) => raw.scripts?.[key] !== undefined,
    );
    const install = Match.value(hasInstallScript).pipe(
      Match.when(true, () => ({ hasInstallScript: true })),
      Match.orElse(() => ({})),
    );
    return { ...version, ...install };
  }
  function* run() {
    const confirmed = yield* Ref.make(false);
    const acquiring = Effect.gen(() => acquire(confirmed));
    const scoped = acquiring.pipe(Effect.timeout('30 seconds'), Effect.scoped);
    const version = yield* scoped;
    yield* requireInventory(yield* Ref.get(confirmed), 'ResolutionRefused');
    return version;
  }
  const workflow = Effect.gen(run);
  return workflow;
}
export function verifyCurrentNpmCache(
  cache: string,
  metadata: readonly { url: string; bytes: number; sha256: string }[],
) {
  function* verify() {
    for (const entry of metadata) {
      const bytes = yield* readCachedMetadata(cache, entry.url);
      yield* requireInventory(
        bytes.length === entry.bytes && (yield* digestBytes(bytes)) === entry.sha256,
        'InputChanged',
      );
    }
  }
  const workflow = Effect.gen(verify);
  return workflow;
}
export function packCurrentMetadata(records: readonly CurrentVersionRecord[]) {
  function* pack() {
    const groups = new Map<string, Map<string, CurrentVersionRecord>>();
    for (const record of records) {
      const versions = groups.get(record.name) ?? new Map<string, CurrentVersionRecord>();
      const previous = versions.get(record.version);
      yield* requireInventory(
        previous === undefined || encodeInventory(previous) === encodeInventory(record),
        'InputChanged',
      );
      versions.set(record.version, record);
      groups.set(record.name, versions);
    }
    const result = [];
    let total = 0;
    for (const name of [...groups.keys()].sort(Order.String)) {
      const versions = [...(groups.get(name)?.entries() ?? [])].sort(([a], [b]) =>
        Order.String(a, b),
      );
      const text = encodeInventory({
        name,
        'dist-tags': {},
        versions: Object.fromEntries(versions),
      });
      const bytes = new TextEncoder().encode(text).length;
      total += bytes;
      yield* requireInventory(bytes <= 2097152 && total <= 16777216);
      result.push({
        name,
        url: `https://registry.npmjs.org/${name.replace('/', '%2f')}`,
        text,
        bytes,
        sha256: yield* sha256(text),
      });
    }
    return result;
  }
  const workflow = Effect.gen(pack);
  return workflow;
}
