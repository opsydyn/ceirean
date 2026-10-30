# Complete Offline Archive Admission

**909/909 fixed archives pass the controlled-worker archive policy offline.**
This is authenticated archive-data inspection with a synthetic process-status
fixture, not real Linux process isolation or package installation. No Colima,
installer, image build, publication, browser/target check, provider or hosted
activity ran. Existing public routes and webhook controls were not changed.

## Approved Compatibility Changes

1. Bounded printable ASCII uname/gname fields are inert metadata only when the
   caller holds genuine process-local `InertArchiveOwnership`. Empty fields keep
   their old semantics. Fields containing control characters or non-ASCII still
   refuse; the existing USTAR codec/canonical-header checks remain in force.
   Names never select a filesystem path, principal or ownership-restoration action.
2. The owner separately approved the sole remaining layout:
   `@types/node@22.19.19` has the root `node v22.19/`. The fixed-inventory preflight
   maps that exact registry identity to that exact root. This is not a generic
   versioned-root wildcard. Other versioned roots, mixed roots and traversal still
   refuse; default inspection without ownership authority stays strict.

Checksum, gzip/CRC/EOF, raw/expanded/entry budgets, collision, special-mode,
link, device and extended-header checks are unchanged. No input was omitted,
repacked, edited or re-downloaded. No dependency version or lint exception changed.

## Whole-Cohort Diagnostic

After inert-name support, a diagnostic inspected every independently authenticated
blob rather than stopping at a prefix: **908 passed, one refused**. The sole
refusal was `@types/node@22.19.19`, artifact `artifacts/0255.tgz`. Read-only tar
listing confirmed `node v22.19/`. That diagnostic did not grant replay/admission;
per-archive checks continued only to discover all remaining incompatibilities.
Its expanded/entry counters included only prefixes for refused archives.

Retained diagnostic: `/private/tmp/ceirean-inert-names-cohort-20261030.json`,
SHA-256 `817d79af8fea1dd6928854ccba49e39ac348972f3faa1c4ccf2c5d9870cb0249`.
Driver: `probes/cloudflare-executor/.local/audit-inert-names-cohort.test.ts` in the
retained Ceirean worktree. The driver is an ignored, local test fixture, not a
production authority-minting path or a portable input bundled with the package.

## Full Admission Readback

After the separate root approval, the existing all-or-nothing preflight completed
with its original cumulative budgets, not independent per-archive allowances:

| Readback            | Value             |
| ------------------- | ----------------- |
| Status              | `Inspected`       |
| Scope               | `ArchiveDataOnly` |
| Admitted / total    | **909 / 909**     |
| Compressed bytes    | **429,561,867**   |
| Expanded bytes      | **1,677,200,384** |
| Entries             | **70,170**        |
| Activation          | `Blocked`         |
| Native installation | `NotRun`          |

The inventory SHA-256 remains
`940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed`.
Every blob was rechecked for size, SHA-256 and SHA-512 SRI before parsing.
The expanded total is below the unchanged 2,147,483,648-byte cap; entries are
below 200,000 and raw bytes below 536,870,912. All per-package limits also passed.

Retained report: `/private/tmp/ceirean-complete-archive-preflight-20261030.json`,
SHA-256 `64186722c3938cbf074f41bf99b6a690af470df158cd2b792321e377664f72e2`.
Log: `/private/tmp/ceirean-complete-archive-preflight.log`.
The local driver asserts both `admitted === 909` and `status === 'Inspected'`;
it passed in 33.79 seconds on the controller Mac. Its explicit
`SyntheticKernelFixtureNotLinuxProof` label must be retained.

## Remaining Gate

The archive-policy blocker is cleared for the exact retained inventory. The next
step is a separately authorized controlled Linux cache-only run: obtain genuine
kernel ownership authority, materialize Bun's cache, stop replay, reinstall fresh
offline, audit both installed graphs and consume the four npm profiles. A Linux
runner can replace local Colima; no runtime was selected or started by this slice.
This report does not authorize a VM/CI run, image build or hosted activation.

Local verification: 740 executor tests passed, 0 failed, across 65 files and
30,206 assertions. All 12 typechecks and strict lint/format passed. Independent
review found no security/correctness issue; it noted a nonblocking gap in dedicated
negative identity-map integration coverage. Literal root mismatches and the full
frozen-cohort positive path are exercised. This gap is recorded in the plan.
