import {
  ClockReading,
  Digest,
  LiveAdmissionDraft,
  LocalIngressPolicy,
  VerifiedCommand,
  commandKey,
} from '@ceirean/domain';
import { Effect, FileSystem, Option } from 'effect';

export function policyFixture() {
  return LocalIngressPolicy.make({
    revision: 'local-1',
    ingressScopeId: 'fixture-app',
    appId: 77,
    installationId: 11,
    ownerId: 33,
    repositoryId: 22,
    profile: { _tag: 'Enabled', profileId: 'foldkit', profileRevision: 'profile-1' },
    policyRevision: 'policy-1',
    allowedOperatorIds: [66, 67],
  });
}
export function verifiedFixture(id = 55, operatorId = 66) {
  return VerifiedCommand.make({
    receipt: {
      ingressScopeId: 'fixture-app',
      deliveryId: `delivery-${id}`,
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
      commentId: id,
      operatorId,
      command: 'Assess',
      ownerLogin: 'owner',
      repositoryName: 'repository',
    },
  });
}
export function draftFixture(id = 55, policy = policyFixture(), operatorId = 66) {
  const verified = verifiedFixture(id, operatorId);
  const key = commandKey(verified.candidate);
  const evidence = {
    evidenceId: `evidence-${id}-${operatorId}`,
    commandKey: key,
    appId: policy.appId,
    installationId: policy.installationId,
    ownerId: policy.ownerId,
    repositoryId: policy.repositoryId,
    operatorId,
    localPolicyRevision: policy.revision,
    policyRevision: policy.policyRevision,
    profileId: 'foldkit',
    profileRevision: 'profile-1',
    basePermission: 'write' as const,
    observedAtMs: 900,
    checkedAtMs: 1000,
    validUntilMs: 6900,
  };
  return LiveAdmissionDraft.members[1].make({
    verified,
    expectedLocalRevision: policy.revision,
    decision: {
      _tag: 'AdmittedPreview',
      commandKey: key,
      policyRevision: policy.policyRevision,
      profileId: 'foldkit',
      profileRevision: 'profile-1',
      evidenceRevision: evidence.evidenceId,
    },
    provenance: { _tag: 'LiveChecked', evidence },
    startedMonotonicMs: 100,
    evaluatedAtMs: 1000,
    evaluatedMonotonicMs: 200,
  });
}
export function ownedConfig() {
  function* acquire() {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'ceirean-live-inbox-' });
    const root = yield* fs.realPath(temporary);
    yield* fs.chmod(root, 0o700);
    const ownerUid = Option.getOrThrow((yield* fs.stat(root)).uid);
    let at = ClockReading.make({ wallMs: 1000, monotonicMs: 200 });
    return {
      fs,
      root,
      config: {
        file: `${root}/admission.sqlite`,
        ingressScopeId: 'fixture-app',
        initialPolicy: policyFixture(),
        pathPolicy: {
          _tag: 'TestOwnedTemporary' as const,
          stateRoot: root,
          ownerUid,
          ownedTemporaryRoot: root,
        },
        limits: { decisions: 256, receipts: 1024, authorityRevisions: 256 },
        clock: () => at,
      },
      setClock: (next: ClockReading) => {
        at = next;
      },
    };
  }
  const acquisition = Effect.gen(acquire);
  return acquisition;
}
