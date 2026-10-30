# Sandboxed Current Baseline Inputs

> **For agentic workers:** Use superpowers:executing-plans inline, test first.

**Goal:** Remove the concrete sandbox-policy conflict and materialize current
trusted source/harness inputs without building or activating anything.

**Architecture:** Commit a minimal consumer fix directly on `1183e3c` in an
isolated FoldKit worktree, then bind its new identity in Ceirean. Reuse existing
Git-tree reconstruction, blob hashing, archive validation and Effect platform
boundaries. Preserve historical preparation and unrelated observer research.

**Spec:** Owner approval following the current preparation runbook and commits
`347bce4`/`0bacb00`. All 16 checks and four cases remain mandatory.

## Constraints And Review Focus

- No image pull/build/publication, external dependency acquisition, browser launch,
  hosted/provider calls, model calls, deployment, merge or push.
- Local source verification and Git-object packaging only; no target installation.
- Do not replace the approved source with the newer working checkout or change
  its lockfile. A sandbox-only descendant gets a new immutable source SHA.
- Keep all Effect lint rules; no new native imports or suppression comments.
- Source and harness-source archives are not dependency closures or a runnable
  image. Pending caches/worker/custody remain explicit.
- Refuse caller-selected source identities, dirty working-tree substitution,
  unsafe entries, tampered blobs and changed lock bytes.

## Task 1: Fix The Consumer Launch Boundary

- [x] Add a failing unit test observing the real `launchBrowser` boundary options,
      intercepting only Playwright's external launch. Expect sandbox true and the
      existing SwiftShader flags; do not launch Chromium.
- [x] Observe RED, set `chromiumSandbox: true`, then observe GREEN.
- [x] Run repository check/typecheck/tests with existing dependencies, report
      pre-existing limitations, and commit only the helper and regression test.

## Task 2: Bind And Materialize Current Inputs

- [x] Test fixed current Git-source preparation with forged/mismatched source
      refusals, reusing the historical reader rather than replacing its pins.
- [x] Bind the exact sandbox-only descendant/tree and unchanged lock. Preserve
      `1183e3c` provenance and all accepted checks; remove only the static sandbox
      conflict blocker, retaining native sandbox qualification as unproven.
- [x] Materialize source and harness-source archives locally, with exact hashes
      and inventories; never substitute macOS caches for a Linux closure.
- [x] Run executor tests, all Ceirean typechecks and lint/format, obtain one fresh
      read-only review, update evidence/roadmap and commit verified work.

Exit: real source bytes and launch fix are prepared. Dependency acquisition,
trusted baseline-worker completion, build and hosted activation are not claimed.

Task 1 commit: `be0427e` in the isolated consumer worktree. Root tests passed
1,904; adapter typecheck/lint passed. Root check remains red with the borrowed
dependency closure's Effect version mismatch; not represented as baseline green.
See [source and input evidence](../../evidence/current-baseline/sandbox-inputs-20261030.md).
Review findings: missing harness-test scope fixed; added actual archive rehashing
and positive controls before current-source corruption tests. Fixed the browser
command cwd to match the existing source archive, retaining its activation guard.
Final gates: 613 executor tests, 12 typechecks, strict lint/format and whitespace
validation passed. No image, publication, merge/push or hosted activation occurred.
