import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Config, Console, Effect, Exit, Match, Result, Schema, type Runtime } from 'effect';

import { verifyCache } from '../src/cache-candidate.ts';
import { frozenMetadata } from '../src/cache-metadata.ts';
import { prepareCacheCandidates } from '../src/cache-preparer.ts';
import { encodeInventory, frozenDependencyInventory } from '../src/frozen-dependencies.ts';
import { sha256 } from '../src/preparation.ts';

const isPrepare = Schema.is(Schema.Tuple([Schema.Literal('--prepare')]));
const isCheck = Schema.is(
  Schema.Tuple([Schema.Literal('--check'), Schema.String.check(Schema.isPattern(/^\//))]),
);
const usage = Console.error('{"_tag":"UsageError"}').pipe(Effect.map(() => 64));
const refused = Console.error('{"_tag":"CachePreparationRefused","activation":"Blocked"}').pipe(
  Effect.map(() => 1),
);
function* prepare() {
  const node = yield* Config.String('CEIREAN_INVENTORY_NODE');
  const report = yield* prepareCacheCandidates(fetch, node);
  yield* Console.log(
    encodeInventory({
      _tag: report._tag,
      activation: report.activation,
      directory: report.directory,
      artifacts: report.artifacts,
      registryBytes: report.registryBytes,
      storage: report.storage,
      storageIncludingManifest: report.storageIncludingManifest,
      metadata: report.metadata.length,
      replay: report.replay,
      inventorySha256: report.inventorySha256,
      manifestSha256: report.manifestSha256,
      blockers: report.blockers,
    }),
  );
  return 2;
}
function checking(directory: string) {
  function* check() {
    const inventory = yield* frozenDependencyInventory();
    const report = yield* verifyCache(directory, inventory.artifacts, yield* frozenMetadata());
    yield* Console.log(
      encodeInventory({
        _tag: 'CacheBytesVerified',
        activation: 'Blocked',
        directory,
        artifacts: report.artifacts,
        registryBytes: report.registryBytes,
        storage: report.storage,
        entriesSha256: yield* sha256(encodeInventory(report.entries)),
        replay: 'NotRunByCheck',
      }),
    );
    return 2;
  }
  const workflow = Effect.gen(check);
  const bounded = workflow.pipe(Effect.timeout('5 minutes'));
  return bounded;
}
function main(argv: readonly string[]) {
  const workflow = Match.value(argv).pipe(
    Match.when(isPrepare, () => Effect.gen(prepare)),
    Match.when(isCheck, (args) => checking(args[1])),
    Match.orElse(() => usage),
  );
  const sanitized = workflow.pipe(Effect.catch(() => refused));
  return sanitized;
}
const workflow = main(Bun.argv.slice(2));
export const program = Effect.provide(workflow, BunServices.layer);
const exitCode = Schema.decodeUnknownResult(Schema.Literals([1, 2, 64]));
const teardown: Runtime.Teardown = (exit, onExit) => {
  function completed(value: unknown) {
    const decoded = exitCode(value);
    const code = decoded.pipe(Result.getOrElse(() => 1));
    onExit(code);
  }
  Exit.match(exit, { onSuccess: completed, onFailure: () => onExit(1) });
};
BunRuntime.runMain(program, { disableErrorReporting: true, teardown });
