import { spyOn } from 'bun:test';

import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';

import { main, replayTeardown } from '../../src/main.ts';
import * as Source from '../../src/manifest-git-source.ts';
import { fakeManifestSource } from '../manifest-fixtures.ts';

spyOn(Source, 'readPinnedManifests').mockImplementation(() => Effect.sync(fakeManifestSource));
const program = main(['manifests', '--repository', '/synthetic/repo']);
BunRuntime.runMain(program, { disableErrorReporting: true, teardown: replayTeardown });
