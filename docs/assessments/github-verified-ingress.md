# Bounded Verified GitHub Ingress

Task 5 of the [offline admission plan](../superpowers/plans/2026-10-20-github-admission.md)
is separately approved after the [native SQLite inbox](github-sqlite-inbox.md).
Initial candidate `2c06dc1` passed full controller gates, but independent review
found an owned-reader-lifetime gap under asynchronous cancellation. Correction
`f5b96ba` passes repeated full gates and clean scoped re-review. Task 5 is
complete; this is not whole-plan acceptance.

## Intended Boundary

The private probe captures a bounded original request body, computes its digest,
and sends unchanged bytes through the real Flue GitHub channel verifier.
Application normalization accepts only exact `/leviathan assess` comments created
by matching human sender/author identities on ordinary issues. Signature validity
does not grant permission: the separate trusted local authority fixture remains
the source of admission policy.

One exported application boundary owns the scoped SQLite inbox and inferred
admission service on one ManagedRuntime. It has in-process `fetch` and explicit
idempotent disposal, not a listener. Each request owns its body/digest context;
no global latest-delivery state or per-request runtime is permitted.

Expected ignores and business refusals remain explicit values. Operational
capture, storage or callback failures must not become default empty HTTP success.
Recorded duplicates refer to the original decision and do not claim fresh
authorization or start work. Cancellation after a synchronous commit does not
undo that record.

## Acceptance Record

The implementer reports 86 focused tests / 314 assertions, strict probe types and
root lint/format passing. The report distinguishes initial missing-module RED
from later behavioral failures and their fixes: disposed-state classification,
field-size status mapping, lifecycle evidence and SDK exception logging. These
author-run results are not independent acceptance.

Tests use the real installed verifier and native file-backed SQLite. They cover
original-byte digest correlation, signature tampering, protocol/field limits,
local authority denial and revision changes, historical replay, transaction
failure, overlapping request barriers and cancellation before and after commit.
Lifecycle tests count runtime/native acquisition and disposal and preserve finite
primary/cleanup failure evidence. Trusted authority, clock, secrets, fault hooks
and stream schedules remain synthetic fixtures.

Fail-closed fetch/listener spies surround composed ingress tests. Their zero-call
assertions and inspection of rows, responses and logs are bounded no-work and
sanitization evidence, not universal network containment. Existing engine barrel
exports include worker/coordinator definitions; the composed call path does not
invoke them. Domain, engine, existing native adapter, dependency and lint-policy
diffs remain empty against the Task 4 closure.

Controller-observed sequential gates pass in the specified minimal environment:

| Gate                               | Result                                      |
| ---------------------------------- | ------------------------------------------- |
| Root lint/format                   | 0 warnings/errors; formatting clean         |
| Four uncached workspace typechecks | Pass                                        |
| Domain tests                       | 201 pass / 768 assertions                   |
| Engine tests                       | 273 pass / 1526 assertions                  |
| Existing Flue probe                | 36 pass / 104 assertions                    |
| GitHub/native probe                | 125 pass / 1726 assertions                  |
| Total                              | **635 pass / 4124 assertions**, no failures |
| Frozen installation and whitespace | Pass                                        |

The GitHub probe contains 86 new deterministic cases and 39 existing channel/native
cases. The prior 30000 generated admission cases remain unchanged; repeated
executions do not add to that primary-case budget. All 141 Effect rules remain
enabled and all four workspaces resolve one physical Effect 4.0.5 instance.
Lock SHA-256 remains
`a03b2f20874301814ba165f945b3fa55df5f20023f29ba5b873f3d16537cadc3`.
No existing qualification or worker source changed. Independent review found that
`Effect.tryPromise` interruption could complete before JavaScript cleanup awaited
an asynchronous `reader.cancel()`. The original synchronous tests did not answer
that schedule, despite the first candidate's 632 passing tests / 4103 assertions.

The correction uses `Effect.acquireUseRelease` to own acquisition, use and release.
Its interruption-safe release awaits memoized cancellation and attempts lock
release on both settlement paths. New held-cancel barriers prove disposal and
response stay pending while cancellation is held, then complete with the reader
unlocked. Resolving and rejecting cancellation are tested; combined primary and
cleanup failures retain finite sanitized evidence. The report preserves the
behavioral RED and subsequent GREEN. The table above describes repeated controller
gates for corrected `f5b96ba`. Scoped re-review closed the original finding with
no new Critical, Important or Minor findings. Controller execution evidence and
reviewer inspection remain separately attributed; no CI or live claim follows.

A cancellation that never settles deliberately keeps disposal pending. No new
teardown deadline, production availability or abuse-resistance guarantee is
claimed by this ordering fix.

The fixed local protocol distinguishes transport acknowledgment from admission:

| Outcome                                       | HTTP |
| --------------------------------------------- | ---- |
| Recorded preview or recorded business refusal | 200  |
| Historical duplicate or explicitly ignored    | 200  |
| Malformed payload or metadata                 | 400  |
| Missing, invalid or tampered signature        | 401  |
| Identity/revision conflict or inbox capacity  | 409  |
| Body or field exceeds its finite limit        | 413  |
| Unsupported media type                        | 415  |
| Storage or unexpected operational failure     | 503  |

Body capacity is 65536 bytes; comment bodies are limited to 4096 UTF-8 bytes.
Metadata IDs use the existing 128-byte bounds and display names 255-byte bounds.
No automatic storage retry or eviction is introduced. Tests must distinguish
pre-admission cancellation from a response lost after a committed record.

## Limits

This is an offline fixture harness. It does not establish process-kill recovery,
power-loss durability, host-loss recovery, distributed coordination, production
retention or exactly-once execution. Task 6 remains pending separate approval.
No listener, live GitHub credentials/permission retrieval, outbound API client,
model/provider, agent dispatch, coordinator, worker allocation or publication is
authorized. No merge or push is included.
