# Qualification Gate: Measured Synthetic Tracer

Measured 2026-10-19. Task 4 implementation and local gates pass; Task 4 Step 7 is
complete with a clean whole-branch review through `e7d9d25` and all nine
independent controller acceptance commands passing at that exact head.
This is not production qualification or approval to integrate, publish or deploy.

## Exact Artifact

Tested-code commit:
`3cda115a2d0ade81a2faecceed42dfa64deb82ee`
(`feat: coordinate race-safe qualification with synthetic evidence`).

Reviewed predecessor: `ea35256e0e44188ea5eb008640dc6fc124b0883c`.
Earlier domain evidence and decisions are in `943e4eb` and `baaf262`.

| Identity               | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Root bun.lock SHA-256  | `94a67265d92385e3bff7a980c22a49ace848a15f3d1f3cf641f3e0d71f2af024` |
| Root bun.lock Git blob | `5394db9099be0a5888b9bc0a247f6d9920fb5cad`                         |
| Bun                    | 1.4.2 (744846f84)                                                  |
| Effect                 | 4.0.5, exact pins in domain and engine                             |
| Moon                   | 2.5.4                                                              |
| TypeScript / bun-types | 7.0.2 / 1.4.2                                                      |
| oxlint / oxfmt         | 1.88.0 / 0.73.0                                                    |
| @opsydyn/oxlint-effect | 2.0.1; all 141 rules universally at error                          |
| Node                   | v24.15.0; developer tooling only                                   |

The lockfile is byte-identical to the reviewed predecessor. No dependency cohort,
workspace linkage, lint policy or typecheck-policy change was needed. Domain and
engine retain `skipLibCheck: false`; the probe-local vendor declaration policy
does not apply to them. No manual Effect/Layer channels, renamed channel aliases,
inference placeholders, rule disables or source-to-test dependencies were added.

The assessment is a separate documentation follow-up naming the immutable code
commit, avoiding a circular self-hash. The tested-code commit contains only the
coordinator, index export, two new test files and test fixture extensions.

## Implemented Boundary

`qualifyRun(runId)` consumes only the stored identity/contract and the trusted
CandidateVerifier capability. There is no caller-supplied receipt or acceptance
contract. The inferred Effect requires the real RunRepository/CandidateVerifier
services; their tagged operational errors propagate unchanged. Expected refusal
and optimistic conflict are success values.

One visible Effect workflow loads once, reads the clock, calls pure eligibility,
invokes the verifier with a detached request, decodes the receipt, reads the
clock again, calls the existing pure qualification decision and commits the
accepted state/facts against the original loaded revision. It has a
`RunCoordinator.qualifyRun` span, no hidden runtime/provision, catch, retry,
re-verification or reread-and-overwrite loop.

The verifier does not receive an alias to authoritative `requiredChecks`.
Tests mutate its input while verification executes: shrinking the required set
cannot turn incomplete evidence into acceptance. Subsequent mutations of
verifier-owned input/output arrays cannot alter the returned or retained
qualified state/history. This proves application capability ownership under the
synthetic port contract, not security against a malicious trusted adapter.

Canonical evidence at time 999 qualifies revision 7 to 8 with one complete
RunQualified fact. A noncanonical identity/one-check contract at revision 41
qualifies to 42 while appending to prior history. Missing, Cancelled, Qualified
and expired runs refuse without verifier/write. Malformed evidence, all six
identity mismatches and missing/empty/duplicate/unknown/Failed/NotRun checks refuse
without commit. Operational failures remain tagged, preserve retained state and
have owned no-call/no-retry assertions.

## Controlled Races

All three race schedules explicitly observe BOTH separate entered Deferreds,
assert both exact stored verification requests and loaded revisions `[7, 7]`,
and inspect the unchanged revision-7 snapshot before releasing either result.
Forking alone is never treated as entry evidence.

| Controlled winner                         | Exact retained result after both qualifiers finish                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Cancellation committed first              | Revision 8, full Cancelled state, only RunCancelled; both stale qualifiers Conflict with expectedRevision 7 |
| Replacement committed first               | Revision 8, attempt-2/generation-4, unchanged contract/limits, no facts; both stale qualifiers Conflict     |
| First qualifier released and joined first | Revision 8, exact Qualified state and one RunQualified; second qualifier Conflict                           |

The winning snapshot is inspected after the first result and again after the
loser completes; both owned verifier call count (2) and loaded revisions remain
unchanged. The Ref repository's existing single synchronous CAS transition owns
state/history atomicity. No lock is held while verification awaits a Deferred.

Deadline schedules observe verifier entry at 999, set TestClock to 1000 or 1001,
then release complete passing evidence: DeadlineExpired, no commit, unchanged
state/history. An immediately returned result already at 1001 also refuses.
Verifier and pre-write commit failures after a competing cancellation preserve
that exact winner and add no qualification fact or retry.

Fibers are child/scoped. Services and TestClock are composed together and
provided once at the test boundary; helpers do not provision services or run a
runtime. No sleeps. A two-second outer live-clock timeout detects deadlocks only;
it does not drive the successful race schedules.

## TDD And Sensitivity

Behavioral RED preceded decision/commit implementation, not just import failure:

| Stage                                                        | Actual result                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Refusing scaffold, initial coordinator tests                 | 1 pass, 23 fail, 23 assertions; happy path expected Qualified, got Refused/RunNotFound                           |
| Load/preflight/verifier-only scaffold, entered-barrier races | 1 pass, 6 fail, 22 assertions; expected Conflict/DeadlineExpired/tagged commit error, got InvalidReceipt refusal |
| Full focused GREEN                                           | 31 pass, 0 fail, 130 assertions                                                                                  |
| Final engine suite after coverage refinement                 | 55 pass, 0 fail, 201 assertions                                                                                  |

The initial combined scaffold run was interrupted while verification entry never
occurred. A TestClock-internal timeout could not advance; moving the deadlock
guard outside provision fixed that test construction issue before the observed
race RED above. Initial unwrap/mutation assertions were also strengthened to
assert the missing outcome first. Neither incidental error is presented as proof
of a working race.

Additional independent temporary production mutations were observed to fail,
then restored before all acceptance gates:

| Mutation                                           | Focused control                   | Actual failure                                                                           |
| -------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| Expose request contract instead of structuredClone | `-t 'shrink authoritative'`       | 0 pass, 1 fail, 25 filtered, 1 assertion; incomplete lint-only receipt wrongly Qualified |
| Reuse initialTime instead of final clock           | `-t 'deadline\|receipt arriving'` | 0 pass, 3 fail, 30 filtered, 3 assertions; all late results wrongly Qualified            |
| Hard-code expectedRevision 7                       | `-t 'noncanonical'`               | 0 pass, 1 fail, 25 filtered, 1 assertion; revision-41 run wrongly Conflict               |

These post-TDD controls establish sensitivity; they do not replace initial RED.
Local inference/literal typing and lint-style findings were resolved without
exceptions. No dependency declaration failures or parked self-review findings.

## Acceptance Gate

Run from the root. Before EACH command inherit only PATH, HOME and TMPDIR:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" <command>
```

Executed sequentially, in this order, with no skipped/cached suites. Moon tasks
retain cache false, retryCount 0, envFile false, and Bun no-env-file/no-install.

| Command                                          | Exit | Observed output                                                                                               |
| ------------------------------------------------ | ---: | ------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile --ignore-scripts` |    0 | Checked 124 installs across 178 packages (no changes)                                                         |
| `bun run check`                                  |    0 | 0 warnings, 0 errors; 40 source/test files, 210 total lint rules; all 64 matched files formatted in code gate |
| `moon run domain:typecheck --force --no-actions` |    0 | tsc --noEmit; 1 task completed                                                                                |
| `moon run engine:typecheck --force --no-actions` |    0 | tsc --noEmit; 1 task completed                                                                                |
| `moon run probe:typecheck --force --no-actions`  |    0 | tsc --noEmit; 1 task completed                                                                                |
| `moon run domain:test --force --no-actions`      |    0 | 119 pass, 0 fail, 407 assertions, 4 files                                                                     |
| `moon run engine:test --force --no-actions`      |    0 | 55 pass, 0 fail, 201 assertions, 4 files                                                                      |
| `moon run probe:test --force --no-actions`       |    0 | 36 pass, 0 fail, 104 assertions, 7 files                                                                      |
| `git diff --check`                               |    0 | No output                                                                                                     |

Aggregate: **210 tests, 712 assertions, 0 failures across 15 files**.
The documentation follow-up adds this one matched Markdown file (65 format
matches), without changing the tested code/lock. Its full sequential gate is
recorded separately in the local scratch report
`.superpowers/sdd/2026-10-18-qualification-gate/task-4-report.md`, which preserves full
outputs of both runs, RED/GREEN details and controlled-entry assertions. It is
ignored coordination evidence, not a substitute for the durable identities here.
The controller subsequently reran all nine commands independently at
`e7d9d25ade69f5351d9ad64336afbea81c0cd293`: the same 210 tests, 712 assertions
and 93,000 primary cases passed, with 65 format matches, all 141 Effect rules at
error and unchanged external dependency cohort. These are controller results,
separate from the historical implementer gates preserved above.

## Property Budgets

Every primary law below runs 1000 cases at EACH seed 0, 1 and 163: 3000 cases per
law per complete domain suite. Common options are size 50, maxShrinks 1000 and
maxDiscards 10000. Generated sequences have at most 50 entries; fixtures are
fresh/coherent and successful branches are asserted, not rejected-only inputs.

| Property                                      | Seed 0 | Seed 1 | Seed 163 |
| --------------------------------------------- | -----: | -----: | -------: |
| Evidence: coherent complete receipt           |   1000 |   1000 |     1000 |
| Evidence: distinct runId                      |   1000 |   1000 |     1000 |
| Evidence: distinct attemptId                  |   1000 |   1000 |     1000 |
| Evidence: distinct generation                 |   1000 |   1000 |     1000 |
| Evidence: distinct candidateDigest            |   1000 |   1000 |     1000 |
| Evidence: distinct contractId                 |   1000 |   1000 |     1000 |
| Evidence: distinct contractDigest             |   1000 |   1000 |     1000 |
| Evidence: MissingCheck                        |   1000 |   1000 |     1000 |
| Evidence: DuplicateCheck                      |   1000 |   1000 |     1000 |
| Evidence: UnknownCheck                        |   1000 |   1000 |     1000 |
| Evidence: Failed                              |   1000 |   1000 |     1000 |
| Evidence: NotRun                              |   1000 |   1000 |     1000 |
| Evidence: permutation                         |   1000 |   1000 |     1000 |
| Run: coherent acceptance and preserved fields |   1000 |   1000 |     1000 |
| Run: distinct runId                           |   1000 |   1000 |     1000 |
| Run: distinct attemptId                       |   1000 |   1000 |     1000 |
| Run: distinct generation                      |   1000 |   1000 |     1000 |
| Run: distinct candidateDigest                 |   1000 |   1000 |     1000 |
| Run: distinct contractId                      |   1000 |   1000 |     1000 |
| Run: distinct contractDigest                  |   1000 |   1000 |     1000 |
| Run: MissingCheck                             |   1000 |   1000 |     1000 |
| Run: DuplicateCheck                           |   1000 |   1000 |     1000 |
| Run: UnknownCheck                             |   1000 |   1000 |     1000 |
| Run: Failed                                   |   1000 |   1000 |     1000 |
| Run: NotRun                                   |   1000 |   1000 |     1000 |
| Run: deadline                                 |   1000 |   1000 |     1000 |
| Run: invalid explicit time                    |   1000 |   1000 |     1000 |
| Run: cancellation terminality                 |   1000 |   1000 |     1000 |
| Run: terminal phases                          |   1000 |   1000 |     1000 |
| Run: permutation                              |   1000 |   1000 |     1000 |
| Run: bounded sequences                        |   1000 |   1000 |     1000 |

Total: **31 laws, 93,000 primary evaluations per full domain run**, separate from
Bun tests/assertions. The 3000-call lazy-execution control and intentionally
false/shrinking/exhausted/replay/defect/interruption checks are not counted as
primary laws, nor are repeated gates summed to inflate the totals.

The current suite passes actual Falsified/shrinking/replay-coordinate diagnostic,
Exhausted, ReplayMismatch, exact-run-count, false-law, defect and interruption
controls. Earlier measured task reports record a permissive validator mutation
falsifying 11 evidence laws, plus separate generation-binding/cancellation-guard
mutations each falsifying after 1 run and 10 shrinks with identical diagnostic
replay. Their readable shrunk generation-zero/cancellation-zero regressions still
pass. Those historical audits are not claimed as new Task 4 executions. Replay
tokens depend on pinned Effect 4.0.5 and are not upgrade-stable evidence.

## Proof Boundaries

| Evidence                                    | What it establishes                                                                       | What it does not establish                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Pure domain properties and literals         | Bound identity, completeness, phase, limit preservation, explicit-time decisions          | Source/contract digest recomputation, real cost/global budget accounting                    |
| Controlled Effect interleavings and Ref CAS | Specified race outcomes, original-revision ownership, detached data, final-time refusal   | SQLite application durability, crash/host recovery, ambiguous commit reconciliation         |
| Native factory unit tests                   | Deferred native invocation, typed/native error normalization, spans, AbortSignal delivery | Actual provider termination, cancellation acknowledgement or external cleanup               |
| Existing offline probe                      | Its real local Flue/SQLite/process boundary behavior with synthetic provider              | Coordinator persistence adapter, real worker isolation, real provider/service qualification |

No CLI, worker, Docker/Flue/SQLite application adapter, artifact store, publisher,
organisation discovery, self-PR, remote or live infrastructure was added. Deadline
checking is at the final pure decision before CAS, not a real-time guarantee
about remote transaction completion. In-memory fixtures cannot qualify durable
storage, production upgrades, external cancellation or publication.

## Review Handoff

Self-review covered all new files, changed exports/fixtures, authority detachment,
inferred channels, original CAS, explicit entry barriers, no-retry counts and
restored mutations. No outstanding self-review issues. Task 4 Step 7 is now
complete: the fresh whole-branch review of
`68091929c8fd6414351194ddd8f196a584c5303b..e7d9d25ade69f5351d9ad64336afbea81c0cd293`
covered all eight commits, the approved spec/plan and all four task contracts.
It found no actionable issues at any severity, with no parked/deferred findings.
The exact reviewed head includes tested code
`3cda115a2d0ade81a2faecceed42dfa64deb82ee`; the code and lock identities above
are unchanged. The independent controller gate at the reviewed head passed all
nine prescribed commands with the measured totals recorded above.

Review exclusions are accepted as the approved synthetic-only limits, not new
proved capabilities or deferred defects; the Proof Boundaries above remain in force.

The local review and controller execution records are `final-review.md` and
`controller-gate.md` under `.superpowers/sdd/2026-10-18-qualification-gate/`.
This closure changes documentation only on local `codex/qualification-gate`;
main remains `68091929c8fd6414351194ddd8f196a584c5303b`. No merge, push,
publication or deployment was performed or authorized by review acceptance.
The controller owns one further scoped review of this documentation-only closure;
that review is not claimed complete here. Integration remains owner-controlled.
