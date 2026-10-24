# Local Effect Durable Object Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Track completed steps with checkboxes.

**Goal:** Qualify the existing ledger policy against local Durable Object SQLite.

**Architecture:** A private probe uses Alchemy's Effect-native Worker and DO APIs.
Synchronous SQLite transactions persist policy decisions; independent local
workerd process generations prove recovery from disk.

**Tech Stack:** Bun 1.4.2, Effect 4.0.5, Alchemy 2.0.0-beta.83, Moon, Oxlint/Oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-23-local-effect-do-design.md`.

## Global Constraints

- Local-only probe; no deployment or live infrastructure changes.
- Keep existing versions pinned; Alchemy upgrade remains paused.
- Preserve domain policy, Bun storage, Flue and XState implementations.
- Keep every lint rule universal; infer Effect channels using existing patterns.
- Disable environment-file loading and telemetry in the test runner; provide no
  credentials and reject remote-capable resources in the isolated graph.
- Bind only loopback and use owned temporary state paths; bounded startup,
  request and shutdown waits must clean up children on failure.

## Review Focus

- Lost response followed by retry: policy outcomes must prevent duplicate events.
- Concurrent requests with one revision: exactly one state-changing winner.
- Partial write: rollback includes both snapshot and event log.
- Corrupt or incompatible storage: fail closed, never initialize over it.
- Restart: retain disk state but replace the runtime process and Effect memory.

## Task 1: Atomic Effect/DO Ledger Boundary

**Files:** Create `probes/cloudflare-ledger/package.json`, `tsconfig.json`,
`moon.yml`, `alchemy.run.ts`, `src/ledger.ts`, `src/object.ts`, `src/worker.ts`,
`tests/harness.ts`, `tests/ledger.test.ts`. Update `.moon/workspace.yml` and
`bun.lock` for the private workspace only. Add the probe README with commands.

**Interfaces:** `commit(encodedCommand: string)` returns an Effect of an encoded
policy reply; `read()` returns an encoded ledger state; `recover()` returns an
encoded validated recovery. Test-only fault selection is explicit, scoped to one
commit and absent from production packages. The harness returns a typed local
client and owns temporary state, startup and teardown.

- [x] Write failing integration tests for registration, valid transition,
      repeated registration, stale revision, concurrent CAS and run/worker
      cancellation coherence. Compare responses and persisted events to the pure
      policy, not invented success expectations.
- [x] Verify the resource graph contains only the isolated Worker/DO and the
      pinned Alchemy local test API uses local providers. Run with no credentials,
      no environment files and a non-production stage. Stop if auth is requested.
- [x] Run `moon run cloudflare-ledger:test`; capture a meaningful red result
      before implementing storage, distinguishing test failures from runner errors.
- [x] Implement strict wire decoding and snapshot/event persistence in one
      synchronous DO SQLite transaction. Preserve bounds before commit; validate
      decoded persisted state with existing recovery policy. Assemble dependencies
      once at the owning boundary, using Alchemy's native Effect wrapper.
- [x] Add failing tests for fault after snapshot write, malformed JSON, excess
      fields, oversized payload and corrupt stored state; implement typed failure
      handling and assert no mutation or event append on failed transactions.
- [x] Run focused tests, `moon run cloudflare-ledger:typecheck` and
      `bun --no-env-file run check`; inspect diff and commit the verified task.

## Task 2: Persistent Restart and Generated Parity

**Files:** Create `tests/properties.test.ts`, `tests/restart.test.ts`,
`tests/restart-child.ts`; extend `tests/harness.ts` and the probe README. Create
`docs/assessments/local-effect-do.md`; update `docs/roadmap.md` with the result.

**Interfaces:** Reuse Task 1's encoded client. Harness restart closes the first
owned runtime, confirms its exit, then starts a second process against the same
temporary persistence root and same DO identity. Expose no reset endpoint that
could silently invalidate the restart claim.

- [ ] Write a failing restart test that commits run and worker state, stops the
      first runtime, restarts and compares recovery, sequence and event records.
      Record distinct process identities; a hot reload is insufficient.
- [ ] Add a committed-but-unacknowledged response-loss test: retry after restart
      and assert the existing refusal/conflict outcome with no duplicate event.
- [ ] Implement the bounded process harness using existing Effect/process
      conventions. Verify failed startup and failed assertions terminate owned
      children; use separate test roots to establish isolation.
- [ ] Add Effect Arbitrary-based generated valid and stale command sequences:
      three fixed seeds, 50 sequences per seed, at most 12 commands per sequence.
      Compare replies, canonical state and event sequences after every command.
      Include failure seed and shrunk input in diagnostics; do not replace actual
      workerd assertions with a mocked SQLite implementation.
- [ ] Run focused tests and typecheck, then repository gates:
      `bun --no-env-file run check`, `moon run :typecheck`, `moon run :test`.
- [ ] Document exact versions, commands, results and local-only evidence limits.
      Mark any blocked acceptance criterion explicitly. Review the whole diff and
      commit the verified task; do not push or deploy as part of this slice.

## Handoff

Review this plan before implementation. Recommend native inline execution for
these two tightly coupled tasks, with an independent final review when available.
Do not claim independent review if this session has no reviewer tool.
