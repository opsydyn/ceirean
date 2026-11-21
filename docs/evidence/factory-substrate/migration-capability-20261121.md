# Migration Capability: Where Slice 4 Got To

Recorded 2026-11-21. Slice 4 of
[the vendoring design](../../superpowers/specs/2026-11-21-factory-substrate-vendoring-design.md).
**Partly delivered.** The pure core and the sandbox port are in and tested; the
Effect capability that drives them is not, for a reason worth recording rather
than hiding.

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

## What Is Not In, And Why

The Effect capability that composes the two — acquire the sandbox, fold the
plan's steps, stop at the first failure, release on every path, map a sandbox
failure to `CandidateVerifierError` — was written and typechecked, and then
withdrawn rather than committed, because it could not be made to satisfy this
repository's own Effect lint policy within the slice.

The policy is strict and, read together, quite specific about shape. It forbids
a named function or const that returns an Effect
(`no-effect-wrapper-alias`), hand-written Effect channel generics
(`no-manual-effect-channels`), `Effect.fn` generator wrappers
(`no-effect-fn-generator`, which is the opposite of what Effect's own
documentation recommends), Effect work inside `Match` or `Option.match`
branches (`no-match-effect-branch`), a decision taken inside an object literal
(`no-branch-in-object`), nested Effect construction (`no-call-tower`) and
multi-step anonymous callbacks (`prefer-extracted-concept`). The accepted shape
exists — `live-admission-service.ts` and `service-factories.ts` are both inside
it — but arriving at it by iteration cost more than the slice had, and
committing code that fails the gates was not an option.

This is a finding about sequencing, not about the design. The three properties
the capability has to hold are now written down and are what the next attempt
should be judged against:

1. The plan is validated before the sandbox is touched.
2. Steps stop at the first failure and the remainder are reported `Skipped`,
   never `Passed`.
3. The sandbox is released on success, refusal, failure and interruption alike,
   because `Effect.acquireRelease` owns it rather than the happy path.

The next attempt should start by reading `live-admission-service.ts` closely
enough to copy its shape — nested named generators, methods as object-literal
properties, decisions computed into values before any pipeline runs — rather
than writing the capability first and then negotiating with the linter.

Not started, and still ahead of it: a fake sandbox driver, tests that the
sandbox is released on every path, and the `CandidateVerifier` wiring that lets
`qualifyRun` use any of this.
