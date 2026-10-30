# Pinned Manifest Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a deterministic dependency-declaration report from the approved
FoldKit commit without installing dependencies or executing repository code.

**Architecture:** Pure domain inspection interprets bounded manifest documents;
an Effect adapter supplies immutable local Git objects. A separate replay CLI
operation validates and emits the report while preserving historical `inspect`.

**Tech Stack:** Existing Bun 1.4.2, Effect 4.0.5 Schema/Result/Arbitrary/process,
Moon 2.5.4, TypeScript, oxlint and oxfmt. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-pinned-manifest-report-design.md`
(approved by the owner after design commit `918bdc6`).

## Global Constraints

- Production source: `opsydyn/fold-kit-experiments`, commit
  `1183e3c067f873fdd29f14f06030515929c1b956`; all 14 paths in the spec.
- Provenance is `LocalGitObjects`, not freshly fetched or GitHub-attested source.
- Limits: 262144 bytes per manifest, 2097152 aggregate source bytes, 262144
  encoded report bytes including its newline; 15-second cooperative deadline.
- Keep original dependency declarations; catalog lookup is not lockfile resolution.
- All Effect rules stay universal: inferred channels, static imports, dependency
  assembly at the exported boundary, no suppression/config exceptions.
- No installs, target scripts/imports, registry requests, patch generation,
  baseline/browser runs, builds, hosted execution, routes/webhooks or PR writes.
- Preserve dirty observer research and the historical replay profile. Stage named
  files only; commit each verified task. Do not push or merge in this plan.
- Use `/private/tmp/ceirean-cleanup-budget`; recheck identity before execution.

## Review Focus

- Named catalog `default` must remain distinct from the unnamed default catalog.
- Duplicate manifest paths must refuse rather than overwrite evidence silently.
- Git environment, replacement objects and lazy retrieval must not redirect reads.
- Cancellation or oversized child output must release the owned process.
- JSON-looking successful stdout must still exit 0 through the actual entrypoint.

## File Map

- `packages/domain/src/manifest-report.ts`: schemas, derived input/report types.
- `packages/domain/src/manifest-inspection.ts`: pure validation/catalog inspection.
- `packages/domain/src/index.ts`: explicit exports needed by the replay app only.
- `packages/domain/tests/manifest-inspection.test.ts`: examples and refusal cases.
- `packages/domain/tests/manifest-properties.test.ts`: deterministic property laws.
- `apps/replay/src/manifest-baseline.ts`: fixed source/paths/limits from the spec.
- `apps/replay/src/manifest-git-source.ts`: bounded scoped Git object reader.
- `apps/replay/src/manifest-cli.ts`: manifest workflow and sanitized output.
- Existing `apps/replay/src/cli.ts` and `main.ts`: routing and success exit decoding.
- New `apps/replay/tests/manifest-source.test.ts`, `manifest-cli.test.ts`, and
  `manifest-process.test.ts`: adapter, workflow, and real subprocess regressions.
- `apps/replay/tests/fixtures/manifest-success.ts`: static subprocess harness
  using the real main/teardown pair and a fake pinned source.
- `docs/runbooks/pinned-manifest-report.md` and
  `docs/evidence/manifest-report/baseline-1183e3c.md`: usage and local evidence;
  `docs/evidence/manifest-report/baseline-1183e3c.json`: generated report artifact.

## Task 1: Pure Dependency Declaration Report

**Files:** create the two domain source files and two domain tests above; modify
`packages/domain/src/index.ts` with explicit exports rather than a wildcard.

**Interfaces:**

- `ManifestInspectionInput` schema/type: `{ repository, commit, manifests }`;
  each manifest is `{ path, blobId, sha256, document: unknown }`. Repository is
  an owner/repo slug, commit/blob IDs are lowercase 40-hex, digests 64-hex,
  paths canonical relative manifest paths. Reject duplicate paths and require
  exactly one root `package.json`. Source authenticity belongs to Task 2.
- `inspectManifestDocuments(input: unknown)` returns an inferred Effect
  `Result` of `ManifestDeclarationReport` or `ManifestInspectionError`.
- `ManifestDeclarationReport` schema/type: `_tag: 'ManifestDeclarationReport'`,
  `schemaVersion: 1`, `repository`, `commit`, `provenance: 'LocalGitObjects'`,
  `coverage: string[]`, `toolchain: { packageManager?: string, engines: Record<string, string> }`,
  and `manifests`. Each manifest carries `path`, `packageName`, `blobId`,
  `sha256`, and `dependencies`.
- Each dependency carries `section`, `name`, `declared`, and `catalog`: null
  for literals, otherwise `{ name: string | null, sourcePath: 'package.json', declaration: string }`.
  Null catalog name means `catalog:`; a string means `catalog:<name>`.
- Error codes: `InvalidSource`, `InvalidManifest`, `InvalidCatalog`,
  `MissingCatalog`. Schema-derived types and inferred Result channels only.

- [ ] Write example tests for all four dependency sections, literals/ranges,
      aliases, workspace declarations, default/named catalogs, and separate entries
      for the same dependency in multiple sections. Assert original declaration,
      catalog provenance and stable ordinal sorting by path, section, then name.

  ```ts
  // Fixture: packages/example/package.json declares foldkit as catalog:.
  expect(
    report.manifests.find((m) => m.path === 'packages/example/package.json')?.dependencies,
  ).toContainEqual({
    section: 'dependencies',
    name: 'foldkit',
    declared: 'catalog:',
    catalog: { name: null, sourcePath: 'package.json', declaration: '0.170.0' },
  });
  ```

- [ ] Add tests for malformed manifests/sections, non-string declarations,
      missing names, missing catalogs, malformed catalog shape, recursive catalog
      references, duplicate paths, invalid IDs and missing root. Assert finite codes.
      Accept unrelated ordinary package fields; never evaluate scripts or exports.
- [ ] Add a regression with both unnamed and named `default` catalogs carrying
      different versions; assert each reference resolves from its own map.
- [ ] Add Effect Arbitrary laws using the existing `tests/properties.ts` runner:
      permutation of document/key order produces identical reports; adding unrelated
      fields preserves the dependency projection. A separate changed-byte fixture
      changes its supplied digest, so do not claim whole-report byte invariance.
- [ ] Run `moon run domain:test --concurrency 1`; observe new assertions fail
      because the implementation is absent, not because the runner is broken.
- [ ] Implement schemas and `inspectManifestDocuments` with Schema/Result and
      existing domain conventions. Strip unrelated package fields from the report;
      strictly validate the emitted report, not the whole npm manifest vocabulary.
      Missing dependency sections become empty collections. Reject unsupported
      catalog indirection; do not interpret semver or infer resolved installations.
      Sort engine keys too, and assert encoded JSON equality for the ordering law.
- [ ] Run `moon run domain:test domain:typecheck --concurrency 1` and root
      lint/format; require exit 0. Commit only Task 1 files as
      `feat: inspect pinned manifest dependency declarations`.

## Task 2: Bounded Local Git Source Adapter

**Files:** create `manifest-baseline.ts`, `manifest-git-source.ts` and
`manifest-source.test.ts` in the paths above.

**Interfaces:**

- `foldkitManifestBaseline` exports the fixed repository/commit/14-path record
  and limits, with paths copied exactly from the approved spec.
- `readPinnedManifests(repositoryPath: string, baseline: ManifestBaseline)`
  returns an inferred Effect producing `ManifestInspectionInput`; it requires
  the existing Effect child-process service. `ManifestBaseline` is derived from
  a local Schema, not an Effect-channel interface. Alternate baselines are for
  synthetic adapter tests; the user-facing operation always uses the fixed one.
- Adapter failures use `ManifestSourceError` with finite codes `GitFailed`,
  `MissingObject`, `InvalidTreeEntry`, `InvalidEncoding`, `SourceTooLarge`,
  `InvalidSource`. The Task 3 operation owns the overall timeout.

- [ ] Write adapter tests with fake child-process services for exact argv and
      environment, missing commits/blobs, wrong tree paths/IDs, symlink/submodule
      modes, malformed UTF-8 and source limits at/over each threshold. Assert
      aggregate accounting uses bytes, not JavaScript string length.
- [ ] Add cancellation and oversized stdout/stderr tests: finalizers complete,
      no child remains owned after return, and native diagnostic sentinels never
      enter returned errors. Add controls proving the valid boundary size succeeds.
- [ ] Add a temporary local Git-repository integration fixture. Commit regular
      manifests, inspect that exact commit, then dirty/delete worktree manifests and
      move its branch; assert identical committed bytes/digests are still read.
      Test a replacement-object/config sentinel and a missing promised-object fake;
      no replacement or lazy network retrieval is allowed.

  ```ts
  // before/after use the same explicit fixture baseline, despite dirty files.
  expect(after).toEqual(before);
  expect(after.manifests[0]?.sha256).toBe(expectedCommittedBytesSha256);
  expect(after.commit).toBe(fixtureCommit);
  ```

- [ ] Run `moon run replay:test --concurrency 1`; record the expected new failures.
- [ ] Implement the reader with `effect/process` and bounded Stream collection,
      following `preparation-process.ts` as an idiom without importing probe code or
      creating a generic arbitrary-command runner. Use `/usr/bin/git`, `shell: false`,
      ignored stdin, cleared inherited environment, `PATH=/usr/bin:/bin`, C locale,
      `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
      `GIT_NO_REPLACE_OBJECTS=1`, `GIT_NO_LAZY_FETCH=1`, `GIT_OPTIONAL_LOCKS=0`.
      Use fixed plumbing operations: validate the exact commit type, read each exact
      tree entry with NUL framing, check mode `100644`/`100755` and blob size, then
      read that blob without filters/textconv. Bound metadata output too. SHA-1 of
      the Git blob header plus content must match the selected blob ID; SHA-256
      records raw content. Use Bun.CryptoHasher, as the existing replay reader does.
- [ ] Keep all spawned handles scoped and stdout/stderr consumed concurrently;
      require successful exit and exact expected byte counts. Enforce read-time caps
      even after metadata checks. Convert fatal UTF-8/JSON failures into finite codes;
      do not leak root paths, stderr or raw exceptions. Provision no runtime here.
- [ ] Run `moon run replay:test replay:typecheck --concurrency 1` and root
      lint/format. Require exit 0; commit only Task 2 files as
      `feat: read bounded manifest evidence from pinned Git objects`.

## Task 3: CLI, Exact Baseline Evidence And Handoff

**Files:** create `apps/replay/src/manifest-cli.ts`, the two remaining replay
tests and the runbook/evidence files; modify `cli.ts`, `main.ts` and the approved
design status. Do not modify package dependencies or hosted infrastructure.

**Interfaces:**

- Add only `manifests --repository <absolute-local-path>` to `runCli(argv)`;
  no ref, URL, profile, output-file or arbitrary Git options. Validate arity,
  flag, absolute path and NUL/control-character rejection before Git acquisition.
- `runManifestReport(repositoryPath: string)` returns an inferred Effect of the
  existing `{ exitCode, stdout, stderr }` shape. It composes Task 2 and Task 1,
  encodes the strictly validated report plus one newline, and checks 262144 bytes
  before emission. Success is exit 0; inspection/source/timeout failures exit 1
  with empty stdout and one `ManifestReportFailed` JSON line containing only a
  finite code. Bad arguments retain existing usage exit 64.
- Compose `BunServices.layer` once at the exported application boundary. The
  15-second deadline covers layer acquisition, reads, inspection, encoding and
  scoped disposal; join finalizers and document cooperative cleanup overrun.
  Retain historical `inspect` output and blocked exit 2 unchanged.
- Export the existing main teardown as internal `replayTeardown` for the static
  subprocess test harness, so that it exercises the same exit decoder as launch.

- [ ] Write workflow tests for valid report, refusal propagation, invalid output,
      byte cap, sanitized defects and acquisition/work cancellation. Assert no
      partial stdout. Include malformed argv proving the adapter is never called.

  ```ts
  expect(failedOutput).toEqual({
    exitCode: 1,
    stdout: '',
    stderr: '{"_tag":"ManifestReportFailed","code":"SourceTooLarge"}\n',
  });
  expect(successProcess.code).toBe(0);
  expect(successProcess.stderr).toBe('');
  ```

- [ ] Add real subprocess regressions: successful mocked-source entrypoint exits
      0, invalid arguments exit 64, unavailable local repository emits only finite
      failure JSON, import remains quiet, sentinel `.env` is not loaded and argv
      cannot supply a different SHA. Never run repository scripts in the harness.
      Use a test-only statically imported harness around the real main function with
      spied source reads and `replayTeardown`, not a public CLI test selector. The
      harness invokes `BunRuntime.runMain` with that real main/teardown pair.
- [ ] Run `moon run replay:test --concurrency 1`; observe expected new failures,
      including the current entrypoint's missing 0 in its exit decoder.
- [ ] Implement CLI composition/encoding and add 0 to `main.ts`'s exit decoder.
      Allow only the exact operation above; keep old `inspect` tests unchanged.
      If process seams require adjustment, keep them internal and inferred rather
      than exposing arbitrary commands or adding lint exceptions.
- [ ] Run the full affected suites and workspace gates from the checkout:

  ```sh
  moon run domain:test replay:test --concurrency 1
  moon run :typecheck --concurrency 1
  PATH="/Users/alancurrie/.proto/tools/bun/1.4.2:$PATH" /Users/alancurrie/.proto/tools/bun/1.4.2/bun --no-env-file --no-install run check
  git diff --check
  ```

  All commands must exit 0. Do not invoke observer-canary real-process tests.

- [ ] Run the actual local report without implicit dotenv or dependency install:

  ```sh
  /Users/alancurrie/.proto/tools/bun/1.4.2/bun --no-env-file --no-install apps/replay/src/main.ts manifests --repository /Users/alancurrie/Projects/fold-kit-experiments
  ```

  Require exit 0, exactly one valid report line, empty stderr, the approved SHA,
  all 14 paths and matching catalog facts (FoldKit 0.170.0, Effect 4.1.0, Astro
  7.4.0 are root declarations, not runtime compatibility claims). Independently
  compare root blob identity/digest and selected catalog entries with fixed-SHA
  Git plumbing. Retain the sanitized JSON artifact and its SHA-256 beside the
  evidence Markdown, within the approved output budget.

- [ ] Document usage, limits, exact coverage, local-object provenance, failure
      codes, verification commands/results and cooperative deadline caveat. Mark
      the spec implemented only after these gates. State explicitly that hosted
      execution and baseline/browser qualification have not occurred.
- [ ] Re-run root format/whitespace checks after docs/evidence. Review the full
      branch diff against this plan; if no independent reviewer tool is available,
      report self-review honestly rather than claiming independent review. Commit
      only Task 3 files as `feat: export pinned FoldKit manifest report`.

## Completion Handoff

Report task commits, actual test/typecheck/lint results, artifact path/digest and
remaining dirty observer research. Recommend the next bounded hosted manifest
report design; do not run it, activate routes/webhooks, build images or advance
to dependency installation automatically.
