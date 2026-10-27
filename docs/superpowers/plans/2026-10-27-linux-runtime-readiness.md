# Linux Runtime Readiness Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Prepare an explicitly non-authorizing Linux readiness inventory and identify the requirements for a trustworthy execution observer.

**Architecture:** Keep the existing qualification controller fail-closed. Prepare a bounded diagnostic that cannot produce qualification receipts or execute the historical workload. Do not admit an observer until binary provenance and trace-output integrity are independently established.

**Tech Stack:** Bun, TypeScript, Effect, Moon, oxlint, oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-27-linux-runtime-readiness-design.md`.

## Global Constraints

- Offline preparation only: no tracer acquisition/build, Docker, external retrieval, Linux/CI run, workflow publication, hosted activation, push, or deployment.
- Never read or copy secrets, dotenv files, or operational state.
- No new native boundary, dependency, lint waiver, dynamic import, manual Effect channel, or `skipLibCheck` addition.
- `trustedApprovalPolicy` remains `Option.none()`; diagnostic output is not an admission or qualification receipt.
- Proposed tmpfs allocation: work 2688 MiB, home 128 MiB, tmp 128 MiB, dev 64 MiB, dev/shm 64 MiB; aggregate limit 3072 MiB. Unknown, duplicate, aliased or overmounted writable storage cannot be admitted.
- Kernel pseudo-filesystem policy remains unapproved until a separately authorized canary measures it. Do not silently weaken existing controls.
- The candidate strace 6.19 source identity is not an approved binary or provenance. The observer must reject unknown/escaping behavior and cannot claim completeness without protected output and actual canary evidence.
- Existing 256 KiB per-stream and 16 MiB aggregate evidence limits, command deadlines and cleanup requirements remain unchanged.

## Review Focus

- Malformed or oversized inventory must fail closed and not leak arbitrary host data.
- Duplicate mount IDs, device aliases, overmounts and arithmetic overflow must never establish admission.
- An unrecognized kernel mount must remain diagnostic-only, not become an allowlist entry.
- Tracee-controlled output, unknown clone flags, truncation and tracer loss must not certify complete observation.
- No diagnostic mode may launch the historical workload or be accepted as a qualification receipt.

---

### Task 1: Non-Authorizing Readiness Inventory

**Files:**
- Create: `probes/cloudflare-executor/src/linux-qualification/readiness.ts`
- Create: `probes/cloudflare-executor/tests/linux-readiness.test.ts`
- Modify: readiness documentation as necessary; do not change existing qualification acceptance.

**Interfaces:** Provide a bounded pure diagnostic for synthetic Linux mount inventory. Its result explicitly identifies `ReadinessOnly`, reports only fixed, sanitized mount categories and reviewed capacity facts, and never returns an approval or receipt. It must not read the host or invoke a process. Keep final kernel-mount admission unavailable pending actual canary inventory.

- [ ] Write failing deterministic and property tests for the exact proposed budget, duplicate IDs/devices, overmounts, unknown size, overflow, malformed/oversized input and sanitization of unknown mount paths.
- [ ] Run the focused tests and observe failure for the missing diagnostic.
- [ ] Implement the minimum bounded parser and non-authorizing report, preserving all existing qualification controls. Do not invent a kernel allowlist.
- [ ] Run the focused tests, probe typecheck, oxlint and formatting checks; record evidence.
- [ ] Commit the verified task.

### Task 2: Observer Integrity And Canary Handoff

**Files:**
- Modify: `docs/assessments/runtime-feasibility-20261027.md` and `docs/roadmaps/first-hosted-e2e.md` only as supported by the independent integrity review.

**Interfaces:** Preserve `makeChildObservation` and provenance as unavailable. Identify a concrete approved-boundary mechanism for authenticated tracer output or explicitly mark the observer blocked. Describe the exact smallest separately authorized acquisition and control canary required before runtime admission.

- [ ] Independently review same-UID file/descriptor integrity, tracer-versus-Bun PID ownership, cleanup, and the existing fixed transport.
- [ ] Document evidence, unresolved controls and next gated action; do not claim a canary, binary identity or successful observation.
- [ ] Verify documentation formatting and the unchanged unavailable observer; commit the verified task.

## Deferred Gates

Wiring and execution of the fixed real canary, any image/tool acquisition, independent binary approval, actual kernel mount policy, historical consumer/browser qualification, Cloudflare activation and Flue patch generation remain outside this plan. A pure synthetic inventory alone does not satisfy the spec's real-canary exit criteria.
