import { AuthorityAvailable, CommandCandidate } from '../src/command-admission.ts';

export function commandFixture() {
  const candidate = CommandCandidate.make({
    ingressScopeId: 'fixture-app',
    installationId: 11,
    repositoryId: 22,
    ownerId: 33,
    issueId: 44,
    issueNumber: 1,
    commentId: 55,
    operatorId: 66,
    command: 'Assess',
    ownerLogin: 'fixture-owner',
    repositoryName: 'fixture-repository',
  });
  const authority = AuthorityAvailable.make({
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
  });
  return { candidate, authority, nowMs: 1000 };
}
