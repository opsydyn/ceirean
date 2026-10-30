# Accepted-Duplicate Hosted Rehearsal Plan

> **For agentic workers:** Use superpowers:executing-plans for the sequential operational steps below. Planning approval does not authorize their execution.

**Goal:** Observe two accepted signed deliveries for one fresh durable job, with one successful runtime execution and verified teardown.

**Architecture:** Reuse the deployed private Worker, SQLite-backed DO and trusted fixed Node runtime. Prepare one fresh policy privately, verify that exact policy through the existing operator command, then temporarily expose only the existing webhook route. Preserve the original consumed session and all research.

**Tech Stack:** Bun 1.4.2, Effect, pinned Alchemy beta.83, Cloudflare Worker/DO Containers, GitHub App signed delivery.

**Spec:** [hosted rehearsal runbook](../../runbooks/readonly-hosted-rehearsal.md), constrained by the [verified private-readiness follow-up](../../evidence/readonly-hosted/private-readiness-20261029.md).

**Execution result:** [23:12 UTC attempt](../../evidence/readonly-hosted/accepted-replay-20261029-231248.md)
was aborted at the browser's action-time confirmation gate. Private readiness and
teardown succeeded; no GitHub delivery or execution occurred. Unchecked proof
steps remain unproven, not authority to resume this expired window.

**Later completion:** the separately confirmed
[30 October 08:48 scheduled run](../../evidence/readonly-hosted/accepted-replay-20261030-084800.md)
completed accepted replay and bounded teardown. The unchecked steps below describe
the original aborted attempt, not remaining work or permission to rerun it.

## Authority And Fixed Scope

- This document is a plan only. No new cloud read, update, probe, comment, route, webhook or execution was performed while preparing it.
- Execution needs separate approval for the complete bounded operation, including private policy updates, authenticated preview capability/upload, one comment, one redelivery and teardown. The final five-minute clock starts only on fresh confirmation when preflight is ready.
- Account `d95812af050c2e549a3296899b7b43b3`; existing `CeireanReadOnly` / `smoke-20261029` stack and protected local state/profile only.
- Worker `ceireanreadonly-readonlyworker56trhdak554hd5gd7mzqrci7`; route only `ceirean-hooks.opsydyn.xyz/webhook`. Keep workers.dev and public preview URLs disabled throughout.
- Target `opsydyn/fold-kit-experiments#57`; installation `173668921`, owner/operator `257329185`, repository `1247366304`. Reverify identities and issue state before execution; changed values require review, not silent substitution.
- One fresh session `readonly-replay-<UTC YYYYMMDDHHmmss>`; never reset or reuse `readonly-20261029`. Selecting a fresh named DO is intentional; no DO migration or namespace replacement is allowed.
- Trusted argv remains `/usr/local/bin/node --version`, existing immutable image, no Internet/SSH/credentials in the container. No dependency upgrade, build, repository script, model call or PR.
- Source export is committed `cf9aa9f6fea4567df9c7a52b8ee88353cd24c0d1` (same runtime code as deployed `5f122fe`), not the dirty worktree. Record any later reviewed source explicitly before execution.
- Keep operator opt-in child-scoped, dotenv/debug dumps disabled and sanitized output only. SDK preview-token lifetime/revocation remains unverified; process disposal is not remote revocation.

## Review Focus

- Worker/DO rollout skew: exact desired-policy readiness must succeed before activation; no sleep, retry loop or weakening of authorization.
- GitHub login/OS lock: verify enable and disable controls before the clock; an independent route watchdog must not depend on the browser staying available.
- Delayed execution/delivery: never extend the window or send an extra comment/redelivery to rescue missing evidence.
- Replay ambiguity: require original 202, terminal private status and replay 202 with the identical terminal record; a refused original is not deduplication proof.
- Teardown uncertainty: route removal and expired admission do not prove webhook disable or container stop; collect each observation separately and report any unknown.

## Task 1: Preflight Without Public Activation

**Inputs:** existing source, protected credentials/state, consumed-session evidence.
**Output:** sanitized preflight record, proposed session and ready-to-start bounded operation; clock not started.

- [x] Run `moon run infrastructure:test --concurrency 1`, `moon run :typecheck --concurrency 1` and `bun --no-env-file --no-install run check`. Require all passing, preserving unrelated observer work.
- [x] Verify token/account, existing Worker/image/DO bindings, no matching route, public URLs off, zero active native instances and the retained original instance still stopped. Do not log secret bindings or credential values.
- [x] Verify App permissions remain Issues Read and Metadata Read, selected repository and signed issue-comment delivery; issue #57 is open and numeric identities match. Verify webhook Active off and SSL verification on.
- [x] Have the owner complete sudo authentication if needed, then verify the webhook enable/disable controls are accessible. Do not use preview auth or an App key to infer authority to edit App settings. Do not start the clock while OS/browser access is blocked.
- [x] Export the pinned committed source into protected operational storage, using frozen offline dependencies without lifecycle scripts if a new export is needed. Reuse the existing pinned image; do not start Docker/Colima unless an unexpected image-copy requirement is separately resolved.
- [x] Prepare an independent watchdog for exact matching-route deletion at the deadline, using existing protected credentials without printing them. Confirm it can run independently of the browser. It must never create a route or change GitHub permissions. Record capability and authentication checks before activation.
- [x] Present the proposed session, one-execution scope, preview-capability limitation and five-minute relative deadline for final start confirmation. No absolute dates/window are preauthorized by this plan.

## Task 2: One Five-Minute Operation

**Inputs:** completed preflight and fresh start confirmation.
**Output:** accepted-replay proof or an explicitly incomplete result; no automatic rerun.

- [x] At confirmation receipt record `T0` in UTC, set `opensAtMs = T0`, `closesAtMs = T0 + 300000`, generate the fresh session and arm the watchdog for that same deadline. All preparation and activation below consume this window; it never restarts.
- [x] Plan the fresh policy with ingress `Private`. Require only expected Worker configuration changes, unchanged class/namespace/image and no destructive resource changes. Apply privately; do not reset either session's ledger.
- [x] Run the fixed operator once against the exact fresh policy. Require `readonly-policy-v1`, full policy equality and `job: null`. Refusal, mismatch, unexpected job or inadequate remaining time means abort, not retry. This checkpoint may initialize the named DO but must not admit or execute a job.
- [ ] Before `T0 + 120000`, apply ingress `Rehearsal` with the **identical** policy, then enable/save the App webhook and verify Active on. Only the exact route may be added. If either action fails or runs late, go straight to teardown; do not post a comment.
- [ ] Post exactly one `/ceirean assess` comment on issue #57. Retain its URL and original delivery response. Require HTTP 202 and a valid fresh-session job. Preserve large GitHub delivery IDs as exact strings, never rounded JavaScript numbers.
- [ ] Observe terminal success through bounded provider observability, then invoke the operator once to retain the exact `Succeeded` job. It must identify the fresh session and expected runtime, with independent stopped-instance evidence. If success is not confirmed before `T0 + 180000`, skip redelivery and tear down.
- [ ] Redeliver that exact original delivery **once**, before `T0 + 180000`. Require replay HTTP 202 and a job structurally equal to the recorded terminal job, including session/timestamps/runtime. No second comment, substitute event, application retry or additional redelivery.
- [ ] Run one post-replay operator observation and compare the unchanged terminal job. Inspect native instance history and alarm/execution evidence for the fresh session: one execution/start only, no new active instance. Bound this collection; start teardown no later than `T0 + 240000`, even if evidence is incomplete.

## Task 3: Teardown And Evidence

**Files:** create `docs/evidence/readonly-hosted/accepted-replay-<actual-UTC-date-time>.md`; update `docs/runbooks/readonly-hosted-rehearsal.md` and `packages/infrastructure/README.md` only to match actual results.

- [x] Disable/save the App webhook immediately after evidence collection (or on abort); if it was never enabled, verify it stayed off instead. Independently restore ingress `Private` with the same fresh session and expired `opensAtMs: 0`, `closesAtMs: 300000`; do not delay route removal while waiting on browser access.
- [x] Use scoped exact-route deletion if immediate safety removal is needed or Alchemy teardown fails. The watchdog removes any remaining matching route at `T0 + 300000` regardless. Verify no matching route and both public URL flags off. Record any failure rather than assuming rollback.
- [x] Verify webhook Active off after reload. If the Mac locks, request manual unlock while route removal proceeds independently; report delivery-disable delay separately. Do not bypass OS authentication or claim the watchdog controls GitHub delivery.
- [x] Run one final operator check against the expired fresh-session policy. Retain the same terminal job, actual failure/cleanup state, or null if no admission occurred. Verify zero active native instances and any allocated fresh instance stopped/exit 0; reconcile `CleanupRequired` without another execution before any future run.
- [x] Limit operator invocations to the four documented checkpoints (empty ledger, terminal before replay, post-replay, expired policy). They are observations, not retries. A checkpoint failure ends the attempted proof and triggers teardown; necessary safety reconciliation must be separately identified.
- [x] Stop the watchdog only after verified route removal, or observe its normal completion; dispose operational processes. Do not delete either durable ledger, protected state, stopped instance history or evidence. Confirm the operator still refuses a disabled invocation.
- [x] Record source/deployment identities, UTC timestamps, desired policies, available comment/delivery identifiers and 202 bodies, operator observations, execution/instance readbacks and each teardown fact. Explicitly record missing proof when aborted before delivery. No secret, raw preview token, full provider config or credential file belongs in Git.
- [x] Report success only if both deliveries were accepted, the terminal job is identical, one execution is observed and teardown is verified. Otherwise record partial/failure without an unapproved rerun. No claim extends beyond the observation period.
- [x] Run root lint/format and `git diff --check`; commit only sanitized evidence and matching documentation. No merge or push is included in activation authority.

## Exit And Product Follow-Up

The [preflight record](../../evidence/readonly-hosted/accepted-replay-preflight-20261029.md)
is historical. The later attempt cleared sudo authentication but was stopped by
the separate action-time enable gate. A future run must collect click-specific
confirmation while still private, before route exposure, without extending a
window. Revisit the sequence and obtain fresh approval before another attempt.

After verified teardown, the next product slice is a trusted pinned FoldKit
manifest/dependency report. Baseline commands and browser evidence follow that;
they are not added to this smoke or justified by its isolation evidence.
