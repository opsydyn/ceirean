import { Match, Result, Schema } from 'effect';

import { DraftReplayProfile, decodeReplayRequest, type ProfileProblem } from './replay-profile.ts';

const Blockers = Schema.Tuple([
  Schema.Literal('ProfileRevisionUnverified'),
  Schema.Literal('HostUnqualified'),
  Schema.Literal('ImageUnqualified'),
  Schema.Literal('ToolchainUnqualified'),
  Schema.Literal('AcceptanceUnqualified'),
  Schema.Literal('ExecutionUnapproved'),
  Schema.Literal('ModelPolicyUnapproved'),
]);
const CheckIdentifier = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/));
export const ReplayInspection = Schema.TaggedStruct('Blocked', {
  profileId: DraftReplayProfile.fields.profileId,
  repository: DraftReplayProfile.fields.repository,
  targets: DraftReplayProfile.fields.targets,
  limits: DraftReplayProfile.fields.limits,
  checkIds: Schema.Array(CheckIdentifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
    Schema.isUnique(),
  ),
  publication: Schema.Literal('Disabled'),
  canExecute: Schema.Literal(false),
  blockers: Blockers,
});
export type ReplayInspection = typeof ReplayInspection.Type;

function requireMatch(condition: boolean, problem: ProfileProblem) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.orElse(() => Result.fail(problem)),
  );
}

export function inspectReplayRequest(
  profile: DraftReplayProfile,
  input: unknown,
): Result.Result<ReplayInspection, ProfileProblem> {
  function* inspect() {
    const request = yield* decodeReplayRequest(input);
    yield* requireMatch(request.repository === profile.repository.slug, {
      _tag: 'RepositoryMismatch',
    });
    yield* requireMatch(request.baseSha === profile.repository.baseSha, { _tag: 'BaseMismatch' });
    const keys = ['fromFoldkit', 'foldkit', 'vitePlugin', 'effect'] as const;
    yield* requireMatch(
      keys.every((key) => request.targets[key] === profile.targets[key]),
      { _tag: 'TargetsMismatch' },
    );
    const report = {
      _tag: 'Blocked',
      profileId: profile.profileId,
      repository: structuredClone(profile.repository),
      targets: structuredClone(profile.targets),
      limits: structuredClone(profile.limits),
      checkIds: profile.checks.map((c) => c.id),
      publication: 'Disabled',
      canExecute: false,
      blockers: [
        'ProfileRevisionUnverified',
        'HostUnqualified',
        'ImageUnqualified',
        'ToolchainUnqualified',
        'AcceptanceUnqualified',
        'ExecutionUnapproved',
        'ModelPolicyUnapproved',
      ],
    };
    return yield* Schema.decodeUnknownResult(ReplayInspection, { onExcessProperty: 'error' })(
      report,
    ).pipe(Result.mapError((): ProfileProblem => ({ _tag: 'InvalidProfile' })));
  }
  return Result.gen(inspect);
}
