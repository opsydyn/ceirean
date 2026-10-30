import { ManifestDeclarationReport, inspectManifestDocuments } from '@ceirean/domain';
import { BunServices } from '@effect/platform-bun';
import { Data, Effect, Match, Order, Result, Schema } from 'effect';

import { foldkitManifestBaseline, manifestLimits } from './manifest-baseline.ts';
import { readPinnedManifests } from './manifest-git-source.ts';

const FailureCode = Schema.Literals([
  'GitFailed',
  'MissingObject',
  'InvalidTreeEntry',
  'InvalidEncoding',
  'SourceTooLarge',
  'InvalidSource',
  'InvalidManifest',
  'InvalidCatalog',
  'MissingCatalog',
  'InvalidReport',
  'OutputTooLarge',
  'TimedOut',
]);
const Failure = Schema.TaggedStruct('ManifestReportFailed', { code: FailureCode });
const encodeFailure = Schema.encodeSync(Schema.fromJsonString(Failure));
const decodeReport = Schema.decodeUnknownResult(ManifestDeclarationReport, {
  onExcessProperty: 'error',
});
const encodeReport = Schema.encodeSync(Schema.fromJsonString(ManifestDeclarationReport));
const equalPaths = Schema.toEquivalence(Schema.Array(Schema.String));
const expectedPaths = [...foldkitManifestBaseline.paths].sort(Order.String);
const LocalPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  Schema.makeFilter(
    (path) =>
      path.startsWith('/') &&
      Array.from(path).every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
  ),
);
export const ManifestArguments = Schema.Tuple([
  Schema.Literal('manifests'),
  Schema.Literal('--repository'),
  LocalPath,
]);
class ManifestReportError extends Data.TaggedError('ManifestReportError')<{
  readonly code: 'InvalidReport' | 'OutputTooLarge';
}> {}
function failed(code: typeof FailureCode.Type) {
  return {
    exitCode: 1,
    stdout: '',
    stderr: `${encodeFailure({ _tag: 'ManifestReportFailed', code })}\n`,
  };
}
function outputFor(input: unknown) {
  function* encode() {
    const report = yield* decodeReport(input).pipe(
      Result.mapError(() => new ManifestReportError({ code: 'InvalidReport' })),
    );
    const matched =
      report.repository === foldkitManifestBaseline.repository &&
      report.commit === foldkitManifestBaseline.commit &&
      equalPaths(report.coverage, expectedPaths) &&
      equalPaths(
        report.manifests.map((m) => m.path),
        expectedPaths,
      );
    const validity = Match.value(matched).pipe(
      Match.when(true, () => Result.succeed(true)),
      Match.orElse(() => Result.fail(new ManifestReportError({ code: 'InvalidReport' }))),
    );
    yield* validity;
    const stdout = `${encodeReport(report)}\n`;
    return yield* Match.value(
      new TextEncoder().encode(stdout).byteLength <= manifestLimits.output,
    ).pipe(
      Match.when(true, () => Result.succeed({ exitCode: 0, stdout, stderr: '' })),
      Match.orElse(() => Result.fail(new ManifestReportError({ code: 'OutputTooLarge' }))),
    );
  }
  return Result.gen(encode);
}
export function runManifestReport(repositoryPath: string, platform = BunServices.layer) {
  function* inspect() {
    const source = yield* readPinnedManifests(repositoryPath, foldkitManifestBaseline);
    const report = yield* Effect.fromResult(inspectManifestDocuments(source));
    return yield* Effect.fromResult(outputFor(report));
  }
  const workflow = Effect.gen(inspect);
  const scoped = Effect.scoped(workflow);
  const provided = Effect.provide(scoped, platform);
  const bounded = provided.pipe(Effect.timeout(manifestLimits.deadlineMs));
  function renderFailure(error: Effect.Error<typeof bounded>) {
    return Match.value(error).pipe(
      Match.tag('ManifestSourceError', 'ManifestInspectionError', 'ManifestReportError', (e) =>
        failed(e.code),
      ),
      Match.tag('TimeoutError', () => failed('TimedOut')),
      Match.orElse(() => failed('GitFailed')),
    );
  }
  const observed = Effect.result(bounded);
  return observed.pipe(
    Effect.map(Result.match({ onSuccess: (output) => output, onFailure: renderFailure })),
    Effect.catchDefect(() => Effect.succeed(failed('GitFailed'))),
  );
}
