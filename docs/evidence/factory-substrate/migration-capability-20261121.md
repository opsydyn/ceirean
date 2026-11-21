# Migration Capability: Where Slice 4 Got To

Recorded 2026-11-21. Slice 4 of
[the vendoring design](../../superpowers/specs/2026-11-21-factory-substrate-vendoring-design.md).
**Delivered.** The pure core, the sandbox port and the Effect capability that
drives them are all in, under 25 tests. The capability was withdrawn once
before landing; why, and what it cost, is recorded at the end rather than
tidied away.

## What Was Already There

The slice was planned as "the migration capability and the acceptance contract
in Effect". The acceptance contract was already built, and well:

| Concern                                | Where it already lives                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Which checks a candidate must pass     | `VerificationContract` in `packages/domain/src/verification.ts`                                          |
| What a receipt of those checks is      | `VerificationReceipt`, carrying the candidate identity                                                   |
| Whether a receipt is acceptable        | `validateReceipt`, with fixed refusal precedence over duplicate, unknown, missing and non-passing checks |
| Whether a run may be qualified         | `decideQualification` in `upgrade-run.ts`, over `UpgradeRun` with deadline and phase gates               |
| That something must produce a receipt  | the `CandidateVerifier` port in `packages/engine/src/ports.ts`                                           |
| Loading, deciding and committing a run | `qualifyRun` in `run-coordinator.ts`                                                                     |

So the contract did not need writing. What was missing was the middle: nothing
turned a contract's required checks into commands, ran them, and turned what
happened back into a receipt. Every existing test stubs `verify` directly.

## What Is Now In

**`packages/engine/src/verification-plan.ts`** — the pure core.

A `VerificationPlan` is an ordered list of steps, one per required check, each
a single command with a timeout bounded by the same 1,800-second ceiling the
vendored sandbox uses. It holds no policy: `validatePlan` refuses a plan that
names a different contract, or whose steps are not exactly the contract's
required checks, before anything runs. A candidate therefore cannot be
qualified by a plan that quietly omitted a check.

`projectReceipt` turns observed step results into a receipt the domain can
judge. A zero exit is `Passed`; a non-zero exit and a killed command are
`Failed`; a step the run never reached is `NotRun`, which the contract refuses.
The projection is strict: results must line up with the plan one for one and in
order, or it refuses. A projection that tolerated a short or reordered list
would be deciding, on its own, what happened to the steps it could not account
for, and the domain would then be judging a receipt that was partly invented.

**`packages/engine/src/migration-sandbox-port.ts`** — the seam.

A prepared checkout that runs one bounded command at a time and is always torn
down. Deliberately narrower than the vendored module it will be implemented
over: no agent tools, no skill mount, no push path, no branch handling. A port
mirroring its implementation would make the fake as complicated as the real
thing and prove nothing. Three decisions are recorded in it: a non-zero exit is
a result rather than a failure, exit code 124 is read as a timeout because that
is what `timeout -k 5` reports and what the vendored sandbox wraps every command
in, and `release` cannot fail, because teardown that can fail is teardown that
gets skipped.

## Evidence

`packages/engine/tests/verification-plan.test.ts`, 17 tests:

- A plan covering exactly the required checks is accepted.
- Two cases for a plan naming another contract, by id and by digest.
- Three coverage refusals: duplicate, unknown, missing.
- Four outcome mappings: zero exit, non-zero exit, killed command, step never
  reached.
- A halted run reports the rest as `NotRun`, never as `Passed`.
- Four projection refusals: unexpected, missing, duplicate and out-of-order
  results.
- One property law under the house harness (seeds 0/1/163, 1000 runs): across
  every combination of pass, fail, timeout and skip over a three-step plan, a
  candidate qualifies **exactly** when every planned check completed with a
  zero exit. The law runs `projectReceipt` into the real
  `decideQualification`, so it tests the join between this module and the
  domain rather than this module alone.

The law was verified non-vacuous by falsifying it and confirming the harness
reported a shrunk counterexample and a replay seed.

Gates: oxlint, oxfmt over 690 files, 14 typechecks, 17 test tasks, engine at
351 passing.

## The Capability

`packages/engine/src/sandbox-verifier.ts` composes the two. `makeSandboxVerifier`
takes a plan resolver — a pure function, so plan selection cannot do I/O behind
the contract's back — and yields a service with one method.

The three properties it exists to hold:

1. **The plan is validated before the sandbox is touched.** A resolver that
   returns a plan naming another contract, or one missing a required check, is
   refused with no `prepare` call and no command run. Two tests assert the
   sandbox log is empty in those cases, which is the only way to show the order
   rather than assert it.
2. **Steps stop at the first failure.** The fold carries a `halted` flag; a
   halted step contributes `Skipped` without executing. The test for this
   asserts on the _commands the sandbox was asked to run_, not just on the
   receipt: a third command must never appear after the second exits non-zero.
3. **The sandbox is released on every path.** `Effect.acquireRelease` owns it,
   so a command that fails outright still releases — asserted by scripting the
   fake's `exec` to throw and checking the log shows one prepare and one
   release.

A plan refusal is returned as a value, not raised: it is a decision about
evidence and the caller records it. Only a sandbox that could not be used at
all becomes a `CandidateVerifierError`, carrying the run id, which is why
`MigrationSandboxError` holds one.

`packages/engine/tests/fake-sandbox.ts` is the scripted driver: it records what
it was asked to do, answers with exit codes a test chose, and can be told to
refuse `prepare` or `exec`. It runs no commands, so a test can state what a
failing second check does to the third without owning a container.

`packages/engine/tests/sandbox-verifier.test.ts`, 8 tests: order and release on
a passing run, the receipt a passing run produces, halting at the first
failure with the remaining command never issued, a killed command counting as
failed, a foreign plan and an incomplete plan both refused before the sandbox
is touched, a sandbox that cannot be prepared surfacing as an operational
failure rather than a refusal, and release after an outright command failure.

Engine totals: 359 passing, up from 351.

## What The Withdrawal Cost

The capability typechecked on the first attempt and was deleted rather than
committed, because it violated seven of this repository's Effect lint rules and
I was discovering them one round trip at a time. Landing it took knowing one
thing, which is now written down:

> The accepted shape for a function that produces an Effect is a named
> generator, then **one** const, then `return thatConst.pipe(...)`. Not
> `return Effect.gen(g).pipe(...)` — the const must exist. Not
> `const a = ...; const b = a.pipe(...); return b;` — one const, not two.
> `live-admission-service.ts` and `run-coordinator.ts` are both exactly this.

Everything else followed from reading those two files rather than from
negotiating with the linter: decisions computed into values before any
pipeline, `Match`/`Option.match` branches holding single expressions,
zero-argument nested generators closing over scope instead of
`Effect.gen(() => f(a, b))` towers, and `Effect.provide` at the test boundary
rather than inside a helper.

Two rules deserve naming because they contradict Effect's own documentation,
which recommends `Effect.fn`: `no-effect-fn-generator` forbids it, and
`no-manual-effect-channels` forbids the explicit `Effect.Effect<...>` return
types its examples use. Neither is wrong as a house rule; both are surprising
if you arrive from the upstream docs, as I did.

## Wired To The Coordinator

`qualifyRun` now drives the capability. The join needed one decision, because
the `CandidateVerifier` port promises `unknown`: a verifier may be any
implementation, and the coordinator decodes whatever arrives.

That is honest but lossy. A capability that refused before running anything —
because the plan did not cover the contract — has something specific to say,
and an undecodable receipt would reach the domain as a bare `InvalidReceipt`.
Three options were open: conflate the refusal with an operational failure
(wrong — it is a decision about evidence, not a broken verifier), let it arrive
as `InvalidReceipt` (loses the reason), or change the port to return a proper
union (correct, and it rewrites all eighteen existing verifier stubs for a
seam with no production caller yet).

`verifier-reply.ts` takes the fourth path: it narrows the port's `unknown` in
exactly one direction. A reply may be a plan-refusal envelope; anything else is
a receipt, decoded exactly as before. No existing verifier changed, no stub
moved, and `QualificationOutcome` gained the plan refusal alongside the
domain's own refusals and `RunNotFound`, which it already carried. The module
says in its own comment that the `unknown` is the real wart and that the port
should take a union when a second real verifier exists.

`candidateVerifierFromSandbox` is the adapter: a projection hands over the
receipt itself, a refusal travels as the envelope.

`packages/engine/tests/coordinator-sandbox.test.ts`, 3 tests, and these are the
ones that matter most in the slice because nothing before them showed the two
halves joined:

- A run qualifies on evidence the sandbox produced, with all three commands
  issued in order and the sandbox released.
- A failing check refuses the run with **the domain's** reason —
  `IncompleteVerification / NonPassingCheck` — not with anything the capability
  decided, and the third command never issues.
- A plan refusal reaches the outcome as `PlanCoverage / MissingCheck` naming
  the absent check, with the sandbox never prepared.

Engine totals: 362 passing.

## Still Ahead

No real sandbox implements the port. The vendored module is the obvious
implementation and connecting them needs a container, which is its own
approval. Until then the capability is exercised only against the scripted
fake, and nothing in this repository has run a real migration.

## A Pre-Existing Fragility Worth Naming

`migration-storage:test`'s native refinement law is budgeted at 180 seconds and
takes about 144 standalone on this machine. Under the full suite's parallel
load it exceeded the budget and failed once during this slice, then passed on
its own. It is not caused by anything here — the law predates this work — but
the headroom is thin enough that added load tips it, and the budget or the run
count is a decision someone should take deliberately rather than discover.
