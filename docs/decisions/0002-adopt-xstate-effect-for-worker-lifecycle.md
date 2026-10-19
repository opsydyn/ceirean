---
status: proposed
date: 2026-10-19
decision-makers: Project owner
---

# ADR-0002 Adopt XState Effect for worker lifecycle

## Context

The owner approved worker ownership/lifecycle boundaries and selected
`@xstate/effect` to make them easier to extend. The current qualification tracer
has pure decisions and a synthetic Effect coordinator, but no worker or durable
application adapter. A machine alone does not qualify either boundary or prove
improved throughput.

This record captures the chosen direction for written review. `proposed` means
the written ADR is not yet accepted, not that framework selection remains open.
Installation/implementation await written-spec, detailed-plan and execution gates.

## Decision

Host one lifecycle actor per worker operation through `@xstate/effect` inside the
existing Effect application. The controller owns lifetime and composition.
XState defines worker orchestration; Effect owns tasks/services/scopes/clocks;
the application ledger owns committed business records and operation intent.
Flue retains reasoning only.

Select exact `@xstate/effect@0.1.0-alpha.6` and `xstate@6.0.0-alpha.64`, retaining
Effect `4.0.5` and Bun `1.4.2`. Peers admit this combination; strict types/Bun
behavior remain unmeasured. Both additions are experimental. A reviewed plan
adds them only to private engine with one root lockfile and one Effect instance.

This narrowly amends [ADR-0001](0001-adopt-effect-and-domain-boundaries.md), not
replaces it. Another durable workflow engine remains deferred. A local worker
interpreter does not replace RunCoordinator, pure qualification, ledger/Flue
ownership or recovery reconciliation.

## Alternatives

| Option                                  | Benefit                                                           | Tradeoff / disposition                                                                     |
| --------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Schema/Match lifecycle decisions        | Familiar, pure, no new dependency                                 | Scheduling/lifetime/supervision stay application code; not selected for this new lifecycle |
| XState with Effect host                 | Explicit statecharts, inferred services, scopes/clocks/inspection | Alpha maintenance and persistence boundaries need qualification; selected                  |
| Bare Docker wrappers                    | Small mechanism surface                                           | Ambiguous cross-operation recovery stays implicit; insufficient alone                      |
| Alchemy/celld or another durable engine | Broader hosting/runtime facilities                                | Expands infrastructure before a real worker proof; deferred                                |

## Constraints

- Persist mutation intent before action; failed conditional commits cannot issue
  mutations. Duplicate actor acquisition cannot create another issuer, and an
  already claimed action stays non-repeatable even after a crash. No blind retry
  or replay on state re-entry.
- Ready needs exact controller readback, not process liveness or an agent claim.
- Run cancellation initiates cleanup; only confirmed release ends worker lifecycle.
  Local interruption/finalizers do not establish external absence.
- Destruction requires custody. Superseded workers can clean their own resources,
  not touch replacements or advance runs.
- Reconstruct from business data into reconciliation, not XState snapshots:
  restoration into a new Effect interpreter is currently unsupported.
- Keep domain pure and one worker orchestration definition, not a second durable
  coordinator or adapter-managed authoritative phase.
- Keep all 141 Effect rules at error, inferred real factories, `skipLibCheck: false`.
  No disables/manual channels/fake inference, helper provisioning, per-operation
  runtimes or Node fallback.

## Implementation Impact

The [spec](../superpowers/specs/2026-10-19-worker-lifecycle-design.md) is the full
contract. The later implementation plan must address:

1. Engine package manifest/root lock: exact packages, coherent Effect resolution,
   strict Bun/type/lint gate first. No environment configuration is added here.
2. Domain `worker-operation.ts`: pure schema data/evidence, no runtime or duplicate
   orchestration reducer.
3. Engine worker contracts/factories/ports: real inferred journal/mechanism seams,
   following existing `service-factories.ts` and `ports.ts`.
4. Engine `worker-lifecycle.ts` and `worker-lifecycle-service.ts`: machine,
   owned acquisition, persistence barriers, surfaced outcomes and shutdown.
5. Engine tests: real interpreter, Effect-native fakes, atomic memory journal,
   properties, controlled races and simulated reconstruction.
6. README/roadmap and a measured report: exact artifacts, observed gates/counts,
   failure controls and external proof gaps.

These are follow-up areas, not an approved implementation plan. Existing
`qualifyRun`, domain run decisions and probe source stay unchanged initially.

## Later Verification

- [ ] Exact packages work under Bun with one Effect instance, no vendor exception,
      rule relaxation or unintended dependency upgrade.
- [ ] Real factories infer services, composition occurs once, actor failures are
      observed and unexpected failures become tagged application errors.
- [ ] No mutation precedes its intent commit or follows a lost execution-authority
      check; timeout/re-entry/reconstruction cannot duplicate it.
- [ ] Lost responses/interruption cannot claim readiness, a fresh deadline or cleanup.
- [ ] Foreign resources are protected; superseded cleanup cannot touch replacements.
- [ ] Cancellation keeps cleanup active; missing readback cannot confirm absence;
      retained artifacts survive disposable cleanup.
- [ ] Recovery uses journal data and observation, no snapshot restoration/replay/reset.
- [ ] TestClock/Deferred tests and non-vacuous bounded properties execute under
      unchanged budgets, and all existing checks still pass.
- [ ] Measured evidence separates synthetic proof from real Docker isolation,
      durable recovery, external cleanup and production scaling.

## Consequences And Revisit

Statecharts make sequencing inspectable, but add an alpha dependency and actor
supervision boundary. Review every exact-cohort update. Stop on incompatible
types/Bun behavior, unobservable errors or unenforceable persistence barriers;
review concrete evidence with the owner rather than changing policy or libraries.

The first implementation is offline: no Docker daemon, SQLite application adapter,
subprocess/model work, publication, infrastructure or migration. Production
isolation, persistence and host-loss recovery remain separate qualification work.

References: [actors](https://stately.ai/docs/xstate/v6/effect/actors),
[errors/persistence](https://stately.ai/docs/xstate/v6/effect/testing-and-errors),
[alpha.6 release](https://github.com/statelyai/xstate/releases/tag/@xstate%2Feffect@0.1.0-alpha.6).
