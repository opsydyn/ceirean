# Current Linux Cache CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Prepare the approved current cache-only job for bounded Linux CI and retain a verified portable Bun seed, without publishing or running it.

**Architecture:** Extend existing cache seals with a hash-bound portable descriptor and fresh filesystem re-admission. Reuse the current worker, public download/cache helpers and Docker process adapter behind a thin testable CI supervisor. Keep the workflow outside `.github/workflows` and live invocation blocked until separate publication/run approvals.

**Tech Stack:** Bun 1.4.2 controller, Bun 1.4.3 installer, Node 22.23.4/npm 10.9.9, Effect 4.0.5, TypeScript, pinned Docker images, GitHub Actions template, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-31-current-linux-cache-ci-design.md` (owner approved local implementation).

## Global Constraints

- No pushes, uploads, external retrieval, CI/Colima/Docker execution, image builds, repository scripts, provider calls or hosted activation during implementation.
- Preserve `be0427e2aba2cf951ef4dbbbe9296e307ed41ad3`, existing tree/lock/source-inventory pins, frozen 909-artifact inventory and npm snapshot.
- All Effect rules stay universal; no new native import boundary or declaration exception.
- Inactive manual-only workflow; contents read; no secrets/OIDC/cache restore/retry/dispatch inputs; 30-minute job, eight-minute acquisition, 16-minute outer worker, two-minute cleanup reserve.
- Consumer: network none, user 1000:1000, cap-drop ALL, no-new-privileges, read-only root, two CPUs, 3 GiB memory, 128 PIDs; only owned input/tool/work volumes.
- Existing 2 GiB/200,000-entry cache limits; 64 MiB descriptor limit, 1 GiB compressed portable seed and 4 MiB evidence export. Retention is mandatory for acceptance.
- Existing dirty observer files and their test registrations remain unstaged and untouched.

## Review Focus

1. Self-declared descriptor hashes must not restore old authority; independent expected digest and actual filesystem scan are required (Task 1).
2. Absolute cache links and special modes must not escape during portability/export/intake (Tasks 1/2).
3. Linux preparation must not rely on macOS tar flags, `/private/tmp`, stale local receipts or moving metadata (Task 3).
4. Cancellation after Docker creation must retain ownership until confirmed removal; unknown cleanup prevents success (Task 3).
5. A worker pass without a retained verified seed, or a job using a mutable implementation/source ref, cannot pass (Task 4).

## Task 1: Durable Portable Cache Descriptor

**Files:** modify `probes/cloudflare-executor/src/linux-qualification/cache.ts`; create `tests/portable-cache.test.ts`; register the test in the current baseline task lists.

**Interfaces:** `describePortableCache(seed, source)` returns canonical descriptor text and SHA-256, requiring live valid seals and exact normalized source-to-portable inventory correspondence. Descriptor carries `CacheModesV1`, original/portable digests, sealed and materialized inventories, not inode/capability state. `admitPortableCache(root, text, expectedDescriptorSha256)` validates bounded strict JSON, transforms/inventory digests and actual readonly portable contents, then establishes a new seal with fresh filesystem identities. Extract common inventory construction from `sealCache` only as needed; preserve historical semantics.

- [x] Write real filesystem tests: original absolute internal link becomes relative through existing `copyCaseCache`; describe/seal succeeds; fresh copied root re-admits with matching hash and independent inodes; malformed/hash-mismatched descriptors, external/absolute portable links, special modes, missing/extra/changed files and mutations refuse. Seed JSON alone cannot satisfy existing WeakMap APIs. Include seeded payload mutations.
- [x] Run the new file and observe RED, then implement strict descriptor serialization (64 MiB) and read-only fresh re-admission using existing scan/hash/mode machinery, without chmod during intake.
- [x] Run new and existing cache tests; verify lint/format and probe types. Commit `feat: add durable portable cache descriptors`.

## Task 2: Worker Portable Seed And Phase-Owned Cleanup

**Files:** modify `src/current-linux-worker.ts`, `tests/current-linux-worker.test.ts`, `tests/current-bun-installation.test.ts` as required; add focused phase tests if needed.

**Interfaces:** worker result adds original/portable seed and descriptor identities plus fixed export paths. Persist descriptor outside the seed tree before exit; keep it out of the 4 MiB diagnostic payload. Fresh positive consumption uses an independent copy of the described portable seed, not an untested export transformation.

- [x] Write failing tests for source-to-portable binding, persisted descriptor hashes and cleanup confined to owned phase paths. Existing identity and evidence-write tests retained; whole-worker native ordering remains CI evidence, not claimed from local fakes.
- [x] Normalize links with `copyCaseCache`, seal the portable root, describe it, then run the existing fresh/default-registry case and verify that portable seal unchanged. Preserve original-seed verification before releasing it; never call stale authority after deletion.
- [x] Audit phase output roots before deleting scratch. Release warm-up source before creating extra cache copies; release fresh workspace/cache only after its audits and portable-seed verification. Keep remaining `/work` ownership checks and per-cache limits unchanged. Release completed npm profile scratch after its checks; retain portable seed/descriptor/evidence and small runtime scratch.
- [x] Update typed test receipts and fixed paths; run all current worker/cache/identity tests and gates. Commit `feat: retain verified portable Bun seeds from cache runs`.

## Task 3: Public Input Rehydration And Linux Supervisor

**Files:** promote exact portable inventory to `fixtures/current-cache-inventory.json`; create `src/current-ci-inputs.ts`, `src/current-ci-controller.ts`, `scripts/current-cache-ci.ts`, corresponding focused tests. Reuse `source-payload.ts`, `currentOfflineCachePlan`, `persistCache`/`verifyCache`, current worker and `makeDockerProcess`; do not modify the historical qualification programme.

**Interfaces:** `readCurrentCiInventory()` validates exact compiled inventory pin. `prepareCurrentCiInputs(repository, destination, request)` reads pinned Git blobs, checks source-inventory hash, recreates 909 raw/npm cache inputs from frozen GETs and metadata, compares complete readback to the frozen inventory, and emits a fresh receipt (909 downloads/0 reuses). No original local receipt is fabricated. Inferred controller ports cover fixed Docker/process operations, clock, files and preparation; real implementations use existing Effect APIs. `runCurrentCiCache(request, ports)` owns each created resource before start and returns only bounded verified evidence plus a verified portable-export candidate or a sanitized failure.

- [ ] Write failing tests for bad inventory/source/hash, request allowlist/SRI/redirect/overflow/cancellation, no destination overwrite and Linux paths without tar extraction. Use small transport fixtures plus fixed-manifest/source checks; no live fetches.
- [ ] Implement direct source-file staging with the original inventory sort/field order; reuse `persistCache` and frozen npm metadata; apply explicit input readability without adding unrelated files or credentials. Check storage capacity before acquisition.
- [ ] Write supervisor fake tests for fixed image/argv/mount controls, ownership-before-start, deadline/overflow/interruption at every resource boundary, stop-before-export, verified seed descriptor/intake, cleanup failure and unknown Docker state. No arbitrary Docker args or shell execution interface.
- [ ] Implement the bounded adapter and fixed, sanitized outputs. Preserve portable mode/link metadata during export using the pinned tar library; bounded readback compares descriptor and actual content, not only archive self-hash. Invalid or oversized export refuses.
- [ ] CLI defaults to `--check`; all other unsupported argv refuse. Live entry remains blocked by unpublished run worksheet/implementation pins. Ordinary tests exercise only check/fakes and own temporary files/processes.
- [ ] Run focused tests plus all tracked executor tests, root checks and all types. Commit `feat: prepare bounded Linux CI cache rehearsal`.

## Task 4: Inactive Workflow, Worksheet And Runbook

**Files:** create `qualification/current-linux-cache.workflow.yml`, `qualification/current-linux-cache-run-worksheet.md`, `docs/runbooks/current-linux-cache-ci.md`, workflow contract tests; update roadmap and active baseline map. Keep old workflow template unchanged.

- [ ] Test manual-only trigger, fixed implementation/source pins, exact budgets/permissions, no secrets/cache/retry/parameters, only fixed evidence/seed paths and inactive location. Missing publication/run fields must block rather than use a branch tip.
- [ ] Write the thin workflow and worksheet around Task 3. SHA-pin acquisition/upload actions and tool provenance using authoritative metadata; read-only online verification may be needed, but no artifact download or workflow activation. Record unresolved pins as publication blockers, not invented values.
- [ ] Require seed export/upload success for overall acceptance; upload bounded failure evidence after cleanup without reinterpreting it as a pass. Record actual runner/tool identities and all cleanup/readback outcomes.
- [ ] Independently review the entire local slice, fix important findings RED-to-GREEN, run full executor suite, lint/format, all typechecks and contract tests. Commit `docs: prepare manual current cache CI handoff`.

## Publication And Execution Gates

Local completion is not publication approval. Later: separately approve publishing the exact FoldKit qualification revision and the reviewed Ceirean workflow/implementation, verify remote identities without dispatch, then separately approve one CI attempt and its retrieval/artifact scope. A cache-only pass still does not authorize Cloudflare image builds or hosted activation.

## Execution Ledger

Inline execution in the existing `codex/linux-cleanup-budget` linked worktree.
Ruling: a fresh CI receipt may reference the historical inventory anchors but must report its own retrieval/custody; it cannot impersonate the Mac-local preparation receipt. Ruling: persisted inventories are data; only actual fresh filesystem verification can mint a new seal. Task completion entries and verified commit ranges follow below.

Task 1: verified RED-to-GREEN, 24 focused tests and the complete 744-test executor
suite (0 failed), all 12 typechecks, lint/format and diff checks. Logs:
`/private/tmp/ceirean-ci-task1-tests.log`, `/private/tmp/ceirean-ci-task1-types.log`.
Ruling: case roots are already reserved; `sealPortableCase(source, copy)` verifies
live copy authority and consumes the writable handle before registering its new
seal. Do not weaken ordinary root reservation checks to promote a copy.

Task 1 commit: `2d7d5a3`.
Task 2: RED-to-GREEN descriptor persistence and owned-phase cleanup; 746 tracked
executor tests passed, zero failed. All types and lint/format checked. Logs:
`/private/tmp/ceirean-ci-task2-{tests,types,check,focused}.log`.
Ruling: use the existing cache inode-checked reader for 64 MiB descriptors; do
not increase the unrelated runner-input reader's 2 MiB ceiling. Phase output
audits precede deletion; actual full-worker ordering still requires the Linux run.
