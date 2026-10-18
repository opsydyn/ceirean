# Qualification Gate Tracer

Status: conversational design approved on 2026-10-18, including a preference for
property-based tests. Written spec pending owner review. No implementation plan,
package scaffolding, dependency changes or product implementation authorised by
this document.

## Intent And Baseline

Prove that Leviathan's domain and application boundaries cannot qualify the wrong
candidate, accept incomplete verification, or overwrite cancellation with a late
result. This is the first application tracer, not a migration service deployment.

The compatibility work is integrated locally on `main` at `6809192`. Its 36 tests
and 104 assertions qualify the documented offline probe only. This spec follows
[accepted ADR-0001](../../decisions/0001-adopt-effect-and-domain-boundaries.md)
without approving the broader
[service architecture draft](2026-10-18-internal-upgrade-service-design.md).

## Scope And Alternatives

Choose one qualification-gate use case backed by in-memory test ports. Pure domain
rules alone would miss service ownership and commit races. Implementing the full
manual workflow now would introduce unapproved worker, persistence, credential
and execution-policy decisions.

Start with an already frozen run and its trusted verification contract in the
repository fixture. Finish with qualification, a refusal, a commit conflict or a
typed operational failure. Do not implement intake, baseline evaluation, candidate
generation or retry admission. A test fixture may apply pure cancellation or
attempt-replacement decisions to simulate a competing writer.

No CLI, Flue adapter, real provider, Docker worker, SQLite application adapter,
artifact store, publisher, remote, scheduled service, global budget reservation
or real consumer migration is included. Do not import production decisions from
the compatibility fixture or expand that fixture into the application.

Organisation discovery and configuration self-PRs are a later
[roadmap item](../../roadmap.md), not an extension of this tracer.

## Ownership And Files

The following paths are proposed implementation boundaries, not files to scaffold
while reviewing this spec:

| Area                                     | Responsibility                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `packages/domain/src/identities.ts`      | Validated identities, digests and numeric constraints                    |
| `packages/domain/src/verification.ts`    | Contract and receipt data; pure evidence validation                      |
| `packages/domain/src/upgrade-run.ts`     | Immutable states, commands, facts and qualification decisions            |
| `packages/domain/tests/`                 | Property-based domain laws and explicit boundary examples                |
| `packages/engine/src/ports.ts`           | `RunRepository` and narrow `CandidateVerifier` Context.Service contracts |
| `packages/engine/src/run-coordinator.ts` | Qualification sequencing, explicit clock reads and commit handling       |
| `packages/engine/tests/`                 | In-memory adapters, controlled races and operational-failure checks      |

The engine depends on the domain, never the reverse. Domain decisions perform no
I/O, read no ambient time/environment and execute no Effects. Schema, Data and
Result utilities may describe pure data. Expected refusals are return values;
repository and verifier operational failures are tagged Effect errors.

`CandidateVerifier` is the narrow trusted verification capability needed by this
tracer, not another workflow engine or a live worker implementation. Compose test
Layers once at the exported test boundary. Helpers consume services directly;
they must not provision live dependencies or assemble a runtime per operation.

## Run And Receipt Contract

Model phase-specific data as a discriminated union, not independent booleans.
This slice needs frozen, qualified and cancelled states. An attempt replacement
has a new attempt identity/generation and repository revision. Earlier workflow
phases remain outside this tracer.

Every run carries its run identity, attempt identity, generation, frozen candidate
digest, verification-contract identity/digest, original absolute deadline, spent
amount and repair count. Repository revision is an optimistic concurrency token,
distinct from attempt generation. Validate non-empty identities, non-negative
safe-integer counters/timestamps and SHA-256 digest shape at boundaries; never
accept NaN, Infinity, fractional counters or unsafe integers. No budget defaults
or reset-on-read behaviour is introduced.

The repository owns the trusted contract: a non-empty set of unique required
check identities and its pinned acceptance identity. That contract identity binds
the repository/base, profile, policy, toolchain and harness selected for the run.
For this tracer these are synthetic reviewed fixtures: digest recomputation from
real source or contract files is not implemented or claimed.

A receipt contains run identity, attempt identity, generation, candidate digest,
contract identity/digest, and concrete check results. A check result has one
identity and a `Passed`, `Failed` or `NotRun` outcome. Qualification requires exact
identity matches and exactly one `Passed` result for every required check.
Missing, duplicate, unknown, failed or unrun checks refuse qualification. Array
ordering alone must not change the decision. Invalid receipt shape is a refusal,
not a transient operational error.

The caller requests qualification by run identity; there is no caller-supplied
receipt argument. Only the trusted verifier port supplies receipt data, decoded
at the application boundary before pure validation. A model-written message or
structurally valid arbitrary object does not acquire verifier authority. Type
brands and schemas validate data, not provenance. These tests establish this
application capability boundary, not security against a compromised trusted
adapter or actual Flue tool exposure, which remains future work.

## Execution And Atomic Commit

1. Load the run, trusted contract and repository revision. Missing, cancelled or
   already qualified runs produce a refusal without invoking the verifier.
2. Read the clock and refuse if the original deadline has expired. The pure rule
   receives an explicit `nowMs`; `nowMs >= deadlineMs` is expired.
3. Invoke the verifier with the loaded run/attempt/generation, exact candidate
   digest and trusted contract, not caller-controlled acceptance conditions.
4. Decode the receipt, read time again, validate evidence and apply the pure
   decision. Refuse a result arriving at or after the original deadline.
5. Commit the new state and its `RunQualified` fact atomically against the
   original repository revision. A successful commit increments revision once;
   the state and fact cannot become visible separately.

The repository port's conditional commit must check the expected revision in the
same atomic operation that updates state and history. An in-memory adapter must
model that contract atomically, not as a read followed by a later write. A failed
compare-and-swap returns a conflict value; it must not write or append a fact.
Every competing cancellation/replacement commit also changes revision.

Cancellation or replacement while verification is suspended therefore wins if it
commits first; the old result cannot overwrite it. Two overlapping qualifications
may run verification twice, but at most one commits for a revision. No automatic
retry or re-verification occurs after refusal, conflict or operational failure.
Admission deduplication and durable operation intents remain future work.

The pure decision preserves rejected-state identity and emits no facts on
refusal. Successful qualification changes only the phase and qualification
evidence/fact; it preserves deadline, spend, repair count, attempt and frozen
identities. Refusals and operational failures do not alter state/history in the
absence of another writer. A conflict preserves the competing writer's changes,
not the stale snapshot. Existing qualified runs refuse repeat qualification
without another verifier call or qualification fact.

Do not hold a repository lock while awaiting verification. This slice prevents
late-result acceptance; it does not claim to abort a real verifier or confirm
external cleanup. Deadline checking occurs at the final decision before the
conditional commit; it is not a real-time guarantee about when a future remote
transaction completes. Production adapters must separately specify ambiguous
commit outcomes and durable reconciliation before adoption.

## Property-Based Testing

Prefer properties for domain laws, using the pinned Effect 4.0.5 built-in
`Arbitrary` API rather than adding fast-check or another property runner.
Derive generators from schemas with `Arbitrary.schema`; use composition for
dependent receipt/run pairs and bounded command sequences. This API is marked
unstable upstream, so replay tokens are tied to the exact Effect version.

The installed API was sanity-checked while writing the spec: a Boolean property
returned `Passed` for 20 runs, and an intentionally false property returned
`Falsified` with a replay token and formatted diagnostic. This verifies API
availability only; no qualification properties have been implemented or run.

Use per-check options, not process-global configuration. For each pure domain
property, run 1,000 cases for each seed `0`, `1` and `163`, with `size: 50`,
`maxShrinks: 1000` and `maxDiscards: 10000`. Bound generated command sequences to
50 entries. Make fixtures coherent by construction rather than relying on large
filters that mostly discard inputs. Create a fresh fixture per evaluation;
generated values and shared services must not leak mutation between shrink runs.

Properties return Boolean results or typed failing Effects so counterexamples
can shrink. A test passes only on `Passed` with the requested run count;
`Falsified`, `Exhausted`, `ReplayMismatch`, defects and interruption fail the test.
Report `Arbitrary.formatCheckFailure`, replay coordinates and the exact dependency
version. Preserve a discovered counterexample as a readable regression example;
do not rely on unstable replay tokens surviving an upgrade.

Required properties:

- Coherent, unexpired frozen runs with exact complete passing receipts qualify.
- Changing any bound identity to a distinct valid value refuses qualification.
- Missing/duplicate/unknown check identities or any non-passing result refuse.
- Permuting complete unique check results preserves the decision.
- Cancelled states and old-generation receipts never qualify, including generated
  bounded cancellation/replacement/receipt sequences.
- Every refusal preserves state identity and produces no facts; every successful
  decision preserves original limits and frozen identities.
- Qualification cannot succeed at or beyond the explicit deadline.

Include valid-case generators and near-valid mutations so the suite cannot pass
vacuously by generating only rejected inputs. Expected outcomes must follow
independent laws or literal fixtures, not call the decision function to compute
their own expected result. Sequence properties must not duplicate the production
transition algorithm as their oracle.

## Deterministic Acceptance Tests

Property tests complement, not replace, readable examples and deterministic
application interleavings. Cover exact deadline equality, malformed identities
and numbers, empty contracts, repeated qualification, each mismatch dimension
and each non-passing/malformed evidence class explicitly.

Use controlled Effect barriers, not sleeps, to pause verification and commit
cancellation or replacement first. Assert the returned conflict and the actual
retained state/history. Race two qualifying operations and assert one commit and
one qualification fact. Inject verifier and repository-read/commit failures;
assert tagged operational errors, no retry and no write by the failed operation.
Prove missing/cancelled/expired/already-qualified runs do not invoke the verifier.
Use narrow interaction assertions only for these owned no-call/no-retry contracts.
Inject in-memory commit failures before the atomic write, not after a successful
commit; do not infer real-database post-commit error semantics from these fixtures.

Seed-only randomness cannot substitute for the explicit race schedules. The
in-memory adapter proves its port contract, not SQLite transactions or recovery.

## Toolchain And Acceptance Gate

Keep Bun 1.4.2, Effect 4.0.5, Moon 2.5.4, TypeScript 7.0.2 and bun-types 1.4.2.
Node 24.15.0 remains developer tooling only. Retain oxlint 1.88.0, oxfmt 0.73.0
and all 141 Effect 4 rules from @opsydyn/oxlint-effect 2.0.1 at error. No rule
disables, blanket source/test ignores, Alchemy dependency or new workflow engine.
The probe-local vendor declaration exception must not silently become a new
package's policy. No dependency installation is authorised at spec-writing time.

The later implementation plan must define private package exports, exact service
signatures and rejection tags, fixture generators, package/Moon tests and strict
typecheck targets. Keep one root lockfile. Run existing probe tests plus both new
package suites, full lint/format and source typechecks; Moon evidence tasks remain
uncached with zero retries and no automatic dotenv/dependency loading. Record
property case counts separately from Bun test counts. A green gate for this
tracer is not qualification of a real upgrade or the full service architecture.

## Review And Next Step

This spec captures the approved two-part conversational design and the owner's
property-based testing preference. Implementation remains gated on review of this
written spec, then a separate implementation plan and execution-method selection.
Do not create packages or implement the tracer while either review is pending.
