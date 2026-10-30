# Current Linux Closure And Trusted Worker Preparation

> **For agentic workers:** Use superpowers:executing-plans inline and test first.

**Goal:** Materialize integrity-checked current registry candidates and prepare
the trusted fixed-plan worker without building or activating an image.

**Architecture:** Reuse current source verification, the existing Linux registry
selector, SRI downloader, npm cache store and Effect process/scoping patterns.
Keep historical profiles unchanged. No new orchestrator or generic observer work.

**Spec:** Owner approval following `7c49ce3` and the current baseline runbook.
Source remains `be0427e2aba2cf951ef4dbbbe9296e307ed41ad3`; all 16 checks and four
cases remain required. Image build/publication, hosted/provider activation,
target installation/execution, browser launch, merge and push remain blocked.

## Constraints And Review Focus

- Public npm registry resolution/archive GETs only; no credentials, scripts,
  arbitrary registries or floating target source. Existing 512 MiB transfer,
  64 MiB blob, 1,024-artifact and storage budgets remain in force.
- Registry candidates are not a qualified Bun Linux cache. No macOS node_modules
  or copied local installer state may stand in for measured Linux installation.
- Keep all Effect lint rules and existing platform boundaries unchanged.
- New worker entry refuses activation; library execution requires a trusted
  in-process admission capability. No file/env/CLI flag can supply that authority.
- Success requires actual exit outcomes for every accepted command, never just
  discovery/counts. Stop on command failure; own servers, deadlines and cleanup.
- Report unfinished generated-consumer resolution and runtime controls honestly.

## Task 1: Freeze And Acquire Current Registry Candidates

- [x] Test current workspace identities, lock hash, Linux exclusion, exact SRI,
      duplicate identity conflicts and historical/current separation; observe RED.
- [x] Reuse the old decoder through an explicit workspace-policy helper. Derive
      the current conservative registry inventory from verified Git bytes, add
      the separately pinned browser cohort and retain the exact source/toolchain.
- [x] Prepare bounded registry candidates using the existing downloader/cache
      store; independently read back hashes. No target install or script runs.
- [x] Record any missing npm/generated closure separately. Verify and commit.

## Task 2: Prepare The Trusted Baseline Worker

- [x] Test fail-closed admission, exact ordered checks, fail-fast results, server
      ownership, cancellation/deadline and output budgets before implementation.
- [x] Implement the fixed current plan using inferred Effect service boundaries;
      reuse platform/process machinery. Keep native admission unavailable in the
      executable entry, not an owner-supplied JSON boolean.
- [x] Prepare the worker bundle locally and bind its exact digest as a candidate,
      not an image/context/readiness claim. No worker or target run is authorized.
- [x] Verify tests/typechecks/lint/format, obtain one independent read-only review,
      update roadmap/evidence, and commit the verified preparation.

Exit: measured local candidate bytes plus a guarded trusted worker; explicit
remaining Linux install/custody/controls and final-image qualification gates.

Observed results: 897 exact registry artifacts acquired and read back; guarded
389,425-byte Bun worker candidate prepared. Final suite: 642 tests, zero failures,
12 typechecks and strict lint/format. Review P1/P2 preview acquisition/exit issues
were reproduced RED and fixed GREEN. No native baseline, image build or hosted
activation occurred. Current generated npm metadata and Linux install remain open.
Evidence: [registry candidates](../../evidence/current-baseline/registry-20261030.md)
and [worker candidate](../../evidence/current-baseline/worker-20261030.md).
