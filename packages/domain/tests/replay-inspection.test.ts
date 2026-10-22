import { expect, test } from 'bun:test';

import { Option, Result, Schema } from 'effect';

import { inspectReplayRequest, ReplayInspection } from '../src/replay-inspection.ts';
import { decodeDraftProfile } from '../src/replay-profile.ts';
import { validDraft, validRequest } from './replay-fixtures.ts';

const blockers = [
  'ProfileRevisionUnverified',
  'HostUnqualified',
  'ImageUnqualified',
  'ToolchainUnqualified',
  'AcceptanceUnqualified',
  'ExecutionUnapproved',
  'ModelPolicyUnapproved',
] as const;
function profile() {
  return decodeDraftProfile(validDraft()).pipe(Result.getOrThrow);
}
function matching() {
  const result = inspectReplayRequest(profile(), validRequest());
  const report = Result.getOrThrow(result);
  expect(report._tag).toBe('Blocked');
  expect(report.canExecute).toBe(false);
  expect(report.publication).toBe('Disabled');
  expect(report.blockers).toEqual(blockers);
  expect(report.checkIds).toEqual(['install', 'check', 'typecheck', 'test', 'build', 'storybook']);
  const valid = Schema.is(ReplayInspection)(report);
  expect(valid).toBe(true);
  for (const key of ['passed', 'qualification', 'receipt'])
    expect(Object.hasOwn(report, key)).toBe(false);
}
test('matching inspection reports all blockers, not check results or qualification', matching);

function mismatches() {
  const request = validRequest();
  const cases = [
    { request: { ...request, repository: 'other/repository' }, tag: 'RepositoryMismatch' },
    { request: { ...request, baseSha: 'c'.repeat(40) }, tag: 'BaseMismatch' },
    ...Object.keys(request.targets).map((key) => ({
      request: { ...request, targets: { ...request.targets, [key]: '99.0.0' } },
      tag: 'TargetsMismatch',
    })),
    { request: { ...request, mode: 'Run' }, tag: 'InvalidRequest' },
    { request: { ...request, apiKey: 'SECRET' }, tag: 'InvalidRequest' },
  ];
  for (const c of cases) {
    const result = inspectReplayRequest(profile(), c.request);
    const problem = Option.getOrThrow(Result.getFailure(result));
    expect(c.tag).toBe(problem._tag);
  }
}
test('repository, base and each exact target mismatch fail closed', mismatches);

function detachedReport() {
  const p = profile();
  const request = validRequest();
  const before = structuredClone({ p, request });
  const report = inspectReplayRequest(p, request).pipe(Result.getOrThrow);
  Reflect.set(report.repository, 'slug', 'mutated/repository');
  Reflect.set(report.targets, 'foldkit', '99.0.0');
  Reflect.set(report.limits, 'cpuCores', 99);
  Reflect.set(report.checkIds, '0', 'mutated');
  Reflect.set(report.blockers, '0', 'mutated');
  expect({ p, request }).toEqual(before);
  const second = inspectReplayRequest(p, request).pipe(Result.getOrThrow);
  expect(second.blockers).toEqual(blockers);
  expect(second.checkIds[0]).toBe('install');
}
test('returned nested objects and arrays never alias input or future reports', detachedReport);
