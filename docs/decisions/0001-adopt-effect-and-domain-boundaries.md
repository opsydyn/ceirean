---
status: accepted
date: 2026-10-18
decision-makers: Project owner
---

# ADR-0001 Adopt Effect orchestration and pure domain decisions

## Context And Problem

Leviathan is a planning-stage internal dependency migration service. Bun and
TypeScript, Flue for agent reasoning, and a dedicated service repository are
agreed constraints. FoldKit experiments is the first dogfood target; the postcode
client follows. There is no application code or dependency manifest yet.

The [architecture draft](../superpowers/specs/2026-10-18-internal-upgrade-service-design.md)
requires typed run states, immutable qualification evidence, bounded execution,
persisted budgets, cancellation and restart reconciliation. These rules need an
explicit owner before implementation. A model transcript, a container exit code
and an application run outcome are different things.

Domain-driven design (DDD) means modelling those rules in the service's own
language and keeping infrastructure behind interfaces. It does not require event
sourcing, distributed services or a framework-specific aggregate runtime.

The project owner accepted this written ADR on 2026-10-18. Acceptance does not
authorise dependency installation, probe execution, infrastructure, model data
access, spending or publication. The compatibility implementation plan requires
separate review; accepting this ADR does not approve the broader deployment and
worker design or its implementation.

## Decision Drivers

- Keep Bun first without hiding a Node-only controller behind an adapter.
- Make qualification and budget rules testable without a model or Docker.
- Expose dependencies and typed failure modes at service boundaries.
- Give run execution and durable recovery one application owner.
- Preserve a narrow Flue adapter and independent verification.
- Keep the first slice within a manual single-owner deployment.

## Considered Options

| Option                            | Benefits                                                                                      | Costs and limitations                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Plain TypeScript and Promises     | Small dependency surface; familiar asynchronous code                                          | Manual dependency wiring, cancellation propagation, resource lifecycle and error conventions       |
| Effect with pure domain decisions | Typed dependencies and failures; scoped execution; replaceable adapters                       | Learning and dependency cost; explicit bridging to Flue; durable recovery remains application work |
| Alchemy Domain runtime            | Aggregate, event, rejection, policy and read-model vocabulary; upstream durable hosting model | Published API and initial runtime mismatch; broader event/runtime commitments before dogfood proof |

## Decision

Adopt Effect 4 for application orchestration, with pure domain decisions and
explicit infrastructure adapters. Retain Bun as the controller runtime and Flue
as the agent runtime. Defer Alchemy Domain and additional workflow engines.

### Domain Boundary

Start with one bounded context, Upgrade Management, and an UpgradeRun aggregate
root. Worker execution and storage are adapters, not separate business contexts.

The domain contains validated run, attempt, candidate and verification-contract
identities; immutable state; commands; facts; and typed rejections. Example
commands are RequestUpgrade, RequestCancellation and RecordVerification. Example
facts are UpgradeRequested, CandidateFrozen, VerificationPassed and RunQualified.
Commands are requests, while events are past-tense facts; this is distinct from
FoldKit UI messages, which are themselves facts.

Decision functions take state, a command and explicit validated facts such as time
and policy, and return a new state with facts or a rejection. They perform no I/O,
read no process environment or system clock, and do not execute Effects. Effect
Schema, Data and Result utilities may describe data without making decisions
effectful. Domain modules import no Flue, Docker, database, GitHub or Alchemy code.

Protect at least these invariants:

- Only a frozen candidate matching a trusted verification receipt can qualify.
- Cancellation and attempt generation prevent late results advancing a run.
- Retry cannot reset a deadline, spent budget or repair count.
- Domain rejections such as BudgetExceeded and CandidateDigestMismatch do not
  enter transient operational retry loops.
- A model assertion cannot become a verification fact through a model-facing tool.

Cross-run spending reservations and admission deduplication use atomic application
ledger transactions. A per-run aggregate or eventually consistent report cannot
enforce a global spending cap on its own.

### Application And Service Boundary

Use Effect 4 Context.Service contracts for the RunRepository, WorkerExecutor,
MigrationAgent and ArtifactStore ports. Keep Clock and other runtime facilities
explicit where an application operation needs them. The RunCoordinator sequences
use cases, applies domain decisions and enforces the execution contract.

Compose live implementations through Layers once at the CLI composition root.
Helpers yield required services directly; they do not provision their own live
dependencies. Tests may supply replacements at their exported test boundary.

Use scoped acquisition and release for worker handles and bounded concurrency for
execution. Interruption alone is not evidence of cleanup: the worker adapter must
stop and reconcile processes and containers, and the ledger records the outcome.
A hard process kill cannot run finalizers, so restart reconciliation is mandatory.

Expected domain refusals and operational failures remain distinct. Retry only
explicitly classified, idempotent transient operations. Persist the original
deadline, attempt limits and spending reservations; runtime restarts do not reset
them. Avoid nested retry layers multiplying the approved budget.

### Flue Boundary

MigrationAgent wraps Flue's supported API. Convert Promise failures to typed Effect
errors and explicitly propagate cancellation through Flue's supported mechanism;
do not assume wrapping a Promise makes its external operation abortable.

Flue receives restricted repository tools, never a qualification or publishing
capability. Tool calls enter the coordinator through a shared scoped runtime
established at the composition root, not a newly assembled runtime per call.
Contract tests must establish runtime lifetime, error propagation and cancellation
on that bridge before consumer migration work.

Flue owns conversation recovery only. It does not decide run completion, replay
application operations without reconciliation, or mutate the application's run
tables. The application likewise does not write Flue's internal storage.

### Persistence And Recovery

Retain the two file-backed SQLite databases proposed in the architecture:
application state and Flue conversation state. Commit run transitions, operation
intents and relevant budget reservations atomically in the application database.
Do not claim one transaction spans the application and Flue databases.

Use persisted operation identities and restart reconciliation to bridge that
boundary. Reject stale generations and ambiguous outcomes. The run ledger, not
Effect fibers or Flue transcripts, is authoritative for application recovery.

Store current run state plus append-only transition history. Full event sourcing,
distributed Command Query Responsibility Segregation, a message broker and another
durable workflow engine are not required for the first slice. Neither Effect
scopes nor local SQLite adds host-loss recovery to the existing guarantee.

### Alchemy Boundary

Borrow the useful DDD vocabulary without taking a dependency on alchemy/Domain.
The 2026-10-18 assessment found upstream Domain declarations but no top-level
Domain implementation in npm's latest alchemy 2.0.0-beta.83 package. Upstream
provides in-memory and Cloudflare hosting; a ready-made durable Bun/SQLite Domain
backend was not established. These are assessment observations, not a permanent
claim about future releases.

Alchemy infrastructure provisioning is a separate future decision. It must not
enter domain rules, migration helpers or untrusted repository workers. Revisit
Domain adoption when a published release and suitable durable backend exist, or
when an approved cloud control-plane design makes its tradeoffs worthwhile.

## Consequences

- Pure rule tests can run without credentials, database setup or model calls.
- Layer composition makes live dependencies and replacement test adapters visible.
- Effect adds runtime and type complexity; keep its orchestration out of pure
  decisions and avoid wrappers that add no lifecycle or failure semantics.
- The Flue-to-Effect bridge becomes an explicit compatibility risk to qualify.
- SQLite transactions, operation reconciliation and worker cleanup remain real
  engineering work; Effect does not provide those guarantees automatically.
- Avoiding Alchemy Domain preserves the initial deployment but retains ownership
  of the small domain model and transition ledger.

## Implementation Impact And Probe Plan

### Repository Structure Amendment

On 2026-10-18 the owner additionally required a Moon monorepo. Use one private Bun
workspace root and root bun.lock, with Moon for the project/task graph. Moon does
not replace Effect execution, Flue reasoning or the durable run ledger. Keep
stateful compatibility and future qualification tasks uncached, with task retries
disabled; do not substitute cache hits or affected-only selection for evidence.

Only the compatibility project is instantiated in the initial slice. The future
package boundaries below are planned, not additional implementation scope.

This section identifies future work, not permission to execute it. The named paths
are proposed; none exist as application code today. The later implementation plan
must preserve these boundaries or obtain review for a change.

| Proposed path                                             | Responsibility                                            |
| --------------------------------------------------------- | --------------------------------------------------------- |
| packages/domain/src/upgrade-run.ts                        | Immutable state, commands, facts and pure decisions       |
| packages/domain/src/identities.ts                         | Validated identities and digests                          |
| packages/engine/src/ports.ts                              | Typed Effect service contracts                            |
| packages/engine/src/run-coordinator.ts                    | Application use cases and invariant application           |
| packages/engine/src/adapters/flue/migration-agent.ts      | Flue bridge, errors and cancellation                      |
| packages/engine/src/adapters/docker/worker-executor.ts    | Scoped worker execution and cleanup                       |
| packages/engine/src/adapters/sqlite/run-repository.ts     | Transactional ledger and reconciliation data              |
| packages/engine/src/adapters/filesystem/artifact-store.ts | Validated artifact storage                                |
| apps/cli/src/composition.ts                               | Live Layers and the single controller runtime             |
| packages/domain/tests/ and packages/engine/tests/         | Pure rules, fake-port orchestration and adapter contracts |
| probes/bun-effect-flue/                                   | First Moon project: bounded compatibility fixture         |

Future dependencies are constrained to Effect >=4.0.0 <4.1.0 and one exact Flue
release chosen from its published supported API. Record and lock exact versions
with the exact Bun controller version before running a probe. No latest ranges,
Alchemy, custom persistence adapter or second workflow engine are implicit
dependencies. Consumer Node/Bun versions remain separate profile concerns.

The compatibility probe has the existing proposed two-hour effort cap within the
first-slice appetite. Start with offline tests, then separately approved real
adapter checks. Pinning dependencies, installing them and running either phase
require the reviewed implementation plan. Paid model calls, remote content and
container execution additionally require their existing data, host and spending
approvals.

The probe must cover:

1. Effect service composition and pure UpgradeRun decisions under Bun.
2. Flue startup, tool registration and the Effect bridge using a supported test
   mechanism when available; label missing real-provider coverage explicitly.
3. File-backed Flue and application persistence across process restart.
4. Cancellation propagation, stale-result rejection and unchanged retry budgets.
5. Real worker cleanup and model cancellation only when separately authorised;
   mocks do not qualify either external mechanism.

Write selected versions, commands, outcomes, timings and missing coverage into a
probe report. If the selected combination fails, stop before migration features;
do not switch to Node, fork Flue or create a persistence adapter automatically.

Configuration must keep model credentials controller-only, use an owner-only state
directory outside workers, and reference a reviewed profile. No environment
variables are configured by this ADR. There is no existing code or data migration.

### Verification

- [ ] Domain tests reject qualification before freeze or with mismatched digests.
- [ ] Pure decisions use explicit time and policy inputs without external I/O.
- [ ] Cancelled or superseded attempts cannot accept late verification results.
- [ ] Rejected decisions do not mutate state or enter operational retries.
- [ ] Atomic ledger tests prevent duplicate admission and overspending reservations.
- [ ] Restart preserves deadline, spend, attempts and cancellation intent.
- [ ] Live Layers are assembled only at the composition root, not in local helpers.
- [ ] Domain imports contain no infrastructure clients or runtime execution calls.
- [ ] Flue tool calls preserve the intended Effect runtime and scope lifetime.
- [ ] Flue and application SQLite state recover independently on the same host.
- [ ] Real cancellation tests confirm worker removal; fake tests are labelled.
- [ ] A probe report records exact versions, commands, failures and evidence gaps.
- [ ] No Alchemy dependency, extra workflow engine or publication capability is added.
- [ ] Moon manages the project graph; Bun owns one root workspace lockfile.
- [ ] Stateful qualification tasks bypass caching and automatic task retries.

## References And Review

- [Effect Context](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Context.ts)
- [Effect Layers](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Layer.ts)
- [Effect resource management](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts)
- [Flue persistence](https://flueframework.com/docs/guide/database/)
- [Flue durability](https://flueframework.com/docs/guide/durability/)
- [Alchemy DDD source](https://github.com/alchemy-run/alchemy/blob/main/website/src/content/docs/domain/what-is-ddd.mdx)
- [Alchemy Domain platform](https://github.com/alchemy-run/alchemy/blob/main/packages/alchemy/src/Domain/Platform.ts)
- [Alchemy published metadata](https://registry.npmjs.org/alchemy/latest)

Accepted by the project owner on 2026-10-18. At acceptance, the compatibility
probe had not run and no dependency compatibility or runtime acceptance was
claimed. The
[compatibility implementation plan](../superpowers/plans/2026-10-18-bun-effect-flue-compatibility.md)
required review and execution-method selection before work began.

Subsequent implementation: the owner approved inline execution in an isolated
worktree. The [offline probe report](../assessments/bun-effect-flue-compatibility.md)
records the pinned cohort, strict source/vendor declaration policy, same-host
completed-receipt restart and synthetic cancellation results. This does not close
the production aggregate, real worker/model, active-job or host-loss verification
items above, or authorise the next service slice.

On 2026-10-19 the owner selected XState's Effect adapter for the local worker
lifecycle and approved its written record and spec the same day.
[Accepted ADR-0002](0002-adopt-xstate-effect-for-worker-lifecycle.md)
records that narrow amendment. It does not replace this
record's application/domain ownership or approve another durable workflow engine,
dependency installation, Docker execution or the broader service draft.
