# Current FoldKit Baseline Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the owner-requested straight-through inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the approved `1183e3c` baseline contract and immutable image
recipe with every accepted check, without building or activating the executor.

**Architecture:** Add a separate current-baseline contract and image inputs in the
existing executor workspace. Keep historical fixtures, live smoke wiring and dirty
observer research unchanged. Reuse the existing preparation hashing/error pattern.

**Tech Stack:** Existing Bun 1.4.2 / Effect 4.0.5 controller, strict Schema/Result,
Moon, oxlint/oxfmt. Consumer Bun is independently pinned to 1.4.3.

**Spec:** Owner approval of 2026-10-30 adopts `1183e3c` with root checks,
Storybook, the full 3D CI job and all four custom browser cases, following
`docs/roadmaps/first-hosted-e2e.md` and
`docs/assessments/foldkit-baseline-readiness-20261030.md`. The owner requested
straight-through implementation rather than another design/approval round.

## Global Constraints

- Source `1183e3c067f873fdd29f14f06030515929c1b956`; lock SHA-256
  `9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89`.
- No source changes, dependency upgrades, target scripts, installs, image pulls,
  builds, publication, hosted calls/activation, model calls, merges or pushes.
- Public image metadata GETs only may resolve preparation pins; no credentials.
- All Effect lint rules remain universal. No dependency or native-boundary changes.
- New contract has activation Blocked, final image Unbuilt and payloads Pending.
- Four custom cases remain desktop/mobile carousel and promo-line interactions;
  all accepted CI/package/3D checks remain required, never substituted by discovery.

## Review Focus

- Reordered/removed checks and altered argv must not decode as approved scope.
- Current and historical source/toolchain contracts must not be interchangeable.
- Docker tag/index/architecture metadata is not measured binary compatibility.
- Caller-provided hashes or status claims must not authorize a build or activation.
- Browser discovery and static sandbox options do not qualify native browser launch.

## Task 1: Freeze The Approved Current Baseline

**Files:** create `probes/cloudflare-executor/src/current-baseline.ts`,
`fixtures/current-baseline.json`, `tests/current-baseline.test.ts`.

**Interfaces:** `decodeCurrentBaseline(input: unknown)` returns inferred Result;
`CurrentBaseline` is a strict schema/type with fixed source, lock, platform,
consumer toolchain, ordered check/server commands, browser cases and finite budgets.
`currentBaseline` returns a fresh decoded contract, not a mutable authority object.

- [ ] Write failing tests: the real fixture decodes; changed source/lock/Bun,
      omitted/reordered/extra checks, substituted commands, altered browser cases,
      unknown fields and Approved/Built status claims refuse with finite errors.
      Assert the resulting runnable command plan includes root checks, Storybook,
      four pack/API checks and 3D E2E, not just a metadata success tag.
- [ ] Run the new test and observe the missing implementation failure.
- [ ] Implement fixed schemas and the separate JSON fixture. Preserve CI command
      arrays; installed browser binaries replace only acquisition, not the E2E check.
      Add seeded Effect property tests mutating command positions/args so weakening
      cannot pass. Preserve consumer toolchain and controller distinctions.
- [ ] Run focused tests, workspace typechecks and root check; commit Task 1.

## Task 2: Prepare The Current Image Recipe

**Files:** create `current-image/Dockerfile`, `current-image/.dockerignore`,
`fixtures/current-image.json`, `src/current-image.ts`, `tests/current-image.test.ts`,
`docs/runbooks/current-foldkit-baseline.md`; update active roadmap/assessment.

**Interfaces:** `validateCurrentImagePreparation(input: unknown, recipe: string)`
returns an inferred Effect of preparation-only evidence with exact recipe digest,
source/lock and required unresolved payloads. It never calls a builder or provider.

- [ ] Write failing tests: accepted fixed recipe/input identity returns blocked
      preparation with all payloads unmaterialized; changed recipe/status/image/source,
      caller matching digest, floating tag or unknown field refuses. Include immutable
      pin ownership and historical-contract negative controls.
- [ ] Run the new tests and observe failure before implementation.
- [ ] Prepare a Linux amd64 Playwright-base/Node/Bun multi-stage recipe with fixed
      digest references, explicit binary version assertions, non-root user and exact
      payload copy list. No target install/scripts or downloads in build instructions.
      Omit the unused Sandbox SDK helper: the proven native container path does not
      need it. Keep the existing image/harness files untouched.
- [ ] Bind recipe hash independently in source and fixture; validate with existing
      `sha256`/PreparationError helpers. Missing current source/cache/harness payloads,
      builder approval, final image and real sandbox/runtime proofs stay blockers.
- [ ] Run new tests plus the existing executor suite excluding retained dirty
      observer research, all typechecks, root check and whitespace validation. Obtain
      one fresh read-only review of both tasks; fix confirmed important issues with
      RED/GREEN before committing Task 2 and verified corrections.
- [ ] Document exact pins, commands, evidence limits and the next actual payload/
      build step. Record that no image or repository baseline has executed.

## Completion

Commit verified work and report actual tests/pins. Do not introduce a manifest
transport milestone. The next delivery is materialized current-source inputs and
one explicitly scoped image build/Linux baseline run, then private hosted wiring.
