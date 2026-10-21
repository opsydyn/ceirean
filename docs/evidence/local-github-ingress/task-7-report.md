# Task 7 Candidate Report

Status: DONE_WITH_CONCERNS. Locally qualified candidate, pending controller Task 7
review and fresh whole-branch review. Tasks 1-6 alone are accepted. No reviewer,
agent, live operation, push, merge or integration was dispatched.

## Exact Source Identity

- Checkout: `/private/tmp/leviathan-compatibility`.
- Branch: `codex/local-github-ingress`.
- Base: `e8fb83c437ebcf1709be4f0e119597319728c653`.
- Source commit: `b7f5d4e3d621e4f09579f76dc4d620dcde521569`.
- Source tree: `9ecbfc4977ef3899c70b0e6ac18029c60a83b6e8`.
- Source inventory SHA256: `fe9e8f19f924bd8b55553de1ff5982e9e4ee1ef6750587ffa35b2ba3ca76c108`.
- Lock SHA256: `8cb4d58bd88280daee28101e542cd9b7120ec7ee63dd5094daf59c2a45fddf59`.

`task-7/source.json` contains the measured per-file identities, production import
graph, 141 error-severity rules and physical Effect resolutions. Its inventory
excludes documentation and plan scratch; the exact Git tree above additionally
identifies the complete source commit. Source was staged/frozen before full
gates; the resulting commit has that exact tree. Later docs/evidence relocation
changes the root Git tree, not the tested source inventory. This report cannot
embed its own containing evidence-commit hash without self-reference. The ignored
handoff report and final response record the later evidence commit separately.

## Implementation

Four source/test files comprise the source commit. `qualification-report.ts`
schema-decodes an unknown measured report with finite Result failures. It rejects
invalid/unknown identities, missing/nonzero/duplicate/unknown gates, absent or
unrestored controls, mismatched source bindings, inconsistent suite totals,
changed lock identity, extra fields and attempts to set live/deployed flags.
All five controls require two intended RED outcomes, distinct mutation identity,
exact restoration and GREEN. Input decoding detaches returned evidence. This is
pure consistency validation, not an external truth oracle: valid-looking hashes
alone are not Git/file attestation. Separate tooling measures the actual bytes,
commit/tree, raw-log hashes, gate exits and suite totals before validation.

Restart tests launch real Bun children with synthetic PKCS#8 keys and API
fixtures. Parent-owned five-second watchdogs guard phase arrival and real
SIGKILL. Synchronous write barriers block on Atomics, not arbitrary sleeps;
pending API uses a genuinely unresolved Promise. Phases are before transaction,
after decision, after evidence, after commit/before response, and API pending.
Reopening asserts no seeded history, zero/one complete decision/evidence/receipt,
immutable evidence equality, released ownership and no fresh API calls for the
committed duplicate. Noncommitted deaths require a fresh five-call API check.
No production fault hook or dependency was added.

Late malformed-key acquisition and occupied-port bind-failure cases verify
immediate reacquisition, unchanged ledger and no residual listener, closing Task
6 M1's coverage gap. Old valid snapshot restoration demonstrates replay-history
loss: status cannot discover lost future records, and fresh delivery records
again after fresh API checks. Existing clean/failed-shutdown tests remain intact.

## TDD And Controls

Raw evidence is in `task-7-raw.tar.gz`; the member index binds every byte. Focused
commands use Bun's existing 30000ms workspace timeout, not a raised timeout.

- Recovery RED: `bun --no-env-file --no-install test apps/github-ingress/tests/restart.test.ts --timeout 30000 --test-name-pattern 'SIGKILL BeforeTransaction'` failed because the old child emitted NativePending rather than BeforeTransaction. The initial sandboxed probe emitted MainReturned due native bind restrictions; that probe is not the semantic RED claim. Authorized ephemeral-bind execution captured the intended RED in `recovery-red.log`.
- Recovery GREEN: five real kill phases plus late cleanup passed 6 tests/99 assertions in `recovery-green.log`. The pending phase was subsequently made an unresolved native Promise, and old-snapshot coverage added; final focused source passed 25 tests/253 assertions in `focused-final.log`.
- Report RED: a rejection-only validator returned Failure where complete measured local evidence required Success; `report-red.log` has 5 pass/1 fail, not an import error. `report-green.log` has 6 pass/29 assertions. Final workspace gates qualify the final formatted implementation.
- Existing-behavior cleanup/snapshot tests passed on first addition; these are qualification characterization tests, not fabricated feature RED cycles.

| Control             | Mutation                                      | Twice RED Intended Outcome                                         | Exact Restore / GREEN             |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| EvidenceBinding     | bypass LiveChecked evidence-row binding       | missing evidence wrongly returned Duplicate instead of InvalidData | identical storage SHA256; 1 pass  |
| PolicyRevision      | bypass configure expected-revision comparison | wrong revision wrongly Installed instead of AuthorityChanged       | identical inbox SHA256; 1 pass    |
| ReplayUniqueness    | treat known receipt as Absent                 | expected Duplicate, received Absent                                | identical inbox SHA256; 1 pass    |
| TransactionRollback | replace savepoint rollback with SELECT        | expired refusal retained 1 decision/evidence/receipt instead of 0  | identical inbox SHA256; 1 pass    |
| AbortOwnership      | skip waiting for owned listener work          | disposal falsely completed while cleanup pending                   | identical listener SHA256; 1 pass |

Each qualifying RED command exited 1 twice, then the restored GREEN exited 0.
The manifest carries exact before/mutated/restored/log hashes and source/test
bindings. No mutation remains in the source commit. The first replay test
selection (rollback/after-commit case) did not detect known-receipt lookup
breakage; the first abort selection (whole composition) still awaited cleanup
through runtime disposal. Both passing mutation attempts are preserved and
excluded from qualifying controls. The corrected selections directly exercise
known-receipt lookup and listener cleanup ownership. No control counts as a law.

## Full Final-Source Gates

Each command ran sequentially under minimal
`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"`, without credentials,
uncached Moon force/no-actions, cache false, retryCount 0 and envFile false.
No prechange 903-test baseline was rerun. A failure stopped dependent gates.

1. Frozen install with ignore-scripts: exit 0; unchanged lock/dependencies.
2. Initial root check: lint clean, generated source.json formatting failed.
   Dependent gates stopped. Its raw command/log/exit remain as initial-final-check.
   Actual fix: format that JSON with repository oxfmt. Root check then exited 0;
   successful install was not repeated. No failing suite was retried unchanged.
3. All six workspace typechecks: exit 0.
4. All six full workspace suites: exit 0, exact totals below.
5. Working/staged whitespace gates: exit 0.
6. Final source/tree/lock/patch/141-rule/physical-Effect/import-graph audit: exit 0.

| Workspace        | Passing Tests | Failures | Assertions |
| ---------------- | ------------: | -------: | ---------: |
| domain           |           211 |        0 |        965 |
| engine           |           300 |        0 |       2719 |
| probe            |            36 |        0 |        104 |
| github-admission |           135 |        0 |       1828 |
| github-adapter   |           196 |        0 |       2771 |
| github-ingress   |            38 |        0 |        506 |
| Total            |           916 |        0 |       8893 |

All eight new laws retain 3 seeds x 1000 runs = **24000 new primary cases**.
Legacy primary cases are separate: domain 42 laws x 3000 = 126000; engine
14 laws x 3000 = 42000; **168000 legacy primary cases**. Primary laws all passed
without failure shrinking. Diagnostic false-property/shrink/replay/exhaustion
tests and controls remain separate; their raw outputs are retained, not added to
primary counts. No property source or budget changed. Engine full suite took
170.32s, not an extended per-test timeout.

One physical Effect 4.0.5 and exact platform-node-shared override remain. No
Node/direct Hono/Octokit imports, app Effect runner/environment read/manual
Effect/Layer channels or additional ManagedRuntime owner were introduced.
Strict app/adapter library checking remains false for skipLibCheck. Patches:
Flue `07d115c8c98bea3c28011afe76e838a89a5126b2f401bad1091af678c008931a`;
Gaxios `7ea7b1f29d158ab1595b71f798b71c9c44249ae29567b12dcf6d5d7e35239e3e`.

Development lint findings were corrected through Schema serialization, explicit
Match decisions and named helpers, without waivers. Two audit-tool path mistakes
(root config relative path and github-admission workspace path) were corrected
before freezing; they were not passing gates. A later root eval lacked a root
Effect dependency; the equivalent app-local identity-pattern probe refused a
newline identity. No production change/retry was needed for that probe.

## Durable Evidence And Documentation

The canonical archive contains final reports for Tasks 1-6; their task/fix review
closures; Task 1 full gates, Task 2 numbered final gates, Task 3 fixed-source
round1 logs, Task 4 round1 final logs, Task 5 fix-round-1 logs and Task 6 raw gate
archive/summary material. All 212 selected archive members were extracted and
byte-compared. The index enumerates source paths, sizes and SHA256 values.
Every controller Ruling and cost-if-wrong is retained in execution-decisions.md
and the exact archived progress.md snapshot. No future review was invented.

The seven tracked Task 6 copies alone were removed using git rm --cached after
canonical comparison. Original working files remain for final review; history
was not rewritten and no unique evidence was deleted. New SDD files were never
force-added. Task 7 report/logs/tooling are durably canonical, not scratch-only.

README/app README, roadmap, assessment, runbook and plan now reflect accepted
Tasks 1-6 only. Task 7 checkboxes remain pending review. The runbook documents
proposed CLI actions, owner-only files, PKCS#8 operator-conversion prerequisite,
exact admission/permission boundaries, capacity stop, failed shutdown,
redelivery and old-backup/reset caveats. Live checklist remains entirely unchecked.

## Self-Review And Remaining Concerns

Personally inspected new source/tests, phase sequencing, final staged scope,
hash restoration and measured outputs. No remaining implementation defect was
identified. Controller-owned fresh review has not happened and is not implied.

- Initial Task 5 broad-batch test-first history remains incomplete.
- Task 6 TDD summary/excerpts are not its raw gate logs.
- Task 3 M1 memory receipt-display metadata and M2 permutation-law weakness
  remain deferred for final whole-branch triage, not silently fixed/dropped.
- Moon update notices remain in raw logs; no tool upgrade or output filtering.
- Frozen install was not network-traced: no zero-network claim.
- Local synthetic Bun/SQLite process-death checks do not qualify host/disk loss,
  live GitHub/App grants, tunnels, deployed operation or production availability.
- Real keys were neither read nor converted. No new dependency, rule waiver,
  runtime/platform escape, live key/API/tunnel, push or merge was used.

Next bounded action belongs to the controller: fresh Task 7 review, then
whole-branch review with the deferred triage items. No integration is authorized.

## Documentation-Only Verification

After staging canonical relocation, `bun run check` exited 0 (zero lint
warnings/errors, format clean). Working/staged whitespace checks exited 0.
The independent artifact-consistency tooling exited 0: all 166 tested source
files remained byte-identical, all 212 historical and 154 Task 7 raw archive
members matched their indices and retained originals, gate/control hashes
matched the measured manifest, and exactly seven approved tracked copies were
removed from the index while every original working file remained. Raw output
and the verification tool are retained in `docs-verification.tar.gz`. These are
documentation/artifact checks, not another full-suite run or independent review.
