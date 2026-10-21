# Internal Export Cleanup

Approved follow-up to the [report-only audit](fallow-20261021.md).
Baseline: `3195615`. This slice narrows 24 unused exports across 14 internal
source/test files: 20 value exports and four type exports. All implementations,
schema/type declarations, package exports, dependency manifests, lockfile,
compatibility peers, patches and lint rules are retained.

## Changes

- Make locally consumed schemas, constants, helpers and error classes private.
- Make the locally used worker fixture types `ExecutionBarrier`, `Readback` and
  `Outcome` private. Inferred Effect success/error contracts are not rewritten.
- Remove the redundant `makeFrozenRun` fixture re-export; retain its import,
  local use and original implementation in domain fixtures.
- Remove only the unconsumed `IngressFailure` and `CapturedBody` probe-facade
  re-exports. The actual protocol exports and consumers remain unchanged.
- Narrow the `QualificationFailure` and `MeasuredEvidence` schema values while
  retaining the corresponding exported type declarations.

No runtime function bodies, parameters, return values or tests are changed.
Formatting of two declarations changes because their export modifiers are gone.
This is a visibility refactor, verified with the existing consumer typechecks
and behavioral/property tests rather than new behavior-specific test cases.

## Measured Audit

The new [JSON evidence](../evidence/fallow-20261021-narrowed.json) reports:

| Category                | Before | After |
| ----------------------- | -----: | ----: |
| Unused value exports    |     21 |     1 |
| Unused type exports     |      7 |     3 |
| Unused dev dependencies |      1 |     1 |
| Total findings          |     29 |     5 |

The remaining findings are deliberately not suppressed:

| Finding                                                                          | Reason retained                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `commandApplication` in `packages/engine/tests/command-fixtures.ts`              | No local caller; privatizing it would introduce an unused local. Deletion needs a separate approved cleanup.        |
| `QualificationFailure` type in `apps/github-ingress/src/qualification-report.ts` | No local type consumer; retain the declaration under this slice's no-deletion constraint.                           |
| `RestartResult` type in `probes/github-admission/src/report.ts`                  | The schema value is consumed, but this alias is not; preserve the alias pending a separate deletion decision.       |
| `MeasuredEvidence` type in the same file                                         | The schema implementation remains locally consumed; preserve the unused alias pending a separate deletion decision. |
| `@modelcontextprotocol/sdk` in `probes/github-admission/package.json`            | Required transitive compatibility type peer; retain under the [repair criteria](github-admission-repair.md).        |

Fallow exits **1** for four error-severity export findings, plus the dependency
warning. This is not a clean Fallow gate. No unused files or unresolved/unlisted
imports were reported. Architecture boundaries/rule packs remain unconfigured,
and semantic/type-aware analysis remains disabled; their limits are unchanged.

## Reproduction Identity

The previous secret-free snapshot was refreshed from `git archive 3195615`,
then overlaid with only the 14 tracked TypeScript changes. Its frozen,
script-disabled dependency installation was reused: manifests and lockfile are
unchanged. No ignored `.env`, PEM or protected external state was copied or
passed to the scanner. The scan used an empty inherited environment, isolated
temporary HOME, both telemetry kill switches and macOS network denial, exactly
as documented in the initial audit. No listener, connector, webhook, Alchemy
operation or application entrypoint was activated.

- Fallow: `3.34.1`, static, `--no-cache --no-type-aware`.
- Source patch identity: SHA-256 of `git diff 3195615 -- '*.ts'`:
  `882d164e55b69f623d69ef899da588b48dcbe339658a6d240f0438355799f023`.
- Raw report SHA-256:
  `a4d02d617cc697b1ee3bd74603a5cb20bb6c034190c09f354dc5f52dd8ba3d93`.
- Committed report SHA-256 after Oxfmt whitespace normalization:
  `57d45faf4e075d98ffa192c04f477aead9c2463d5522b47319a5ab6a4a7bbdf0`.

The original audit evidence remains unchanged. External disabled-control state
was not rechecked; this local slice does not supersede rehearsal shutdown proof.

## Verification

- `bun --no-env-file run check`: passed, including zero-warning Oxlint and Oxfmt.
- `moon run :typecheck --force --no-actions`: all seven tasks passed.
- `moon run :test --force --no-actions`: all seven tasks passed, 962 tests,
  zero failures, including the existing seeded property suites.
- `git diff --check`: passed. Manifests, lockfile, patches and Fallow config
  are unchanged from `3195615`.
- Independent read-only review found no material issues or broken consumers.

## Next Bounded Step

Review deletion of the one unused helper and three unused type aliases as a
separate source-cleanup slice, preserving the required MCP peer. Do not downgrade
rules or add suppressions to produce a zero count.
