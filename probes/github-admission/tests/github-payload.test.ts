import { expect, test } from 'bun:test';

import { Result } from 'effect';

import { draftFixture } from '../src/fixture.ts';
import { normaliseGitHubDelivery } from '../src/github-payload.ts';

function nativePayload() {
  return {
    action: 'created',
    installation: { id: 11 },
    repository: { id: 22, name: 'repository', owner: { id: 33, login: 'owner' } },
    issue: { id: 44, number: 1 },
    comment: { id: 55, body: '/leviathan assess', user: { id: 66, type: 'User' } },
    sender: { id: 66, type: 'User' },
  };
}
function normalize(payload: unknown) {
  return normaliseGitHubDelivery({
    eventName: 'issue_comment',
    payload,
    receipt: draftFixture().verified.receipt,
  });
}
function valid() {
  const value = nativePayload();
  const result = normalize(value);
  expect(Result.isSuccess(result)).toBe(true);
  expect(Result.getOrThrow(result)).toEqual(draftFixture().verified);
  value.repository.name = 'mutated-after-normalization';
  expect(Result.getOrThrow(result).candidate.repositoryName).toBe('repository');
}
test('normalization is a detached runtime-validated pure Result', valid);
function invalidId(id: number) {
  const value = nativePayload();
  value.comment.id = id;
  expect(normalize(value)).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'Rejected', reason: 'MalformedInput' },
  });
}
test.each([0, -1, 0.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
  'invalid native id %s cannot construct identity',
  invalidId,
);
function malformed({ value }: { value: unknown }) {
  expect(normalize(value)).toMatchObject({
    _tag: 'Failure',
    failure: { reason: 'MalformedInput' },
  });
}
const malformedCases = [null, [], {}, { action: 'created' }].map((value) => ({ value }));
test.each(malformedCases)(
  'missing native structure %# is rejected without operational failure',
  malformed,
);
function malformedReceipt() {
  const receipt = draftFixture().verified.receipt;
  Reflect.set(receipt, 'eventName', 'push');
  expect(
    normaliseGitHubDelivery({ eventName: 'issue_comment', payload: nativePayload(), receipt }),
  ).toMatchObject({ _tag: 'Failure', failure: { reason: 'MalformedInput' } });
}
test('runtime receipt event cannot disagree with verified command event', malformedReceipt);
