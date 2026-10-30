import { Effect, FileSystem, Schema } from 'effect';

import { currentNpmProfiles, fromCurrentNpmLock } from './current-npm-profiles.ts';
import { invokeResolver, writeEmptyConfig } from './dependency-capture.ts';
import { requireInventory } from './dependency-inventory.ts';
import { encodeInventory } from './frozen-dependencies.ts';
import { readBounded } from './runner-input.ts';

const lockCodec = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    lockfileVersion: Schema.Literal(3),
    requires: Schema.Boolean,
    packages: Schema.Record(Schema.String, Schema.Unknown),
  }),
);
const runtimeCodec = Schema.fromJsonString(
  Schema.Struct({ version: Schema.String, platform: Schema.String, arch: Schema.String }),
);
const decodeNpmVersion = Schema.decodeUnknownEffect(Schema.Literal('10.9.9'));
export function resolveCurrentNpm(cache: string, node: string) {
  function* resolve() {
    yield* requireInventory(cache.startsWith('/') && node.startsWith('/'), 'ResolutionRefused');
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-current-npm-resolve-' });
    yield* fs.chmod(home, 0o700);
    yield* writeEmptyConfig(home);
    const paths = {
      guard: decodeURIComponent(
        new URL('../scripts/npm-offline-guard.cjs', import.meta.url).pathname,
      ),
      npm: decodeURIComponent(
        new URL('../node_modules/npm/bin/npm-cli.js', import.meta.url).pathname,
      ),
    };
    const version = yield* invokeResolver(
      node,
      ['--require', paths.guard, paths.npm, '--version', '--offline'],
      home,
      home,
      cache,
    );
    yield* decodeNpmVersion(version.trim());
    const runtimeText = yield* invokeResolver(
      node,
      [
        '--require',
        paths.guard,
        '-p',
        'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})',
      ],
      home,
      home,
      cache,
    );
    const host = yield* Schema.decodeUnknownEffect(runtimeCodec)(runtimeText);
    const profiles = [];
    for (const profile of currentNpmProfiles) {
      const directory = `${home}/${profile.id}`;
      yield* fs.makeDirectory(directory);
      for (const vendor of profile.vendors) {
        yield* fs.makeDirectory(`${directory}/${vendor.path}`, { recursive: true });
        yield* fs.writeFileString(
          `${directory}/${vendor.path}/package.json`,
          encodeInventory(vendor.manifest),
          { flag: 'wx', mode: 0o600 },
        );
      }
      yield* fs.writeFileString(`${directory}/package.json`, encodeInventory(profile.manifest), {
        flag: 'wx',
        mode: 0o600,
      });
      yield* requireInventory(!(yield* fs.exists(`${directory}/package-lock.json`)));
      yield* invokeResolver(
        node,
        [
          '--require',
          paths.guard,
          paths.npm,
          'install',
          '--package-lock-only',
          '--offline',
          '--ignore-scripts',
          '--include=dev',
          '--include=optional',
          '--no-audit',
          '--no-fund',
          '--update-notifier=false',
          '--os=linux',
          '--cpu=x64',
          '--libc=glibc',
          '--registry=https://registry.npmjs.org/',
        ],
        home,
        directory,
        cache,
      );
      const localPaths = ['', ...profile.vendors.map(({ path }) => path)];
      for (const path of localPaths) {
        yield* requireInventory(
          !(yield* fs.exists(`${directory}/${path}/node_modules`)),
          'ResolutionRefused',
        );
      }
      const text = yield* readBounded(`${directory}/package-lock.json`, 2097152);
      const lock = yield* Schema.decodeUnknownEffect(lockCodec)(text);
      const inventory = yield* fromCurrentNpmLock(lock, profile);
      profiles.push({
        id: profile.id,
        lock,
        selected: inventory.selected.length,
        excluded: inventory.excluded.length,
      });
    }
    return {
      activation: 'Blocked' as const,
      npm: version.trim(),
      host,
      profiles,
      network: 'OfflineWithNativeTripwire' as const,
      scripts: 'Disabled' as const,
      acceptance: 'MetadataOnly' as const,
    };
  }
  const workflow = Effect.gen(resolve);
  return workflow.pipe(Effect.timeout('8 minutes'), Effect.scoped);
}
