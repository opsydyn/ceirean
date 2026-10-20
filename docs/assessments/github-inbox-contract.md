# In-Memory Command Admission Contract

Task 3 of the [offline admission plan](../superpowers/plans/2026-10-20-github-admission.md)
is separately approved after the [pure command policy](github-command-policy.md).
Source is implemented; controller full runtime gates and independent task review
are in progress. The already completed pure policy remains unchanged.

## Boundary

This slice adds an inferred Effect inbox boundary and admission use case. The
inbox is acquired by the owning service, rather than provided inside each helper
or allocated for each call. Schema-derived domain records and the existing pure
policy remain the source of candidate and permission decisions.

A test-only in-memory driver models atomic transport/command deduplication,
current authority revision/time checks, immutable historical decisions and
capacity refusal. Its observed behavior will be synthetic contract evidence,
not SQLite, process-restart, power-loss, distributed or production durability.

No HTTP ingress, live GitHub signature/permission check, listener, database,
model, worker, coordinator invocation or publishing capability is added.
An acquired service is not an authorization capability for future execution.

## Required Evidence

- Fresh, duplicate and conflicting requests preserve the first stored decision.
- Rejected exact commands remain historical after authority changes; new comments
  may be evaluated under current evidence.
- Authority changes between load and commit cannot admit a stale draft.
- Caller/driver mutation cannot change stored or returned historical evidence.
- Operational failure remains separate from a permission decision or ACK success.
- Acquired service methods compile without a remaining inbox dependency.
- Four sequence laws complete 1000 cases at seeds 0, 1 and 163: 12000 new primary
  cases if all checks pass, with fresh scoped state and sequences of at most 25.

## Implemented Contract

`CommandInboxDriver` is derived from the real factory parameter, not a parallel
manually annotated Effect interface. `CommandInbox` uses that factory's inferred
return. `CommandAdmission` uses the success type of the actual acquisition
Effect. The owning acquisition reads the inbox once; returned `admit` Effects
do not retain an inbox environment requirement or allocate a runtime.

Input, authority, drafts and replies are decoded and detached. Invalid candidate,
event-name or scope data makes no driver call. Driver throws and invalid replies
become finite, sanitized `CommandInboxError` failures rather than stored decisions.
Fresh records are bound to the draft; duplicates bind immutable command facts
but intentionally retain historical names, permission revisions and timestamps.

The memory fixture resolves transport conflicts and historical duplicates before
fresh revision/time checks. It preserves receipts, enforces decision/receipt
capacities of 256/1024 without eviction, and requires commit time to be at least
both the draft evaluation time and prior committed clock floor. It reuses the
pure policy at evaluation/commit times; no independent permission oracle is added.

## Focused Evidence

The implementer observed missing-module RED before implementation, followed by
behavioral RED for an out-of-window evaluation and an overwritten historical
receipt. Both regressions passed after repair. Final focused author checks pass
37 tests / 364 assertions across three new test files. These include 25 literal
tests and 12 seeded tests representing four sequence laws.

Each law completes 1000 primary cases at seeds 0, 1 and 163 using
`Arbitrary.checkEffect` and the unchanged `validateCheckResult`: **12000 new
primary cases** per full execution. Size 50, maxShrinks 1000 and maxDiscards 10000
remain fixed. Generated actions plus constructive prefixes stay below 25
admissions per case; every case has fresh scoped memory state. The previous
18000 pure cases are separate, not counted again as new engine coverage.

Deferred barriers cover authority replacement/revocation, expiry, clock rewind
and caller mutation between load and commit, with bounded waits and no sleeps.
Tests compile/run the acquired service without supplying the inbox again.

Controller-observed sequential gates pass:

| Gate                                                        | Result                                      |
| ----------------------------------------------------------- | ------------------------------------------- |
| Root lint/format                                            | 0 warnings/errors; formatting clean         |
| Domain, engine, old probe, GitHub probe uncached typechecks | All pass                                    |
| Domain tests                                                | 201 pass / 768 assertions                   |
| Engine tests                                                | 273 pass / 1526 assertions                  |
| Existing Flue probe                                         | 36 pass / 104 assertions                    |
| GitHub channel probe                                        | 8 pass / 24 assertions                      |
| Total                                                       | **518 pass / 2422 assertions**, no failures |
| Frozen install and whitespace                               | Pass                                        |

Independent task review is pending. These are local controller-run gates, not
CI or live acceptance. Moon targets used `--force --no-actions` with the planned
minimal environment, unchanged timeouts and no overlapping suites. Frozen
installation used scoped temporary-directory access and ran no scripts.
Dependency/configuration inputs, domain source and the lock hash are unchanged
from `880b5f9`:
`9659b60ff39f9d38bfc54e5aea5bccc7ba47a0ba37e2ca01598cf3b75e76d5c4`.

Later tasks still own native transactions, bounded ingress and local
process-restart qualification; none is implied by passing an in-memory contract.
