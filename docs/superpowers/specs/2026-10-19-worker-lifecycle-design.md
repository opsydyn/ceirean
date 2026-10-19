# Worker Ownership And XState Effect Lifecycle

Status: written spec and ADR-0002 approved by the owner on 2026-10-19. The
owner selected `@xstate/effect` as the framework, not an alternative to investigate.
The [implementation plan](../plans/2026-10-19-worker-lifecycle.md) requires review
before execution. This document adds no dependency/code and authorises no
installation or live execution.

## Intent And Baseline

Make worker ownership, readiness, cancellation and cleanup explicit enough to
extend without scattered callbacks or ambiguous flags. Scaling means a
maintainable lifecycle model here; no throughput or production recovery gain
has been measured.

The qualification tracer has pure domain rules and an Effect coordinator with
synthetic services, but no worker or durable application adapter. Keep
`qualifyRun`, exact-evidence validation, original-revision conditional commits,
existing laws and probe source unchanged in the first implementation slice.
Its passing tests do not qualify this new design.

The broader service draft still needs separate review. This spec does not
approve its complete migration workflow, host, resource caps, credential policy,
real Docker adapter or live execution.

## Architecture And Alternatives

Use one XState definition for worker lifecycle orchestration, hosted by
`@xstate/effect` inside the existing Effect application. The application ledger
remains authoritative for committed business records and operation intent.

Schema/Match remains suitable for pure qualification rules, but was not selected
for the new event-driven lifecycle: explicit cancellation, reconciliation and
resource lifetime benefit from a statechart. Bare Docker wrappers leave that
sequencing implicit. Alchemy/celld adoption adds unrelated hosting/storage
commitments and is not selected.

This narrowly amends ADR-0001's deferral of another workflow engine: a local
interpreter is selected, not a second durable coordinator. Flue owns reasoning,
Effect owns execution/services, and the ledger owns durable intent. See
[accepted ADR-0002](../../decisions/0002-adopt-xstate-effect-for-worker-lifecycle.md).

## Cohort And Universal Policy

The selected exact evaluation cohort for the later plan is
`@xstate/effect@0.1.0-alpha.6` and `xstate@6.0.0-alpha.64`, in the private engine
workspace only. Keep Effect `4.0.5`,
Bun `1.4.2`, Moon `2.5.4`, TypeScript `7.0.2`, bun-types `1.4.2`, oxlint `1.88.0`,
oxfmt `0.73.0` and `@opsydyn/oxlint-effect@2.0.1` unchanged.

Exact registry manifests were read on 2026-10-19, without installation. The
adapter peers are Effect `^4.0.0` and XState `^6.0.0-alpha.63`: compatible ranges
are not proof of Bun/types/runtime compatibility. Both new packages are
experimental. Avoid moving dist-tags; the observed adapter `alpha` tag returned
an older release than exact alpha.6.

The reviewed implementation plan owns installation and the single root lockfile
update. Require one Effect instance, no unrelated cohort changes, Zod, Vitest,
new test runner or additional workflow/persistence dependency. Unexpected changes
require review, not silent upgrades.

All 141 Effect rules remain at error universally. Add no disables, blanket
ignores, manual Effect/Layer channels, renamed channel aliases, fake inference
factories, inline helper provisioning or per-operation runtimes. Infer service
contracts from real factories as in engine `service-factories.ts` and `ports.ts`.
Keep `skipLibCheck: false` in new code; vendor declaration failures block work
until reviewed rather than inheriting the probe exception. No Node runtime fallback.

## Ownership And Components

RunCoordinator owns admission, current generation, cancellation intent, limits
and qualification. A controller-owned WorkerLifecycle service manages one root
Effect actor per worker operation, not a runtime per actor/request. Duplicate
acquisition for one operation must reuse its owned actor or refuse, never start
a second independent interpreter. The actor
invokes narrow journal, readback and mutation services; the future Docker adapter
owns mechanism, never qualification policy.

Flue and consumer code receive no raw actor handle/arbitrary `send`, journal
writes, Docker socket, cleanup capability or model-supplied shell execution.
Application operations validate inputs; actor outcomes/errors are always observed.

Domain may contain schema-derived identities, records, refusals and pure evidence
checks. It imports no XState runtime or Docker client. Engine owns the single
machine definition and interpreter. Do not add a second orchestration reducer or
adapter-maintained authoritative phase. Actor snapshots are in-process execution
state, not an alternate durable run ledger.

Proposed implementation areas are domain `worker-operation.ts`, engine worker
contracts/factories/ports, `worker-lifecycle.ts` for the machine and
`worker-lifecycle-service.ts` for owned acquisition and observation. The detailed
plan must name actual signatures and focused test files. Memory journal/fakes
remain under engine tests; src never imports them. Do not scaffold empty CLI or
production adapter projects.

## Identity And Intent Barriers

Each operation binds RunId, AttemptId, generation, unique WorkerOperationId,
purpose (`Baseline`, `Candidate` or `Verification`), approved host/daemon identity,
exact image/source/policy/configuration digests, disposable-resource custody,
controller-owned staging, original absolute deadline and unchanged spend/repairs.

Each create, start, stop and remove has its own unique mutation intent. Atomically
commit intent against the expected business revision before issuing that action.
The commit claims that action for a single issuer; an already claimed intent
cannot be claimed again by another actor or after restart. A crash between the
claim and the external call remains ambiguous, not permission to repeat it.
Record completion, known failure or unresolved outcome before advancing. A lost
revision/current-execution-authority check cannot launch the external mutation.
Never hold a journal transaction while awaiting Docker or an invoked task.

Bind the observed immutable container ID after creation. Names and labels are
discovery hints, not authority. Binding a discovered result requires the same
host/daemon, full operation identity, exact resource and pinned configuration.
This is not exactly-once execution or a transaction spanning Docker and SQLite.

## Lifecycle And Errors

Represent recording intent, creating, checking readiness, ready, executing,
stopping, removing, reconciling, blocked and released explicitly. Only `Released`
finishes the disposable worker lifecycle; blocked is not a synonym for absent.

Mutations are declared invoked Effects after intent commit succeeds. Do not
enqueue Docker work directly from state entry/background actions before that
barrier. A successful send/transition does not establish persistence or completed
external work. No blind mutation retries, actor-supervision restarts that replay
actions or implicit writes on state re-entry. Read-only observation may repeat
within its persisted bound, never resetting time on each read.

Runtime-decode external observations and machine inputs. Malformed events, dead
letters, stale results and identity mismatches cannot trigger work or success
receipts. Expected refusals remain values; operational failures remain tagged.
Map unexpected machine failures to a sanitized lifecycle-runtime error at the
application boundary, not a public unknown error channel or success fallback.

## Readiness

Readiness requires controller readback matching container/operation identity,
image/spec digests and declared mount, network and security configuration.
Record the subject, observation time and policy binding. A running process or
worker-written message is insufficient. Mismatch refuses execution; missing,
malformed, unavailable or ambiguous readback blocks it. Not-yet-ready observations
may repeat within the original deadline. Current run authority is also required:
an old-generation ready result cannot authorise work or qualification.

Configuration inspection does not prove egress enforcement, resource limits or
containment. Live qualification on an approved host is separate. Do not weaken
non-root execution, dropped capabilities, no-new-privileges, bounded resources,
credential separation or browser sandboxing. No actual network profile or
numerical production execution cap is approved here.

## Cancellation And Cleanup

Persist cancellation before relying on actor delivery. It blocks new execution
and drives reconciliation/cleanup; it does not prove the local task or Docker
stopped. Do not make Cancelled a final worker state or stop the lifecycle actor
merely because the run is terminal.

Keep cleanup evidence distinct: `CleanupPending`, `CleanupConfirmed` or
`CleanupUnknown`. Known refusal/failure stays visible with its tagged reason.
Confirmation requires observed absence of all declared disposable resources and
no unresolved mutation that could create/start them later. Retained evidence
artifacts have a separate retention policy.

Custody is mandatory before destruction. Missing/conflicting ownership, foreign
resources, escaping paths or another host/daemon block deletion. Never widen
custody or delete by name prefix. Superseded operations may clean their own
explicitly recorded old-generation resources, but cannot touch replacements,
advance runs or reset budgets. Forbidding all old-generation cleanup strands them.

Cleanup has a separately bounded policy deadline anchored when requested, not
an extension of expired execution time. Recovery resets neither deadline.
Missing/invalid/overflowing policy times block work. The later implementation
plan supplies explicit synthetic test values, not production defaults.

## Scope And Shutdown

Compose actor/service Layers once at the application boundary, with dependencies
alive outside the actor scope. Use declared tasks/actions for inferred service
requirements and Effect Clock/TestClock rather than another timer system.

Task-local resources remain invocation-scoped. Apply `withActorScope` selectively
to resources spanning tasks: it uses the root actor even from nested invocations.
Do not accidentally retain every worker under one global root or release a worker
when its create task returns.

No raw stop/remove in a finalizer may bypass the journal or duplicate a mutation.
Orderly shutdown requests cleanup while actors/services remain alive, drains
within a bound, then closes resources. Failure retains pending/unknown intent for
recovery. Scope closure waits for local finalizers, but finalizer completion and
SIGKILL establish no external absence.

## Ambiguity And Recovery

An interrupted create/start/remove may still complete externally. Reconcile its
intent and exact resource, never automatically repeat it. No match after an
ambiguous create is not immediate proof of absence: the request may still finish.
Multiple matches or foreign resources also block. Invent no Docker idempotency or
fencing guarantee. Unresolved work needs authoritative evidence or explicit
operator resolution, not an automatic force-adopt/force-delete escape hatch.

Persisted XState snapshots currently cannot restore into a new Effect interpreter
and omit progress inside running Effects. Store validated business records and
intent instead. A new actor bootstraps into reconciliation from those records,
without replaying state-entry mutations or granting a fresh time allowance.

This is a protocol to implement and qualify, not an existing recovery guarantee.
The first tracer uses synthetic journal snapshots and external observations;
it cannot prove disk durability, process/host-loss recovery or Docker cleanup.
A real journal, controller lock and Docker driver remain later slices.

## First Implementation And Acceptance

First qualify the exact packages under Bun, strict types, lint and coherent Effect
resolution. Then build a narrow offline tracer using the real actor interpreter,
Effect-native fake services and an atomic memory journal. No Docker daemon,
subprocess, network work, SQLite application adapter, model, publisher or actual
migration is added. Framework direction is selected; the first task is a
compatibility gate, not a competition with another FSM library.

The later plan must test:

- Inferred requirements, one composition boundary, owned actor lifetimes,
  observed typed task failures and mapped unexpected machine errors.
- Runtime input rejection and deterministic TestClock deadlines without casts
  erasing dependency requirements.
- Intent commit before every mutation; lost revisions/cancellation preventing
  execution; no duplicate writes on timeout, re-entry or reconstruction.
- Duplicate actor acquisition and competing intent claims cannot create two
  issuers for one action; a crash after claim but before the call stays unresolved.
- Cancellation during intent recording, creation/startup; interrupted local
  work cannot claim cleanup or start a replacement.
- Lost create/start/remove responses, no match while creation remains unresolved,
  multiple matches, malformed readback and foreign IDs/host/custody.
- Fresh-actor reconciliation from business data, without snapshot restoration,
  replayed mutations, deadline/budget reset or lost cancellation intent.
- Owned superseded cleanup without touching replacements; complete absence and
  resolved pending mutations before confirmation; retained artifacts preserved.
- Orderly shutdown and cleanup observation failure cannot silently succeed.

Prefer Effect Arbitrary laws for bounded event sequences: 1000 cases at each
seed 0, 1 and 163; size 50; maxShrinks 1000; maxDiscards 10000; at most 50 events.
Include positive readiness and cleanup paths to reject always-refusing designs.
Use Deferred barriers for races, no sleeps/detached fibers/global generator config.
XState graph paths may supplement, not replace, laws and controlled interleavings.

Run existing domain/engine/probe tests and strict typechecks, root lint/format,
frozen script-free install and cohort audit sequentially under only PATH, HOME
and TMPDIR. Keep Moon evidence uncached, retryCount 0, envFile false,
`--force --no-actions`; Bun uses `--no-env-file --no-install`. Commit each verified
task. Do not modify existing qualification or claim production scaling from this.

## Stop Conditions And Handoff

If the pinned cohort cannot satisfy strict types, inferred dependencies,
cancellation/errors and universal lint, stop with concrete evidence. Do not
downgrade Effect, switch to Node, relax rules, fork the adapter or replace the
framework silently. Changed package selection requires owner review.

The approved two-hour appetite covers design only, not implementation or live
execution. Written-spec and ADR review precede a detailed implementation plan
and execution-method selection. No merge, push, installation or Docker approval
is inferred. No throughput baseline or comparative performance has been measured.

## References

- [ADR-0001](../../decisions/0001-adopt-effect-and-domain-boundaries.md)
- [Qualification evidence](../../assessments/qualification-gate.md)
- [XState Effect actors](https://stately.ai/docs/xstate/v6/effect/actors)
- [Testing, errors and persistence](https://stately.ai/docs/xstate/v6/effect/testing-and-errors)
- [Adapter alpha.6 release](https://github.com/statelyai/xstate/releases/tag/@xstate%2Feffect@0.1.0-alpha.6)
- [Exact adapter manifest](https://registry.npmjs.org/@xstate%2Feffect/0.1.0-alpha.6)
- [Exact XState manifest](https://registry.npmjs.org/xstate/6.0.0-alpha.64)
- [Alchemy-celld snapshot](https://github.com/joelhooks/alchemy-celld/tree/3fa30903a4c5d73032839a304c05b815f6797abe)

Sources inform the design, not proof this cohort passed their tests. Borrow
custody/readback/no-blind-retry ideas without optional-custody/log-and-continue
defaults. No Alchemy/celld dependency is selected.
