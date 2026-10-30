import { Match, Option, Order, Record, Result, Schema } from 'effect';

import {
  ManifestDeclarationReport,
  ManifestInspectionError,
  ManifestInspectionInput,
} from './manifest-report.ts';

const RootPath = Schema.Literal('package.json');
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));
const Declarations = Schema.Record(Text, Text);
const Package = Schema.Struct({
  name: Text,
  dependencies: Schema.optionalKey(Declarations),
  devDependencies: Schema.optionalKey(Declarations),
  peerDependencies: Schema.optionalKey(Declarations),
  optionalDependencies: Schema.optionalKey(Declarations),
  packageManager: Schema.optionalKey(Text),
  engines: Schema.optionalKey(Declarations),
});
const CatalogMaps = Schema.Struct({
  catalog: Schema.optionalKey(Declarations),
  catalogs: Schema.optionalKey(Schema.Record(Text, Declarations)),
});
const CatalogRoot = Schema.Struct({
  workspaces: Schema.optionalKey(Schema.Union([Schema.Array(Text), CatalogMaps])),
});
function failure(code: ManifestInspectionError['code']) {
  return new ManifestInspectionError({ code });
}
function requireValid(condition: boolean, code: ManifestInspectionError['code']) {
  return Match.value(condition).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.orElse(() => Result.fail(failure(code))),
  );
}
function decodeCatalogs(document: unknown) {
  function* catalogs() {
    const root = yield* Schema.decodeUnknownResult(CatalogRoot)(document).pipe(
      Result.mapError(() => failure('InvalidCatalog')),
    );
    const maps = Schema.decodeUnknownResult(CatalogMaps)(root.workspaces).pipe(
      Result.getOrElse((): typeof CatalogMaps.Type => ({})),
    );
    const declarations = [
      ...Object.values(maps.catalog ?? {}),
      ...Object.values(maps.catalogs ?? {}).flatMap(Object.values),
    ];
    yield* requireValid(!declarations.some((d) => d.startsWith('catalog:')), 'InvalidCatalog');
    return maps;
  }
  return Result.gen(catalogs);
}
function sortedRecord(record: Readonly<Record<string, string>>) {
  const entries = Object.entries(record).sort(([a], [b]) => Order.String(a, b));
  return Record.fromEntries(entries);
}
function required<A>(option: Option.Option<A>, code: ManifestInspectionError['code']) {
  return Option.match(option, { onNone: () => Result.fail(failure(code)), onSome: Result.succeed });
}
function catalogReference(name: string, declared: string, maps: typeof CatalogMaps.Type) {
  function* resolve() {
    const catalogName = declared.slice('catalog:'.length);
    const selected = Match.value(catalogName).pipe(
      Match.when('', () => Option.fromUndefinedOr(maps.catalog)),
      Match.orElse((key) => Record.get(maps.catalogs ?? {}, key)),
    );
    const map = yield* required(selected, 'MissingCatalog');
    const declaration = yield* required(Record.get(map, name), 'MissingCatalog');
    const selectedName = Match.value(catalogName).pipe(
      Match.when('', () => null),
      Match.orElse((value) => value),
    );
    return { name: selectedName, sourcePath: 'package.json', declaration };
  }
  return Match.value(declared.startsWith('catalog:')).pipe(
    Match.when(true, () => Result.gen(resolve)),
    Match.orElse(() => Result.succeed(null)),
  );
}
function dependenciesOf(manifest: typeof Package.Type, maps: typeof CatalogMaps.Type) {
  function* dependencies() {
    const entries = [];
    for (const section of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const) {
      const sorted = Object.entries(manifest[section] ?? {}).sort(([a], [b]) => Order.String(a, b));
      for (const [name, declared] of sorted) {
        const catalog = yield* catalogReference(name, declared, maps);
        entries.push({ section, name, declared, catalog });
      }
    }
    return entries;
  }
  return Result.gen(dependencies);
}
function toolchainOf(root: typeof Package.Type) {
  const engines = sortedRecord(root.engines ?? {});
  return Option.match(Option.fromUndefinedOr(root.packageManager), {
    onNone: () => ({ engines }),
    onSome: (packageManager) => ({ packageManager, engines }),
  });
}
export function inspectManifestDocuments(input: unknown) {
  function* inspect() {
    const source = yield* Schema.decodeUnknownResult(ManifestInspectionInput, {
      onExcessProperty: 'error',
    })(input).pipe(Result.mapError(() => failure('InvalidSource')));
    const ordered = [...source.manifests].sort((a, b) => Order.String(a.path, b.path));
    const parsed = [];
    for (const item of ordered) {
      const manifest = yield* Schema.decodeUnknownResult(Package)(item.document).pipe(
        Result.mapError(() => failure('InvalidManifest')),
      );
      parsed.push({ item, manifest });
    }
    const rootEntry = parsed.find((m) => Schema.is(RootPath)(m.item.path));
    const root = yield* required(Option.fromUndefinedOr(rootEntry), 'InvalidSource');
    const maps = yield* decodeCatalogs(root.item.document);
    const manifests = [];
    for (const { item, manifest } of parsed) {
      const dependencies = yield* dependenciesOf(manifest, maps);
      manifests.push({
        path: item.path,
        blobId: item.blobId,
        sha256: item.sha256,
        packageName: manifest.name,
        dependencies,
      });
    }
    return yield* Schema.decodeUnknownResult(ManifestDeclarationReport, {
      onExcessProperty: 'error',
    })({
      _tag: 'ManifestDeclarationReport',
      schemaVersion: 1,
      repository: source.repository,
      commit: source.commit,
      provenance: 'LocalGitObjects',
      coverage: ordered.map((m) => m.path),
      toolchain: toolchainOf(root.manifest),
      manifests,
    }).pipe(Result.mapError(() => failure('InvalidManifest')));
  }
  return Result.gen(inspect);
}
