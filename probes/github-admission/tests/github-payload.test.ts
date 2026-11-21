import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Match, Result, Schema } from 'effect';

import { checkLaw } from '../../../packages/domain/tests/properties.ts';
import { draftFixture } from '../src/fixture.ts';
import { normaliseGitHubDelivery } from '../src/github-payload.ts';

function nativePayload() {
  return {
    action: 'created',
    installation: { id: 11 },
    repository: { id: 22, name: 'repository', owner: { id: 33, login: 'owner' } },
    issue: { id: 44, number: 1 },
    comment: { id: 55, body: '/ceirean assess', user: { id: 66, type: 'User', login: 'operator' } },
    sender: { id: 66, type: 'User', login: 'operator' },
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

const exactCommand = Schema.Literal('/ceirean assess');
const isExactCommand = Schema.is(exactCommand);

/**
 * The two actors the router gates on, as selectors rather than a discriminator
 * string: a selector returns the object to mutate, so a case needs no
 * branching to pick one.
 */
type Actor = (payload: ReturnType<typeof nativePayload>) => { login: string };

const actors: { readonly name: string; readonly select: Actor }[] = [
  { name: 'sender', select: (payload) => payload.sender },
  { name: 'comment author', select: (payload) => payload.comment.user },
];

function botLoginPayload(select: Actor, login: string) {
  const value = nativePayload();
  select(value).login = login;
  return value;
}

function botLoginIgnored({ select, login }: { select: Actor; login: string }) {
  const payload = botLoginPayload(select, login);
  const decision = normalize(payload);
  expect(decision).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'Ignored', reason: 'BotActor' },
  });
}

const botLoginCases = actors.flatMap(({ name, select }) =>
  ['factory[bot]', 'dependabot[bot]', 'astrobot-houston'].map((login) => ({
    name,
    select,
    login,
  })),
);
test.each(botLoginCases)(
  'the bot login $login on the $name is ignored even when GitHub types it as a user',
  botLoginIgnored,
);

function humanLoginAdmitted(login: string) {
  const value = nativePayload();
  value.sender.login = login;
  value.comment.user.login = login;
  const decision = normalize(value);
  expect(Result.isSuccess(decision)).toBe(true);
}
test.each(['operator', 'someone[bot]ish', 'astrobot-houston-fan'])(
  'a human login %s still reaches admission',
  humanLoginAdmitted,
);

function missingLoginRejected({ select }: { select: Actor }) {
  const value = nativePayload();
  Reflect.deleteProperty(select(value), 'login');
  expect(normalize(value)).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'Rejected', reason: 'MalformedInput' },
  });
}
test.each(actors)(
  'a delivery with no $name login is malformed rather than treated as human',
  missingLoginRejected,
);

const stems = Arbitrary.schema(Schema.String);

const isBotActorIgnored = Schema.is(
  Schema.TaggedStruct('Ignored', { reason: Schema.Literal('BotActor') }),
);

function appSuffixIsAlwaysBot(stem: string) {
  const result = normalize(botLoginPayload((payload) => payload.sender, `${stem}[bot]`));
  return Result.match(result, { onSuccess: () => false, onFailure: isBotActorIgnored });
}
test('law: any login ending in the app suffix is refused as a bot actor', async () => {
  await Effect.runPromise(checkLaw('router app-suffix bot', stems, appSuffixIsAlwaysBot));
}, 60000);

function onlyTheExactCommandAdmits(body: string) {
  function refusedForThisBody() {
    const value = nativePayload();
    value.comment.body = body;
    return Result.isFailure(normalize(value));
  }
  return Match.value(body).pipe(
    Match.when(isExactCommand, () => true),
    Match.orElse(refusedForThisBody),
  );
}
test('law: no body other than the exact command reaches admission', async () => {
  await Effect.runPromise(checkLaw('router exact command', stems, onlyTheExactCommandAdmits));
}, 60000);
