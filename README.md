# Leviathan

An internal dependency migration service, built to dogfood across Opsydyn
repositories before considering a broader product.

Repository direction: a Moon-managed Bun workspace monorepo. The first private
compatibility probe and pinned workspace configuration are scaffolded.

## Status

The offline compatibility probe's 36 tests cover pure decisions, real Flue tools
through Effect, process-kill recovery and distinct read/abort semantics. The
canonical typecheck passes with strict source checking and the owner-approved
probe-local vendor declaration policy. This does not qualify production use.
There is no production application, GitHub remote, scheduled job or deployment.

The synthetic qualification-gate tracer is implemented and locally verified:
119 domain tests, 55 engine tests, and 36 unchanged probe tests pass (210 total).
Its 31 domain properties evaluate 93,000 cases per full run. Controlled Effect
races use a test-only in-memory repository, not a durable application adapter.
Task 4 Step 7 is complete: the whole-branch review is clean through `e7d9d25`,
and the controller independently passed all nine acceptance commands at that head.
This remains local-only on `codex/qualification-gate`, not merged to main or pushed.

[Measured qualification-gate evidence](docs/assessments/qualification-gate.md)
records the exact tested-code commit, lock identities, gates and exclusions.

[Measured compatibility checkpoint](docs/assessments/bun-effect-flue-compatibility.md)
records exact pins, measured results, dependency declaration limitations and
excluded systems.

The initial product outcome is a reviewable dependency migration with reproducible
qualification evidence and less maintainer effort. Producing more version-bump
pull requests is not the success measure.

## Agreed Direction

- Bun and TypeScript first, with Flue at the core of bounded agent reasoning.
- Moon owns the monorepo project graph and development tasks; Bun owns workspace
  dependencies, the lockfile and application execution.
- Effect for application orchestration, with pure domain decisions and explicit
  infrastructure adapters, recorded in accepted ADR-0001.
- A dedicated central service, independent of its consumer repositories.
- FoldKit experiments first; the postcode client second; wider internal adoption
  only after successful dogfooding.
- Keep the public Astro and Viz packages independent of service machinery.
- Rust is parked pending a measured bottleneck and a separate decision.
- Alchemy Domain and additional workflow engines are deferred for the pilot.
- The owner selected `@xstate/effect` for local worker lifecycle orchestration,
  not another durable coordinator. The written spec and ADR-0002 are approved;
  execution is approved, and Task 1's exact-cohort gate is committed and reviewed
  clean at `91c0f01`. Task 2's pure domain implementation awaits controller review.
- No automatic merge, package release or deployment.

## Proposed First Slice

A manually requested FoldKit migration from an immutable base revision, executed
in disposable workers. Initially export the patch and evidence without opening a
live pull request.

1. Validate the request against a reviewed central repository profile.
2. Establish an unchanged baseline; existing failures block qualification.
3. Apply the dependency update and bounded source migration.
4. Freeze the candidate and independently run the approved acceptance checks.
5. Export a receipt binding results to the exact source, patch and toolchain.
6. Obtain maintainer review before any separately approved publication.

Profiles describe toolchains, companion dependencies, allowed changes, protected
acceptance files, qualification commands and required evidence. Repository code
must not execute with publication credentials. Agent completion is not proof of
qualification.

The detailed workflow, isolation, credential, storage and recovery designs still
require review. The proposed pilot effort and spending limits are not approved
execution budgets.

## Planning Checklist

- [x] Agree the dedicated service boundary and initial dogfood repositories.
- [x] Lock Bun first and retain Flue at the core.
- [x] Create the local Leviathan repository.
- [x] Agree the Effect, pure-domain and Flue ownership direction.
- [x] Review and accept the written Effect and domain-boundary ADR.
- [x] Require a Moon-managed Bun workspace monorepo.
- [ ] Approve the manual workflow and repository profile contract.
- [ ] Approve worker isolation, credentials, persistence and recovery design.
- [ ] Select a historical migration and define acceptance evidence and budgets.
- [ ] Review the written design specification.
- [x] Review an implementation plan and select execution method (compatibility probe only).
- [ ] Implement and qualify the first dry run.
- [ ] Separately approve a GitHub remote, app installation and draft PR publication.

## Product Plan

[Bun First Agent Upgrade Platform Product Plan](https://chatgpt.com/space/page_f7bcb77a27c08191af1b7a6621fb7c9b)

The product plan contains the proposed pilot roadmap, evaluation thresholds and
stop conditions. Its budgets and later phases remain proposals, not authority to
run paid jobs or change external systems.

[Local delivery roadmap](docs/roadmap.md) tracks the next slices, including later
organisation discovery and config-only self-PRs against Leviathan for new repos.
Discovery does not automatically enable migrations or grant execution access.

## Architecture Draft

[Internal Upgrade Service Design](docs/superpowers/specs/2026-10-18-internal-upgrade-service-design.md)

The draft proposes a single-owner CLI, isolated workers, separate run and Flue
storage, immutable qualification and dry-run evidence. Its broader service design
needs owner review before a service implementation plan. The narrow compatibility
plan below follows accepted ADR-0001 only. Process-restart recovery is in scope;
host-loss recovery and GitHub dispatch are deferred.

## Architecture Decisions

[ADR-0001 Adopt Effect orchestration and pure domain decisions](docs/decisions/0001-adopt-effect-and-domain-boundaries.md)

Status: accepted on 2026-10-18. It defines service ownership, dependency
boundaries and the scope of the Bun/Effect/Flue compatibility probe. The pure
fixture, Flue/Effect tool loop, same-host completed-receipt restart and synthetic
cancellation semantics are tested. Real providers, containers and production
architecture remain unqualified.

[ADR-0002 Adopt XState Effect for worker lifecycle](docs/decisions/0002-adopt-xstate-effect-for-worker-lifecycle.md)

Status: accepted by the owner on 2026-10-19.
It narrows the additional-engine deferral to allow an Effect-hosted local worker
statechart, retaining the ledger as durable authority. The owner approved plan
execution; Task 1's clean review admits the pinned cohort locally, not live workers
or durable recovery.

## First Implementation Plan

[Bun Effect Flue Compatibility](docs/superpowers/plans/2026-10-18-bun-effect-flue-compatibility.md)

Approved for inline execution in an isolated worktree. Its four phases pass with
the approved Valibot 1.5.0 correction and probe-local `skipLibCheck` policy. A
fresh whole-branch review found no issues and independently reran the tests and
typecheck. The plan covers a credential-free offline probe using
the real Flue runtime with a synthetic provider; it does not implement the
upgrade service or qualify real models, containers or deployment.

## Next Application Design

[Qualification Gate Tracer](docs/superpowers/specs/2026-10-18-qualification-gate-design.md)

The qualification-gate written spec is approved, with property-based domain tests
preferred using Effect's built-in Arbitrary support and inferred port contracts
preserving the universal lint policy. The
[implementation plan](docs/superpowers/plans/2026-10-18-qualification-gate.md)
was executed through Task 4 Step 7 in the existing qualification-gate worktree.
Private domain and engine packages implement the synthetic tracer. The review of
`6809192..e7d9d25` found no actionable issues; the exact range and independent
controller results are recorded in the measured assessment. Real providers,
workers, durable application storage and publication stay outside this slice.
The subsequent documentation closure was separately approved through `742a5df`;
later docs-only corrections do not extend that reviewed range.

## Worker Lifecycle Design

The next design is
[Worker Ownership And XState Effect Lifecycle](docs/superpowers/specs/2026-10-19-worker-lifecycle-design.md).
The written spec, ADR and plan execution are approved. The selected evaluation pins are `@xstate/effect@0.1.0-alpha.6`
and `xstate@6.0.0-alpha.64`, with existing Effect `4.0.5`. The first planned
implementation is an offline actor/journal tracer, not Docker or durable recovery.
The [implementation plan](docs/superpowers/plans/2026-10-19-worker-lifecycle.md)
records Task 1's clean independent review and commit `91c0f01`; its
[measured cohort evidence](docs/assessments/worker-lifecycle.md) is local-only.
Task 2's pure schemas/readiness/custody checks are implemented; controller review
is pending before Task 3. No lifecycle engine protocol, Docker or durable recovery
is established by this domain-only work. The whole plan remains incomplete.

## Monorepo Layout

```text
.moon/                      Project graph, toolchains and development tasks
.prototools                 Exact Moon, Bun and development-only Node pins
package.json                Private Bun workspace root
bun.lock                    One root dependency lockfile
apps/cli/                   Future CLI and live dependency composition
packages/domain/            Pure qualification evidence and run decisions
packages/engine/            Qualification coordinator and inferred ports
probes/bun-effect-flue/      Private compatibility fixture
docs/                       Decisions, specifications, plans and evidence
```

The root Moon project owns quality tasks; domain, engine and probe are private workspaces.
Do not scaffold empty production packages. Evidence tasks run uncached with no automatic retries;
Moon is not Leviathan's durable run coordinator or container security boundary.

## Quality Gates

Install the exact tools in `.prototools` with `moon setup`, then install dependencies
with `bun install --frozen-lockfile --ignore-scripts`. Node 24.15.0 runs developer
tooling only: standalone Oxlint needs Node for its JavaScript plugin and TypeScript
config. Application and probe execution remain Bun 1.4.2; Node is not a runtime
fallback. Moon does not automatically install workspace dependencies.

```sh
bun run check                     # Oxlint, then oxfmt check
bun run lint:fix                  # Apply available lint fixes, then review
bun run format                    # Format owned source, config and docs
moon run workspace:check --force --no-actions
moon run domain:typecheck --force --no-actions
moon run engine:typecheck --force --no-actions
moon run probe:typecheck --force --no-actions
moon run domain:test --force --no-actions
moon run engine:test --force --no-actions
moon run probe:test --force --no-actions
```

`oxlint.config.ts` enables every Effect 4-applicable rule from
`@opsydyn/oxlint-effect@2.0.1`: 141 rules, all errors, including the 20 beyond
`recommendedRules`. There are no blanket source/test exclusions or rule disables.
Native adapter and test boundaries are explicit paths. Warnings fail the gate.
`oxfmt@0.73.0` owns formatting; `oxlint@1.88.0` owns linting. Use `bun run lint`,
not an assumed Bun-native linter. Type-aware Oxlint extensions are not enabled.

[Quality tooling evidence](docs/assessments/code-quality-tooling.md) records the
baseline, fixes, checks and remaining qualification limits.
