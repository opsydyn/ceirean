import {
  AuthorityQuery,
  ClockReading,
  GitHubId,
  LiveEvidenceLease,
  commandKey,
  decideLiveAdmission,
} from '@ceirean/domain';
import { LiveAuthorityError, type LiveAuthorityDriver } from '@ceirean/engine';
import { Match, Option, Result, Schema } from 'effect';

import { importAppSigner } from './github-auth.ts';
import {
  boundedNativeOutcome,
  githubRequest,
  interrupted,
  requireGitHub,
  safeGitHubError,
  type GitHubFetch,
} from './github-http.ts';

const segment = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/));
const installationSchema = Schema.Struct({
  id: GitHubId,
  app_id: GitHubId,
  account: Schema.Struct({ id: GitHubId }),
  suspended_at: Schema.NullOr(Schema.String),
});
const tokenSchema = Schema.Struct({
  token: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,4096}$/)),
  expires_at: Schema.String,
  permissions: Schema.Record(Schema.String, Schema.String),
  repository_selection: Schema.String,
  repositories: Schema.Array(Schema.Struct({ id: GitHubId })),
});
const repositorySchema = Schema.Struct({
  id: GitHubId,
  owner: Schema.Struct({ id: GitHubId, login: segment }),
  name: segment,
  archived: Schema.Boolean,
  disabled: Schema.Boolean,
});
const userSchema = Schema.Struct({ id: GitHubId, login: segment, type: Schema.String });
const permissionSchema = Schema.Struct({
  permission: Schema.Literals(['write', 'admin', 'read', 'none']),
  user: Schema.Struct({ id: GitHubId }),
});
const enabledProfile = Schema.Struct({
  _tag: Schema.Literal('Enabled'),
  profileId: Schema.String,
  profileRevision: Schema.String,
});
const tokenRequest = Schema.fromJsonString(
  Schema.Struct({
    repository_ids: Schema.Array(GitHubId),
    permissions: Schema.Struct({ metadata: Schema.Literal('read') }),
  }),
);
const isSelected = Schema.is(Schema.Literal('selected'));
const isRead = Schema.is(Schema.Literal('read'));
const isHuman = Schema.is(Schema.Literal('User'));

function decode<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  value: unknown,
  phase: LiveAuthorityError['phase'],
) {
  return Schema.decodeUnknownResult(schema)(value).pipe(
    Result.getOrThrowWith(() => new LiveAuthorityError({ phase, code: 'InvalidResponse' })),
  );
}

export async function makeGitHubAuthorityDriver(options: {
  readonly appId: number;
  readonly privateKey: string;
  readonly fetch: GitHubFetch;
  readonly clock: () => ClockReading;
}) {
  const { appId, privateKey, fetch, clock } = options;
  const acquired = await importAppSigner(appId, privateKey);
  function buildDriver(sign: (wallMs: number) => Promise<string>) {
    const closed = new AbortController();
    const outstanding = new Set<Promise<void>>();
    let disposal: Promise<void> | undefined;
    function run(input: AuthorityQuery, callerSignal: AbortSignal) {
      const timeout = new AbortController();
      const signal = AbortSignal.any([callerSignal, timeout.signal, closed.signal]);
      const nativeRequests: Promise<void>[] = [];
      function own(settlement: Promise<void>) {
        nativeRequests.push(settlement);
      }
      const timer = setTimeout(
        () => timeout.abort(new LiveAuthorityError({ phase: 'permission', code: 'Timeout' })),
        6000,
      );
      const current: { phase: LiveAuthorityError['phase'] } = { phase: 'signing' };
      // Detach all request facts before signing or any other asynchronous work.
      const snapshot = Result.try(() =>
        decode(AuthorityQuery, structuredClone(input), 'installation'),
      );
      async function check(query: AuthorityQuery) {
        const { policy, verified } = query;
        const first = decode(ClockReading, clock(), 'signing');
        const profile = policy.profile;
        const eligible = decideLiveAdmission({ ...query, evidence: Option.none(), now: first });
        const locallyEligible = Match.value(eligible).pipe(
          Match.when({ _tag: 'Rejected', reason: 'AuthorityUnavailable' }, () => true),
          Match.orElse(() => false),
        );
        requireGitHub(
          locallyEligible && policy.appId === appId,
          'installation',
          'IdentityMismatch',
        );
        const enabled = decode(enabledProfile, profile, 'installation');
        let expires = Number.MAX_SAFE_INTEGER;
        function reading() {
          interrupted(signal, current.phase);
          const now = decode(ClockReading, clock(), current.phase);
          requireGitHub(
            now.wallMs >= first.wallMs && now.monotonicMs >= first.monotonicMs,
            current.phase,
            'InvalidResponse',
          );
          requireGitHub(
            now.wallMs - first.wallMs < 6000 && now.monotonicMs - first.monotonicMs < 6000,
            current.phase,
            'Timeout',
          );
          requireGitHub(
            now.wallMs < expires && now.monotonicMs - first.monotonicMs < expires - first.wallMs,
            'token',
            'Timeout',
          );
          return now;
        }
        interrupted(signal, current.phase);
        const jwt = await sign(first.wallMs);
        async function request<S extends Schema.ConstraintDecoder<unknown, never>>(
          nextPhase: LiveAuthorityError['phase'],
          path: string,
          token: string,
          schema: S,
          body?: string,
        ) {
          current.phase = nextPhase;
          reading();
          const raw = await githubRequest(
            fetch,
            signal,
            {
              phase: current.phase,
              path,
              token,
              body,
            },
            own,
          );
          reading();
          return decode(schema, raw, current.phase);
        }
        const installation = await request(
          'installation',
          `/app/installations/${policy.installationId}`,
          jwt,
          installationSchema,
        );
        const installationMatches = [
          installation.id === policy.installationId,
          installation.app_id === appId,
          installation.account.id === policy.ownerId,
          installation.suspended_at === null,
        ].every(Boolean);
        requireGitHub(installationMatches, current.phase, 'IdentityMismatch');
        const body = Schema.encodeSync(tokenRequest)({
          repository_ids: [policy.repositoryId],
          permissions: { metadata: 'read' },
        });
        const token = await request(
          'token',
          `/app/installations/${policy.installationId}/access_tokens`,
          jwt,
          tokenSchema,
          body,
        );
        const expiration = Date.parse(token.expires_at);
        requireGitHub(
          Number.isSafeInteger(expiration) && expiration > reading().wallMs,
          'token',
          'InvalidResponse',
        );
        expires = expiration;
        const restricted = [
          isSelected(token.repository_selection),
          token.repositories.length === 1,
          token.repositories[0]?.id === policy.repositoryId,
          Object.keys(token.permissions).length === 1,
          isRead(token.permissions['metadata']),
        ].every(Boolean);
        requireGitHub(restricted, 'token', 'IdentityMismatch');
        const repository = await request(
          'repository',
          `/repositories/${policy.repositoryId}`,
          token.token,
          repositorySchema,
        );
        const repositoryMatches = [
          repository.id === policy.repositoryId,
          repository.owner.id === policy.ownerId,
          !repository.archived,
          !repository.disabled,
        ].every(Boolean);
        requireGitHub(repositoryMatches, current.phase, 'IdentityMismatch');
        const user = await request(
          'user',
          `/user/${verified.candidate.operatorId}`,
          token.token,
          userSchema,
        );
        requireGitHub(
          user.id === verified.candidate.operatorId && isHuman(user.type),
          current.phase,
          'IdentityMismatch',
        );
        const permission = await request(
          'permission',
          `/repos/${repository.owner.login}/${repository.name}/collaborators/${user.login}/permission`,
          token.token,
          permissionSchema,
        );
        requireGitHub(permission.user.id === user.id, current.phase, 'IdentityMismatch');
        const checked = reading();
        const validUntilMs = Math.min(first.wallMs + 6000, expires);
        requireGitHub(
          checked.wallMs < validUntilMs &&
            checked.monotonicMs - first.monotonicMs < validUntilMs - first.wallMs,
          current.phase,
          'Timeout',
        );
        return decode(
          LiveEvidenceLease,
          {
            startedMonotonicMs: first.monotonicMs,
            evidence: {
              evidenceId: crypto.randomUUID(),
              commandKey: commandKey(verified.candidate),
              appId,
              installationId: policy.installationId,
              ownerId: policy.ownerId,
              repositoryId: policy.repositoryId,
              operatorId: user.id,
              localPolicyRevision: policy.revision,
              policyRevision: policy.policyRevision,
              profileId: enabled.profileId,
              profileRevision: enabled.profileRevision,
              basePermission: permission.permission,
              observedAtMs: first.wallMs,
              checkedAtMs: checked.wallMs,
              validUntilMs,
            },
          },
          'permission',
        );
      }
      function failure(error: unknown) {
        const interruption = Result.try(() => interrupted(signal, current.phase));
        const cause = Result.match(interruption, {
          onFailure: (abort) => abort,
          onSuccess: () => error,
        });
        return Result.fail(safeGitHubError(cause, current.phase));
      }
      const native = Promise.resolve(snapshot)
        .then(Result.getOrThrow)
        .then(check)
        .then(Result.succeed, failure);
      async function settle() {
        await native;
        await Promise.all(nativeRequests);
      }
      const settlement = settle().finally(() => {
        outstanding.delete(settlement);
      });
      outstanding.add(settlement);
      return boundedNativeOutcome(native, signal, () => current.phase)
        .catch(failure)
        .finally(() => clearTimeout(timer));
    }
    function driver(input: AuthorityQuery, callerSignal: AbortSignal) {
      return Match.value(true).pipe(
        Match.when(
          () => closed.signal.aborted,
          () =>
            Promise.resolve(
              Result.fail(new LiveAuthorityError({ phase: 'signing', code: 'Aborted' })),
            ),
        ),
        Match.when(
          () => outstanding.size >= 4,
          () =>
            Promise.resolve(
              Result.fail(new LiveAuthorityError({ phase: 'signing', code: 'Unavailable' })),
            ),
        ),
        Match.orElse(() => run(input, callerSignal)),
      );
    }
    function dispose() {
      closed.abort();
      disposal ??= Promise.all(outstanding).then(() => undefined);
      return disposal;
    }
    return { driver: driver satisfies LiveAuthorityDriver, dispose };
  }
  return Result.map(acquired, buildDriver);
}
