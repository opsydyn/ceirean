# Qualification Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a tested qualification gate that accepts only the exact frozen candidate and cannot overwrite cancellation or a superseding attempt.

**Architecture:** Pure domain data and decisions live in `@leviathan/domain`; an Effect coordinator and explicit service keys live in `@leviathan/engine`. Infer port shapes from real native-boundary factories, not manually declared Effect channels or test implementations. Test the coordinator with in-memory Effect-native services and atomic conditional commits; there are no live adapters.

**Tech Stack:** Bun 1.4.2, Effect 4.0.5 including Arbitrary, TypeScript 7.0.2, Moon 2.5.4, bun-types 1.4.2, existing Oxlint/oxfmt toolchain.

**Spec:** [Qualification Gate Tracer](../specs/2026-10-18-qualification-gate-design.md), owner-approved on 2026-10-18. Read both documents before implementation.

**Status:** Written plan pending owner review and execution-method selection. This commit changes documentation only. The owner explicitly rejected a lint exception: `no-manual-effect-channels` remains universal.

## Global Constraints

- Keep Bun 1.4.2, Effect 4.0.5, Moon 2.5.4, TypeScript 7.0.2 and bun-types 1.4.2.
- Node 24.15.0 remains developer tooling only.
- Retain oxlint 1.88.0, oxfmt 0.73.0 and all 141 Effect 4 rules from @opsydyn/oxlint-effect 2.0.1 at error.
- No rule disables, blanket source/test ignores, Alchemy dependency or new workflow engine.
- No handwritten `Effect.Effect<...>`/`Layer.Layer<...>`, renamed channel aliases or placeholder implementations manufactured for type inference. Real implementation return types determine service shapes.
- The probe-local vendor declaration exception must not silently become a new package's policy. New package typechecks use `skipLibCheck: false`; stop for owner review if published dependency errors block them.
- Domain decisions perform no I/O, ambient clock/environment access or Effect execution. The engine depends on domain, never the reverse.
- Start with frozen synthetic runs. No admission, paid calls, Flue/Docker/SQLite adapters, publisher, repo discovery, self-PR or real migration work.
- Expected refusals/conflicts are values. Operational failures are tagged errors. No automatic retry, re-verification or budget reset.
- Per pure property: 1,000 cases for each seed `0`, `1`, `163`; `size: 50`, `maxShrinks: 1000`, `maxDiscards: 10000`; sequences at most 50 entries. No process-global Arbitrary configuration.
- Compose services once at test boundaries. No runtime per operation, live provisioning in helpers, held repository lock across verification or unscoped test fibers.
- One root lockfile; exact Effect pins in both new private packages. No additional property-testing dependency.
- Moon evidence targets use `cache: false`, `retryCount: 0`, `envFile: false`; commands use `--no-env-file --no-install`. Run the full probe as well as new suites, sequentially, under the minimal environment already documented.
- Commit each verified task, obtain the selected review gates and recommend next steps. Do not merge/push without separate approval.

## Review Focus

1. Well-shaped but incomplete/duplicate evidence must fail, even if every supplied result says Passed: Task 1 mutation properties and literal cases.
2. Verification completing after cancellation/replacement must never overwrite the winner: Task 3 conditional-commit tests and Task 4 controlled races.
3. Numeric boundaries must not wrap revision or qualify at deadline equality: Task 1 decoder cases, Task 3 revision exhaustion and Task 4 clock advancement.
4. Mutable receipt/snapshot aliases must not retrospectively alter committed state/history: Task 3 detached-snapshot tests and Task 4 verifier-input mutation tests.
5. Exhausted generators, broken replay and invalid-only cases must not produce a green suite: Task 1 property-harness controls and positive-case properties.

## File Structure And Shared Data

Create private source-exported packages named `@leviathan/domain` and `@leviathan/engine`, each with `src/index.ts`, `package.json`, `tsconfig.json`, `moon.yml` and a `typecheck` script using `tsc --noEmit`. Root exports point to `./src/index.ts`, not unbuilt dist files. Both depend on `effect: "4.0.5"`; engine additionally depends on `@leviathan/domain: "workspace:*"`. Register Moon project IDs `domain` and `engine` as each task creates its package. Do not create `apps/cli`.

Each new Moon project has `test` (`bun --no-env-file --no-install test --timeout 30000`) and `typecheck` (`bun --bun --no-env-file --no-install run typecheck`), with JavaScript/Bun toolchains and the options above. Increase no timeout or test budget silently. Installing after approved execution begins uses `bun install --ignore-scripts`, then verifies the resulting lockfile with a frozen install. Expect only workspace entries/linkage, not a changed dependency cohort.

Use schema-derived readonly data types, not parallel manually maintained models. Fields below are the shared contract between tasks:

- Branded string schemas/types: `RunId`, `AttemptId`, `ContractId`, `CheckId`, `Digest`. IDs must be non-empty and contain non-whitespace; digests are exactly 64 lowercase hexadecimal characters.
- `NonNegativeSafeInteger`: finite integral values from 0 through `Number.MAX_SAFE_INTEGER`, for generation, revision, epoch milliseconds, spentMicros and repairs.
- `CandidateIdentity`: `{ runId, attemptId, generation, candidateDigest, contractId, contractDigest }`.
- `VerificationContract`: `{ contractId, contractDigest, requiredChecks: readonly CheckId[] }`, with at least one unique required check. The digest is supplied by the trusted fixture, not computed from real source.
- `VerificationReceipt`: CandidateIdentity fields plus `checks: readonly { checkId, outcome: 'Passed' | 'Failed' | 'NotRun' }[]`. Empty/duplicate/unknown evidence is structurally decodable so pure validation can refuse it.
- `RunLimits`: `{ deadlineMs, spentMicros, repairs }`. Fields are carried unchanged; this is not a cost-accounting implementation.
- Canonical evidence fixture: run `run-1`, attempt `attempt-1`, generation `3`, contract `contract-1`, candidate digest `'a'.repeat(64)`, contract digest `'c'.repeat(64)`, required checks `lint`, `types`, `tests`, all Passed.
- Canonical run limits: `{ deadlineMs: 1000, spentMicros: 17, repairs: 1 }`; eligible time `999`, expired time `1000`; initial repository revision `7` and empty history.

The implementation may select idiomatic Schema constructors/checks from installed Effect 4.0.5; it must not change the field names, validation semantics, evidence policy or outcome tags below.

---

## Task 1: Validated Evidence And Property Harness

**Files:** Create `packages/domain/{package.json,tsconfig.json,moon.yml}`, `src/{identities.ts,verification.ts,index.ts}`, `tests/{fixtures.ts,properties.ts,verification.test.ts,properties.test.ts}`. Modify `.moon/workspace.yml` and root `bun.lock` only for this workspace.

**Interfaces:**

- `decodeContract(input: unknown): Result.Result<VerificationContract, QualificationRefusal>` and `decodeReceipt(input: unknown): Result.Result<VerificationReceipt, QualificationRefusal>` are pure.
- `validateReceipt(identity: CandidateIdentity, contract: VerificationContract, receipt: VerificationReceipt): Result.Result<VerificationReceipt, QualificationRefusal>` is pure and returns the validated receipt on success.
- Define `QualificationRefusal` as readonly tagged data, not Error: `InvalidContract`, `InvalidReceipt`, `IdentityMismatch { field }`, `IncompleteVerification { reason, checkId }`, `InvalidPhase { phase }`, `DeadlineExpired`, `InvalidTime`. Identity fields are the six CandidateIdentity keys. Incomplete reasons are `MissingCheck`, `DuplicateCheck`, `UnknownCheck`, `NonPassingCheck`.
- Validation precedence: contract validity/binding, receipt identity in CandidateIdentity field order, duplicate checks, unknown checks, missing checks, non-passing checks. Compare sets for completeness, never array order. `checkId` identifies the first offending check in receipt order, or required-check order for missing entries.
- `makeEvidenceCase()` returns fresh `{ identity, contract, receipt }` from the literals above. Derive a coherent `evidenceCaseArbitrary` through Schema and Arbitrary composition, with unique non-empty required-check lists bounded to 8 entries.
- `checkLaw<A>(name: string, arbitrary: Arbitrary.Arbitrary<A>, law: (value: A) => boolean)` returns an inferred Effect checking all three specified seeds. It executes no runtime itself. Tests run it at their boundary; the helper imports no Bun test runtime.
- Its pure reporting seam is `validateCheckResult(name: string, seed: number, result: Arbitrary.CheckResult<unknown, unknown>, expectedRuns: number): Result.Result<void, LawFailure>`, where `LawFailure` is a tagged error carrying the property name, seed and diagnostic. The helper uses this after actual checks, not fabricated Passed values.

- [ ] **Step 1: Write failing decoder/validator tests and positive/negative properties.** Include literal assertions equivalent to:

```ts
const c = makeEvidenceCase();
expect(Result.isSuccess(validateReceipt(c.identity, c.contract, c.receipt))).toBe(true);
expect(Result.isFailure(decodeReceipt({ ...c.receipt, generation: NaN }))).toBe(true);
expect(Result.isFailure(decodeContract({ ...c.contract, requiredChecks: [] }))).toBe(true);
```

Add Boolean laws for coherent passing receipts, each distinct identity mutation, each missing/duplicate/unknown/Failed/NotRun mutation, and permutation invariance. Add explicit cases for null/arbitrary objects, whitespace-only IDs, uppercase/short digests, Infinity, fractions, negative and unsafe integers, duplicate required checks, and no supplied check results. Pin the corresponding refusal tags/reasons with literal expectations, not helper-derived expected decisions.

- [ ] **Step 2: Establish RED.** Run `bun --no-env-file --no-install test ./packages/domain/tests/verification.test.ts`. Observe failure from missing domain implementation, then each behavioural test failing against an intentionally minimal implementation before completing its branch. Do not count package-resolution errors alone as evidence that validation works.
- [ ] **Step 3: Implement the package and pure interfaces.** Use Effect Schema decoders returning Result rather than throwing or executing Effects. Keep contracts/receipts in `verification.ts` and identifier/numeric schemas in `identities.ts`. Use `Schema.brand` for identities. Export only the types/schemas/functions consumers need.
- [ ] **Step 4: Implement and test `checkLaw`.** Use `Arbitrary.schema`, composition and `Arbitrary.checkEffect`, not fast-check. Require `Passed` and the exact requested runs. Format every non-passing result using `Arbitrary.formatCheckFailure` with property name, seed and Effect version; propagate defects/interruption as failures. Obtain actual false-property and exhausted-generation results in `properties.test.ts` and feed them through `validateCheckResult`. For ReplayMismatch, capture a false property's replay token and replay it against an always-true property, then require reporting failure. A Passed result with an unexpected run count also fails. These small harness controls may use fewer runs; domain laws retain the full configured budgets. Ensure a deliberately thrown property defect fails `checkLaw`, not Passed. False Boolean laws must shrink; do not throw Bun assertions inside the property predicate.
- [ ] **Step 5: Verify.** Run `moon run domain:test --force --no-actions`, `moon run domain:typecheck --force --no-actions`, root `bun run check`, and the existing probe suite. Domain properties must execute all seeded cases, not merely construct Effects. Record property cases separately from Bun test/assertion counts. New strict typechecking must not import Flue or inherit the probe's skipLibCheck exception.
- [ ] **Step 6: Commit and review.** Stage only the listed deliverable; commit `feat: validate qualification evidence with property laws`. Review this contract before Task 2 consumes it.

## Task 2: Pure Run Decisions And Invariants

**Files:** Create `packages/domain/src/upgrade-run.ts`, `tests/upgrade-run.test.ts`, `tests/run-properties.test.ts`; extend `src/index.ts`, `tests/fixtures.ts` and `tests/properties.ts` only where shared fixtures/generators require it.

**Consumes:** Task 1 identity, contract, receipt, refusal and property interfaces.

**Produces:**

- `FrozenRun`: CandidateIdentity and RunLimits fields with `_tag: 'Frozen'`.
- `QualifiedRun`: same immutable fields, `_tag: 'Qualified'`, validated `receipt`, `qualifiedAtMs`.
- `CancelledRun`: same immutable fields, `_tag: 'Cancelled'`, `cancelledAtMs`.
- `UpgradeRun`: the schema-derived union; `RunFact`: `RunQualified` with identity/receipt/atMs or `RunCancelled` with run/attempt/generation/atMs.
- `checkEligibility(run: UpgradeRun, nowMs: number): Result.Result<FrozenRun, QualificationRefusal>`: phase first, then valid non-negative safe time, then exclusive deadline. No I/O.
- `decideQualification(run: UpgradeRun, contract: VerificationContract, receipt: VerificationReceipt, nowMs: number)` returns `Accepted { state: QualifiedRun, facts: readonly [RunQualified] }` or `Refused { state: UpgradeRun, facts: readonly [], refusal }`.
- `decideCancellation(run: UpgradeRun, nowMs: number)` returns the corresponding accepted cancelled state/RunCancelled fact or refused original state/empty facts. Only Frozen can cancel; invalid time and terminal phases refuse.
- `makeFrozenRun()` uses the canonical fixture. Replacement is a test-fixture operation, not a public retry/admission command: seed a validated new frozen identity with greater generation while retaining limits. No production replacement workflow is implemented.

- [ ] **Step 1: Write failing literal decision tests.** Pin these independent expectations:

```ts
const before = makeFrozenRun();
const c = makeEvidenceCase();
const accepted = decideQualification(before, c.contract, c.receipt, 999);
expect(accepted._tag).toBe('Accepted');
const expired = decideQualification(before, c.contract, c.receipt, 1000);
expect(expired._tag).toBe('Refused');
expect(expired.state).toBe(before);
expect(expired.facts).toEqual([]);
```

Also assert the exact accepted state identity/limits, one complete RunQualified fact, cancelled-state refusal, repeated qualification refusal, cancellation refusal after qualification, every Task 1 mismatch, and invalid explicit time. Refusals must preserve reference identity, not merely structural equality.

- [ ] **Step 2: Observe RED, then implement.** Run the two new files with Bun; implement the two pure decisions and eligibility in `upgrade-run.ts`. Match tagged states exhaustively. Do not introduce a generic workflow framework, ambient clock, retry counter reset or production replacement API.
- [ ] **Step 3: Add the required run properties.** For generated valid runs and matching evidence, assert qualification succeeds before the deadline and preserves all six identity fields plus all three limit fields. For every refusal, assert original reference identity and empty facts. At and beyond the deadline qualification refuses. Once cancelled, repeated matching/current/old receipts never qualify. Build bounded fixture sequences from zero or more valid replacements, optional cancellation and receipt observations; any old-generation receipt after replacement refuses, and no receipt after cancellation can qualify. Include the zero-replacement/no-cancellation valid branch so the sequence law cannot pass by always rejecting. Keep generations below overflow when generating replacement preludes; explicit numeric boundary tests remain separate.
- [ ] **Step 4: Verify generators and shrink quality.** Run each seeded property through `checkLaw`. Temporarily remove one identity comparison and the cancellation guard separately; each corresponding law must falsify and provide a replayable shrunk input. Restore the correct code before the full gate. Do not implement a duplicate production transition algorithm as the test oracle.
- [ ] **Step 5: Verify and commit.** Run all domain/probe tests, domain typecheck and root check; commit `feat: enforce pure qualification and cancellation decisions`. Review before exposing these decisions to the engine.

## Task 3: Inferred Ports And Atomic Repository Contract

**Files:** Create `packages/engine/{package.json,tsconfig.json,moon.yml}`, `src/{contracts.ts,errors.ts,service-factories.ts,ports.ts,index.ts}`, `tests/{fixtures.ts,memory-repository.ts,repository.test.ts,service-factories.test.ts}`. Modify `.moon/workspace.yml` and root lockfile only for this workspace.

**Consumes:** Domain UpgradeRun, RunFact, identity, contract and decision types.

**Data interfaces in `contracts.ts`:**

- `RunSnapshot`: `{ revision, state: UpgradeRun, contract: VerificationContract, history: readonly RunFact[] }`.
- `RunChange`: `{ runId, expectedRevision, state: UpgradeRun, facts: readonly RunFact[] }`.
- `CommitResult`: `Committed { snapshot: RunSnapshot } | Conflict { runId, expectedRevision }`.
- `VerificationRequest`: `{ identity: CandidateIdentity, contract: VerificationContract }`, both taken from the loaded snapshot, never the external caller.
- `RunRepositoryError`: Data.TaggedError with `{ operation: 'load' | 'commit', runId, code: 'ReadFailed' | 'CommitFailed' | 'InvalidData' | 'RevisionExhausted' }`.
- `CandidateVerifierError`: Data.TaggedError with `{ runId, code: 'VerificationFailed' }`. Do not expose raw native exception messages or use unknown as an Effect error channel.

**Inferred service design (the owner's universal lint constraint):**

- A `RunRepositoryDriver` is a synchronous native/data boundary: `load(runId: RunId)` returns `Result.Result<Option.Option<RunSnapshot>, RunRepositoryError>`; `commit(change: RunChange)` returns `Result.Result<CommitResult, RunRepositoryError>`. The commit callback itself owns atomicity. This matches the planned single-host synchronous repository seam, not a claim of support for future remote transactions.
- `makeRunRepository(driver: RunRepositoryDriver)` returns an object with `load` and `commit` Effects, inferred from deferred driver invocation, native-throw mapping and `Effect.fromResult`. Native throws become the operation's tagged error, not success or a defect. Each method includes a named trace span. Constructing a method Effect must not call the driver until that Effect executes.
- `CandidateVerifierDriver(request: VerificationRequest, signal: AbortSignal)` returns `Promise<Result.Result<unknown, CandidateVerifierError>>`. `makeCandidateVerifier(driver)` returns an inferred `verify(request)` Effect using `Effect.tryPromise`, the supplied signal and Result flattening. Typed failure values survive; unexpected rejection maps to the tagged verifier error. This seam propagates an interruption signal, but does not claim an external verifier stopped.
- Define class-style Context.Service keys `RunRepository` and `CandidateVerifier` in `ports.ts` using `ReturnType<typeof makeRunRepository>` and `ReturnType<typeof makeCandidateVerifier>`. Factories depend only on domain, data contracts and errors; they must not import the service keys or test adapters, avoiding cycles.
- Native factory contracts use Promise/Result/data types, never manual Effect channels. Their runtime purpose is boundary deferral, failure normalisation and tracing, not a dummy implementation for type inference. Effect-native test services use `RunRepository.of`/`CandidateVerifier.of` to satisfy the inferred shape directly; they need not convert back to Promises or create nested runtimes.

- [ ] **Step 1: Write failing real-boundary and repository tests.** Pin lazy native invocation, success values, preservation of tagged Result failures, mapping of unexpected throws/rejections, and verifier signal delivery. These are boundary contracts, not assertions that a mock exists. For memory storage, seed revision 7 and assert conditional commit yields revision 8 with both next state and fact visible; a second commit expecting 7 conflicts and changes nothing. Assert wrong run identity fails InvalidData, missing current run conflicts, and MAX_SAFE_INTEGER revision fails RevisionExhausted without mutation.
- [ ] **Step 2: Observe RED and implement factories/service keys.** Keep implementations inferred and add no lint exception. Put only real boundary logic in `service-factories.ts`; `ports.ts` declares keys and derives shapes. No no-op services, false-success defaults, renamed type aliases or imports from tests into src.
- [ ] **Step 3: Implement the memory fixture in tests only.** `makeMemoryRepository(initial: readonly RunSnapshot[])` is an inferred Effect acquiring a fresh Ref-backed store and returning `{ service, inspect }`. `service` satisfies RunRepository through `.of`; `inspect(runId)` is test-only observation. Perform revision check, state replacement and history append in one `Ref.modify`, returning a data Result that becomes a typed Effect result outside the atomic callback. No suspension inside the critical section. Load/inspect/commit snapshots must be detached so later fixture or caller mutation cannot change stored history. Failure injection happens before mutation, not after commit.
- [ ] **Step 4: Verify isolation and concurrency.** Two concurrent changes expecting revision 7 must produce exactly one commit and one conflict. Mutating an input seed, a loaded snapshot or a caller-held receipt array must not rewrite committed storage. A conflict retains a competing cancellation/replacement and appends no fact from the loser. Inject read/commit errors through typed failing service values, not by adding production debug flags. Ensure the fake verifier can return Deferred-based Effects through `.of` without using the native Promise factory or a runtime per operation.
- [ ] **Step 5: Verify and commit.** Run engine/domain/probe suites, engine/domain typechecks and root check; run frozen install and inspect the dependency cohort. Confirm `no-manual-effect-channels` remains at error everywhere. Commit `feat: define inferred verification ports and atomic repository contract`; review this boundary before Task 4.

## Task 4: Coordinator, Controlled Races And Evidence

**Files:** Create `packages/engine/src/run-coordinator.ts`, `tests/{run-coordinator.test.ts,qualification-races.test.ts}`, and `docs/assessments/qualification-gate.md`. Extend `src/index.ts` and test fixtures. Update README, roadmap and this plan's checkboxes only to reflect measured implementation/review progress.

**Consumes:** All earlier interfaces, `Clock.currentTimeMillis`, Effect Deferred/Fiber and `TestClock` from `effect/testing`.

**Produces:** `qualifyRun(runId: RunId)` with an inferred Effect requiring RunRepository and CandidateVerifier (plus Effect's clock facility), failing only with their tagged operational errors. Success is `QualificationOutcome`: `Qualified { snapshot } | Refused { refusal: QualificationRefusal | { _tag: 'RunNotFound' } } | Conflict { runId, expectedRevision }`. The function has no receipt or acceptance-contract argument. Use a span named `RunCoordinator.qualifyRun`.

- [ ] **Step 1: Write failing happy-path and short-circuit tests.** With the canonical snapshot at time 999 and matching verifier result, require Qualified, revision 8 and exactly one complete RunQualified fact. Assert the verifier receives the stored identity/contract exactly. Missing, Cancelled, Qualified and expired snapshots refuse without verifier invocation or write. Invalid explicit time is pinned by Task 2's pure tests; do not rely on an invalid TestClock timestamp to manufacture that case. Invalid verifier receipt shape and every evidence mismatch refuse without commit. Existing state and history remain intact.
- [ ] **Step 2: Implement sequencing as one visible Effect operation.** Yield the services; load the snapshot; perform preflight eligibility; call the verifier; decode its raw receipt; read time again; apply the pure decision; conditionally commit accepted state/facts with the originally loaded revision. Refusals/conflicts remain values; operational failures propagate. Infer channels from the actual program and use a flat Effect flow with exhaustive matching. No inline provision, hidden execution, swallowed errors, retry or reread-and-overwrite loop.
- [ ] **Step 3: Write deterministic race tests before completing those paths.** Compose services and `TestClock.layer` once at each test boundary. Use Deferred entry/release barriers and child/scoped fibers; no sleeps. Establish both qualifiers have read revision 7 before releasing either. Test cancellation-first, replacement-first, and two-qualifiers races. Assert the stale operation conflicts, retained winning state is exact, and only the winner's fact is in history. Race tests must observe both entered barriers, not assume scheduling from a fork call.
- [ ] **Step 4: Pin deadline and failure behaviour.** Set time to 999; pause verification; use TestClock.setTime(1000); release a valid receipt and require DeadlineExpired with no commit. Also test a verifier result already past the deadline. Inject typed verifier, repository-load and pre-write commit failures and require the corresponding tagged error, no automatic retries, no qualification fact and no lost competing state. Verify mutation of verifier-owned output/input arrays cannot retrospectively alter the committed snapshot. Assert only owned no-call/no-retry counts, not generic framework internals.
- [ ] **Step 5: Run the full acceptance gate sequentially.** From the root, inherit only PATH, HOME and TMPDIR via `env -i`; execute:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
moon run domain:typecheck --force --no-actions
moon run engine:typecheck --force --no-actions
moon run probe:typecheck --force --no-actions
moon run domain:test --force --no-actions
moon run engine:test --force --no-actions
moon run probe:test --force --no-actions
git diff --check
```

All commands must exit 0; no skipped suite/cache replay counts as evidence. Record actual discovered test counts and each property's seeded evaluation totals, diagnostics/replay checks and mutation controls. Assert no manual-channel declaration or rule exception was introduced, no source-to-tests dependency exists, and no live adapter/publication capability was added. Compare lockfile cohort and source diff against the approved task scope.

- [ ] **Step 6: Write the measured report and commit.** Report versions, commands, observed counts, gate outcomes and exact candidate commit/lock identities in `docs/assessments/qualification-gate.md`. Distinguish property laws, synthetic Effect interleavings and native-boundary unit tests from real workers, provider cancellation, SQLite durability and production qualification. Keep those external guarantees unqualified. Commit `feat: coordinate race-safe qualification with synthetic evidence` after all checks pass.
- [ ] **Step 7: Obtain the whole-branch review.** A fresh reviewer checks the approved spec, all four task interfaces and the complete diff, with emphasis on receipt authority, optimistic concurrency, typed failures, invariant coverage and non-vacuous properties. Resolve findings, rerun affected/full gates and commit fixes before presenting integration choices. Do not auto-merge or push.

## Self-Review And Handoff

Spec coverage: evidence identity/completeness and generator integrity belong to Task 1; phases, limits, deadlines and cancellation laws to Task 2; inferred channels, native errors and atomic/detached storage to Task 3; capability ownership, races, final-time checks and full evidence to Task 4. All five Review Focus entries have explicit owning tests. In-memory fixtures do not qualify external storage, cancellation, hashing, global budget accounting or PR publication.

The owner-approved universal lint rule is preserved through real factory inference; no policy decision is deferred to the executor. If that design cannot satisfy strict types and lint without a semantic compromise, stop and show the concrete failure rather than introducing an exception or dummy service. The same stop rule applies to new vendor declaration errors, unexpected dependency-cohort changes or needing live infrastructure.

Before execution, the owner must review this written plan and choose an execution method. Recommend **subagent-driven** for the four independently reviewable contracts: mistakes here can falsely qualify a candidate, and a fresh gate at each boundary is useful. **Native** remains available for lower context overhead, with a final independent review. Approval of the spec does not authorise execution of this still-unreviewed plan.
