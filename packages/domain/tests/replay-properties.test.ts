import { test } from 'bun:test';

import { Arbitrary, Effect, Match, Result, Schema } from 'effect';

import { inspectReplayRequest } from '../src/replay-inspection.ts';
import { DraftReplayProfile, decodeDraftProfile } from '../src/replay-profile.ts';
import { checkLaw } from './properties.ts';
import { validDraft } from './replay-fixtures.ts';

const cases = Arbitrary.schema(
  Schema.Struct({
    id: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000000 })),
    variant: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 })),
  }),
);
type Case = typeof cases extends Arbitrary.Arbitrary<infer A> ? A : never;
function generated(c: Case) {
  const p = validDraft();
  const raw = {
    ...p,
    profileId: `profile-${c.id}`,
    repository: { slug: `owner-${c.id}/repository`, baseSha: c.id.toString(16).padStart(40, '0') },
    targets: { ...p.targets, foldkit: `0.${c.id}.0` },
  };
  const profile = decodeDraftProfile(raw).pipe(Result.getOrThrow);
  const request = {
    mode: 'InspectOnly',
    repository: profile.repository.slug,
    baseSha: profile.repository.baseSha,
    targets: { ...profile.targets },
  };
  return { profile, request };
}
function blocked(c: Case) {
  const { profile, request } = generated(c);
  return inspectReplayRequest(profile, request).pipe(
    Result.match({
      onFailure: () => false,
      onSuccess: (r) => !r.canExecute && r.blockers.length === 7,
    }),
  );
}
test('law: accepted Draft requests always remain blocked', async () => {
  await Effect.runPromise(checkLaw('draft stays blocked', cases, blocked));
});
function wrongIdentity(c: Case) {
  const { profile, request } = generated(c);
  const mutation = Match.value(c.variant).pipe(
    Match.when(0, () => ({ ...request, repository: `other-${c.id}/repository` })),
    Match.when(1, () => ({ ...request, baseSha: 'f'.repeat(40) })),
    Match.when(2, () => ({ ...request, targets: { ...request.targets, foldkit: '99.0.0' } })),
    Match.when(3, () => ({ ...request, targets: { ...request.targets, effect: '99.0.0' } })),
    Match.when(4, () => ({ ...request, targets: { ...request.targets, vitePlugin: '99.0.0' } })),
    Match.orElse(() => ({ ...request, targets: { ...request.targets, fromFoldkit: '99.0.0' } })),
  );
  return blocked(c) && Result.isFailure(inspectReplayRequest(profile, mutation));
}
test('law: generated repository, base and target mismatches cannot pass', async () => {
  await Effect.runPromise(checkLaw('identity mismatch', cases, wrongIdentity));
});
function invalidPath(c: Case) {
  const { profile } = generated(c);
  const valid = {
    ...profile,
    scope: { ...profile.scope, generatedPaths: [`generated-${c.id}/lock`] },
  };
  const paths = [
    `../${c.id}`,
    `/root-${c.id}`,
    `x//${c.id}`,
    `x/./${c.id}`,
    `x/../${c.id}`,
    `x\\${c.id}`,
  ];
  return (
    Result.isSuccess(decodeDraftProfile(valid)) &&
    paths.every((path) =>
      Result.isFailure(
        decodeDraftProfile({ ...valid, scope: { ...valid.scope, generatedPaths: [path] } }),
      ),
    )
  );
}
test('law: generated noncanonical paths reject with a valid path control', async () => {
  await Effect.runPromise(checkLaw('scope traversal', cases, invalidPath));
});
function unknownAuthority(c: Case) {
  const { profile, request } = generated(c);
  const extra = { [`execute-${c.id}`]: 'Approved' };
  const invalid = { ...profile, qualification: { ...profile.qualification, ...extra } };
  return (
    blocked(c) &&
    Result.isFailure(decodeDraftProfile(invalid)) &&
    Result.isFailure(inspectReplayRequest(profile, { ...request, ...extra }))
  );
}
test('law: unknown qualification and execution fields cannot authorize', async () => {
  await Effect.runPromise(checkLaw('unknown authority', cases, unknownAuthority));
});
function immutable(c: Case) {
  const { profile, request } = generated(c);
  const before = structuredClone(profile);
  const requestBefore = structuredClone(request);
  const report = inspectReplayRequest(profile, request).pipe(Result.getOrThrow);
  Reflect.set(report.checkIds, '0', `changed-${c.id}`);
  Reflect.set(report.blockers, '0', 'changed');
  Reflect.set(report.repository, 'slug', 'changed/repository');
  Reflect.set(report.targets, 'foldkit', '99.0.0');
  Reflect.set(report.limits, 'cpuCores', 99);
  const same = Schema.toEquivalence(DraftReplayProfile);
  const sameRequest = Schema.toEquivalence(
    Schema.Struct({
      repository: Schema.String,
      baseSha: Schema.String,
      mode: Schema.String,
      targets: DraftReplayProfile.fields.targets,
    }),
  );
  return same(profile, before) && sameRequest(request, requestBefore) && blocked(c);
}
test('law: report mutation preserves deep input equality', async () => {
  await Effect.runPromise(checkLaw('immutable inspection', cases, immutable));
});
