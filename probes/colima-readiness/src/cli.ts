import { Effect, FileSystem, Match, Result, Schema } from 'effect';

import { PreflightReport } from './contracts.ts';
import { collectHostObservations } from './host-observations.ts';
import type { makeHostReader } from './host-reader.ts';
import { inspectHost } from './preflight.ts';

export interface CliDependencies {
  readonly collectHost: typeof collectHostObservations;
  readonly makeReader: (root: string, home: string) => ReturnType<typeof makeHostReader>;
  readonly inspect: typeof inspectHost;
}
const encodeReport = Schema.encodeUnknownResult(Schema.fromJsonString(PreflightReport), {
  onExcessProperty: 'error',
});
const encodeUnknown = Schema.encodeUnknownResult(Schema.fromJsonString(Schema.Unknown));
const isArguments = Schema.is(
  Schema.Tuple([Schema.Literal('preflight'), Schema.Literal('--config'), Schema.String]),
);
const Failure = Schema.TaggedStruct('PreflightFailed', {
  code: Schema.Literals(['CollectionFailed', 'InvalidReport', 'OutputTooLarge']),
});
const encodeFailure = Schema.encodeSync(Schema.fromJsonString(Failure));
function failed(code: (typeof Failure.Type)['code']) {
  return {
    exitCode: 1,
    stdout: '',
    stderr: `${encodeFailure({ _tag: 'PreflightFailed', code })}\n`,
  };
}

export function serializeReport(value: unknown) {
  function* serialize() {
    // Check serialized size even for injected invalid reports; never truncate.
    const raw = yield* Effect.fromResult(
      encodeUnknown(value).pipe(Result.mapError(() => 'InvalidReport' as const)),
    );
    const withinCap = new TextEncoder().encode(`${raw}\n`).length <= 262144;
    const encoded = encodeReport(value).pipe(Result.mapError(() => 'InvalidReport' as const));
    const result = Match.value(withinCap).pipe(
      Match.when(false, () => Result.fail('OutputTooLarge' as const)),
      Match.orElse(() => encoded),
    );
    const text = yield* Effect.fromResult(result);
    return Match.value(new TextEncoder().encode(`${text}\n`).length <= 262144).pipe(
      Match.when(true, () => ({ exitCode: 2, stdout: `${text}\n`, stderr: '' })),
      Match.orElse(() => failed('OutputTooLarge')),
    );
  }
  const workflow = Effect.gen(serialize);
  const result = workflow.pipe(Effect.result);
  const rendered = result.pipe(Effect.map(Result.getOrElse(failed)));
  const program = rendered.pipe(Effect.catchDefect(() => Effect.succeed(failed('InvalidReport'))));
  return program;
}

function configRoot(argv: ReadonlyArray<string>) {
  const path = argv[2] ?? '';
  const suffix = ['/ceirean', 'colima.yaml'].join('/');
  const root = path.slice(0, -suffix.length);
  const command = isArguments(argv);
  const traversal = new Set(['.', '..']);
  const valid = [
    command,
    path.endsWith(suffix),
    /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(root),
    root.length <= 450,
    !root.split('/').some((part) => traversal.has(part)),
  ].every(Boolean);
  return Match.value(valid).pipe(
    Match.when(true, () => root),
    Match.orElse(() => undefined),
  );
}

export function runCli(argv: ReadonlyArray<string>, dependencies: CliDependencies) {
  const root = configRoot(argv);
  function* collect(colimaRoot: string) {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({
      directory: '/private/tmp',
      prefix: 'ceirean-preflight-home-',
    });
    const host = yield* dependencies.collectHost(home);
    const reader = dependencies.makeReader(colimaRoot, home);
    const report = yield* dependencies.inspect(reader, {
      profile: 'ceirean',
      colimaRoot,
      configPath: `${colimaRoot}/ceirean/colima.yaml`,
      configurationSemantics: 'ReviewedColimaYaml',
      host,
    });
    return yield* serializeReport(report);
  }
  const workflow = Match.value(root).pipe(
    Match.when(undefined, () =>
      Effect.succeed({ exitCode: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' }),
    ),
    Match.orElse((colimaRoot) => Effect.gen(() => collect(colimaRoot))),
  );
  const scoped = Effect.scoped(workflow);
  const result = scoped.pipe(Effect.result);
  const rendered = result.pipe(Effect.map(Result.getOrElse(() => failed('CollectionFailed'))));
  const program = rendered.pipe(
    Effect.catchDefect(() => Effect.succeed(failed('CollectionFailed'))),
  );
  return program;
}
