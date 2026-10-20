import { test } from 'bun:test';

import { Arbitrary, Effect, Match, Option, Schema } from 'effect';

import { AdmissionDecision, commandKey } from '../src/command-admission.ts';
import { decideLiveAdmission } from '../src/live-admission-policy.ts';
import { LiveAdmissionDraft } from '../src/live-admission.ts';
import { commandFixture } from './command-fixtures.ts';
import { checkLaw } from './properties.ts';

const generatedSchema = Schema.Struct({
  id: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
  time: Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 1_000_000 })),
});
const generated = Arbitrary.schema(generatedSchema);
const cases = Arbitrary.map(generated, coherentCase);

function coherentCase({ id, time }: { readonly id: number; readonly time: number }) {
  const base = commandFixture();
  const candidate = {
    ...base.candidate,
    installationId: id,
    repositoryId: id + 1,
    ownerId: id + 2,
    commentId: id + 3,
    operatorId: id + 4,
  };
  const verified = {
    candidate,
    receipt: {
      ingressScopeId: candidate.ingressScopeId,
      deliveryId: `delivery-${id}`,
      eventName: 'issue_comment' as const,
      rawBodyDigest: 'a'.repeat(64),
    },
  };
  const policy = {
    revision: `local-${id}`,
    ingressScopeId: candidate.ingressScopeId,
    appId: id + 5,
    installationId: candidate.installationId,
    repositoryId: candidate.repositoryId,
    ownerId: candidate.ownerId,
    profile: { _tag: 'Enabled' as const, profileId: 'foldkit', profileRevision: `profile-${id}` },
    policyRevision: `policy-${id}`,
    allowedOperatorIds: [candidate.operatorId],
  };
  const lease = {
    startedMonotonicMs: 100,
    evidence: {
      evidenceId: `evidence-${id}`,
      commandKey: commandKey(candidate),
      appId: policy.appId,
      installationId: candidate.installationId,
      repositoryId: candidate.repositoryId,
      ownerId: candidate.ownerId,
      operatorId: candidate.operatorId,
      localPolicyRevision: policy.revision,
      policyRevision: policy.policyRevision,
      profileId: policy.profile.profileId,
      profileRevision: policy.profile.profileRevision,
      basePermission: 'write' as const,
      observedAtMs: time - 100,
      checkedAtMs: time,
      validUntilMs: time + 5900,
    },
  };
  return { verified, policy, lease, now: { wallMs: time, monotonicMs: 200 } };
}
type Case = ReturnType<typeof coherentCase>;
function decide(c: Case) {
  return decideLiveAdmission({ ...c, evidence: Option.some(c.lease) });
}
function admitted(c: Case) {
  return Match.value(decide(c)).pipe(
    Match.tag('AdmittedPreview', () => true),
    Match.orElse(() => false),
  );
}
function rejected(value: unknown) {
  return Match.value(decideLiveAdmission(value)).pipe(
    Match.tag('Rejected', () => true),
    Match.orElse(() => false),
  );
}

function bindingLaw(c: Case) {
  const e = c.lease.evidence;
  const changes = [
    ...(['appId', 'installationId', 'repositoryId', 'ownerId', 'operatorId'] as const).map(
      (field) => ({ ...e, [field]: e[field] + 1 }),
    ),
    ...(['localPolicyRevision', 'policyRevision', 'profileId', 'profileRevision'] as const).map(
      (field) => ({ ...e, [field]: `${e[field]}-other` }),
    ),
    {
      ...e,
      commandKey: commandKey({
        ...c.verified.candidate,
        commentId: c.verified.candidate.commentId + 1,
      }),
    },
  ];
  return (
    admitted(c) &&
    changes.every((evidence) => rejected({ ...c, evidence: Option.some({ ...c.lease, evidence }) }))
  );
}
function renameLaw(c: Case) {
  const renamed = {
    ...c,
    verified: {
      ...c.verified,
      candidate: {
        ...c.verified.candidate,
        ownerLogin: `renamed-${c.policy.appId}`,
        repositoryName: 'renamed',
      },
    },
  };
  return admitted(c) && Schema.toEquivalence(AdmissionDecision)(decide(c), decide(renamed));
}
function clockLaw(c: Case) {
  const expiry = c.lease.evidence.validUntilMs;
  const valid = { ...c, now: { wallMs: expiry - 1, monotonicMs: 6099 } };
  const invalid = [
    { wallMs: expiry, monotonicMs: 6100 },
    { wallMs: c.now.wallMs - 1, monotonicMs: 200 },
    { wallMs: c.now.wallMs, monotonicMs: 99 },
    { wallMs: c.now.wallMs, monotonicMs: 6100 },
    ...[NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].flatMap((value) => [
      { wallMs: value, monotonicMs: 200 },
      { wallMs: c.now.wallMs, monotonicMs: value },
    ]),
  ];
  return (
    admitted(c) &&
    admitted(valid) &&
    invalid.every((now) => rejected({ ...c, evidence: Option.some(c.lease), now }))
  );
}
function provenanceLaw(c: Case) {
  const common = {
    verified: c.verified,
    expectedLocalRevision: c.policy.revision,
    decision: decide(c),
    evaluatedAtMs: c.now.wallMs,
    evaluatedMonotonicMs: c.now.monotonicMs,
  };
  const live = {
    ...common,
    provenance: { _tag: 'LiveChecked', evidence: c.lease.evidence },
    startedMonotonicMs: 100,
  };
  return [
    admitted(c),
    Schema.is(LiveAdmissionDraft)(live),
    !Schema.is(LiveAdmissionDraft)({
      ...common,
      provenance: { _tag: 'LocalPolicy', revision: c.policy.revision },
    }),
    !Schema.is(LiveAdmissionDraft)({ ...live, startedMonotonicMs: undefined }),
    rejected({ ...c, evidence: Option.none() }),
    ...['read', 'none', 'custom-admin'].map((basePermission) =>
      rejected({
        ...c,
        evidence: Option.some({ ...c.lease, evidence: { ...c.lease.evidence, basePermission } }),
      }),
    ),
  ].every(Boolean);
}
const laws = {
  'coherent binding and single ID mutations': bindingLaw,
  'rename invariance': renameLaw,
  'exclusive expiry and invalid clocks': clockLaw,
  'provenance and permission integrity': provenanceLaw,
};
for (const [name, law] of Object.entries(laws)) {
  async function runLaw() {
    await Effect.runPromise(checkLaw(`live domain ${name}`, cases, law));
  }
  test(`live domain law: ${name}`, runLaw);
}
