# Offline GitHub Admission Recovery

Task 6 of the [approved plan](../superpowers/plans/2026-10-20-github-admission.md)
is separately approved after the [verified ingress bridge](github-verified-ingress.md).
Source candidate `ad5c840` passes controller qualification and has a validated
measured report. Independent Task 6/whole-branch review approved `71afb64` with
fresh gates and no findings. This completes the amended offline admission plan,
not a production service or the original unpatched-artifact gate.

## Required Evidence

The committed-loss case must emit its bounded phase only after native commit,
then be killed by the parent before replying. A fresh process reopens the same
file without seeding authority and must return the original decision identity as
historical Duplicate, including replay under a new delivery ID.

The uncommitted-loss case must pause after an insert inside the transaction,
before commit. After parent-confirmed SIGKILL, a fresh connection must see no
partial decision or transport receipt; an explicit current-authority retry may
record once. Neither process exit alone nor a guessed sleep establishes the
transaction phase. Each owned child and read/join is watchdog-bounded at 5000ms;
the Bun test timeout remains 30000ms.

Four temporary behavioral controls must demonstrate that existing tests detect
broken command-key deduplication, a missing authority revision barrier, lost
transaction rollback and rejection of every otherwise valid command. Original
source must be restored exactly before qualification. Compiler/import failures
are not behavioral control evidence, and broken controls must not be committed.

The report must reject missing, duplicated or nonzero gates and separate actual
validated primary law runs from assertions, shrinks and repeated executions.
Exact tested source, tree, lock and installed-artifact identities belong to the
record; later evidence-only documentation commits are not different tested
application sources.

Schema validation can reject incomplete or inconsistent report data; it cannot
independently attest that an operator actually ran a command. Measured execution
logs, inspected source identities and reviewer checks must remain attributed
separately from synthetic report-validator fixtures.

## Baseline Identity

The starting source commit is `e474dcd320dd4dfc51883a5a2aeeee26f03bd935`.
Current lock SHA-256 is
`a03b2f20874301814ba165f945b3fa55df5f20023f29ba5b873f3d16537cadc3`.
The approved declaration-only patches are unchanged:

| Patch              | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| Flue runtime 2.3.0 | `07d115c8c98bea3c28011afe76e838a89a5126b2f401bad1091af678c008931a` |
| Gaxios 7.3.1       | `7ea7b1f29d158ab1595b71f798b71c9c44249ae29567b12dcf6d5d7e35239e3e` |

The lock records original package tarball integrity; installed entry and patch
hashes identify the local patched cohort. A lock integrity string alone is not a
fresh registry download or proof that an unmodified published artifact passes.
The [compatibility repair assessment](github-admission-repair.md) retains the
original strict failure and exact approved exception.

The separate [artifact audit](../evidence/github-admission-artifacts.json) freshly
fetched both pinned public npm manifests and tarballs, recomputed SHA-512 against
the registry and lock, compared parsed exports structurally and matched tarball
JavaScript entries to installed entries. Export hashes use the actual tarball
package manifest's key order, not the registry's reordered root export map.
The audit is tooling network access, separate from the fixture harness. It is
neither an npm-signature attestation nor acceptance of unpatched declarations.

Current installed runtime-entry SHA-256 observations:

| Artifact              | Entry SHA-256                                                      |
| --------------------- | ------------------------------------------------------------------ |
| `@flue/github@2.3.0`  | `526cb85d72f4e9a7e947444d62c4206f56b88e30b20d1efaec2935d78440b597` |
| `@flue/runtime@2.3.0` | `67ced81aec33762ed6f7111cdab6dcace78548c062f2401a03114f5e91527907` |
| `effect@4.0.5`        | `fa0b1ffb925b4c771d8ca81012cdf47e25a8060b4bcddd7e6416bbe9cb23db98` |

Installed Bun reports 1.4.2, Moon 2.5.4 and Node 24.15.0; Node remains tooling
only. All 141 Effect rules and one physical Effect resolution across the four
workspaces were checked directly. These observations do not upgrade a runtime
entry hash into a full installed-tree or fresh tarball-integrity verification.

Fresh starting lint/format and all four uncached typechecks pass. Task 5's prior
accepted full gate total is 635 tests / 4124 assertions, not a measured Task 6
result.

## Measured Candidate

The [validated measured report](../evidence/github-admission-report.json) records
tested commit `ad5c840c07128ce761272f7d3d3fdc2f6069af0a` and tree
`e049c317e09bc301549db4752c25e432e7a37336`, with 116 checked source/configuration
identities. Each current source was compared to that commit, not inferred from
the previous clean HEAD. Subsequent evidence/documentation commits do not change
the tested source. Report validation ran from the probe workspace using its
declared Effect dependency, not an undeclared root dependency.

Controller-observed sequential gates use the specified minimal environment,
uncached forced Moon targets, no overlapping suites and no automatic retries:

| Gate                                   | Result                                      |
| -------------------------------------- | ------------------------------------------- |
| Frozen script-free installation        | Pass; no dependency changes                 |
| Root lint/format                       | Pass; 0 warnings/errors                     |
| All four workspace typechecks          | Pass                                        |
| Domain tests                           | 201 pass / 768 assertions                   |
| Engine tests                           | 273 pass / 1526 assertions                  |
| Existing Flue probe                    | 36 pass / 104 assertions                    |
| GitHub admission probe                 | 135 pass / 1828 assertions                  |
| Total                                  | **645 pass / 4226 assertions**, no failures |
| Whitespace, including staged new files | Pass                                        |

Gate command/output transcripts are committed under
`docs/evidence/github-admission-gates/controller-1/`. The report binds each by
SHA-256. The 30000 primary admission law cases are attributed to the actual
validating law source and these passing gates: six domain laws and four engine
laws at three fixed seeds, each requiring an actual `Passed.runs === 1000`.
Other existing project properties also pass but are not included in that
admission-only count. Shrinks, control runs and repeated gate executions are not
added to it.

The implementer supplied focused RED/GREEN and control observations; the
controller inspected their logs and independently checked exact source
restoration, then ran the complete gate block above. Report-validator fixtures
remain synthetic, not additional real qualification runs.

## Recovery And Controls

The committed writer was killed only after decoded `AfterCommit` and native
counts 1 decision / 1 receipt. A fresh process returned historical Duplicate with
the same observed decimal decision identity; new-delivery replay left 1 decision
and 2 receipts. Repeated recovery did not create another decision or receipt.

The uncommitted writer was killed at decoded `AfterDecision`. Fresh native reads
saw 0 decisions / 0 receipts before and after SIGKILL. A fresh signed retry
recorded once; another process returned its original. Missing/corrupt files
failed without recovered success or fixture seeding. A retained revoked authority
recorded `AccessRevoked`, never an admitted restart result.

Five controls each failed twice with the same behavioral selection, were restored
byte-for-byte, then passed. Their RED/repeated-RED/GREEN transcripts are committed
under `docs/evidence/github-admission-controls/`; original, mutant and restored
source identities are in the measured report:

| Control                                  | Observed failure                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Shared command key includes display name | Pure rename law falsified at seed 0, with shrunk counterexample and replay coordinates       |
| Native command lookup bypassed           | Fresh reader failed to return historical Duplicate; SQL uniqueness still prevented overwrite |
| Authority revision refusal bypassed      | Literal received a recorded stale preview instead of `AuthorityChanged`                      |
| Native transaction bypassed              | Killed uncommitted writer and native fault cases left partial decision rows                  |
| Every access check refuses               | Constructive signed authorized command failed to produce a preview                           |

The pure key law and native replay literal are separate evidence. Test-only
memory sequence laws are not credited with detecting native SQLite mutations.
Two trailing diagnostic spaces and transcript footer blank lines were normalized
for Git whitespace checks; behavioral output/counterexamples are retained.

## Independent Review

The [final independent review](github-admission-review.md) approved Task 6 spec
compliance, code quality and the entire admission branch from main through
`71afb64`, with no Critical, Important or Minor findings. This single combined
scope replaced a duplicate narrow-only seat without narrowing code or gate
coverage. The reviewer independently reran all 11 gates sequentially, observing
the same 645 tests / 4226 assertions and 30000 attributed admission cases, and
verified all 138 evidence references plus the 116 source/configuration identities.
These repeat executions do not double the case count.

The [review log archive](../evidence/github-admission-review.json) retains 14 raw
UTF-8 log contents and their original SHA-256 values, including provenance and
postflight checks. The initial sandboxed install's tempdir permission failure is
retained separately from the permitted scoped frozen-install success. No test
retry or lowered budget was used.

The reviewer did not reapply historical mutations or repeat the registry fetch;
those observations remain attributed to implementer/controller evidence. Current
source restoration and installed artifact consistency were checked independently.
Declined live-operation, production-availability, kernel/unkillable-process,
power/host-loss and execution guarantees match the exclusions below; none is an
unresolved in-scope finding. Later closeout changes are documentation/evidence
only, with no new source/configuration/dependency tree claimed as tested.

## Exclusions

Even successful local SIGKILL/restart tests do not establish power-loss or
host-loss durability, multi-host coordination, production retention, availability
or exactly-once execution. This fixture-only probe has no live GitHub authority,
model/provider, agent, coordinator dispatch, worker allocation, listener or
publication. No merge or push is authorized.
