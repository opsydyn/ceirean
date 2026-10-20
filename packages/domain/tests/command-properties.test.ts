import { test } from 'bun:test';

import { Arbitrary, Effect, Match, Schema } from 'effect';

import {
  AdmissionDecision,
  AuthorityAvailable,
  commandKey,
  decideAssessment,
  parseAssessCommand,
  transportKey,
} from '../src/index.ts';
import { commandFixture } from './command-fixtures.ts';
import { checkLaw } from './properties.ts';

const generated = Arbitrary.schema(
  Schema.Struct({
    id: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
    time: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
    mutation: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 7 })),
  }),
);

function seedCommandCase({
  id,
  time,
  mutation,
}: {
  readonly id: number;
  readonly time: number;
  readonly mutation: number;
}) {
  const fixture = commandFixture();
  const candidate = {
    ...fixture.candidate,
    ingressScopeId: `scope-${id}`,
    installationId: id,
    repositoryId: id + 1,
    ownerId: id + 2,
    issueId: id + 3,
    issueNumber: id + 4,
    commentId: id + 5,
    operatorId: id + 6,
    ownerLogin: `owner-${id}`,
    repositoryName: `repo-${id}`,
  };
  const authority = {
    ...fixture.authority,
    ingressScopeId: candidate.ingressScopeId,
    installationId: candidate.installationId,
    repositoryId: candidate.repositoryId,
    ownerId: candidate.ownerId,
    allowedOperatorIds: [candidate.operatorId],
    revision: `authority-${id}`,
    policyRevision: `policy-${id}`,
    profile: {
      _tag: 'Enabled' as const,
      profileId: `profile-${id}`,
      profileRevision: `profile-revision-${id}`,
    },
    observedAtMs: time * 3,
    validUntilMs: time * 3 + 2,
  };
  return { candidate, authority, nowMs: time * 3 + 1, mutation };
}
const commandCaseArbitrary = Arbitrary.map(generated, seedCommandCase);
type CommandCase = typeof commandCaseArbitrary extends Arbitrary.Arbitrary<infer A> ? A : never;

function coherent(c: CommandCase) {
  const decision = decideAssessment(c);
  return Match.value(decision).pipe(
    Match.tag('AdmittedPreview', (preview) =>
      [
        Schema.is(AdmissionDecision)(preview),
        preview.commandKey === commandKey(c.candidate),
        preview.policyRevision === c.authority.policyRevision,
        preview.evidenceRevision === c.authority.revision,
        preview.profileId === c.authority.profile.profileId,
        preview.profileRevision === c.authority.profile.profileRevision,
      ].every(Boolean),
    ),
    Match.orElse(() => false),
  );
}

test('law: coherent admission binds every evidence revision', async () => {
  await Effect.runPromise(checkLaw('command coherent admission', commandCaseArbitrary, coherent));
});

function changedAuthority(c: CommandCase): AuthorityAvailable {
  const authority = c.authority;
  return Match.value(c.mutation).pipe(
    Match.when(0, () => ({ ...authority, ingressScopeId: `${authority.ingressScopeId}-other` })),
    Match.when(1, () => ({ ...authority, installationId: authority.installationId + 1 })),
    Match.when(2, () => ({ ...authority, repositoryId: authority.repositoryId + 1 })),
    Match.when(3, () => ({ ...authority, ownerId: authority.ownerId + 1 })),
    Match.when(4, () => ({ ...authority, access: 'Revoked' as const })),
    Match.when(5, () => ({ ...authority, allowedOperatorIds: [c.candidate.operatorId + 1] })),
    Match.when(6, () => ({ ...authority, profile: { _tag: 'Disabled' as const } })),
    Match.orElse(() => ({ ...authority, profile: { _tag: 'Unknown' as const } })),
  );
}

function isRejected(decision: typeof AdmissionDecision.Type) {
  return Match.value(decision).pipe(
    Match.tag('Rejected', () => true),
    Match.orElse(() => false),
  );
}

function mutationLaw(c: CommandCase) {
  const before = structuredClone(c);
  const decision = decideAssessment({ ...c, authority: changedAuthority(c) });
  const sameAuthority = Schema.toEquivalence(AuthorityAvailable);
  return coherent(c) && isRejected(decision) && sameAuthority(c.authority, before.authority);
}
test('law: a single authority-binding mutation refuses with an admitted control', async () => {
  await Effect.runPromise(
    checkLaw('command single authority mutation', commandCaseArbitrary, mutationLaw),
  );
});

function invalidTimeLaw(c: CommandCase) {
  const invalidTimes = [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
  return (
    coherent(c) &&
    [
      ...invalidTimes.map((nowMs) => ({ ...c, nowMs })),
      { ...c, nowMs: c.authority.validUntilMs },
      { ...c, nowMs: c.authority.observedAtMs - 1 },
      ...invalidTimes.flatMap((time) => [
        { ...c, authority: { ...c.authority, observedAtMs: time } },
        { ...c, authority: { ...c.authority, validUntilMs: time } },
      ]),
      { ...c, authority: { ...c.authority, observedAtMs: c.nowMs + 1 } },
      { ...c, authority: { ...c.authority, validUntilMs: c.authority.observedAtMs } },
    ].every((input) => isRejected(decideAssessment(input)))
  );
}
test('law: invalid interval/time refuses with an admitted control', async () => {
  await Effect.runPromise(
    checkLaw('command invalid interval and time', commandCaseArbitrary, invalidTimeLaw),
  );
});

function renameLaw(c: CommandCase) {
  const candidate = {
    ...c.candidate,
    ownerLogin: `${c.candidate.ownerLogin}-renamed`,
    repositoryName: `${c.candidate.repositoryName}-renamed`,
  };
  return (
    coherent(c) &&
    commandKey(candidate) === commandKey(c.candidate) &&
    Schema.toEquivalence(AdmissionDecision)(
      decideAssessment(c),
      decideAssessment({ ...c, candidate }),
    )
  );
}
test('law: rename invariance preserves admission and keys', async () => {
  await Effect.runPromise(checkLaw('command rename invariance', commandCaseArbitrary, renameLaw));
});

function keyLaw(c: CommandCase) {
  const key = commandKey(c.candidate);
  const delivery = `delivery-${c.candidate.commentId}`;
  return [
    coherent(c),
    (['installationId', 'repositoryId', 'commentId'] as const).every(
      (field) => key !== commandKey({ ...c.candidate, [field]: c.candidate[field] + 1 }),
    ),
    transportKey(c.candidate.ingressScopeId, delivery) !==
      transportKey(`${c.candidate.ingressScopeId}-other`, delivery),
    transportKey(c.candidate.ingressScopeId, delivery) !==
      transportKey(c.candidate.ingressScopeId, `${delivery}-other`),
    transportKey(`scope|${delivery}`, 'other') !== transportKey('scope', `${delivery}|other`),
  ].every(Boolean);
}
test('law: validated distinct tuples have injective canonical keys', async () => {
  await Effect.runPromise(checkLaw('command tuple key injectivity', commandCaseArbitrary, keyLaw));
});

function isNotCommand(body: string) {
  return Match.value(parseAssessCommand(body)).pipe(
    Match.tag('NotCommand', () => true),
    Match.tag('Assess', () => false),
    Match.exhaustive,
  );
}

function exactCommandLaw(c: CommandCase) {
  const extra = `${c.candidate.repositoryName}:${c.candidate.issueNumber}`;
  return (
    coherent(c) &&
    !isNotCommand('/leviathan assess') &&
    [
      `${extra}/leviathan assess`,
      `/leviathan assess${extra}`,
      `${extra}\n/leviathan assess\n${extra}`,
    ].every(isNotCommand)
  );
}
test('law: generated extra text is never an exact command', async () => {
  await Effect.runPromise(
    checkLaw('command generated extra text', commandCaseArbitrary, exactCommandLaw),
  );
});
