# Read-Only Rollout Readiness Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this approved local correction; verify before committing.

**Goal:** Refuse admission during Worker/DO policy skew without misreporting an authorization failure, and prove accepted replay against the real storage adapter locally.

**Architecture:** Add a versioned private readiness RPC carrying the full validated admission policy. The Worker compares that descriptor before calling `enqueueReadyV1`; the DO compares the caller's descriptor again in that invocation before accessing the store. No legacy enqueue fallback is permitted. Keep status backward compatible, avoid public diagnostic routes, and preserve the existing admission/claim/cleanup state machine.

**Tech Stack:** Existing Alchemy 2.0.0-beta.83, Effect 4.0.5, Bun tests, oxlint-effect allRules.

**Spec:** `docs/runbooks/readonly-hosted-rehearsal.md` and the approved next slice following the 29 October hosted evidence.

## Global Constraints

- Local implementation and synthetic tests only; no deployment, public routes, webhook activation, comments or redelivery in this slice.
- No dependency upgrades, lint suppressions, manual Effect channel declarations, runtime provisioning in helpers, fixed rollout sleeps or enqueue retries.
- Preserve the consumed hosted session and all unrelated observer research.
- Readiness attests compatible protocol and equal policy, not equal native deployment IDs, an account-wide guarantee or permission to execute.
- Hosted readiness must be checked over a separately qualified private operator transport before another activation. Do not claim that transport or accepted-duplicate hosted evidence from local tests.

## Review Focus

- A stale DO or absent readiness method must return 503 before admission.
- A policy change between readiness and enqueue must not write a job or alarm.
- Matching policy cannot bypass numeric identity or time-window validation.
- Private readiness must not allocate a container, change storage or expose signing secrets.
- Accepted replay after success must preserve the same terminal job without another dispatch.

## Task 1: Private Readiness And Fail-Closed Admission

- [x] Add a failing regression for the missing private readiness capability.
- [x] Add `src/readonly/readiness.ts`: schema/codec, full-policy comparison, typed refusal and DO admission adapter inferred from the concrete store.
- [x] Add private readiness to the DO and Worker; keep `status` unchanged.
- [x] Check readiness before enqueue and again at the DO boundary; return generic 503 on mismatch/unavailability, with no automatic enqueue retry.
- [x] Test matching/stale/malformed/missing capability, bounded timeout, policy-field properties and no-mutation probing.

## Task 2: Accepted Replay And Documentation

- [x] Compose the signed HTTP bridge, readiness guards and real Alchemy storage wrapper over the existing transactional native fixture.
- [x] Verify stale admission does not write; matching admission dispatches once; replay after terminal success returns the identical result and does not rearm an alarm.
- [x] Update the runbook with private-first preparation, full desired-policy comparison, consumed-session preservation and the remaining hosted transport/activation gate.
- [x] Run infrastructure tests, all workspace typechecks, root lint/format and a final diff check; review and commit only this slice.

## Execution Record

Baseline: infrastructure typecheck and root lint/format passed; unrelated research remains untouched.
Ruling: this approval covers the local readiness/replay correction, not a new hosted window or new operator-facing infrastructure.

RED: the existing handler failed the new assertion because private readiness was absent.
GREEN: the descriptor, private RPC and guards made it pass.
Mutation RED/GREEN: removing the DO's second descriptor check made the signed race test return 202 instead of 503; restoring the check passed.
Initial verification: 54 infrastructure tests, all 12 workspace typechecks and root lint/format passed with all Effect lint rules unchanged. The 1,000-case policy mutation property reported Passed.
Independent review found that a rollback between probe and enqueue could reach legacy admission, which ignores the new guard argument. A second RED regression reproduced 202 instead of 503 through the actual Alchemy RPC adapter. The new versioned method name made it pass with zero legacy calls or store mutations; final verification follows below.

Final verification: 55 infrastructure tests, all 12 workspace typechecks, root lint/format and diff whitespace checks passed. Independent follow-up review confirmed the P1 was addressed, both mixed-version directions fail closed, and no rename blockers remain. No deployment or hosted activation occurred.
