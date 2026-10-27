# Readiness Canary Wiring Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Prepare the fixed, non-authorizing readiness worker and host-side frame/lifecycle plumbing without running a canary or enabling qualification.

**Architecture:** A dedicated entrypoint collects only fixed Linux pseudo-files through bounded Effect streams and emits a sanitized, versioned `ReadinessOnly` frame. A distinct host path validates one bounded frame and tracks cleanup without reusing qualification evidence or granting approval. Actual image/tool identities, observer admission and execution remain separately gated.

**Tech Stack:** Bun, TypeScript, Effect, Moon, oxlint, oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-27-linux-runtime-readiness-design.md`; approved canary preparation checklist in `docs/assessments/runtime-feasibility-20261027.md`.

## Global Constraints

- No actual canary, Docker, image/tool acquisition or build, network probes, workflow publication, credentials, .env, operational state, hosted activation, push or deployment.
- No new dependencies, native boundaries, lint waivers, manual Effect channels, dynamic imports or `skipLibCheck` additions.
- Fixed reviewed inputs only; no arbitrary paths, commands, argv, environment-derived settings, historical repository or installer.
- Read each pseudo-file through bounded streaming with a limit-plus-one check and deadline; strict UTF-8, partial/error/oversize produce finite unknown/refused facts, never raw error text.
- Export no arbitrary paths, command lines, environment, source strings, raw mountinfo or trace; unknown mount categories remain explicitly unknown and are never admitted.
- Frame must be versioned `ReadinessOnly`, `kernelMountPolicy: Unreviewed`, `qualificationReceipt: NotProduced`; no observation completeness or cleanup success without independently measured evidence.
- Production observer/provenance and `trustedApprovalPolicy` remain unavailable. No JSON, CLI or caller-provided value can mint authorization.
- Existing limits and qualification mount acceptance remain unchanged. Synthetic tests do not prove kernel, Docker, channel integrity or Cloudflare behavior.

## Review Focus

- Pseudo-files reporting zero size, oversized chunks, split UTF-8 and never-ending streams must not evade bounds or deadline.
- A plausible but partial, forged or unrecognized inventory must not become an admitted policy or leak arbitrary contents.
- Missing controls, duplicate/conflicting records and unavailable namespaces must remain unknown or refused.
- Extra output, duplicate frames, wrong session or cleanup uncertainty must not become a completed run.
- The fixed CLI and host protocol must not invoke a historical workload, network negative, tracer or container implicitly.

### Task 1: Fixed Worker And Sanitized Readbacks

**Files:**

- Create `probes/cloudflare-executor/src/linux-qualification/readiness-worker.ts`.
- Create `probes/cloudflare-executor/scripts/linux-readiness-worker.ts`.
- Create `probes/cloudflare-executor/tests/linux-readiness-worker.test.ts`.
- Modify `probes/cloudflare-executor/src/linux-qualification/readiness.ts` only if required for sanitized kernel mount details.
- Modify `probes/cloudflare-executor/moon.yml` to register the new test.

**Interfaces:** Define a strict versioned `ReadinessOnly` schema and an Effect service-backed `collectReadiness()` with no caller-selected paths. Read `/proc/self/mountinfo`, `/proc/self/status`, `/proc/self/ns/{mnt,pid,ipc,net,user}`, and `/sys/fs/cgroup/{cpu.max,memory.max,memory.swap.max,pids.max}` using fixed targets. Mountinfo limit 65536 bytes; every other textual target limit 8192 bytes; individual read deadline 90000 ms. Parse only finite reviewed fields: the existing bounded mount summary; known root/data and kernel mount types/flags and counts with unknowns explicitly redacted; numeric UID/GID and capability/no-new-privileges/seccomp readbacks; finite namespace identity categories; and bounded cgroup values or `Unknown`. Namespace links are read only through the existing Effect filesystem API; do not report raw link targets. Observer, network-negatives and cleanup are explicitly `NotMeasured`. Separate fixed worker invocation must emit exactly one bounded frame and never produce a qualification receipt.

- [ ] Write failing tests with a fake Effect filesystem and fake clock for exact fixed paths, zero-size pseudo-file behavior, chunk partitions, oversize, invalid UTF-8, timeout, missing controls, adversarial mount/path sanitization, duplicate status keys and absence of arbitrary IO.
- [ ] Run tests to show failure, implement only the bounded collector, schema and fixed entrypoint, and run the tests green. Do not run the actual entrypoint against host `/proc`.
- [ ] Verify strict schema rejects excess properties and that qualification decoders reject the readiness frame; run probe typecheck, lint/format and the focused tests.
- [ ] Commit the independently reviewed task.

### Task 2: Host Frame And Ownership Plumbing

**Files:**

- Create `probes/cloudflare-executor/src/linux-qualification/readiness-handoff.ts`.
- Create `probes/cloudflare-executor/tests/linux-readiness-handoff.test.ts`.
- Modify `probes/cloudflare-executor/moon.yml` to register the new test.

**Interfaces:** `readReadinessFrame` accepts an Effect byte stream, enforces a single newline-terminated frame and EOF within 262144 bytes and 90000 ms, strictly decodes the Task 1 schema, and never converts it into qualification evidence. Bind a frame to an owned in-process canary session via a separate host-only interface. Prepare fail-closed lifecycle orchestration around an injected fixed canary process port: register cleanup before create, treat ambiguous creation as unknown, verify ownership before removal, require absence readback before reporting cleanup, and refuse completion on timeout, interruption, mismatched identity, or unavailable authority. The production authority and process implementation remain unavailable; no Docker command or image is selected.

- [ ] Write failing fake-port tests for split framing, excess/trailing/duplicate output, oversize, malformed schema, forged/mismatched session, creation ambiguity, cancellation/deadline, ownership mismatch and cleanup/readback failures.
- [ ] Implement the strict host protocol and fake-testable ownership lifecycle without any live provider or qualification path.
- [ ] Verify frame/receipt separation, focused tests, probe typecheck, lint/format; commit after independent review.

### Task 3: Handoff And Verification

**Files:** Modify `docs/assessments/runtime-feasibility-20261027.md` and `docs/roadmaps/first-hosted-e2e.md` only.

- [ ] Update the roadmap to identify what is wired, what is explicitly `NotMeasured`, and the remaining fixed observer/channel, binary provenance, image, lifecycle provider and actual canary approval gates. Do not claim a run took place.
- [ ] Verify repository lint/format, all Moon typechecks, the affected offline probe tests and independent whole-branch review. Record any inability to run the full suite accurately.
- [ ] Commit the verified documentation.
