import { expect, test } from 'bun:test';

import { Option, Schema } from 'effect';

import { commandKey } from '../src/command-admission.ts';
import { decideLiveAdmission } from '../src/live-admission-policy.ts';
import {
  LiveAdmissionDraft,
  LiveAdmissionRecord,
  LivePermissionEvidence,
} from '../src/live-admission.ts';
import { commandFixture } from './command-fixtures.ts';

function fixture() {
  const { candidate, authority } = commandFixture();
  const verified = {
    candidate,
    receipt: {
      ingressScopeId: candidate.ingressScopeId,
      deliveryId: 'live-1',
      eventName: 'issue_comment' as const,
      rawBodyDigest: 'a'.repeat(64),
    },
  };
  const policy = {
    revision: 'local-1',
    appId: 77,
    ingressScopeId: candidate.ingressScopeId,
    installationId: candidate.installationId,
    ownerId: candidate.ownerId,
    repositoryId: candidate.repositoryId,
    profile: authority.profile,
    policyRevision: authority.policyRevision,
    allowedOperatorIds: [candidate.operatorId],
  };
  const evidence = {
    evidenceId: 'evidence-1',
    commandKey: commandKey(candidate),
    appId: 77,
    installationId: candidate.installationId,
    ownerId: candidate.ownerId,
    repositoryId: candidate.repositoryId,
    operatorId: candidate.operatorId,
    localPolicyRevision: policy.revision,
    policyRevision: policy.policyRevision,
    profileId: 'foldkit',
    profileRevision: 'profile-1',
    basePermission: 'write' as const,
    observedAtMs: 900,
    checkedAtMs: 1000,
    validUntilMs: 6900,
  };
  return {
    verified,
    policy,
    evidence: Option.some({ evidence, startedMonotonicMs: 100 }),
    now: { wallMs: 1000, monotonicMs: 200 },
  };
}

function decideAt(wallMs: number) {
  return decideLiveAdmission({ ...fixture(), now: { wallMs, monotonicMs: wallMs - 800 } });
}

function coherentControls() {
  const input = fixture();
  const decision = decideLiveAdmission(input);
  expect(decision._tag).toBe('AdmittedPreview');
  expect(decideAt(6899)._tag).toBe('AdmittedPreview');
  expect(decideAt(6900)._tag).toBe('Rejected');
  const lease = Option.getOrThrow(input.evidence);
  expect(
    decideLiveAdmission({
      ...input,
      evidence: Option.some({ ...lease, evidence: { ...lease.evidence, basePermission: 'admin' } }),
    })._tag,
  ).toBe('AdmittedPreview');
}
test('coherent write/admin controls admit and expiry is exclusive', coherentControls);

function boundEvidence() {
  const input = fixture();
  const lease = Option.getOrThrow(input.evidence);
  expect(decideLiveAdmission({ ...input, evidence: Option.none() })._tag).toBe('Rejected');
  for (const mutation of [
    { commandKey: '[11,22,56]' },
    { appId: 78 },
    { installationId: 12 },
    { ownerId: 34 },
    { repositoryId: 23 },
    { operatorId: 67 },
    { localPolicyRevision: 'other' },
    { policyRevision: 'other' },
    { profileId: 'other' },
    { profileRevision: 'other' },
    { basePermission: 'read' },
    { basePermission: 'none' },
    { basePermission: 'custom-admin' },
    { observedAtMs: 1001 },
    { checkedAtMs: 1001 },
    { checkedAtMs: 899 },
    { validUntilMs: 6901 },
    { validUntilMs: 900 },
  ]) {
    expect(
      decideLiveAdmission({
        ...input,
        evidence: Option.some({ ...lease, evidence: { ...lease.evidence, ...mutation } }),
      })._tag,
    ).toBe('Rejected');
  }
}
test('absent, wrongly bound and insufficient evidence refuses', boundEvidence);

function invalidInputs() {
  const input = fixture();
  for (const field of [
    'installationId',
    'repositoryId',
    'ownerId',
    'issueId',
    'issueNumber',
    'commentId',
    'operatorId',
  ]) {
    expect(
      decideLiveAdmission({
        ...input,
        verified: { ...input.verified, candidate: { ...input.verified.candidate, [field]: 0 } },
      })._tag,
    ).toBe('Rejected');
  }
  for (const policy of [
    { ...input.policy, allowedOperatorIds: [99] },
    { ...input.policy, profile: { _tag: 'Disabled' } },
    { ...input.policy, ingressScopeId: 'other' },
  ])
    expect(decideLiveAdmission({ ...input, policy })._tag).toBe('Rejected');
  for (const now of [
    { wallMs: 999, monotonicMs: 200 },
    { wallMs: 1000, monotonicMs: 99 },
    { wallMs: 1000, monotonicMs: 6100 },
    ...[NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].flatMap((value) => [
      { wallMs: value, monotonicMs: 200 },
      { wallMs: 1000, monotonicMs: value },
    ]),
  ])
    expect(decideLiveAdmission({ ...input, now })._tag).toBe('Rejected');
}
test('invalid IDs, local refusal and invalid or rollback clocks refuse', invalidInputs);

function assertValid<S extends Schema.Constraint>(schema: S, input: unknown, expected: boolean) {
  const valid = Schema.is(schema)(input);
  expect(valid).toBe(expected);
}
function provenanceSchemas() {
  const input = fixture();
  const lease = Option.getOrThrow(input.evidence);
  const common = {
    verified: input.verified,
    expectedLocalRevision: 'local-1',
    evaluatedAtMs: 1000,
    evaluatedMonotonicMs: 200,
  };
  const decision = decideLiveAdmission(input);
  const draft = {
    ...common,
    decision,
    provenance: { _tag: 'LiveChecked', evidence: lease.evidence },
    startedMonotonicMs: 100,
  };
  assertValid(LiveAdmissionDraft, draft, true);
  assertValid(
    LiveAdmissionDraft,
    {
      ...draft,
      provenance: { _tag: 'LocalPolicy', revision: 'local-1' },
    },
    false,
  );
  assertValid(LiveAdmissionDraft, { ...draft, startedMonotonicMs: undefined }, false);
  assertValid(
    LiveAdmissionDraft,
    {
      ...draft,
      provenance: { _tag: 'LiveChecked', evidence: { ...lease.evidence, operatorId: 99 } },
    },
    false,
  );
  assertValid(
    LiveAdmissionDraft,
    {
      ...common,
      decision: { _tag: 'Rejected', reason: 'OperatorDenied' },
      provenance: { _tag: 'LocalPolicy', revision: 'local-1' },
    },
    true,
  );
  assertValid(LivePermissionEvidence, { ...lease.evidence, basePermission: 'custom-role' }, false);
  assertValid(
    LiveAdmissionDraft,
    {
      ...common,
      decision: { _tag: 'Rejected', reason: 'AuthorityExpired' },
      provenance: { _tag: 'LocalPolicy', revision: 'local-1' },
    },
    false,
  );
}
test(
  'draft schema cannot validate invented local admission or mismatched live provenance',
  provenanceSchemas,
);

function evaluationMonotonicSchema() {
  const input = fixture();
  const lease = Option.getOrThrow(input.evidence);
  const common = {
    verified: input.verified,
    expectedLocalRevision: input.policy.revision,
    evaluatedAtMs: 1000,
    evaluatedMonotonicMs: 200,
  };
  const local = {
    ...common,
    decision: { _tag: 'Rejected', reason: 'OperatorDenied' },
    provenance: { _tag: 'LocalPolicy', revision: input.policy.revision },
  };
  const live = {
    ...common,
    decision: decideLiveAdmission(input),
    provenance: { _tag: 'LiveChecked', evidence: lease.evidence },
    startedMonotonicMs: 100,
  };
  assertValid(LiveAdmissionDraft, local, true);
  assertValid(LiveAdmissionDraft, live, true);
  for (const draft of [local, live]) {
    for (const value of [undefined, NaN, Infinity, -1, 0.5])
      assertValid(LiveAdmissionDraft, { ...draft, evaluatedMonotonicMs: value }, false);
  }
  for (const evaluatedMonotonicMs of [99, 6100, 6101])
    assertValid(LiveAdmissionDraft, { ...live, evaluatedMonotonicMs }, false);
  assertValid(LiveAdmissionDraft, { ...live, evaluatedMonotonicMs: 6099 }, true);
}
test(
  'I2 draft evaluation requires safe monotonic time and live start/age ordering',
  evaluationMonotonicSchema,
);

function liveRefusalRelationships() {
  const input = fixture();
  const lease = Option.getOrThrow(input.evidence);
  const admitted = decideLiveAdmission(input);
  const draft = {
    verified: input.verified,
    expectedLocalRevision: input.policy.revision,
    evaluatedAtMs: 1000,
    evaluatedMonotonicMs: 200,
    startedMonotonicMs: 100,
    provenance: { _tag: 'LiveChecked', evidence: lease.evidence },
    decision: admitted,
  };
  const record = {
    decisionId: '1',
    commandKey: commandKey(input.verified.candidate),
    candidate: input.verified.candidate,
    localPolicyRevision: input.policy.revision,
    evaluatedAtMs: 1000,
    committedAtMs: 1001,
    provenance: draft.provenance,
    decision: admitted,
  };
  for (const basePermission of ['write', 'admin', 'read', 'none'] as const) {
    const evidence = { ...lease.evidence, basePermission };
    const provenance = { _tag: 'LiveChecked', evidence };
    const lowPermission = ['read', 'none'].includes(basePermission);
    assertValid(LiveAdmissionDraft, { ...draft, provenance }, !lowPermission);
    assertValid(LiveAdmissionRecord, { ...record, provenance }, !lowPermission);
    const denied = { _tag: 'Rejected', reason: 'OperatorDenied' };
    assertValid(LiveAdmissionDraft, { ...draft, provenance, decision: denied }, lowPermission);
    assertValid(LiveAdmissionRecord, { ...record, provenance, decision: denied }, lowPermission);
    for (const reason of [
      'AuthorityUnavailable',
      'NotCommand',
      'IdentityMismatch',
      'AuthorityExpired',
      'InvalidClock',
      'InvalidAuthority',
      'ProfileUnavailable',
      'AccessRevoked',
      'MalformedInput',
      'AuthorityChanged',
      'CommandConflict',
      'DeliveryConflict',
      'CapacityExceeded',
    ]) {
      const decision = { _tag: 'Rejected', reason };
      assertValid(LiveAdmissionDraft, { ...draft, provenance, decision }, false);
      assertValid(LiveAdmissionRecord, { ...record, provenance, decision }, false);
    }
    const mismatch = { _tag: 'LiveChecked', evidence: { ...evidence, operatorId: 99 } };
    assertValid(LiveAdmissionDraft, { ...draft, provenance: mismatch, decision: denied }, false);
    assertValid(LiveAdmissionRecord, { ...record, provenance: mismatch, decision: denied }, false);
  }
}
test(
  'I3 live draft and record reject impossible refusals but retain low-permission denials',
  liveRefusalRelationships,
);
