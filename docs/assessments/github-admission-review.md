# Task 6 And Whole-Branch Review

## Spec Compliance

APPROVED for the specified offline fixture scope. Task 6 source, behavioral
controls, actual measured report and documentation satisfy the reviewed brief;
the required fresh independent eleven-gate block passed. Whole-branch quality
and readiness are approved within that same boundary, not for production use.

Reviewed package: `review-1fb038c..ad5c840.diff`, 10384 lines, base
`1fb038c3b49c08266e7fd1a2765b3fc9870d2649`, source candidate
`ad5c840c07128ce761272f7d3d3fdc2f6069af0a` (also observed current HEAD).
Read the entire supplied package in successive chunks. Tool-output truncation
required narrow recovery reads; no second whole diff or source crawl was used.
Read task-6-review-context.md, task-6-brief.md, task-6-context.md and
task-6-report.md. Applied the requested task-reviewer and code-reviewer rubrics
without delegating or treating previous approvals as evidence of correctness.
Phase B additionally read all 1630 lines of `review-ad5c840..71afb64.diff` in
four nonoverlapping chunks after the stable-docs signal. Combined scope is exact
main `1fb038c3b49c08266e7fd1a2765b3fc9870d2649` through final HEAD
`71afb6434c794c4f09ca3a53483c8ee1b1db4e35`, tree
`198b2e3e6976a002cb4e5693288de9f4d056ba14`. The addendum changes six
README/docs/evidence files only, with no source/configuration/dependency changes.

## Strengths

- `probes/github-admission/src/restart-child.ts:30`: phase sentinels originate
  in the synchronous native fault hook, followed by the child-local 5000ms
  barrier. `src/sqlite-inbox.ts:228` commits before AfterCommit notification.
- `probes/github-admission/tests/restart.test.ts:34`: committed identity is read
  from a fresh native connection before SIGKILL; fresh processes must return the
  same Duplicate identity, including replay under a new delivery ID. The separate
  uncommitted case checks zero visible rows before and after kill, then records
  once through real signed ingress. These are not memory-driver persistence tests.
- `probes/github-admission/src/restart-child.ts:49`: reader mode omits initial
  authority and uses create:false. Missing/corrupt/revoked cases require nonzero
  exit and no recovered success; revoked authority is inspected in native rows.
- `probes/github-admission/src/report.ts:58`: finite gates require exit 0;
  exact-once membership, test/log attribution, law/source attribution, control
  restoration and one physical Effect path are validated. The builder explicitly
  validates supplied observations; it does not authenticate measurements.
- `probes/github-admission/src/composition.ts:51`: one owned runtime composes
  admission and native storage. The reviewed new call path produces previews,
  never invokes a coordinator, model, worker, publisher or listening server.
- `probes/github-admission/src/request-body.ts:99`: owned cancellation is awaited
  before lock release, retaining the async-cancel lifetime correction. Held
  cancellation tests cover both fulfillment and rejection.

## Findings

### Critical

None.

### Important

None.

### Minor

None. Documentation correctly retains pending independent acceptance at the
pre-review evidence commit rather than prematurely claiming this review passed.

## Named Risk Checks

- Pending process-stream read versus watchdog/overflow and releaseLock ordering:
  inspected `tests/restart-process.test.ts:7-69` and its restart callers. Watchdog
  races attach rejection handlers; outer ownership kills and joins children on
  scenario failure. Overflow rejects rather than accepting truncated evidence.
  One focused executable Bun 1.4.2 check answered the remaining platform doubt:
  releaseLock during pending read succeeds, unlocks the stream and rejects the
  pending read with TypeError. Final cancellation/release also leaves it unlocked.
  Exit 0. No focused suite or subprocess recovery rerun was performed.
- Cleanup failure: `tests/restart-process.test.ts:49-53,98-105` attempts every
  child cleanup with allSettled and fails the cleanup assertion on stop/join
  rejection. A rejected stderr drain is ignored during cleanup, but is explicitly
  checked by joined on successful scenarios. This is not proof against an
  unkillable process or kernel failure.
- Outside-diff risk, inflated law counts: read only unchanged
  `packages/domain/tests/properties.ts:9-48`. It accepts only Passed with exactly
  the requested run count; checkLaw uses all three fixed seed/budget sets.
  Six domain laws plus four engine laws therefore attribute 30000 primary cases
  to a passing execution, not to shrinks, controls or multiple executions.
- Source restoration: independent `shasum -a 256 -c` of the controller's
  controls-original.sha256 exited 0. All three production control targets matched
  their original hashes. The package contains reproducible behavioral RED/RED
  and restored GREEN logs for key, native lookup, revision, rollback and refusal.

## Evidence Attribution

Read the raw packaged controller-1 gate transcripts and control transcripts.
Controller totals are supplied evidence only: domain 201/768, engine 273/1526,
old probe 36/104, new probe 135/1828; total 645 tests / 4226 assertions.
These are not reviewer execution results. Original unmodified-artifact failure
is historical; only the two approved declaration patches and explicit optional
MCP peer are admitted. No additional compatibility waiver is inferred.

Independent Phase B attribution check exited 0 (`00-attribution.log`):

- The actual JSON round-trips through the real pure `buildReport`, including
  productionQualified:false, five controls and 30000 attributed primary cases.
- All 138 unique file-identity references match current bytes. All 116 listed
  source/configuration hashes also match `git show ad5c840:<path>` independently.
- Tested source commit is `ad5c840c07128ce761272f7d3d3fdc2f6069af0a`, tree
  `e049c317e09bc301549db4752c25e432e7a37336`. Final HEAD is a later evidence-only
  commit, not mislabeled as the controller-tested source candidate.
- Lock SHA-256 remains
  `a03b2f20874301814ba165f945b3fa55df5f20023f29ba5b873f3d16537cadc3`.
- Gate count records match their hash-bound raw transcripts. Law entries match
  the inspected validating source and correct passing domain/engine gates.
- Artifact fields agree with the separate hash-bound artifact audit; installed
  GitHub/runtime JavaScript entries match its entry hashes. Both declaration
  patches match their approved hashes. Four workspace Effect resolutions agree
  with the one physical Effect 4.0.5 installation.

## Fresh Reviewer Gates

All 11 passed sequentially at clean final HEAD `71afb64`. Every command ran from
the isolated worktree root with exactly this environment prefix:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"
```

Logs below are relative to the ignored `task-6-final-review-logs/` beside this
report. Exit codes are observed reviewer command exits, not copied controller
values. Raw output is preserved; `12-postflight.log` records each gate log SHA-256.

| #   | Command after prefix                                       | Exit | Raw log / result                                                    |
| --- | ---------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| 1   | `bun install --frozen-lockfile --ignore-scripts`           | 0    | `01-install-scoped.log`; 207 installs / 260 packages, no changes    |
| 2   | `bun run check`                                            | 0    | `02-check.log`; 0 warnings/errors, formatting clean                 |
| 3   | `moon run domain:typecheck --force --no-actions`           | 0    | `03-domain-typecheck.log`                                           |
| 4   | `moon run engine:typecheck --force --no-actions`           | 0    | `04-engine-typecheck.log`                                           |
| 5   | `moon run probe:typecheck --force --no-actions`            | 0    | `05-probe-typecheck.log`                                            |
| 6   | `moon run github-admission:typecheck --force --no-actions` | 0    | `06-github-admission-typecheck.log`                                 |
| 7   | `moon run domain:test --force --no-actions`                | 0    | `07-domain-test.log`; 201 pass / 768 assertions / 0 fail            |
| 8   | `moon run engine:test --force --no-actions`                | 0    | `08-engine-test.log`; 273 pass / 1526 assertions / 0 fail           |
| 9   | `moon run probe:test --force --no-actions`                 | 0    | `09-probe-test.log`; 36 pass / 104 assertions / 0 fail              |
| 10  | `moon run github-admission:test --force --no-actions`      | 0    | `10-github-admission-test.log`; 135 pass / 1828 assertions / 0 fail |
| 11  | `git diff --check`                                         | 0    | `11-diff-check.log`; empty output                                   |

The initial sandboxed install exited 1 solely because Bun could not write its
tempdir (EPERM), preserved in `01-install.log`. The expressly permitted identical
frozen script-free install then ran once with scoped escalation and exited 0.
There were no test retries, altered budgets, extra suites, cached/affected-only
substitutions, overlapping gates, or root unfiltered Bun tests.

Fresh total: **645 tests, 4226 assertions, 0 failures**. All six pure admission
laws and all four engine admission laws passed at seeds 0/1/163, with actual
Passed.runs===1000 required by the inspected validators: **30000 primary admission
cases in this execution**. Existing other properties, historical executions,
shrinks and negative controls are not added to that count.

Fresh process-kill, missing/corrupt/revoked recovery, native rollback/revision,
signed ingress, report-refusal and held-reader-cancellation cases all passed in
the planned GitHub probe target. Native evidence is not inferred from memory laws.

## Declined To Judge

- Live GitHub authorization and delivery operations: explicitly offline fixture scope.
- Public-endpoint abuse resistance and retention availability: no endpoint or production service is delivered.
- Model, agent, worker and publisher execution: forbidden and not an intended capability.
- Power/host loss, distributed storage and exactly-once execution: explicitly excluded claims.
- Unkillable children/kernel failure: outside this local SIGKILL evidence; no guarantee inferred.
- Historical original-package acceptance: superseded only by the explicitly approved patched cohort, not reassessed as unmodified success.

## Cannot Independently Verify

- Historical RED/control mutations were inspected through supplied raw logs and
  identities, not re-applied by this reviewer. Current restoration was checked
  independently before and after the gate run.
- Registry download/integrity observations are controller tooling evidence from
  the hash-bound artifact audit. This reviewer checked audit consistency and
  installed entries, but did not perform another network fetch or npm-signature
  attestation; none is claimed.
- These local gates do not verify CI, cross-platform behavior, live permissions,
  production durability, or any explicitly excluded execution capability.

## Final Assessment

Task 6 spec compliance: APPROVED. Task 6 code quality: APPROVED.
Whole-branch quality/readiness: APPROVED for offline-local-process-restart-only
acceptance, with no Critical, Important or Minor findings. All required fresh
gates and final provenance checks passed; no source fix is requested.

`12-postflight.log` confirms clean tracked state at the same final HEAD, unchanged
lock and all 138 evidence references still matching after installation/tests.
Only ignored reviewer logs and this report were written. Source, index, HEAD,
controller evidence and tracked documentation were not modified. No subagents,
merge, push, listeners, live credentials, live provider calls or external workers.
Only the planned targets ran, including their existing synthetic/faux fixtures;
the admission call path performs no agent or worker dispatch.

Next bounded action: controller review closeout recording this independent
verdict and fresh gate attribution. Broader implementation or merge/push requires
separate owner approval; this review grants neither.
