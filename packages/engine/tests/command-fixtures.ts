import {
  AdmissionDraft,
  AuthorityAvailable,
  VerifiedCommand,
  Digest,
  decideAssessment,
} from '@ceirean/domain';
import { Effect, Layer, Match } from 'effect';

import {
  CommandAdmission,
  CommandInbox,
  makeCommandAdmission,
  makeCommandInbox,
} from '../src/index.ts';

export function commandApplication(driver: Parameters<typeof makeCommandInbox>[0]) {
  const inbox = Layer.succeed(CommandInbox, makeCommandInbox(driver));
  const admission = Layer.effect(CommandAdmission, makeCommandAdmission());
  return admission.pipe(Layer.provide(inbox));
}

export function acquireCommandAdmission(driver: Parameters<typeof makeCommandInbox>[0]) {
  const acquisition = makeCommandAdmission();
  return acquisition.pipe(Effect.provideService(CommandInbox, makeCommandInbox(driver)));
}

export function acquireCommandAdmissionFromInbox(inbox: ReturnType<typeof makeCommandInbox>) {
  const acquisition = makeCommandAdmission();
  return acquisition.pipe(Effect.provideService(CommandInbox, inbox));
}

export function verifiedCommandFixture() {
  return VerifiedCommand.make({
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
  });
}

export function authorityFixture() {
  const state = AuthorityAvailable.make({
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
  return { atMs: 1000, state };
}

export function draftFixture(
  verified = verifiedCommandFixture(),
  observation = authorityFixture(),
) {
  const decision = decideAssessment({
    candidate: verified.candidate,
    authority: observation.state,
    nowMs: observation.atMs,
  });
  const recordable = Match.value(decision).pipe(
    Match.tag('Ignored', () => ({ _tag: 'Rejected' as const, reason: 'NotCommand' as const })),
    Match.orElse((value) => value),
  );
  return AdmissionDraft.make({
    verified,
    decision: recordable,
    expectedAuthorityRevision: observation.state.revision,
    evaluatedAtMs: observation.atMs,
  });
}
