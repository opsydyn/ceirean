# Local SQLite Command Inbox

Task 4 of the [offline admission plan](../superpowers/plans/2026-10-20-github-admission.md)
is separately approved after the [in-memory contract](github-inbox-contract.md).
Source is complete at `db21cc4`, with full controller gates and clean independent
spec/quality review. This is local Task 4 acceptance, not whole-plan acceptance.

## Boundary

The private probe owns a scoped `bun:sqlite` adapter implementing the existing
inferred inbox driver. Trusted configuration supplies the database path,
configured ingress scope, explicit clock, finite capacities and optional
synthetic fault hooks. No request can select fault points or install authority.

The native transaction must bind deduplication, current authority revision/time,
capacity reservation, decision and receipt recording, and the per-scope clock
floor. Persisted revision history must prevent old revisions from restoring
authority after revocation. An identical current snapshot is idempotent; stale
or conflicting updates cannot overwrite it.

Reopening must not reseed an existing database. Missing `create: false` paths,
corrupt files, malformed rows and close failures remain observed failures. No
raw request/comment body, secret, signature, SQL or exception text is persisted
as a decision. The initial trusted fixture cannot become an enabled default.

## Narrow Supporting Changes

The adapter requires `ingressScopeId` explicitly because unavailable authority
has no scope field. This is private trusted configuration already present in the
planned application configuration, not another request-supplied identity.

The probe declares the existing domain/engine workspace dependencies and includes
its new source in strict typechecking. The engine adds only the finite `Busy`
error code and exposes its existing immutable-fact comparison for adapter reuse.
These changes do not alter the policy, acquired-service contract, lint rules,
external package versions or existing dependency patches.

## Evidence Limits

The implementer reports 31 deterministic native cases plus the unchanged eight
channel cases: 39 focused tests / 1412 assertions. Native evidence uses real
file-backed SQLite, an immediate transaction, fresh-handle SQL counts, actual
foreign-key constraints and observed WAL/FULL/foreign-keys/busy-timeout settings.
Two independently opened connections exercise real lock contention and explicit
retry; no automatic retry or fake in-memory lock is used.

An initial missing-implementation RED is separate from later behavioral
regressions: `create: false` incorrectly created a missing file, invalid stored
schema initially had the wrong error classification, and construction mutation
could bypass validated configuration. The report retains those failures and
subsequent GREEN runs rather than claiming every edge had an assertion RED.

Acquisition now forks a child of the caller scope and registers native close in
its literal `acquireRelease` finalizer. Initialization failure closes that child
immediately; success remains caller-owned. A failing synthetic Close hook cannot
skip the actual close attempt. An initialization failure plus cleanup fault
retains one typed Fail and one sanitized teardown Die reason. Cleanup defects
are observable, not recoverable operation errors silently converted with `orDie`.
No runner, standalone scope or lint waiver is introduced.

Construction data and limits are snapshotted at factory invocation, while the
injected clock/fault function identities remain stable. Later mutation of the
caller config cannot raise capacities, retarget scope or replace those callbacks.
Snapshot failures enter the acquisition error channel. Focused tests cover
pre-acquisition and post-acquisition mutation without losing intentional
clock/fault closure control.

Controller-observed sequential gates pass:

| Gate                                   | Result                                      |
| -------------------------------------- | ------------------------------------------- |
| Root lint/format                       | 0 warnings/errors; formatting clean         |
| All four uncached workspace typechecks | Pass                                        |
| Domain tests                           | 201 pass / 768 assertions                   |
| Engine tests                           | 273 pass / 1526 assertions                  |
| Existing Flue probe                    | 36 pass / 104 assertions                    |
| GitHub/native probe                    | 39 pass / 1412 assertions                   |
| Total                                  | **549 pass / 3810 assertions**, no failures |
| Frozen installation and whitespace     | Pass                                        |

Moon commands used `--force --no-actions` in the specified minimal environment,
without overlapping suites or automatic retries. The previous 30000 generated
pure/engine admission cases remain unchanged; these native cases are deterministic
transaction tests, not newly generated laws. Lock changes are exactly the two
existing workspace links, with no external pin changes. Current lock SHA-256:
`a03b2f20874301814ba165f945b3fa55df5f20023f29ba5b873f3d16537cadc3`.
Independent review approved `ea6aed3..db21cc4` with no findings requiring changes.
It inspected native atomicity, historical identity, revision/time/capacity checks,
config snapshots and child-scope cleanup without rerunning the full suites.
The gate results above are controller-observed, not reviewer-reproduced history.
All 141 Effect rules and one physical Effect instance remain verified. No
hosted/CI or cross-platform acceptance is inferred from these local gates.

Verified cases include real file-backed recording and reopen, native rollback
counts from fresh handles, two-connection lock contention/duplicates, capacity,
revision reuse, explicit-time races and immediate cleanup on failed acquisition.
Post-commit synthetic reply loss is distinct from pre-commit rollback.

The native close implementation itself throwing was not independently induced;
double-cleanup aggregation is not claimed as native I/O-fault proof. Synthetic
Close faults, actual close attempts and retained primary/cleanup causes are
separate observations.

This task does not qualify process-kill timing, power loss, host loss,
distributed workers, exactly-once execution, bounded HTTP ingress, live GitHub
permissions, models, migration execution or publication. Later tasks remain
separately approved boundaries even if the local native tests pass.
