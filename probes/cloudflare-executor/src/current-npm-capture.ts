import { Console, Effect, Exit, FileSystem, Ref, Schema } from 'effect';

import { fromCurrentBunLock } from './current-dependencies.ts';
import { currentSourcePins, readCurrentSource } from './current-inputs.ts';
import {
  fetchCurrentVersion,
  packCurrentMetadata,
  verifyCurrentNpmCache,
  type CurrentVersionRecord,
} from './current-npm-metadata.ts';
import {
  currentNpmProfiles,
  currentNpmSourceHashes,
  fromCurrentNpmLock,
  validateCurrentNpmSources,
} from './current-npm-profiles.ts';
import { resolveCurrentNpm } from './current-npm-resolver.ts';
import { fromNpmLock, npmProfiles, requireInventory } from './dependency-inventory.ts';
import { encodeInventory, readFrozenInputs } from './frozen-dependencies.ts';
import { seedReplayMetadata } from './npm-cache-store.ts';
import { sha256 } from './preparation.ts';

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
function requiredNames(record: {
  name: string;
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
  optionalDependencies?: Readonly<Record<string, string>>;
  peerDependencies?: Readonly<Record<string, string>>;
  peerDependenciesMeta?: Readonly<Record<string, { optional?: boolean }>>;
}) {
  const direct = Object.entries({
    ...record.dependencies,
    ...record.devDependencies,
    ...record.optionalDependencies,
  });
  const peers = Object.entries(record.peerDependencies ?? {}).filter(
    ([name]) => !record.peerDependenciesMeta?.[name]?.optional,
  );
  return [...direct, ...peers]
    .filter(([, specifier]) => !specifier.startsWith('file:'))
    .map(([name]) => name);
}
export function prepareCurrentNpm(
  repository: string,
  node: string,
  request: (url: string, init: RequestInit) => Promise<Response>,
) {
  function* prepare() {
    const source = yield* readCurrentSource(repository);
    yield* validateCurrentNpmSources(source);
    const isBunLock = Schema.is(Schema.Literal('bun.lock'));
    const bytes = source.find(({ path }) => isBunLock(path))?.bytes ?? new Uint8Array();
    const parsing = Effect.try(() => Bun.JSON5.parse(new TextDecoder().decode(bytes)));
    const bun = yield* fromCurrentBunLock(yield* parsing);
    const cohort = new Map<string, { identity: string; integrity?: string }>();
    const inputs = yield* readFrozenInputs();
    const entries = [...bun.selected, ...bun.excluded];
    for (const profile of npmProfiles) {
      const decoded = yield* decodeJson(inputs.get(`npm-${profile.id}.lock`) ?? '');
      const inventory = yield* fromNpmLock(decoded);
      entries.push(...inventory.selected, ...inventory.excluded);
    }
    for (const entry of entries) {
      const previous = cohort.get(entry.identity);
      yield* requireInventory(
        previous === undefined || previous.integrity === entry.integrity,
        'InputChanged',
      );
      cohort.set(entry.identity, { identity: entry.identity, integrity: entry.integrity });
    }
    cohort.set('foldkit@0.169.0', { identity: 'foldkit@0.169.0' });
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* Effect.acquireRelease(
      fs.makeTempDirectory({ directory: '/private/tmp', prefix: 'ceirean-current-npm-' }),
      (directory, exit) =>
        Exit.match(exit, {
          onSuccess: () => Effect.void,
          onFailure: () =>
            fs
              .remove(directory, { recursive: true })
              .pipe(
                Effect.catch(() => Console.error('{"_tag":"CurrentNpmPartialCleanupUnconfirmed"}')),
              ),
        }),
    );
    yield* fs.chmod(directory, 0o700);
    const spent = yield* Ref.make(0);
    const pending = new Set(
      currentNpmProfiles.flatMap((profile) => [
        ...requiredNames(profile.manifest),
        ...profile.vendors.flatMap((vendor) => requiredNames(vendor.manifest)),
      ]),
    );
    const fetched = new Set<string>();
    const versions = new Map<string, CurrentVersionRecord>();
    while (pending.size > 0) {
      const names = [...pending].filter((name) => !fetched.has(name)).sort();
      pending.clear();
      for (const name of names) {
        fetched.add(name);
        const candidates = [...cohort.values()].filter(
          ({ identity }) => identity.slice(0, identity.lastIndexOf('@')) === name,
        );
        yield* requireInventory(candidates.length > 0, 'ResolutionRefused');
        const metadata = yield* Effect.forEach(
          candidates,
          (artifact) => fetchCurrentVersion(artifact, request, spent),
          { concurrency: 4 },
        );
        for (const version of metadata) {
          versions.set(`${version.name}@${version.version}`, version);
          for (const dependency of requiredNames(version)) {
            pending.add(dependency);
          }
        }
      }
      yield* requireInventory(versions.size <= 2048 && fetched.size <= 1024, 'ResolutionRefused');
    }
    const candidateMetadata = yield* packCurrentMetadata([...versions.values()]);
    const captureCache = `${directory}/capture-cache`;
    yield* seedReplayMetadata(captureCache, candidateMetadata);
    yield* verifyCurrentNpmCache(captureCache, candidateMetadata);
    const resolved = yield* resolveCurrentNpm(captureCache, node);
    yield* verifyCurrentNpmCache(captureCache, candidateMetadata);
    const used = new Map<string, CurrentVersionRecord>();
    for (const profile of resolved.profiles) {
      const definition = currentNpmProfiles.find(({ id }) => id === profile.id)!;
      const inventory = yield* fromCurrentNpmLock(profile.lock, definition);
      for (const entry of [...inventory.selected, ...inventory.excluded]) {
        const version = versions.get(entry.identity);
        yield* requireInventory(version?.dist.integrity === entry.integrity, 'InputChanged');
        yield* requireInventory(version !== undefined);
        used.set(entry.identity, version!);
      }
    }
    const metadata = yield* packCurrentMetadata([...used.values()]);
    const replayCache = `${directory}/replay-cache`;
    yield* seedReplayMetadata(replayCache, metadata);
    yield* verifyCurrentNpmCache(replayCache, metadata);
    const replay = yield* resolveCurrentNpm(replayCache, node);
    yield* verifyCurrentNpmCache(replayCache, metadata);
    yield* requireInventory(
      encodeInventory(replay.profiles) === encodeInventory(resolved.profiles),
      'InputChanged',
    );
    const snapshot = {
      schemaVersion: 1,
      activation: 'Blocked',
      source: currentSourcePins,
      sourceHashes: currentNpmSourceHashes,
      selection: 'ReviewedVersionCohortNotMovingLatest',
      resolver: { npm: resolved.npm, host: resolved.host },
      profiles: resolved.profiles,
      metadata,
    } as const;
    const text = encodeInventory(snapshot);
    yield* fs.writeFileString(`${directory}/snapshot.json`, text, { mode: 0o600, flag: 'wx' });
    const receipt = {
      _tag: 'CurrentNpmMetadataPrepared',
      activation: 'Blocked',
      directory,
      snapshotSha256: yield* sha256(text),
      profiles: resolved.profiles.map(({ id, selected, excluded }) => ({ id, selected, excluded })),
      acquiredVersions: versions.size,
      acquiredBytes: yield* Ref.get(spent),
      replayVersions: used.size,
      packuments: metadata.length,
      network: replay.network,
      scripts: replay.scripts,
      acceptance: replay.acceptance,
      resolver: snapshot.resolver,
      blockers: [
        'RegistryArchiveDeltaPending',
        'LinuxInstallUnqualified',
        'BunCacheLayoutUnqualified',
        'FinalImageUnbuilt',
        'HostedActivationBlocked',
      ],
    } as const;
    yield* fs.writeFileString(`${directory}/receipt.json`, encodeInventory(receipt), {
      mode: 0o600,
      flag: 'wx',
    });
    return receipt;
  }
  const workflow = Effect.gen(prepare);
  return workflow.pipe(Effect.timeout('15 minutes'), Effect.scoped);
}
