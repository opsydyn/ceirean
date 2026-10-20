import { AdmissionDraft, AuthorityAvailable, Digest, VerifiedCommand } from '@leviathan/domain';

export function authorityFixture() {
  return {
    atMs: 1000,
    state: AuthorityAvailable.make({
      _tag: 'Available',
      revision: 'authority-1',
      ingressScopeId: 'fixture-app',
      installationId: 11,
      repositoryId: 22,
      ownerId: 33,
      access: 'Granted',
      profile: { _tag: 'Enabled', profileId: 'foldkit', profileRevision: 'profile-1' },
      allowedOperatorIds: [66],
      policyRevision: 'policy-1',
      observedAtMs: 900,
      validUntilMs: 2000,
    }),
  };
}

export function draftFixture() {
  return AdmissionDraft.make({
    verified: VerifiedCommand.make({
      receipt: {
        ingressScopeId: 'fixture-app',
        deliveryId: 'delivery-1',
        eventName: 'issue_comment',
        rawBodyDigest: Digest.make('a'.repeat(64)),
      },
      candidate: {
        ingressScopeId: 'fixture-app',
        installationId: 11,
        repositoryId: 22,
        ownerId: 33,
        issueId: 44,
        issueNumber: 1,
        commentId: 55,
        operatorId: 66,
        command: 'Assess',
        ownerLogin: 'owner',
        repositoryName: 'repository',
      },
    }),
    decision: {
      _tag: 'AdmittedPreview',
      commandKey: '[11,22,55]',
      policyRevision: 'policy-1',
      profileId: 'foldkit',
      profileRevision: 'profile-1',
      evidenceRevision: 'authority-1',
    },
    expectedAuthorityRevision: 'authority-1',
    evaluatedAtMs: 1000,
  });
}
