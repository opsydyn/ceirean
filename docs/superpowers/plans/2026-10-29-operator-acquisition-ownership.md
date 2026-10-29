# Operator Acquisition Ownership Implementation Plan

**Goal:** Cancel pending preview acquisition when its owning runtime scope closes, without any hosted operation.

**Architecture:** Apply a minimal Bun patch to the pinned Alchemy runtime. Capture the RemoteBindings layer's scope and attach prefetch and fallback acquisition fibers to it. Exercise the real plugin with fake Loopback and RemoteWorker services, not Cloudflare credentials or a live preview. A failed individual request does not dispose a shared runtime: the future single-use operator boundary must own the whole runtime layer.

**Tech Stack:** Alchemy runtime 2.0.0-beta.83, Effect 4.0.5, Bun patches/tests and universal Effect lint.

**Spec:** approved acquisition fix following `docs/runbooks/private-operator-probe.md`.

## Constraints

- No credentials, remote preview/session/upload, deployment, public route, webhook, container or hosted activation.
- Preserve unrelated observer research; no dependency upgrades or lint-rule changes.
- Patch both Bun source and compiled Node entrypoints; keep package API/declarations unchanged.
- This proves local fiber ownership, not provider rollback, preview-token revocation or hosted readiness.

## Tasks

- [x] Add real-plugin regressions for scope close, interruption, deadline and startup failure; observe the ownership assertion fail before patching.
- [x] Register the minimal pinned dependency patch; verify cancellation finalizers complete before the owner returns, without background completion or retries. Reproduce and fix fallback acquisition ownership too.
- [x] Verify successful acquisition still reaches the existing binding bridge and independently check native local proxy teardown. Run the same nine plugin tests through Bun source and Node compiled exports.
- [x] Update qualification/runbook evidence, run infrastructure tests/all typechecks/lint/format and obtain independent review. Commit this verified slice only.

## Execution Record

Baseline: all 12 workspace typechecks and root lint/format passed. Only the previously preserved observer research was dirty.

RED: the actual plugin left its fake provider pending after its owning layer returned (`interruptedBeforeReturn` was false). Capturing the layer scope and using forkIn made that assertion pass. A second RED test showed the non-prefetched fallback could outlive runtime disposal when its caller remained alive; scoping that acquisition and joining its fiber made it pass too. The fake providers are drained even on RED, so no test task is left behind.

The patch changes only ownership in the pinned dependency's source and compiled Node module. Applied-file diffs were compared against the pristine cached package. The first installation exposed inaccurate patch hunk positions; those were corrected before qualification. Frozen-lockfile offline installation now passes without dependency or lifecycle-script changes.

Review found that the initial fallback fix kept runtime ownership but lost caller cancellation. A third RED test reproduced pending acquisition after its caller returned while the runtime stayed open. Fallback now uses acquire/use/release around the runtime-owned fiber, restoring caller interruption and joining it before return. Additional tests prove a delayed finalizer blocks owner return and a fallback arriving after disposal starts zero provider calls.

Initial verification passed 70 Bun tests plus six Node tests. After review changes, all nine ownership tests pass through both source and compiled exports, focused lint and infrastructure typecheck pass; final whole-slice verification follows. The native test independently verifies the operator proxy socket closes while the shared fixture still exists, then verifies fixture shutdown. Hosted transport remains disabled and no credentials or cloud resources were accessed.

Final gates: 73 infrastructure Bun tests and the nine-test Node prerequisite passed; all 12 workspace typechecks, root lint/format, frozen-lockfile offline installation and whitespace checks passed. Independent follow-up review confirmed the caller-cancellation finding resolved and found no blockers. All Effect rules remain unchanged. Only this ownership patch, tests, task wiring and documentation are included; unrelated observer research remains unstaged. No hosted operation or upstream report was performed.
