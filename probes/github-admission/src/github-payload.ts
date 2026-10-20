import {
  AdmissionLimits,
  GitHubId,
  VerifiedCommand,
  type NonAdmittedDecision,
} from '@leviathan/domain';
import { Match, Result, Schema } from 'effect';

const native = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({ id: GitHubId }),
  repository: Schema.Struct({
    id: GitHubId,
    name: Schema.String,
    owner: Schema.Struct({ id: GitHubId, login: Schema.String }),
  }),
  issue: Schema.Struct({
    id: GitHubId,
    number: GitHubId,
    pull_request: Schema.optionalKey(Schema.Unknown),
  }),
  comment: Schema.Struct({
    id: GitHubId,
    body: Schema.String,
    user: Schema.Struct({ id: GitHubId, type: Schema.String }),
  }),
  sender: Schema.Struct({ id: GitHubId, type: Schema.String }),
});
function refused(
  reason: NonAdmittedDecision['reason'],
  tag: NonAdmittedDecision['_tag'] = 'Rejected',
) {
  return Result.fail<NonAdmittedDecision>({ _tag: tag, reason });
}
export function normaliseGitHubDelivery(input: {
  readonly eventName: string;
  readonly payload: unknown;
  readonly receipt: VerifiedCommand['receipt'];
}): Result.Result<VerifiedCommand, NonAdmittedDecision> {
  const decoded = Schema.decodeUnknownResult(native)(input.payload);
  function normalize(
    value: typeof native.Type,
  ): Result.Result<VerifiedCommand, NonAdmittedDecision> {
    const command = Schema.decodeUnknownResult(VerifiedCommand)({
      receipt: input.receipt,
      candidate: {
        ingressScopeId: input.receipt.ingressScopeId,
        installationId: value.installation.id,
        repositoryId: value.repository.id,
        ownerId: value.repository.owner.id,
        issueId: value.issue.id,
        issueNumber: value.issue.number,
        commentId: value.comment.id,
        operatorId: value.sender.id,
        command: 'Assess',
        ownerLogin: value.repository.owner.login,
        repositoryName: value.repository.name,
      },
    });
    const isUser = Schema.is(Schema.Literal('User'));
    const isCreated = Schema.is(Schema.Literal('created'));
    const exact = Schema.is(Schema.Literal('/leviathan assess'));
    return Match.value(true).pipe(
      Match.when(
        () =>
          new TextEncoder().encode(value.comment.body).length > AdmissionLimits.commentBodyBytes,
        () => refused('FieldTooLarge'),
      ),
      Match.when(
        () =>
          [value.repository.name, value.repository.owner.login].some(
            (text) => new TextEncoder().encode(text).length > AdmissionLimits.displayNameBytes,
          ),
        () => refused('FieldTooLarge'),
      ),
      Match.when(
        () => !isCreated(value.action),
        () => refused('UnsupportedAction', 'Ignored'),
      ),
      Match.when(
        () => 'pull_request' in value.issue,
        () => refused('PullRequestComment', 'Ignored'),
      ),
      Match.when(
        () => !isUser(value.sender.type) || !isUser(value.comment.user.type),
        () => refused('BotActor', 'Ignored'),
      ),
      Match.when(
        () => value.sender.id !== value.comment.user.id,
        () => refused('MalformedInput'),
      ),
      Match.when(
        () => !exact(value.comment.body),
        () => refused('NotCommand', 'Ignored'),
      ),
      Match.orElse(() =>
        Result.mapError(command, () => ({
          _tag: 'Rejected' as const,
          reason: 'MalformedInput' as const,
        })),
      ),
    );
  }
  return Match.value(input.eventName).pipe(
    Match.when('issue_comment', () =>
      Result.match(decoded, { onSuccess: normalize, onFailure: () => refused('MalformedInput') }),
    ),
    Match.orElse(() => refused('UnsupportedEvent', 'Ignored')),
  );
}
