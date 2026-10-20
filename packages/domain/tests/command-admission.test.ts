import { expect, test } from 'bun:test';

import { Match, Schema } from 'effect';

import { decideAssessment } from '../src/command-admission-policy.ts';
import {
  AdmissionDraft,
  AdmissionRecord,
  AdmissionReply,
  AuthorityState,
  CommandCandidate,
  CommandKey,
  GitHubId,
  TransportKey,
  VerifiedCommand,
  commandKey,
  parseAssessCommand,
  transportKey,
} from '../src/command-admission.ts';
import { commandFixture } from './command-fixtures.ts';

function assertValid<S extends Schema.Constraint>(schema: S, value: unknown, expected: boolean) {
  const valid = Schema.is(schema)(value);
  expect(valid).toBe(expected);
}

test('exact command only', () => {
  expect(parseAssessCommand('/leviathan assess')).toEqual({ _tag: 'Assess' });
  for (const body of [
    '',
    ' /leviathan assess',
    '/leviathan assess ',
    '/leviathan assess\n',
    '\n/leviathan assess',
    '> /leviathan assess',
    '`/leviathan assess`',
    '/leviathan assess now',
    '/Leviathan assess',
    '/leviathan Assess',
    '/leviathan\tassess',
    'please /leviathan assess',
  ]) {
    expect(parseAssessCommand(body)).toEqual({ _tag: 'NotCommand' });
  }
});

function coherentPreview() {
  const fixture = commandFixture();
  const before = structuredClone(fixture);
  expect(decideAssessment(fixture)).toEqual({
    _tag: 'AdmittedPreview',
    commandKey: '[11,22,55]',
    policyRevision: 'policy-1',
    profileId: 'foldkit',
    profileRevision: 'profile-1',
    evidenceRevision: 'authority-1',
  });
  expect(fixture).toEqual(before);
}
test('coherent available authority admits preview', coherentPreview);

function changedAuthorityRefuses() {
  const fixture = commandFixture();
  const changes = [
    { ingressScopeId: 'other-app' },
    { installationId: 12 },
    { repositoryId: 23 },
    { ownerId: 34 },
    { access: 'Revoked' },
    { allowedOperatorIds: [67] },
    { profile: { _tag: 'Disabled' } },
    { profile: { _tag: 'Unknown' } },
    { profile: { _tag: 'Enabled', profileId: '', profileRevision: 'profile-1' } },
    { profile: { _tag: 'Enabled', profileId: 'foldkit', profileRevision: '' } },
    { revision: '' },
    { policyRevision: '' },
  ];
  for (const change of changes) {
    expect(
      decideAssessment({ ...fixture, authority: { ...fixture.authority, ...change } })._tag,
    ).toBe('Rejected');
  }
  expect(
    decideAssessment({ ...fixture, authority: { _tag: 'Unavailable', revision: 'authority-1' } }),
  ).toEqual({ _tag: 'Rejected', reason: 'AuthorityUnavailable' });
  for (const field of [
    'ingressScopeId',
    'installationId',
    'repositoryId',
    'ownerId',
    'operatorId',
  ] as const) {
    const value = fixture.candidate[field];
    const changed = Match.value(value).pipe(
      Match.when(Match.string, (text) => `${text}-other`),
      Match.orElse((id) => id + 1),
    );
    expect(
      decideAssessment({ ...fixture, candidate: { ...fixture.candidate, [field]: changed } })._tag,
    ).toBe('Rejected');
  }
}
test('one changed authority fact refuses', changedAuthorityRefuses);

function exclusiveExpiry() {
  const fixture = commandFixture();
  expect(decideAssessment({ ...fixture, nowMs: 1999 })._tag).toBe('AdmittedPreview');
  expect(decideAssessment({ ...fixture, nowMs: 2000 })).toEqual({
    _tag: 'Rejected',
    reason: 'AuthorityExpired',
  });
  expect(decideAssessment({ ...fixture, nowMs: 2001 })).toEqual({
    _tag: 'Rejected',
    reason: 'AuthorityExpired',
  });
}
test('expiry is exclusive', exclusiveExpiry);

function invalidObservation() {
  const fixture = commandFixture();
  for (const time of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, -1]) {
    expect(decideAssessment({ ...fixture, nowMs: time })).toEqual({
      _tag: 'Rejected',
      reason: 'InvalidClock',
    });
    for (const field of ['observedAtMs', 'validUntilMs']) {
      expect(
        decideAssessment({ ...fixture, authority: { ...fixture.authority, [field]: time } }),
      ).toEqual({ _tag: 'Rejected', reason: 'InvalidAuthority' });
    }
  }
  for (const change of [{ observedAtMs: 1001 }, { validUntilMs: 900 }, { validUntilMs: 899 }]) {
    expect(
      decideAssessment({ ...fixture, authority: { ...fixture.authority, ...change } }),
    ).toEqual({ _tag: 'Rejected', reason: 'InvalidAuthority' });
  }
}
test('invalid/future observation fails', invalidObservation);

function renameAndTransfer() {
  const fixture = commandFixture();
  const renamed = { ...fixture.candidate, ownerLogin: 'renamed', repositoryName: 'new-name' };
  expect(decideAssessment({ ...fixture, candidate: renamed })).toEqual(decideAssessment(fixture));
  expect(commandKey(renamed)).toBe(commandKey(fixture.candidate));
  for (const change of [{ ownerId: 34 }, { installationId: 12 }]) {
    expect(
      decideAssessment({ ...fixture, candidate: { ...fixture.candidate, ...change } }),
    ).toEqual({ _tag: 'Rejected', reason: 'IdentityMismatch' });
  }
}
test('rename is metadata, transfer is authority', renameAndTransfer);

function tupleKeys() {
  const { candidate } = commandFixture();
  expect(commandKey(candidate)).toBe('[11,22,55]');
  for (const field of ['installationId', 'repositoryId', 'commentId'] as const) {
    const changedKey = commandKey({ ...candidate, [field]: candidate[field] + 1 });
    expect(changedKey).not.toBe(commandKey(candidate));
  }
  const firstTransport = transportKey('a|b', 'c');
  expect(firstTransport).not.toBe(transportKey('a', 'b|c'));
  expect(transportKey('fixture-app', 'delivery-1')).toBe('["fixture-app","delivery-1"]');
  for (const id of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assertValid(GitHubId, id, false);
    expect(() => commandKey({ ...candidate, commentId: id })).toThrow();
  }
  assertValid(GitHubId, Number.MAX_SAFE_INTEGER, true);
  for (const text of ['', ' ', 'x'.repeat(129), 'é'.repeat(65), 'a\nb', 'a\u007fb', 'a\u0085b']) {
    expect(() => transportKey(text, 'delivery')).toThrow();
    expect(() => transportKey('scope', text)).toThrow();
  }
  assertValid(CommandKey, '[0,22,55]', false);
  assertValid(CommandKey, '[11, 22,55]', false);
  assertValid(TransportKey, '["","x"]', false);
}
test('tuple keys do not alias', tupleKeys);

function malformedInputs() {
  const fixture = commandFixture();
  for (const value of [null, undefined, {}, [], 'command']) {
    expect(decideAssessment(value)).toEqual({ _tag: 'Rejected', reason: 'MalformedInput' });
    expect(decideAssessment({ ...fixture, authority: value })._tag).toBe('Rejected');
  }
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
      decideAssessment({ ...fixture, candidate: { ...fixture.candidate, [field]: 0 } }),
    ).toEqual({ _tag: 'Rejected', reason: 'MalformedInput' });
  }
  for (const name of ['x'.repeat(256), 'é'.repeat(128), 'bad\nname']) {
    assertValid(CommandCandidate, { ...fixture.candidate, repositoryName: name }, false);
    expect(() => commandKey({ ...fixture.candidate, repositoryName: name })).toThrow();
  }
  for (const allowedOperatorIds of [
    [66, 66],
    Array.from({ length: 101 }, (_, index) => index + 1),
  ]) {
    const authority = { ...fixture.authority, allowedOperatorIds };
    assertValid(AuthorityState, authority, false);
    expect(decideAssessment({ ...fixture, authority })).toEqual({
      _tag: 'Rejected',
      reason: 'InvalidAuthority',
    });
  }
}
test('schemas and policy fail closed on malformed or oversized inputs', malformedInputs);

function recordingEnvelopes() {
  const fixture = commandFixture();
  const verified = {
    receipt: {
      ingressScopeId: 'fixture-app',
      deliveryId: 'delivery-1',
      eventName: 'issue_comment',
      rawBodyDigest: 'a'.repeat(64),
    },
    candidate: fixture.candidate,
  };
  assertValid(VerifiedCommand, verified, true);
  assertValid(
    VerifiedCommand,
    { ...verified, receipt: { ...verified.receipt, ingressScopeId: 'other' } },
    false,
  );
  const decision = decideAssessment(fixture);
  const record = {
    decisionId: '1',
    commandKey: commandKey(fixture.candidate),
    candidate: fixture.candidate,
    decision,
    evaluatedAtMs: 1000,
    committedAtMs: 1001,
    authorityRevision: 'authority-1',
  };
  assertValid(AdmissionRecord, record, true);
  assertValid(AdmissionRecord, { ...record, decisionId: '01' }, false);
  assertValid(AdmissionReply, { _tag: 'Recorded', record }, true);
  assertValid(AdmissionReply, { _tag: 'Duplicate', record }, true);
  assertValid(AdmissionReply, { _tag: 'Unrecorded', decision }, false);
  assertValid(
    AdmissionReply,
    { _tag: 'Unrecorded', decision: { _tag: 'Ignored', reason: 'NotCommand' } },
    true,
  );
  assertValid(
    AdmissionDraft,
    { verified, expectedAuthorityRevision: 'authority-1', evaluatedAtMs: 1000, decision },
    true,
  );
  assertValid(
    AdmissionDraft,
    {
      verified,
      expectedAuthorityRevision: 'authority-1',
      evaluatedAtMs: 1000,
      decision: { _tag: 'Ignored', reason: 'NotCommand' },
    },
    false,
  );
}
test('shared recording envelopes validate scope and exact-command decisions', recordingEnvelopes);
