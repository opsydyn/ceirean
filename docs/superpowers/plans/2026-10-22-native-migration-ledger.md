# Native Migration Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist run state and worker intent under one controller-owned SQLite transaction boundary, with tested local restart recovery and no native worker execution.

**Architecture:** Preserve the existing RunRepository, WorkerJournal, RunCoordinator and single XState Effect lifecycle. Promote their test-only journal decisions into pure engine policies, then implement a private Bun SQLite adapter that atomically commits run changes, worker-authority fan-out and an audit entry. Opening storage returns services and recovery data; it never starts actors or mechanisms.

**Tech Stack:** Existing Bun 1.4.2 / bun:sqlite, Effect 4.0.5, @effect/platform-bun 4.0.5, @xstate/effect 0.1.0-alpha.6, XState 6.0.0-alpha.64, TypeScript 7.0.2, Moon 2.5.4, Oxlint 1.88.0, Oxfmt 0.73.0 and @opsydyn/oxlint-effect 2.0.1. No new dependency versions.

**Spec:** [Approved replay/worker boundary](../specs/2026-10-21-foldkit-replay-profile-design.md), especially Controller And Storage Ownership and Limits And Cancellation; [approved worker lifecycle](../specs/2026-10-19-worker-lifecycle-design.md). The owner approved one atomic ledger boundary for run state and worker authority on 2026-10-22.

**Status:** Owner-approved implementation. Tasks 1-4 independently reviewed through `56c123e`. Task 5 review of `56c123e..a94f945` was Approved with one Minor; fresh whole-branch review of `03828ae..a94f945` returned ReadyToMergeYes, no Critical/Important, same Minor. The focused guarded-argv follow-up addresses it; controller scoped re-review of the follow-up remains pending. These completed reviews apply to `a94f945`, not a future head. See the [measured assessment](../../assessments/native-migration-ledger.md). Original design base: local main `03828ae`. No operational initialization, VM/container execution or publication is authorized.

## Global Constraints

- This is Plan B. Plan A remains inspection-only, Draft, publication Disabled and seven blockers present. Do not change `apps/replay`, its arguments, central profile or report into an execution/admission path.
- Keep pure decisions in engine/domain, Effect scope and services at boundaries, one existing lifecycle machine and ledger authority. Persist business records, never XState snapshots, actor handles, queues or Flue conversations.
- Use one dedicated migration database and one exclusive controller owner. Never initialize, reuse, upgrade or migrate live-admission storage or `/Users/alancurrie/Library/Application Support/Ceirean` during this work.
- Only explicit, test-owned temporary directories may be initialized during qualification. Production path validation is tested; no operational path is selected or initialized.
- No Docker/Colima commands, native workers, consumer installs/builds/tests, paid/model calls, registry retrieval, network/GitHub access, ingress, tunnel/webhooks or publication. Existing workspace tests may use their established synthetic loopback fixtures.
- Preserve original absolute deadlines, consumed `spentMicros` and `repairs`, current identity, immutable operation/container bindings, intent-before-mutation and earliest cancellation/cleanup bounds. No implicit retries or new deadlines after restart.
- Keep existing service signatures and inferred Effect/Layer channels. Expected conflicts/refusals remain values; storage failures remain finite tagged errors. Universal lint rules, declaration policy and existing compatibility dependencies stay unchanged.
- Use Effect-native properties with `packages/domain/tests/properties.ts`: seeds 0/1/163, 1000 runs, size 50, maxShrinks 1000 and maxDiscards 10000. Construct valid controls and mutations; do not weaken existing budgets or assertions.
- Before each task commit: root `bun --no-env-file run check`, `moon run :typecheck --force --no-actions` and `moon run :test --force --no-actions` must exit 0. Record actual totals. Commit each verified task; do not merge or push without approval.
- Proposed implementation appetite: three engineering days including native qualification/review. Stop for scope review if a new workflow, live mechanism, storage migration, dependency upgrade or policy exception becomes necessary. This is not native/model spending approval.

## Review Focus

1. A crash during run cancellation/generation replacement must expose all or none of the run, peer authority and audit changes: Tasks 2, 4 and 5.
2. A stale worker's cancellation or a CAS loser must not revoke replacement authority, append facts or issue work: Tasks 2 and 5.
3. A dead owner must release the OS-backed lock, but PID/age/timeout guesses must never steal a live owner or renew run deadlines: Tasks 3 and 5.
4. Corrupt/truncated/wrong-version records, unsafe files and exhausted bounds must refuse without repairing storage, leaking contents or returning partial services: Tasks 3 and 4.
5. Restart after a claim or lost outcome must reconcile evidence rather than repeat create/start/execute or infer cleanup from a missing actor: Task 5.

## Contract And File Map

Keep the two engine ports, backed by one native handle/owner and one SQL transaction per mutation. Do not introduce independent run and worker databases or a generic event-sourcing framework.

| Files                                                                                                 | Responsibility                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/engine/src/run-repository-policy.ts`                                                        | Existing pure run CAS/history decision, extracted from the memory adapter                                    |
| `packages/engine/src/worker-journal-record.ts`                                                        | Existing detach, time-floor, authority and record helpers                                                    |
| `packages/engine/src/worker-journal-edits.ts`                                                         | Existing per-record claim/outcome/readiness/execution/cleanup decisions                                      |
| `packages/engine/src/worker-journal-policy.ts`                                                        | Existing register/CAS/shared-run authority decisions and detached results                                    |
| `packages/engine/src/migration-ledger-contracts.ts`                                                   | Schema-derived ledger state, commands, audit entries, registration/refusal/recovery values and parser bounds |
| `packages/engine/src/migration-ledger-policy.ts`                                                      | Pure composite transaction decision; no second workflow state machine                                        |
| `packages/engine/tests/migration-ledger-policy.test.ts`, `migration-ledger-properties.test.ts`        | Atomicity, authority, bounds and generated laws                                                              |
| `packages/migration-storage/src/config.ts`, `errors.ts`                                               | Explicit migration-only path policy/configuration and finite storage failures                                |
| `packages/migration-storage/src/paths.ts`, `ownership.ts`                                             | Safe explicit file reservation, identity binding, scoped native exclusive owner                              |
| `packages/migration-storage/src/schema.ts`, `codec.ts`                                                | Exact SQLite schema/version, strict data codecs and readback validation                                      |
| `packages/migration-storage/src/database.ts`                                                          | Internal scoped SQLite connection/init/status acquisition, no public SQL handle                              |
| `packages/migration-storage/src/transaction.ts`, `drivers.ts`                                         | Composite transaction, atomic row/event writes and existing port adapters                                    |
| `packages/migration-storage/src/ledger.ts`, `index.ts`                                                | Actual public init/open/status boundaries; no empty future APIs                                              |
| `packages/migration-storage/tests/{paths,ownership,storage,transactions,recovery,properties}.test.ts` | Native local filesystem/SQLite and existing-actor recovery proof                                             |
| `packages/migration-storage/tests/{fixtures,recovery-controller,readiness}.ts`, `restart-child.ts`    | Owned temporary inputs, synthetic mechanisms and bounded subprocess protocol                                 |
| `packages/migration-storage/{package.json,tsconfig.json,moon.yml,README.md}`                          | Working private workspace, strict gates and exact operational limits                                         |
| `docs/assessments/native-migration-ledger.md`                                                         | Measured results and review/negative-control disposition                                                     |

Modify the two engine memory adapters to consume shared pure policies, not vice versa. Preserve their test-only inspection/authority replacement controls. Modify engine `package.json` for a narrow `./journal-policy` subpath; retain `.` unchanged. Do not barrel-export helper internals. Task 4 may add finite resource-failure codes to existing engine errors, not change their tags or Effect success shapes. Register `migration-storage: packages/migration-storage` in Moon, the actual child fixture in Fallow, and workspace-only entries in `bun.lock`.

## Atomicity And Recovery Decisions

These are implementation requirements for the approved atomic boundary, not additional execution capabilities.

- `MigrationLedgerState`: detached `runs: ReadonlyArray<RunSnapshot>`, `workers: ReadonlyArray<WorkerJournalSnapshot>` and safe-integer `sequence`. The stored run is authoritative; every worker's `authority` projection must match its run. Mismatch on read is corruption, not permission to silently synchronize.
- `MigrationLedgerCommand`: tagged `RegisterRun { state: FrozenRun, contract: VerificationContract }`, `ChangeRun { change: RunChange }`, or `EditWorker { edit: WorkerJournalEdit }`. No arbitrary snapshot/SQL replacement command. Initial registration builds revision 0 and empty history, binds contract ID/digest and rejects non-Frozen initial state.
- `MigrationLedgerReply`: tagged `Registered { snapshot }`, `RunResult { result: CommitResult }`, `WorkerResult { result: WorkerJournalResult }`, or `RegistrationRefused { reason: 'InvalidInput' | 'RunAlreadyPresent' | 'RunActive' | 'CleanupUnresolved' }`. Existing worker/run results are preserved inside their wrappers.
- A committed decision supplies fresh `next` state and one `MigrationLedgerEvent`; conflict/refusal supplies unchanged data and no event. Event fields are `sequence`, the decoded command, and changed `runRevisions` / `workerRevisions` pairs. Events are audit evidence, not instructions to replay effects.
- Run cancellation and identity replacement atomically update the run and all its worker-authority projections, incrementing affected worker revisions. Any revision exhaustion or write failure rolls back everything. Unchanged authority does not gratuitously increment peer revisions.
- A current Frozen worker's accepted `RequestCancellation` atomically cancels the run via existing `decideCancellation` and fans out authority; repeated cancellation preserves the earliest time and does not append another run fact. A superseded worker may only obtain the existing policy's cleanup-only result, never cancel the new generation. A Qualified current run refuses worker cancellation as `NotCurrent`; explicit cleanup remains available.
- Existing exact duplicate worker registration still returns Conflict, including reconstruction of an old operation. New stale/missing/terminal-run registrations refuse. New Create/Start claims, readiness and execution authorization require the current Frozen run. Issued outcomes and bounded cleanup remain recordable after cancellation, expiry or replacement under the existing custody/evidence rules.
- Accepted run changes must reproduce existing `decideQualification` / `decideCancellation` state and facts. A Frozen replacement requires a newer generation and a distinct attempt, the same run/contract binding and original deadline, nondecreasing consumed spend/repairs, and no fabricated qualification facts. Terminal runs cannot be reopened. Do not mutate pinned worker operations to refresh their limits.
- Register at most one active run. A previous run must be terminal and every registered worker have confirmed cleanup with no unresolved create/start intent before another run is registered. No automatic deletion or active-slot release from actor/process absence.
- Defensive storage limits proposed for plan approval: 32 retained runs, 256 worker operations total / 64 per run, 4096 commit events, 1048576 encoded UTF-8 bytes per record/command, and 67108864 aggregate application-payload bytes. Exceeding these stops writes without eviction. These are parser/application bounds, not a measured database/WAL filesystem quota or native worker limit.
- SQLite tables: singleton `metadata`, `runs` keyed by run ID with revision/payload, `workers` keyed by operation ID with run foreign key/revision/payload, and `commits` keyed by sequence with payload. Use STRICT tables, checks, bound statements, foreign keys, WAL, `synchronous=FULL`, `busy_timeout=0`, and short `BEGIN IMMEDIATE` mutation transactions. No awaits or external calls while a transaction is held.
- Wire codecs use `Schema.fromJsonString(Schema.toCodecJson(recordSchema))` with strict excess-property rejection. `Schema.Option` requires its canonical JSON codec to rebuild genuine Option wrappers; raw JSON/structuredClone alone is not a persistence codec. Pin this with Some/None and nested Option round-trip controls.
- Dedicated application ID `0x4345524d`, schema version 1. Fixed names beneath the explicit state root: `migration.sqlite` and `migration.sqlite.owner.sqlite`. Keep a separate rollback-journal guard database under a scope-held `BEGIN EXCLUSIVE`, following the qualified admission ownership mechanism without importing GitHub adapters or their schemas.
- Initialization is explicit and refuses existing files. Open uses create:false, validates exact schema/metadata/foreign-key/record/event consistency, and never executes DDL or changes journal mode. Unknown/old/admission databases, partial initialization and missing guard files refuse; no repair, migration or fallback to memory.
- State root is owner-only 0700; ledger/guard/sidecars are regular owner-owned 0600 files. Check normalized absolute paths, excluded production roots, links and special files before potentially blocking native opens; retain descriptor/identity readback. Do not chmod-repair existing storage. Parent-directory/local-filesystem trust is explicit; no hostile-host, arbitrary sync-client detection or power-loss durability claim.
- `openMigrationLedger` acquires ownership before returning either service. All returned services die with that scope; late calls fail finitely. Read-only status does not acquire writer authority, initialize files or start actors. Do not steal locks using PID files, expiry or a fresh deadline.
- Recovery returns bounded persisted records/identities and unresolved intent IDs. Production open does not invoke lifecycle acquisition, observations or mutations. Tests explicitly reconstruct the existing lifecycle with a new issuer and fake mechanism. No actor snapshot restoration or second orchestration reducer.

## Task 1: Share The Existing Pure Journal Decisions

**Files:** Create the four pure policy/helper files above and `packages/engine/tests/journal-policy.test.ts`; modify `tests/memory-repository.ts`, `tests/worker-memory-journal.ts` and engine package exports.

**Interfaces:**

- `evaluateRunChange(current: Option.Option<RunSnapshot>, change: RunChange): Result.Result<CommitResult, RunRepositoryError>`.
- `evaluateWorkerJournalEdit(current: ReadonlyArray<WorkerJournalSnapshot>, edit: WorkerJournalEdit)` returns a Result with `{ result: WorkerJournalResult, next: ReadonlyArray<WorkerJournalSnapshot> }` or WorkerJournalError.
- `replaceWorkerAuthority(current: ReadonlyArray<WorkerJournalSnapshot>, operationId: WorkerOperationId, identity: CandidateIdentity, cancelledAtMs: Option.Option<number>)` returns a Result containing the detached next worker array or WorkerJournalError. Preserve the existing test adapter's missing-operation semantics through its wrapper.
- A missing operation in replaceWorkerAuthority returns a detached unchanged array; the test adapter's existing inspect/load wrapper still reports Option.none. It must not insert an authority-only placeholder.
- The narrow `@ceirean/engine/journal-policy` export exposes only these functions and Task 2's actual contracts/decision. Existing port factories/signatures do not change.

- [ ] **Step 1: Write failing shared-policy tests.** Name cases `run CAS loser appends no fact`, `worker cancellation updates all peer revisions atomically`, `peer revision exhaustion leaves all records unchanged`, `Option payloads survive detachment`, and `returned data cannot mutate the input store`. Use independent existing fixtures and exact expected revisions/refusals.
- [ ] **Step 2: Run red.** `cd packages/engine && bun --no-env-file --no-install test tests/journal-policy.test.ts`; expect the missing new policy exports, not unrelated dependency errors.
- [ ] **Step 3: Extract the real decisions.** Move existing pure logic out of the two memory adapters into the named modules, separating per-record edits from store-wide CAS/fan-out. Keep Effect Ref/storage and synthetic seed controls under tests. Preserve all existing authority/time/cleanup behavior and Option wrappers; production source must not import tests.
- [ ] **Step 4: Run shared-policy and existing journal/repository tests.** Run `bun --no-env-file --no-install test tests/journal-policy.test.ts tests/worker-journal.test.ts tests/repository.test.ts --timeout 30000` in engine. Existing regressions remain intact; do not rewrite expectations to accommodate drift.
- [ ] **Step 5: Run all gates and commit.** Global commands exit 0; commit `refactor(engine): share pure run and worker journal decisions`.

## Task 2: Define The Atomic Migration Ledger Decision

**Files:** Create `migration-ledger-contracts.ts`, `migration-ledger-policy.ts` and the two engine ledger test files. Extend the narrow journal-policy export, not the root barrel.

**Interfaces:**

- Produce schema/value/type `MigrationLedgerState`, `MigrationLedgerCommand`, `MigrationLedgerReply`, `MigrationLedgerEvent`, `MigrationRecovery` and `RunRegistration` (the registration-success/refusal subset of MigrationLedgerReply).
- `MigrationRecovery`: `sequence`, detached `runs`, and `workers` entries `{ snapshot, unresolvedIntentIds }`; no readiness/qualification summary stronger than the underlying records.
- `decideMigrationLedger(current: MigrationLedgerState, input: unknown)` returns a pure Result with `{ reply: MigrationLedgerReply, next: MigrationLedgerState, event: Option.Option<MigrationLedgerEvent> }` or existing RunRepositoryError/WorkerJournalError plus a finite pure `MigrationLedgerPolicyError` (`InvalidData | RevisionExhausted | CapacityExceeded`). No manual Effect channels.
- Consume Task 1 functions and existing `decideCancellation`, `decideQualification`, schemas and refusal vocabulary. This policy applies persistence constraints; it does not replace the existing lifecycle machine or qualify a Draft replay.

- [ ] **Step 1: Write failing transaction-policy tests.** Assert initial Frozen revision 0; duplicate/active/unresolved-cleanup registration refuses; run cancellation and worker cancellation each atomically update the run, every sibling and one audit event; stale-worker cancellation cannot cancel a replacement; stale CAS and semantic refusal append nothing. Cover Qualified cleanup-only behavior, missing parents, peer exhaustion, forged facts, reopened terminal state, renewed deadline and decreasing spend/repairs.
- [ ] **Step 2: Run red.** In engine, `bun --no-env-file --no-install test tests/migration-ledger-policy.test.ts`; expect missing ledger decision/schema exports.
- [ ] **Step 3: Implement the composite pure decision.** Strictly reject excess fields at all untrusted command/state boundaries. Enforce the Atomicity And Recovery Decisions above, immutable contract/operation bindings and application bounds. Validate all state before making a decision, not by silently rebuilding corrupt authority. Return detached values and audit revision pairs; preserve error/refusal distinctions.
- [ ] **Step 4: Add properties and run green.** Use the unchanged checkLaw helper for six constructive laws: CAS winner uniqueness; cancellation/run-worker coherence; old-generation isolation; rejected transition immutability/no audit append; monotonic deadlines/budgets/time floors; encode/decode and returned-object detachment. Each includes a valid committed control. Run both new test files with `--timeout 30000`; require all 18000 primary cases across the six laws.
- [ ] **Step 5: Run all gates and commit.** Commit `feat(engine): decide atomic migration ledger changes` only after all global gates pass.

## Task 3: Initialize And Own A Dedicated Native Ledger

**Files:** Create the new workspace metadata, `config.ts`, `errors.ts`, `paths.ts`, `ownership.ts`, `schema.ts`, `codec.ts`, `database.ts`, `ledger.ts`, `index.ts`; create native `paths.test.ts`, `ownership.test.ts`, `storage.test.ts` and `fixtures.ts`. Register Moon/workspace lock entries. No transaction-driver stubs.

**Interfaces:**

- `MigrationStatePolicy`: schema-derived `Production` and `TestOwnedTemporary` variants, with the same explicit root/UID and exclusion semantics as the observed admission path policy, but no dependency on LiveInboxError or GitHub packages.
- `MigrationLedgerConfig`: `{ ledgerId, pathPolicy }`, with schema-bounded identifiers and path inputs. Root comes from pathPolicy. No environment, cwd, default directory or implicit live-ledger lookup.
- `initializeMigrationLedger(config)` is an inferred scoped Effect boundary yielding validated `{ ledgerId, schemaVersion: 1 }`; it creates only an empty ledger and guard, never a run or qualified profile.
- `readMigrationLedgerStatus(config)` is an inferred read-only Effect boundary yielding `{ ledgerId, schemaVersion, sequence, runCount, workerCount }` after validation, not a run-admission or lock-ownership receipt.
- Internal `openOwnedMigrationDatabase(config)` yields the native connection only inside this workspace. No exported SQL handle or query escape hatch.
- `MigrationStorageError`: finite operations `initialize | open | status | close` and codes `InvalidConfig | UnsafePath | AlreadyExists | OpenFailed | OwnershipBusy | IncompatibleSchema | InvalidData | CloseFailed`; no raw paths, SQL, causes or stored content.

- [ ] **Step 1: Write failing native path/schema/ownership tests.** Include missing/zero-byte/foreign-application/unknown-version files, unsafe/excluded roots, final and parent links, known FIFOs/special files, wrong ownership/mode, dangling sidecars, partial initialization and replaced inode/identity. Assert no automatic repair or partial service return, finite redacted errors and strict close on all acquisition failures. Test two owners and read-only status under a live owner.
- [ ] **Step 2: Run red with the actual workspace.** Add package/test metadata using only dependencies `@ceirean/domain: workspace:*`, `@ceirean/engine: workspace:*`, `effect: 4.0.5`, devDependency `@effect/platform-bun: 4.0.5`. Link with a script-disabled install in an isolated credential-free execution worktree, using existing cached locked dependencies with network denied; a cache miss blocks setup rather than authorizing registry retrieval. Inspect workspace-only lock changes. Run `moon run migration-storage:test --force --no-actions`; failure must concern missing implementation, not package discovery.
- [ ] **Step 3: Implement explicit init/open/status ownership.** Follow the observed native admission mechanisms without importing or refactoring that adapter. Initialize fixed files with exclusive reservation; exact migration schema/application ID; bound statements; scoped strict database close; native exclusive guard lock. Normal open validates before yielding and never creates/repairs files or changes journal mode. Protect against known special-file blocking and document the trusted-directory race boundary.
- [ ] **Step 4: Verify metadata and full local acquisition cleanup.** Private `@ceirean/migration-storage`, ESM, typecheck `tsc --noEmit`, strict `skipLibCheck: false`; Moon test/type tasks use envFile false, retries 0 and cache false. Its test command is `bun --no-env-file --no-install test --timeout 180000` to bound the full-budget native property test; existing workspace timeouts are unchanged. Deterministic child/barrier waits retain their own short deadlines. Repeat focused tests and typecheck. Assert readonly status leaves bytes/schema/files unchanged and emits no console output. No production path is touched.
- [ ] **Step 5: Run all gates and commit.** Commit `feat(storage): initialize and own migration ledger` after every workspace gate passes.

## Task 4: Back Both Existing Ports With One SQL Commit

**Files:** Add `transaction.ts`, `drivers.ts`, `transactions.test.ts`; extend native `ledger.ts`, `codec.ts`, `schema.ts`, `index.ts` and engine error-code unions if required below.

**Interfaces:**

- `openMigrationLedger(config)` returns an inferred scoped Effect yielding `{ runRepository, workerJournal, registerRun, readRecovery }`. runRepository/workerJournal are made by existing real factories and satisfy their unchanged ports; `registerRun(input: unknown)` is an inferred Effect yielding RunRegistration; `readRecovery()` yields MigrationRecovery. No registration/effects occur at open.
- Native `runRepository.commit(change)` and `workerJournal.commit(edit)` wrap the corresponding Task 2 commands and map the matching reply variant back to the existing return shape. Registration cannot return an arbitrary RunResult/WorkerResult.
- Add resource codes `Busy | CapacityExceeded | Closed` to RunRepositoryError/WorkerJournalError if needed for honest adapter failures, preserving their tags and existing codes. Invalid/corrupt data and revision exhaustion remain typed failures; ordinary Conflict/Refused stays a value. Adapter acquisition failures use MigrationStorageError.
- `MigrationLedgerTestFault`: finite points `AfterRunWrite | AfterWorkerWrite | AfterEventWrite | BeforeCommit | AfterCommit | Close`. Optional fault callback is permitted only with TestOwnedTemporary policy; Production rejects it. The callback receives no SQL/database capability. No fake inference driver or ignored test knob in production.

- [ ] **Step 1: Write failing atomic native tests.** Use two same-run operations and exact revisions to test all-or-nothing run cancellation, current-worker cancellation and generation replacement. Inject failure after the first peer write and audit append, including revision exhaustion in pure fixtures, and assert no partial persisted authority/history/event. Check original contracts/limits/earliest cancellation, exact duplicate registration, stale CAS, old-worker cleanup and immutable Option round trips after close/reopen. No automatic retry on Busy/ambiguous commit.
- [ ] **Step 2: Run red.** `moon run migration-storage:test --force --no-actions` must expose missing real port behavior, not a substituted memory adapter.
- [ ] **Step 3: Implement one synchronous transaction.** Begin immediate, load validated affected run/worker records, call the pure decision, then atomically write all changed records and one audit event. Commit before returning success. Refusal/CAS loss writes nothing; any error rolls back. Never await, call a mechanism or notify an actor inside SQL. An AfterCommit response loss retains committed intent; the caller must read back, not reissue it.
- [ ] **Step 4: Verify readback, bounds and closure.** Enforce per-record/aggregate application bounds before decoding untrusted oversized payloads or writing, check event/revision/foreign-key consistency and fail closed on corruption. Read recovery in one consistent bounded read transaction. Mutating returned data cannot alter storage. Late calls after scope close return Closed; no leaked raw native exceptions or reopened connection. Test restored byte-cap and skipped-peer-write negative controls before claiming qualification.
- [ ] **Step 5: Run all gates and commit.** Commit `feat(storage): persist run and worker authority atomically` only after native tests, all workspace types/tests and lint/format pass.

## Task 5: Qualify Restart Recovery Without Native Workers

**Files:** Add `recovery.test.ts`, `properties.test.ts`, `recovery-controller.ts`, `readiness.ts`, `restart-child.ts`; register the exact child entry in `.fallowrc.json`. Add the native README/assessment and update roadmap/parent spec statuses accurately.

**Interfaces:**

- The test-only recovery controller wires the real openMigrationLedger services and existing WorkerLifecycle into one exported Effect boundary, with a synthetic WorkerMechanism and an explicit new issuer per process. It consumes readRecovery; no new public actor-resume API or workflow machine.
- The fixed child fixture accepts only schema-validated synthetic scenario/fault-point data, owned temporary paths and control messages. Allowlisted environment, `--no-env-file --no-install`, no shell, consumer commands, model keys or operational config. Readiness output and parent waits are bounded; cleanup always waits for/kills owned children.
- Measured README/assessment names actual source, commands, counts, property budgets, failure controls, storage identity and limits. Local SIGKILL/reopen is not host-loss, power-loss, SQLite-filesystem quota or live Docker cleanup proof.

- [x] **Step 1: Write failing restart tests.** Kill an owner before a transaction, after run write, after a worker write, after event write and after commit before acknowledgement. Fresh process must obtain a released native lock and observe exactly the pre- or post-transaction state, never mixed records. A live owner is never displaced, and after-commit replay is a conflict/readback, not a second audit event.
- [x] **Step 2: Add bounded actor/reconciliation controls.** Persist Create/Start claims and execution authorization, terminate the controller and explicitly reconstruct the existing lifecycle with a new issuer/fake mechanism. Claimed/unknown mutations and authorized-but-unacknowledged execution never repeat. Missing/ambiguous resource readback remains blocked; absence alone cannot confirm cleanup while a materializing intent is unresolved. Positive control reconciles matching immutable resource evidence and confirms cleanup only under the original persisted window. Retained evidence paths are never deleted.
- [x] **Step 3: Run red, then implement the test harness.** Focus `bun --no-env-file --no-install test tests/recovery.test.ts --timeout 30000` in migration-storage. Prove at least one test fails for deliberately skipped atomic fan-out and one for replayed claimed action; restore each mutation and rerun green. The matching-evidence lifecycle defect triggered the required stop; owner then explicitly approved minimal binding-field projections in both reconciliation and Unknown fallback, verified RED/GREEN through the strict native boundary. No assertion/decoder/machine weakening.
- [x] **Step 4: Add native properties and finish evidence.** One generated refinement law uses unchanged checkLaw budgets: for bounded valid/refused command sequences (at most eight commands per case), SQLite replies and readback agree with the pure composite decision before and after close/reopen. Include cancellation/replacement, Options, original limits and returned-object mutation in those cases, with a valid committed control per case. Each case owns fresh temporary storage; all 3000 primary cases across seeds 0/1/163 passed in the focused final run at 110668.70ms under the unchanged single 180-second bound. Deterministic native tests own SIGKILL, ownership and faults.
- [x] **Step 5a: Run author gates, self-review and prepare the verified task commit.** Root check exits 0, 9 typecheck tasks pass and 1160 tests pass across 9 tasks (138 native tests); the complete native law also passes within 180 seconds under full-suite load. Fallow separately exits 0 with only the retained SDK compatibility warning; the new fixture cycle was fixed, not suppressed. Commit subject: `test(storage): qualify migration ledger restart recovery`, with the README/assessment/roadmap. No automatic merge/push, operational init or Plan C activation.
- [x] **Step 5b: Controller-owned independent reviews of `a94f945`.** Task 5: Rawls, `56c123e..a94f945`, spec compliant / quality Approved with one Minor, no Critical/Important. Whole branch: Meitner, `03828ae..a94f945`, ReadyToMergeYes, no Critical/Important, same Minor. Direct malformed child argv could escape the guard; parent validation protected exercised paths. The owner chose a bounded fixture fix and direct RED/GREEN regression rather than narrowing the refusal claim. Reviewers' declined judgments remain explicit nonclaims: Docker/native workers/models/real migration, host/power loss, hostile filesystem/same-UID/authenticity, disk quota/maximum throughput, forensic confinement, broad security, operational init/deployment/publication.
- [ ] **Step 5c: Controller scoped follow-up review.** Guard argv decoding inside the existing Effect boundary, verify the black-box malformed-input regression and all frozen-tree gates, commit the one bounded fix and review-disposition evidence. Controller then reviews only the follow-up for the Minor/new breakage. No claim that the new head already has whole-branch or scoped approval; no merge/push authorization.

## Self-Review And Handoff

- [x] Coverage: this plan implements native run/worker persistence and local recovery only; native mechanism/readiness, prepared artifacts, model spend and real migration remain Plans C-D.
- [x] Contract consistency: existing ports retain signatures; Task 2 owns every composite command/reply/recovery schema used by the SQL adapter and tests. Init/status and open/register are explicit distinct actions.
- [x] Review Focus: all five failure classes have deterministic or property tests in their owning tasks; neither SQLite locks nor parsed records are presented as execution approval.
- [x] Proportion: decision interfaces and observable tests are specified without copying the implementation. Existing policy extraction is scoped to real memory-adapter logic, not broad engine/GitHub refactoring.
- [x] Owner reviews this written plan and its proposed defensive storage bounds/appetite, then chooses execution method before any product implementation.
- [x] Execute with isolated credential-free source/dependencies and temporary test state, commit each verified task, and obtain independent Task 5 and whole-branch review through `a94f945`. Focused follow-up scoped review remains the explicit open gate above.

Recommend subagent-driven execution: five sequential deliverables with explicit contracts and costly crash/authority failure modes benefit from fresh per-task implementation/review gates. Inline execution remains available, with one final fresh reviewer. Approval of this document does not authorize containers, operational ledgers or model calls.
