import { expect, test } from 'bun:test';

import { Result, Schema } from 'effect';

import { inspectManifestDocuments } from '../src/manifest-inspection.ts';
import { ManifestDeclarationReport } from '../src/manifest-report.ts';
import { manifestInput } from './manifest-fixtures.ts';
const encodeUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function declarations() {
  const report = inspectManifestDocuments(manifestInput()).pipe(Result.getOrThrow);
  expect(report.coverage).toEqual(['package.json', 'packages/example/package.json']);
  expect(report.toolchain).toEqual({ packageManager: 'bun@1.4.3', engines: { node: '>=22' } });
  const entries = report.manifests[1]?.dependencies;
  expect(entries).toHaveLength(7);
  expect(entries).toContainEqual({
    section: 'dependencies',
    name: 'foldkit',
    declared: 'catalog:',
    catalog: { name: null, sourcePath: 'package.json', declaration: '0.170.0' },
  });
  expect(entries).toContainEqual({
    section: 'devDependencies',
    name: 'foldkit',
    declared: 'catalog:default',
    catalog: { name: 'default', sourcePath: 'package.json', declaration: '0.169.0' },
  });
  expect(entries).toContainEqual({
    section: 'peerDependencies',
    name: 'foldkit',
    declared: '>=0.169.0 <0.171.0',
    catalog: null,
  });
  expect(entries).toContainEqual({
    section: 'dependencies',
    name: 'sibling',
    declared: 'workspace:*',
    catalog: null,
  });
  expect(entries).toContainEqual({
    section: 'dependencies',
    name: 'alias',
    declared: 'npm:other@1',
    catalog: null,
  });
  expect(entries?.map((e) => `${e.section}/${e.name}`)).toEqual([
    'dependencies/alias',
    'dependencies/effect',
    'dependencies/foldkit',
    'dependencies/sibling',
    'devDependencies/foldkit',
    'optionalDependencies/tool',
    'peerDependencies/foldkit',
  ]);
  expect(
    Schema.decodeUnknownResult(ManifestDeclarationReport, { onExcessProperty: 'error' })(
      report,
    ).pipe(Result.isSuccess),
  ).toBe(true);
}
test('reports original declarations, catalog provenance and all dependency sections', declarations);

function malformedDocuments() {
  for (const document of [
    null,
    [],
    'SECRET_SENTINEL',
    {},
    { name: 'x', dependencies: null },
    { name: 'x', dependencies: [] },
    { name: 'x', dependencies: { foldkit: 2 } },
    { name: 'x', dependencies: { foldkit: '' } },
  ]) {
    const input = manifestInput();
    const manifests = [input.manifests[0], { ...input.manifests[1], document }];
    const error = inspectManifestDocuments({ ...input, manifests }).pipe(Result.getFailure);
    expect(error).toMatchObject({
      value: { _tag: 'ManifestInspectionError', code: 'InvalidManifest' },
    });
    expect(encodeUnknown(error)).not.toContain('SECRET_SENTINEL');
  }
}
test(
  'rejects malformed documents and dependency sections without raw input leakage',
  malformedDocuments,
);

function catalogFailures() {
  const input = manifestInput();
  for (const workspaces of [
    null,
    { catalog: [] },
    { catalogs: [] },
    { catalog: { foldkit: 7 } },
    { catalog: { foldkit: 'catalog:other' } },
  ]) {
    const root = { ...input.manifests[0], document: { name: 'workspace', workspaces } };
    expect(
      inspectManifestDocuments({ ...input, manifests: [root, input.manifests[1]] }).pipe(
        Result.getFailure,
      ),
    ).toMatchObject({ value: { code: 'InvalidCatalog' } });
  }
  const root = { ...input.manifests[0], document: { name: 'workspace' } };
  expect(
    inspectManifestDocuments({ ...input, manifests: [root, input.manifests[1]] }).pipe(
      Result.getFailure,
    ),
  ).toMatchObject({ value: { code: 'MissingCatalog' } });
  const child = {
    ...input.manifests[1],
    document: { name: 'child', dependencies: { foldkit: 'catalog:nope' } },
  };
  expect(
    inspectManifestDocuments({ ...input, manifests: [input.manifests[0], child] }).pipe(
      Result.getFailure,
    ),
  ).toMatchObject({ value: { code: 'MissingCatalog' } });
}
test('catalog shape and missing references refuse instead of falling back', catalogFailures);

test('rejects duplicate paths, missing root and malformed source identities', () => {
  const input = manifestInput();
  for (const changed of [
    { ...input, manifests: [input.manifests[0], input.manifests[0]] },
    { ...input, manifests: [input.manifests[1]] },
    { ...input, commit: 'main' },
    { ...input, repository: 'not-a-slug' },
    { ...input, manifests: [{ ...input.manifests[0], path: '../package.json' }] },
    { ...input, manifests: [{ ...input.manifests[0], blobId: 'bad' }] },
  ])
    expect(inspectManifestDocuments(changed).pipe(Result.getFailure)).toMatchObject({
      value: { code: 'InvalidSource' },
    });
});

function detachedReport() {
  const input = manifestInput();
  const report = inspectManifestDocuments(input).pipe(Result.getOrThrow);
  const changed = structuredClone(input);
  Reflect.set(changed.manifests[0]?.document ?? {}, 'scripts', { install: 'SECRET_SENTINEL' });
  expect(inspectManifestDocuments(changed).pipe(Result.getOrThrow)).toEqual(report);
  Reflect.set(report.toolchain.engines, 'node', 'changed');
  expect(inspectManifestDocuments(input).pipe(Result.getOrThrow).toolchain.engines.node).toBe(
    '>=22',
  );
  const rootOnly = inspectManifestDocuments({
    ...input,
    manifests: [{ ...input.manifests[0], document: { name: 'root' } }],
  }).pipe(Result.getOrThrow);
  expect(rootOnly.toolchain).toEqual({ engines: {} });
  expect(rootOnly.manifests[0]?.dependencies).toEqual([]);
}
test('ignores unrelated fields, omits scripts and keeps returned objects detached', detachedReport);
