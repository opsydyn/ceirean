import { Digest, ReplayInspection, inspectReplayRequest } from '@ceirean/domain';
import { BunFileSystem } from '@effect/platform-bun';
import { Effect, Match, Result, Schema } from 'effect';

import { readDraftProfile } from './reader.ts';

const InspectionReport = Schema.TaggedStruct('InspectionReport', {
  report: ReplayInspection,
  sourceDigest: Digest,
  profileOrigin: Schema.Literal('UnverifiedWorkingTree'),
});
const encodeReport = Schema.encodeUnknownResult(Schema.fromJsonString(InspectionReport), {
  onExcessProperty: 'error',
});
const Failure = Schema.TaggedStruct('InspectionFailed', {
  code: Schema.Literals([
    'ReadFailed',
    'NotRegular',
    'ProfileTooLarge',
    'InvalidEncoding',
    'InvalidProfile',
    'InvalidReport',
    'OutputTooLarge',
  ]),
});
const encodeFailure = Schema.encodeSync(Schema.fromJsonString(Failure));
type FailureCode = Parameters<typeof encodeFailure>[0]['code'];
const canonicalPath = new URL('../../../profiles/foldkit-0166-replay.json', import.meta.url)
  .pathname;
function failed(code: FailureCode) {
  return {
    exitCode: 1,
    stdout: '',
    stderr: `${encodeFailure({ _tag: 'InspectionFailed', code })}\n`,
  };
}

function inspect() {
  function* inspection() {
    const { profile, sourceDigest } = yield* readDraftProfile(canonicalPath);
    const request = {
      mode: 'InspectOnly',
      repository: profile.repository.slug,
      baseSha: profile.repository.baseSha,
      targets: profile.targets,
    };
    const report = yield* Effect.fromResult(inspectReplayRequest(profile, request));
    const encoded = encodeReport({
      _tag: 'InspectionReport',
      report,
      sourceDigest,
      profileOrigin: 'UnverifiedWorkingTree',
    }).pipe(Result.mapError(() => ({ _tag: 'InvalidReport' as const })));
    const stdout = `${yield* Effect.fromResult(encoded)}\n`;
    return Match.value(new TextEncoder().encode(stdout).byteLength <= 16384).pipe(
      Match.when(true, () => ({ exitCode: 2, stdout, stderr: '' })),
      Match.orElse(() => failed('OutputTooLarge')),
    );
  }
  const workflow = Effect.gen(inspection);
  const result = Effect.result(workflow);
  function renderFailure(error: Effect.Error<typeof workflow>) {
    return Match.value(error).pipe(
      Match.tag('ProfileReadError', (e) => failed(e.code)),
      Match.orElse(() => failed('InvalidReport')),
    );
  }
  return result.pipe(
    Effect.map(Result.match({ onSuccess: (output) => output, onFailure: renderFailure })),
    Effect.catchDefect(() => Effect.succeed(failed('ReadFailed'))),
  );
}

export function runCli(argv: ReadonlyArray<string>) {
  const supported = argv.length === 1 && argv.includes('inspect');
  const program = Match.value(supported).pipe(
    Match.when(true, inspect),
    Match.orElse(() =>
      Effect.succeed({ exitCode: 64, stdout: '', stderr: '{"_tag":"UsageError"}\n' }),
    ),
  );
  const provided = Effect.provide(program, BunFileSystem.layer);
  return provided;
}
