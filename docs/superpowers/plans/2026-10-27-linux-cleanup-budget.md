# Linux Cleanup Budget Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Align the existing Docker qualification supervisor's cleanup scheduling with its declared 30-second budget while preserving fail-closed ownership and readback.

**Architecture:** The supervisor owns one cleanup phase, with a 20-second cooperative removal window and an independent readback started after removal settles or at 20 seconds, bounded by the remaining 10 seconds. Confirmation requires acknowledged creation, successful owned removal or an already-absent owned inventory, and a subsequent successful empty readback; an early or ambiguous observation cannot later become confirmation.

**Tech Stack:** Bun, TypeScript, Effect 4, Moon, oxlint and oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-24-linux-cache-consumer-design.md` and `probes/cloudflare-executor/src/linux-qualification/contract.ts`.

## Global Constraints

- No real Docker, canary, network, image acquisition, deployment, workflow publication, credentials, `.env` or operational state.
- Keep the exact 30,000 ms cleanup contract, 20,000 ms removal phase and 10,000 ms reserved readback phase; do not grant fresh per-command phase budgets or start a new mutation after the removal deadline.
- Preserve a best-effort graceful stop, capped at 3,000 ms with Docker `--time=3`, then attempt owned force removal within the removal phase. A stop error cannot suppress the force attempt when budget remains.
- Verify the generated name, ownership label and full container ID before stopping or removing; never remove a foreign identity.
- Unacknowledged create, empty-but-ambiguous inventory, failed/malformed output, timeouts and defects remain unknown; readable nonempty post-removal inventory remains `RemainingResources`.
- Do not confirm absence from readback started before successful removal settled. Preserve already-absent behavior only when create was acknowledged and both inventory observations succeed.
- Preserve the unavailable production observer, provenance and `trustedApprovalPolicy`; no new dependencies, native boundaries, Effect lint waivers, or dynamic imports.
- Timers and Effect interruption are cooperative. An uninterruptible operation or finalizer can exceed 30 seconds; no hard host deadline or real Docker cleanup proof is claimed. Keep live activation blocked.

## Review Focus

- Slow or uninterruptible inspect, stop or remove must not suppress the independently scheduled readback or start a late mutation.
- Empty readback during pending removal must never be promoted to confirmed cleanup.
- Lost create acknowledgements and late daemon completion remain unknown even when a single inventory is empty.
- Foreign IDs, wrong labels, malformed output, defects and interruption must not cause foreign removal or a successful receipt.
- Multiple commands share one phase budget; a successful fast path still performs a later readback.

### Task 1: Shared Cleanup Budget

**Files:**

- Modify `probes/cloudflare-executor/src/linux-qualification/supervisor.ts`.
- Modify `probes/cloudflare-executor/tests/linux-supervisor.test.ts`.
- Add a tightly scoped helper/test file only if needed; register any new test in `probes/cloudflare-executor/moon.yml`.
- Update `docs/assessments/runtime-feasibility-20261027.md` to distinguish implemented cooperative scheduling from unproved host enforcement.

**Interfaces:** Keep `superviseFixedWorker` and `DockerProcess` public types and qualification admission unchanged. Use existing Effect Clock/TestClock and Deferred/scope facilities; never trust caller-controlled JSON as ownership authority.

- [ ] Write failing fake-clock tests for the 20/10 schedule, stop cap, cumulative phase timing, stalled inspect/remove including finite uninterruptible finalizers, post-removal readback ordering, late mutation refusal, ambiguous creation, invalid/foreign ownership, defects and parent interruption. Use generated cases where sensible.
- [ ] Run the focused tests and confirm behavioral failures on the old 120-second cleanup path.
- [ ] Implement the smallest change to the existing supervisor. Preserve scope ownership and the existing acknowledged-already-absent semantics; do not detach cleanup.
- [ ] Run focused tests, probe typecheck, root lint/format and independent review. Record any actual 30-second hard-deadline limitation accurately; commit after verification.
