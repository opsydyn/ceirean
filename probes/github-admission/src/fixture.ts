import { AdmissionDraft, AuthorityAvailable, Digest, VerifiedCommand } from '@ceirean/domain';
import { Schema } from 'effect';

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

export async function signedCommandFixture(deliveryId: string) {
  const fixture = { secret: 'synthetic-restart-secret' };
  const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
  const body = encode({
    action: 'created',
    installation: { id: 11 },
    repository: { id: 22, name: 'repository', owner: { id: 33, login: 'owner' } },
    issue: { id: 44, number: 1 },
    comment: { id: 55, body: '/ceirean assess', user: { id: 66, type: 'User' } },
    sender: { id: 66, type: 'User' },
  });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(fixture.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  );
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    secret: fixture.secret,
    request: new Request('http://ceirean.invalid/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'issue_comment',
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': `sha256=${signature}`,
      },
      body,
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
