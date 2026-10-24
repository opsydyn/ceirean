# Hosted Executor Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify a bounded Cloudflare Linux executor against the pinned FoldKit baseline without migrating Ceirean's controller.

**Architecture:** A private control Worker admits predefined operations and owns disposable per-job sandboxes. Preparation and offline execution are separate; a trusted local runner exports validated evidence. Compatibility, implementation and paid activation have independent stop gates.

**Tech Stack:** Bun, TypeScript, Effect 4.0.5, Alchemy 2.0.0-beta.83, Cloudflare Sandbox/Containers, Playwright, Moon, Oxlint and Oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-24-hosted-executor-design.md`

## Global Constraints

- Only `opsydyn/fold-kit-experiments` at `b7484cb46e66b162c8afddcfba235c9507b4f0ab`; baseline-only, no candidate patch.
- Alchemy stays `2.0.0-beta.83`. No Flue/XState migration, hosted application ledger, model calls, GitHub writes, webhooks, tunnel activation, DNS or public previews.
- Exact SDK, matching image digest, historical toolchain and harness identities must be resolved before hosted execution; no floating execution tags.
- Whole sandbox is one disposable trust unit. Chromium must retain its own sandbox; no `--no-sandbox` fallback.
- One active sandbox; 60-minute window, at most 45 minutes execution and 15 minutes cleanup. Start no case that cannot fit its deadline plus cleanup.
- At most 2 vCPU, 8 GiB memory, 20 GiB writable storage; unsupported required enforcement blocks qualification.
- At most 10 MiB output per command, 512 MiB exported evidence and proposed USD 5 session allowance, not a provider billing cap.
- External network disabled during execution. Missing offline artifacts block, never trigger broader networking or skipped checks.
- Universal lint rules. Inferred Effect channels and service boundaries; do not add explicit manual Effect channel contracts or helper-local runtime provisioning.
- Existing `skipLibCheck` approval covers the ledger probe, not this new workspace. Any new exception requires owner approval.
- Use an isolated worktree at execution time. Commit each verified task, without pushing. No paid provisioning until the filled session worksheet is separately approved.

## Review Focus

1. Duplicate or concurrent control requests must not create a second active job; Task 2 tests admission races.
2. A disconnected caller or ambiguous remote response must not cause blind command replay; Task 3 tests reconciliation and teardown.
3. HTTP denial is not proof of DNS/raw-socket denial; Task 4 records each network channel separately and blocks unexpected egress.
4. A screenshot can exist despite broken interactions or page errors; Task 4 requires assertions, trace and console evidence for every journey.
5. A successful destroy response is not proof of cleanup; Tasks 3 and 5 require independent access/readback checks and preserve `CleanupUnconfirmed`.

## File Map

- `docs/assessments/hosted-executor-preflight.md`: exact compatibility evidence and blockers, before any scaffold.
- `probes/cloudflare-executor/{package.json,tsconfig.json,moon.yml,README.md}` and `.moon/workspace.yml`: private workspace and safe offline commands.
- `probes/cloudflare-executor/alchemy.run.ts`: isolated stack, private control binding, image/container configuration; never imports operational infrastructure.
- `src/contract.ts`: strict input/output schemas, fixed operations and budgets.
- `src/admission.ts`: pure admission/identity/deadline decisions.
- `src/control.ts`: trusted Effect service owning SDK integration and resource scopes.
- `src/worker.ts`: authenticated private entrypoint exposing only predefined operations.
- `src/evidence.ts`: streaming budgets, safe artifact names and evidence manifest validation.
- `image/Dockerfile` and `fixtures/baseline.json`: trusted image and exact historical input/command inventory.
- `tests/{contract,admission,control,evidence}.test.ts`: offline deterministic/property tests.
- `tests/{baseline,network,lifecycle}.hosted.ts`: explicit hosted cases, never auto-discovered by normal tests.
- `scripts/{prepare,run-hosted}.ts`: trusted preparation and explicitly activated session runner.
- `docs/runbooks/hosted-executor-session.md`: operator approval worksheet and recovery procedure.
- `docs/assessments/hosted-executor.md`: measured result, not planning claims.

Paths below are relative to `probes/cloudflare-executor/` unless fully qualified.

### Task 1: Resolve Compatibility And Pin The Baseline

Outcome, 2026-10-24: **Blocked**. See
`docs/assessments/hosted-executor-preflight.md`. Native Alchemy/container support
is present, but the final custom image/toolchain identities require preparation
scheduled later in this plan. Authenticated operator-to-Worker invocation also
remains unresolved and is an independent Task 1 blocker. No Task 2 scaffold or
paid operation has started. Owner approval of a narrow sequencing amendment would
permit preparation only; it would not satisfy the private invocation gate.

**Files:** Create `docs/assessments/hosted-executor-preflight.md`. No package edits, installs, deployment or cloud mutation in this task.

**Interfaces:** Produces a documented `Proceed` or `Blocked` decision, with source references and exact identities. Task 2 consumes only a `Proceed` decision; a failure ends execution and returns the blocker to the owner.

- [ ] Inspect the installed `packages/infrastructure/node_modules/alchemy` container/image/private-binding APIs and pinned provider implementation. Record exact paths and exports, not inferred support from newer online examples.
- [ ] Read current official Sandbox generation, process, network, security and lifecycle docs. Resolve a compatible exact SDK/image pair from primary metadata without installing it. Determine whether local image construction is required; if so, explicitly identify a bounded trusted builder rather than reviving the previous local VM effort implicitly.
- [ ] Verify the historical Git commit exists; statically inventory manifests, lockfile, fixture installs, root commands and browser targets without executing consumer scripts. Resolve historical Bun/Node/Git/Playwright/Chromium identities and all offline artifact requirements.
- [ ] Record the supported private invocation/authentication path, provider resource caps and remote cancellation/termination/readback mechanisms. Distinguish documented support from account eligibility, which remains a session gate. Lack of enforceable required caps or supported private control yields `Blocked`.
- [ ] Review the evidence against every spec prerequisite. If any identity or provider mechanism remains unresolved, commit a `Blocked` assessment and stop; do not scaffold an alternative toolchain or weaken a control.
- [ ] Verify `git diff --check` and root `bun --no-env-file run check`; commit `docs: resolve hosted executor compatibility gate`.

### Task 2: Build Offline Admission And Evidence Contracts

**Files:** Create workspace config, `src/{contract,admission,evidence}.ts`, `tests/{contract,admission,evidence}.test.ts`; modify `.moon/workspace.yml` and `bun.lock` only for admitted exact dependencies.

**Interfaces:** `contract.ts` exports schemas/types `ProbeRequest`, `ProbeManifest`, `ProbeOutcome` and fixed operation names `Baseline`, `NetworkDenial`, `CancelTree`, `Deadline`, `Disconnect`, `Isolation`. Outcomes are `Feasible | Blocked | Inconclusive`; cleanup is `Confirmed | CleanupUnconfirmed`. `admit(request, session)` returns a tagged admission decision. `makeEvidenceCollector(limits)` returns bounded collection operations. Effects infer their channels.

- [ ] Write failing `admission.test.ts` tests: a second active allocation is refused; duplicate operation IDs resolve to the existing operation; a case is refused if deadline plus cleanup exceeds the approved window. Test exact time boundaries, expired sessions and invalid identities with deterministic and Effect-native generated cases.
- [ ] Write failing `contract.test.ts` tests rejecting arbitrary argv, source revisions other than the approved SHA, caller-chosen sandbox IDs, unknown fields and expanded budgets. Fixed command definitions are controller-owned, never supplied by repository instructions.
- [ ] Write failing `evidence.test.ts` cases for traversal, absolute names, duplicate artifact names, special entries, malformed manifests, missing required artifacts and streaming output limits at 10 MiB/512 MiB plus one byte. Accept limits exactly; refuse before unbounded buffering. Use generated path/chunk cases where sensible.
- [ ] Run `moon run cloudflare-executor:test`; confirm the new tests fail for missing behavior, not an unrelated install/config failure.
- [ ] Implement schemas and pure decisions using existing Effect conventions. Normal tests run only named offline files, with no cloud calls or credential reads. Add the Moon workspace entry and strict source typechecking; do not copy the ledger declaration exception.
- [ ] Run focused tests, `moon run cloudflare-executor:typecheck`, root check and `git diff --check`; commit `feat: add bounded executor admission and evidence contracts`.

### Task 3: Own Remote Execution And Cleanup

**Files:** Create `src/{control,worker}.ts`, `alchemy.run.ts`, `tests/control.test.ts` and `scripts/run-hosted.ts`.

**Interfaces:** `makeExecutor(driver)` exposes inferred Effect operations `start(admittedOperation)`, `inspect(operationId)`, `cancel(operationId)` and `close(sessionId)`. The driver interface is inferred from the concrete adapter implementation, not manually annotated Effect channels. `inspect` distinguishes known-running, known-exited and unknown outcome. `close` returns evidence with `Confirmed | CleanupUnconfirmed`.

- [ ] Write failing fake-driver tests for concurrent start, duplicate request, authentication refusal before allocation, start response loss, cancellation with descendants, kill timeout, client disconnect and cleanup response/readback disagreement. Assert an unknown outcome is reconciled against the same operation, never blindly retried as a new execution.
- [ ] Run focused tests red. Implement the smallest owning Effect service with live dependencies declared once at its boundary. Explicitly separate cancelling a local wait from terminating the remote process and its descendants.
- [ ] Integrate the exact Task 1 SDK APIs and private binding in a separate Alchemy stack. Public routes, workers.dev and preview URLs stay disabled. No arbitrary shell HTTP API. Separate credential-free runtime configuration from trusted deployment credentials using Effect Config.
- [ ] Make the hosted runner refuse absent/mismatched approval worksheet, identity pins, session deadline or cost allowance. Sanitize its environment; never auto-load operational root `.env`. A dry-run validates inputs and prints only a redacted operation plan, performing no cloud calls.
- [ ] Run fake-driver tests, strict typecheck, root check and a negative dry-run proving missing approval cannot allocate resources. Commit `feat: add private executor lifecycle and fail-closed cleanup`.

### Task 4: Prepare Real Toolchain And Hosted Cases

**Files:** Create `image/Dockerfile`, `fixtures/baseline.json`, `scripts/prepare.ts`, `tests/{baseline,network,lifecycle}.hosted.ts` and `README.md`.

**Interfaces:** Baseline inventory contains the SHA, immutable image identity, exact tool versions, dependency artifact hashes, command argv/cwd pairs and required journey artifacts. Hosted cases use Task 3's admitted operations and Task 2's validated evidence; they never invoke the SDK through a second control path.

- [ ] Add offline failing tests for source archive traversal/symlink escape, credential-bearing tracked input, missing cache artifacts, unapproved redirect destinations and changing network policy mid-operation. Pin rejection behavior in the contract before implementing preparation.
- [ ] Implement trusted source validation and registry/artifact preparation. Never run consumer scripts in the trusted controller or image builder with credentials. Build tools/browser are pre-provisioned; record exact provenance. A missing artifact stops offline execution.
- [ ] Implement the unchanged root frozen install/check/typecheck/test/build, Storybook and packed consumer/template checks from the historical inventory. Assert nonzero test discovery and unchanged baseline source. Do not use current FoldKit checkout commands by assumption.
- [ ] Implement the two fixed journeys at 1440x900 and 390x844: carousel buttons/desktop and mobile drag-settle, promo line point edit/settings consistency. Require interaction assertions, screenshots, trace, console/page-error inventory, deterministic inputs and proof Chromium sandboxing is enabled.
- [ ] Implement hosted negative cases: denied HTTPS, direct-IP/raw TCP and recorded DNS behavior; two sequential isolated jobs; process-tree cancellation/deadline; caller disconnect; ambiguous response reconciliation; teardown followed by failed process/filesystem access. Emit explicit blocked results rather than simulated passes if a platform control cannot be exercised.
- [ ] Run all offline tests, typecheck and root check. Verify normal Moon test targets cannot execute hosted cases. No image build/upload, account mutation or hosted case runs in this task without the separate paid-operation approval. Commit `test: define hosted toolchain browser and safety qualification`.

### Task 5: Review And Prepare The Activation Worksheet

**Files:** Create `docs/runbooks/hosted-executor-session.md`; update preflight assessment and probe README.

**Interfaces:** The filled worksheet is the sole activation input to Task 3's runner: exact account/stage, authenticated operator, approved image/toolchain/source/harness hashes, commands, resource tier/enforcement, cost bound, absolute start/deadline, cleanup owner and resource inventory. Unfilled or expired fields are refused, not defaulted.

- [ ] Write and exercise offline worksheet tests for absent approval, stale/hash-mismatched artifacts, invalid timing, excessive budgets, unsupported caps and unconfirmed cleanup from a previous session.
- [ ] Document trusted build/upload, authenticated invocation, evidence export, stop conditions and teardown/recovery commands against the chosen pinned APIs. Inventory billable residual resources and account entitlement without provisioning; credentials stay outside source and chat.
- [ ] Calculate a conservative bound from current official pricing, including build/upload, compute, storage and residual resources. State which bounds are technically enforced and which require operator action. Seek a revised allowance rather than pretending USD 5 is a provider cap.
- [ ] Run root `bun --no-env-file run check`, `moon run :typecheck` and `moon run :test --concurrency 1`. Preserve existing property counts and timeouts. Inspect the full diff; obtain independent review if an authorized reviewer tool exists, otherwise explicitly disclose author-only review.
- [ ] Commit `docs: prepare bounded hosted executor rehearsal`. Present the filled worksheet and measured offline results; stop for owner approval. No deploy, upload or paid build is implied by a completed implementation plan.

### Task 6: Run The Separately Approved Hosted Session

**Files:** Update `docs/assessments/hosted-executor.md`, session worksheet and `docs/roadmap.md`; keep generated evidence outside tracked source with recorded hashes and location.

**Interfaces:** Consumes the approved exact worksheet and built harness. Produces a measured `Feasible | Blocked | Inconclusive` result with all required artifacts and cleanup readback.

- [ ] Revalidate approval, account/permissions, immutable inputs, current time, cost bound and disabled operational ingress. If anything drifted, stop before provisioning.
- [ ] Provision only the approved isolated resources; execute baseline and negative cases sequentially under remote deadlines. Never start a second active sandbox or a case that exceeds the remaining window.
- [ ] Export bounded validated evidence; record each required check and its actual result. A failed safety prerequisite stops additional repository execution; missing browser/security/cleanup evidence cannot be `Feasible`.
- [ ] Destroy session-owned resources by the deadline and independently verify removal/inaccessibility. Preserve `CleanupUnconfirmed` and invoke the documented operator recovery path when teardown cannot be established; do not claim success from an SDK response alone.
- [ ] Write measured assessment, cost/usage observations and remaining limitations. Root check and `git diff --check`; commit `docs: record hosted executor qualification evidence`. No push, controller integration or production activation.

## Self-Review

All spec sections map to Tasks 1-6: compatibility/baseline (1), schemas/budgets
(2), ownership and cancellation (3), preparation/browser/network/isolation (4),
approval/cost/security review (5), hosted evidence and teardown (6). Review Focus
items have explicit tests in their owning tasks. Exact SDK-dependent signatures
are intentionally settled by the blocking first task, not guessed in advance.
This plan does not assume they are supported. Inline execution was selected in
the preceding slice; preserve that method unless the owner changes it.
