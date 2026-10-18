# Leviathan

An internal dependency migration service, built to dogfood across Opsydyn
repositories before considering a broader product.

Repository direction: a Moon-managed Bun workspace monorepo. The workspace and
Moon configuration are planned, not scaffolded yet.

## Status

Planning only. This repository has no application code, installed dependencies,
GitHub remote, scheduled jobs or deployment.

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
- [ ] Review an implementation plan and select execution method.
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
boundaries and the scope of a future Bun/Effect/Flue compatibility probe. The probe
has not been run; no dependencies or runtime compatibility are qualified.

## First Implementation Plan

[Bun Effect Flue Compatibility](docs/superpowers/plans/2026-10-18-bun-effect-flue-compatibility.md)

Pending review and execution-method selection. This plan covers a credential-free
offline probe using the real Flue runtime with a synthetic provider. It does not
implement the upgrade service or qualify real models, containers or deployment.

## Planned Monorepo Layout

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
