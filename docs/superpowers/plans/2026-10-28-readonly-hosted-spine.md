# Read-Only Hosted Spine Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this inline slice.

**Goal:** Prepare the shortest real Cloudflare execution path, without activating it.

**Architecture:** Keep the existing signed GitHub ingress adapter. One SQLite-backed
Durable Object admits one allowlisted issue command, schedules a native alarm,
executes a fixed read-only command in its own network-disabled container and
persists the result after cleanup. Alchemy beta.83 already exposes this API; no
framework migration, custom observer or new SDK is required.

**Tech Stack:** Bun, Effect 4.0.5, Alchemy 2.0.0-beta.83, Cloudflare Workers,
SQLite Durable Objects, native Containers.

**Spec:** The approved deployment reset: authenticated allowlisted issue -> durable
job -> fixed read-only task -> recorded result -> disposable sandbox cleanup.

## Constraints

- This first command is a runtime smoke test, not repository, browser or migration
  qualification. It does not claim to inspect or execute the FoldKit source.
- One configured issue, installation, repository, operator and five-minute window;
  one job per configured session. Duplicate comments/deliveries cannot allocate again.
- No model credentials, writes, PRs, arbitrary argv, repository scripts or sandbox
  Internet access. Public Worker URLs remain disabled in the prepared stack.
- Do not alter the research probe's fail-closed gates or uncommitted drafts.
- Building/publishing an image, deploying resources and webhook activation remain
  separate external operations. No deploy command runs in this slice.
- Preserve every Effect lint rule and the existing infrastructure-only vendor
  declaration exception. Do not upgrade Alchemy.

## Review Focus

Wrong identity/window must not persist work; duplicates must not allocate twice;
an interrupted/restarted running job must clean up rather than execute again;
command failure must still destroy the container; cleanup uncertainty must never
be reported as success.

## Tasks

### 1. Bounded Job Policy And Runner

- [x] Add failing tests for identity/window admission, single-job replay and
      restart/failure/cleanup handling in infrastructure tests.
- [x] Implement the small job schema and inferred Effect runner contract; use the
      existing Alchemy container handle, not a generic execution abstraction.
- [x] Run focused tests, infrastructure typecheck and root lint/format.

### 2. Prepared Cloudflare Composition

- [x] Prepare a private Worker and one container-backed SQLite DO. Admission
      permits one job, not an asserted account-wide provider quota.
- [x] Reuse the existing signature/body verification and exact `/ceirean assess`
      parser, with extra fixed rehearsal identity and issue checks.
- [x] Persist dispatch plus alarm atomically; mark running before allocation.
      On redelivery after a crash, do cleanup only, never repeat execution.
- [x] Expose no test/fault routes. Status is private RPC and structured logs;
      duplicate signed issue delivery returns the existing result.
- [x] Typecheck the actual provider composition without deploying it; update
      deployment instructions and explicitly state what still lacks hosted proof.

### 3. Verification And Handoff

- [x] Run affected tests and all workspace typechecks, lint/format and review.
- [x] Commit only verified reset work, preserving unrelated research drafts.
- [ ] Next external checkpoint: one approved bounded deployment/rehearsal covering
      account eligibility, exact image, one issue/operator, expiry and teardown.

## Deferred, Not Deployment Prerequisites

Custom strace, sealed builder handoff, protected observer attestation, complete
offline dependency caches and historical baseline/browser qualification stay as
research. They are not required to run this trusted fixed smoke command. Revisit
the relevant controls before admitting untrusted repository scripts or agents.

## Execution Record

The infrastructure suite includes policy properties, native adapter contract
tests, signed ingress and planning-boundary regressions, transactional fake-storage
tests using the real Alchemy adapter, and an Alchemy Worker bundle test. All 12
workspace typechecks and root lint/format passed. Independent review found and
verified fixes for eager namespace lookup and lost cleanup watchdogs. No P1/P2
finding remained in the reviewed spine.

Ruling: use one native DO alarm instead of a Queue for this one-job checkpoint.
Admission and scheduling are transactional, and restart recovery never allocates
again. This avoids an unnecessary transport without replacing the later private
Queue research or admitting general agent execution.

Ruling: preserve full expected-job compare-and-set and count at most two additional
cleanup attempts before work begins. Unknown cleanup stays visible for manual
reconciliation; stale completions cannot overwrite recovery results.

No image copy/build, resource deployment, route change, tunnel/listener start or
webhook activation was performed. Actual SQLite/alarm and hosted execution evidence
remain for the bounded rehearsal, not for inference from these local tests.
