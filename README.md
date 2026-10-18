# Leviathan

An internal dependency migration service, built to dogfood across Opsydyn
repositories before considering a broader product.

Repository direction: a Moon-managed Bun workspace monorepo. The first private
compatibility probe and pinned workspace configuration are scaffolded.

## Status

Offline compatibility probe only: 26 tests cover pure decisions, real Flue tools
through Effect, process-kill recovery and distinct read/abort semantics. The
canonical typecheck passes with strict source checking and the owner-approved
probe-local vendor declaration policy. This does not qualify production use.
There is no
production application, GitHub remote, scheduled job or deployment.

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

## First Implementation Plan

[Bun Effect Flue Compatibility](docs/superpowers/plans/2026-10-18-bun-effect-flue-compatibility.md)

Approved for inline execution in an isolated worktree. Its four phases pass with
the approved Valibot 1.5.0 correction and probe-local `skipLibCheck` policy. A
fresh whole-branch review found no issues and independently reran the tests and
typecheck. The plan covers a credential-free offline probe using
the real Flue runtime with a synthetic provider; it does not implement the
upgrade service or qualify real models, containers or deployment.

## Monorepo Layout

```text
.moon/                      Project graph, toolchains and development tasks
.prototools                 Exact Moon and Bun tool pins
package.json                Private Bun workspace root
bun.lock                    One root dependency lockfile
apps/cli/                   Future CLI and live dependency composition
packages/domain/            Future pure upgrade model and decisions
packages/engine/            Future Effect use cases, ports and adapters
probes/bun-effect-flue/      First Moon project, private compatibility fixture
docs/                       Decisions, specifications, plans and evidence
```

Only the probe project is created in the first slice. Do not scaffold empty
production packages. Stateful probe tasks run uncached with no automatic retries;
Moon is not Leviathan's durable run coordinator or container security boundary.
