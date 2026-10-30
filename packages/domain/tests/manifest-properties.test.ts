import { test } from 'bun:test';

import { Arbitrary, Effect, Option, Record, Result, Schema } from 'effect';

import { inspectManifestDocuments } from '../src/manifest-inspection.ts';
import { ManifestDeclarationReport } from '../src/manifest-report.ts';
import { manifestInput } from './manifest-fixtures.ts';
import { checkLaw } from './properties.ts';

const Case = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100000 }));
const cases = Arbitrary.schema(Case);
const encode = Schema.encodeSync(Schema.fromJsonString(ManifestDeclarationReport));
const encodeUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const AnyRecord = Schema.Record(Schema.String, Schema.Unknown);
function ordered(n: number) {
  const input = manifestInput();
  const changed = structuredClone(input);
  changed.manifests.reverse();
  for (const manifest of changed.manifests) {
    for (const section of ['dependencies', 'devDependencies', 'engines']) {
      const original = Reflect.get(manifest.document, section);
      const record = Schema.decodeUnknownResult(AnyRecord)(original).pipe(
        Result.getOrElse(() => ({})),
      );
      const entries = Object.entries(record).reverse();
      Reflect.set(manifest.document, section, Record.fromEntries(entries));
    }
    Reflect.set(manifest.document, 'description', `unrelated-${n}`);
  }
  const before = inspectManifestDocuments(input).pipe(Result.getOrThrow);
  const after = inspectManifestDocuments(changed).pipe(Result.getOrThrow);
  return encode(before) === encode(after);
}
test('law: ordering and unrelated fields preserve encoded declaration reports', async () => {
  await Effect.runPromise(checkLaw('manifest ordering', cases, ordered));
});
function changedEvidence(n: number) {
  const input = manifestInput();
  const changed = structuredClone(input);
  Option.match(Option.fromUndefinedOr(changed.manifests[0]), {
    onNone: () => undefined,
    onSome: (root) => {
      root.sha256 = n.toString(16).padStart(64, '0');
    },
  });
  const before = inspectManifestDocuments(input).pipe(Result.getOrThrow);
  const after = inspectManifestDocuments(changed).pipe(Result.getOrThrow);
  const beforeDependencies = before.manifests.map((m) => m.dependencies);
  const afterDependencies = after.manifests.map((m) => m.dependencies);
  return (
    encodeUnknown(beforeDependencies) === encodeUnknown(afterDependencies) &&
    before.manifests[0]?.sha256 !== after.manifests[0]?.sha256
  );
}
test('law: changed byte evidence changes provenance without changing dependency facts', async () => {
  await Effect.runPromise(checkLaw('manifest evidence', cases, changedEvidence));
});
