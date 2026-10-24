# Offline Admission And Evidence Budgets

Task 2 of the [hosted executor plan](../superpowers/plans/2026-10-24-hosted-executor.md),
2026-10-24. Local contract qualification only; hosted activation remains blocked.

## Delivered

- Strict request/manifest schemas for the fixed source revision and six operation
  names. No arbitrary argv, consumer instructions, caller-selected sandbox IDs,
  extra fields or expanded byte budgets are admitted. Offline manifests cannot
  claim enabled activation, feasibility or verified content integrity.
- Pure `admit(request, session)` proposals plus an Effect Ref-backed gate that
  atomically owns one process-local reservation. Identical retries return the
  existing reference, even after expiry; they never authorize another start.
  Conflicting ID reuse and other work while occupied are refused. No release or
  reset method is exposed before cleanup is coupled to lifecycle ownership.
- New reservations must fit both the execution deadline and the full 900000ms
  cleanup reserve. Exact boundary equality is accepted; one millisecond over is
  refused. A recorded expired-session clock cannot be moved backwards to admit
  fresh work. The controller supplies clock observations, not the request body.
- Snapshot-bound evidence metering: per-command output cap 10485760 bytes and
  combined output/reserved-artifact cap 536870912 bytes, optionally lowered by
  the owner. Artifact reservations count their full declared size before chunks
  arrive; simultaneous reservations cannot oversubscribe the shared cap.
- Flat safe artifact names, File entries only, unique names, strict metadata,
  claimed SHA-256 syntax and explicit completeness checks. Failed collection is
  sticky; sealing prevents later changes. Each collector bounds artifacts and
  command metadata to 64 entries, including zero-byte entries.

Only the private probe and its documentation/test commands changed. No dependency
updates, lockfile churn, lint exceptions or declaration-check exceptions.

## Evidence And Scope

Initial tests observed missing request/manifest, admission and metering behavior
before implementation. Two focused admission regressions were observed red then
green: reopening an expired empty session by reversing the clock, and an exact
retry after expiry failing to resolve its existing reservation.

The probe has 47 tests / 829 assertions after this slice. Effect-native laws add
three seeds (0, 1, 163) x 100 cases each for admission deadlines and chunk-budget
prefixes: 600 new generated cases. Existing path laws contribute another 600.
Boundary tests meter 512 MiB using a reused 1 MiB buffer, not a retained 512 MiB
allocation. Tests also cover races, input mutation, exact byte caps plus one,
64/65 metadata counts, duplicate command IDs and aggregate manifest overflow.

Independent review found no actionable correctness issue in the authorized
offline scope. Its two supplemental coverage suggestions (metadata-count bounds
and malformed/oversized manifests) were added and pass. No hosted security,
payload-handling or cleanup qualification is claimed by that review.

Final local verification:

- `bun --no-env-file run check`: lint and format pass with all rules unchanged.
- `moon run cloudflare-executor:test :typecheck`: 47 probe tests / 829 assertions
  and all 12 workspace typechecks pass. Source checking remains strict.
- `moon run :test --concurrency 1`: all 12 test tasks pass in 9m06.014s. Native
  storage completes all 3000 refinement cases in 115761.85ms, below the unchanged
  180000ms bound. The final contracts and coverage additions were in place before
  this complete run; only documentation changed afterward.
- `git diff --check`: passes.

Full-suite output is retained at
`/private/tmp/ceirean-admission-evidence-tests.log`. These are local macOS ARM64
results, not execution of the proposed Linux image or hosted provider controls.

## Deliberate Boundaries

The collector retains counts and descriptors, not payload chunks. Callers must
check each Result before forwarding bytes and must bound their own pending work
with stream backpressure. This is not a stream reader, storage sink, tar parser,
content hash verifier or proof that caller-owned upstream buffers are bounded.
Claimed digests remain unverified; finalization returns only `Blocked`, integrity
`Unverified`, cleanup `CleanupUnconfirmed` and activation `Blocked`, bound to the
constructor's request identity. Caller mutation cannot rewrite that snapshot.

Admission is not a distributed lock, durable history or substitute for the
authoritative ledger. Each gate owns one local slot, and creating a different
gate is not proof of global coordination. A replay is metadata for reconciliation,
not permission to rerun expired work. These limitations must remain explicit when
the next slice connects lifecycle ownership and simulated remote drivers.

Private authenticated invocation, final built executor digest, actual offline
payloads, browser sandbox viability, provider limits and the separately approved
cost/time/permission worksheet remain prerequisites before hosted activation.
No cloud calls, credentials, listeners, image builds, workflow pushes or deployment
were needed to implement these contracts. Main is not merged or pushed by this task.
