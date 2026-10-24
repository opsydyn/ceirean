import { Effect, FileSystem, Schema } from 'effect';

import { invokeResolver, writeEmptyConfig } from './dependency-capture.ts';
import { fromNpmLock, npmProfiles, requireInventory } from './dependency-inventory.ts';
import { encodeInventory, readFrozenInputs } from './frozen-dependencies.ts';
import { readBounded } from './runner-input.ts';

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeVersion = Schema.decodeUnknownEffect(Schema.Literal('10.9.9'));

export function replayMetadata(cache: string, node: string) {
  function* replay() {
    yield* requireInventory(cache.startsWith('/') && node.startsWith('/'), 'ResolutionRefused');
    const inputs = yield* readFrozenInputs();
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-offline-replay-' });
    yield* fs.chmod(home, 0o700);
    yield* writeEmptyConfig(home);
    const guard = decodeURIComponent(
      new URL('../scripts/npm-offline-guard.cjs', import.meta.url).pathname,
    );
    const npm = decodeURIComponent(
      new URL('../node_modules/npm/bin/npm-cli.js', import.meta.url).pathname,
    );
    const version = yield* invokeResolver(
      node,
      ['--require', guard, npm, '--version', '--offline'],
      home,
      home,
      cache,
    );
    yield* decodeVersion(version.trim());
    const profiles = [];
    for (const profile of npmProfiles) {
      const directory = `${home}/${profile.id}`;
      yield* fs.makeDirectory(`${directory}/vendor/foldkit-viz`, { recursive: true });
      yield* fs.writeFileString(`${directory}/package.json`, encodeInventory(profile.manifest));
      yield* fs.writeFileString(
        `${directory}/vendor/foldkit-viz/package.json`,
        encodeInventory(profile.vendor),
      );
      yield* requireInventory(!(yield* fs.exists(`${directory}/package-lock.json`)));
      yield* invokeResolver(
        node,
        [
          '--require',
          guard,
          npm,
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
      yield* requireInventory(
        !(yield* fs.exists(`${directory}/node_modules`)),
        'ResolutionRefused',
      );
      const actual = yield* fromNpmLock(
        yield* decode(yield* readBounded(`${directory}/package-lock.json`, 2097152)),
      );
      const expected = yield* fromNpmLock(
        yield* decode(inputs.get(`npm-${profile.id}.lock`) ?? ''),
      );
      yield* requireInventory(
        encodeInventory(actual) === encodeInventory(expected),
        'InputChanged',
      );
      profiles.push({
        profile: profile.id,
        selected: actual.selected.length,
        excluded: actual.excluded.length,
      });
    }
    return {
      activation: 'Blocked' as const,
      profiles,
      scripts: 'Disabled',
      network: 'OfflineWithNativeTripwire',
      hostAcceptance: 'MetadataOnly',
    };
  }
  const workflow = Effect.gen(replay);
  const bounded = workflow.pipe(Effect.timeout('5 minutes'));
  const scoped = Effect.scoped(bounded);
  return scoped;
}
