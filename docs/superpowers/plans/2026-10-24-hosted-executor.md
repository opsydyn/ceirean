# Hosted Executor Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify a bounded Cloudflare Linux executor against the pinned FoldKit baseline without migrating Ceirean's controller.

**Architecture:** A private control Worker admits predefined operations and owns disposable per-job sandboxes. Preparation and offline execution are separate; a trusted local runner exports validated evidence. Compatibility, implementation and paid activation have independent stop gates.

**Tech Stack:** Bun, TypeScript, Effect 4.0.5, Alchemy 2.0.0-beta.83, Cloudflare Sandbox/Containers, Playwright, Moon, Oxlint and Oxfmt.

**Spec:** `docs/superpowers/specs/2026-10-24-hosted-executor-design.md`

## Approved Execution Order

Owner-approved amendment, 2026-10-24: **1 -> 4A -> 2 -> 3 -> 4B -> 5 -> 6**.
Task numbers are retained to preserve the preflight evidence and earlier review.
Static inspection now permits trusted recipe and offline harness preparation.
It is not hosted readiness: **private invocation and the final custom executor
image digest remain independent blockers before any hosted activation**.
Build/upload and hosted session approvals remain separate, as described in Task 5.

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
3. HTTP denial is not proof of DNS/raw-socket denial; Task 4B records each network channel separately and blocks unexpected egress.
4. A screenshot can exist despite broken interactions or page errors; Task 4B requires assertions, trace and console evidence for every journey.
5. A successful destroy response is not proof of cleanup; Tasks 3 and 5 require independent access/readback checks and preserve `CleanupUnconfirmed`.

## File Map

- `docs/assessments/hosted-executor-preflight.md`: static compatibility evidence, preparation permission and unresolved activation blockers.
- `probes/cloudflare-executor/{package.json,tsconfig.json,moon.yml,README.md}` and `.moon/workspace.yml`: private workspace and safe offline commands.
- `probes/cloudflare-executor/alchemy.run.ts`: isolated stack, private control binding, image/container configuration; never imports operational infrastructure.
- `src/contract.ts`: strict input/output schemas, fixed operations and budgets.
- `src/admission.ts`: pure admission/identity/deadline decisions.
- `src/control.ts`: trusted Effect service owning SDK integration and resource scopes.
- `src/worker.ts`: authenticated private entrypoint exposing only predefined operations.
- `src/evidence.ts`: streaming budgets, safe artifact names and evidence manifest validation.
- `image/Dockerfile` and `fixtures/baseline.json`: trusted image recipe and exact input/command inventory, with new qualification pins labeled separately from historical pins.
- `src/preparation.ts` and `tests/preparation.test.ts`: offline source/artifact validation and recipe prerequisite checks, independent of a live SDK adapter.
- `tests/{contract,admission,control,evidence}.test.ts`: offline deterministic/property tests.
- `tests/{baseline,network,lifecycle}.hosted.ts`: explicit hosted cases, never auto-discovered by normal tests.
- `scripts/{prepare,run-hosted}.ts`: trusted preparation and explicitly activated session runner.
- `docs/runbooks/hosted-executor-session.md`: operator approval worksheet and recovery procedure.
- `docs/assessments/hosted-executor.md`: measured result, not planning claims.

Paths below are relative to `probes/cloudflare-executor/` unless fully qualified.

### Task 1: Resolve Compatibility And Pin The Baseline

Initial outcome, 2026-10-24: **Blocked**, recorded in `dfc1887`. The subsequently
approved amendment permits Task 4A offline preparation using the static native
Alchemy/container evidence. No live compatibility, private invocation or final
executor digest has been qualified. These remain visible activation blockers in
`docs/assessments/hosted-executor-preflight.md`, not reasons to fabricate pins.

**Files:** Create `docs/assessments/hosted-executor-preflight.md`. No package edits, installs, deployment or cloud mutation in this task.

**Interfaces:** Produces separate preparation and activation decisions. `PreparationAllowed` permits Tasks 4A/2 and offline implementation of 3/4B only; `ActivationBlocked` retains each unresolved prerequisite. An actual incompatible provider/API premise is `PreparationBlocked` for affected implementation and must be reported, not worked around implicitly.

- [x] Inspect the installed `packages/infrastructure/node_modules/alchemy` container/image/private-binding APIs and pinned provider implementation; record exact paths and exports in the assessment.
- [x] Read current official SDK/native process/network/lifecycle docs and public SDK/helper metadata. Candidate SDK 1.0.3 and its helper digest are recorded, not installed or compile-qualified.
- [x] Verify the historical Git commit and record the prerequisite manifest/lockfile/fixture inventory without executing consumer scripts. Unpinned toolchain choices and full offline artifacts move to Task 4A.
- [x] Record documented resource/cancellation mechanisms and the unresolved authenticated invocation path. Private invocation, final image identity and live eligibility remain activation blockers.
- [x] Record the initial stop decision, review finding and the owner-approved preparation-only amendment. Do not weaken a control or silently substitute a deployment tool.
- [x] Verify root check/diff checks and commit the initial preflight as `dfc1887`; this is documentation evidence, not hosted qualification.

### Task 4A: Prepare Trusted Recipe And Offline Harness First

**Files:** Create workspace config, `image/Dockerfile`, `fixtures/baseline.json`, `src/preparation.ts`, `tests/preparation.test.ts`, `scripts/prepare.ts` and README; modify `.moon/workspace.yml` and `bun.lock` for admitted offline dependencies only.

**Interfaces:** `PreparationManifest` records the fixed source SHA, exact toolchain/SDK/helper/base inputs, recipe hash, fixed command inventory and artifact requirements. Distinguish a not-yet-built image from a resolved final digest; a preparation manifest can never serve as activation approval. `validatePreparation(input)` returns inferred Effect validation results with concrete missing prerequisites. `prepare --check` reads reviewed inputs and validates the manifest without building, fetching dependencies, invoking consumer scripts or accessing cloud credentials.

- [x] Select exact compatible Node 22, Git and controller-owned Playwright/Chromium pins from primary metadata and label them new qualification choices; retain historical Bun 1.3.11 and the recorded baseline. Pin linux/amd64 helper/base inputs by digest. Do not report chosen versions as reconstructed CI runtime facts.
- [x] Write failing preparation tests for wrong source/version, missing digest-bound inputs, floating tags, archive traversal/symlink escape, credential-bearing tracked inputs, absent offline consumer artifacts and unapproved redirect destinations. Assert that a valid recipe without a final image is preparation-only, never activation-ready. Use property tests for path and manifest invariants where sensible.
- [x] Run the named preparation tests red, then implement pure validators and the non-mutating `prepare --check` path using Effect Schema/Config conventions. Create only the minimal private workspace scaffolding required for those tests; do not install a live SDK merely to type a pure manifest.
- [x] Author the reviewed trusted image recipe and fixed command/journey inventory. Preserve root checks and nested npm/bun fixture installs; inventory those offline requirements explicitly. Include Chromium sandbox-enabled verification requirements; no fallback flags, silent fixture skips or arbitrary consumer instructions in the trusted build environment.
- [x] Document the proposed trusted Linux amd64 builder and its credential isolation. No builder creation, workflow push, Docker start, image build/upload or consumer execution in this task. Missing artifact payloads stay pending, not marked prepared because their names are listed.
- [x] Run preparation tests, workspace typecheck, root check and `git diff --check`; commit `feat: prepare trusted executor recipe and offline harness`. See `docs/assessments/hosted-executor-preparation.md` for measured results and the review fixes; later tasks remain unstarted.

### Task 2: Build Offline Admission And Evidence Contracts

**Files:** Extend Task 4A's workspace with `src/{contract,admission,evidence}.ts` and `tests/{contract,admission,evidence}.test.ts`; modify `bun.lock` only for admitted exact dependencies.

**Interfaces:** `contract.ts` exports schemas/types `ProbeRequest`, `ProbeManifest`, `ProbeOutcome` and fixed operation names `Baseline`, `NetworkDenial`, `CancelTree`, `Deadline`, `Disconnect`, `Isolation`. Outcomes are `Feasible | Blocked | Inconclusive`; cleanup is `Confirmed | CleanupUnconfirmed`. `admit(request, session)` returns a tagged admission decision. `makeEvidenceCollector(limits)` returns bounded collection operations. Effects infer their channels.

- [x] Write failing `admission.test.ts` tests: a second active allocation is refused; duplicate operation IDs resolve to the existing operation; a case is refused if deadline plus cleanup exceeds the approved window. Test exact time boundaries, expired sessions and invalid identities with deterministic and Effect-native generated cases.
- [x] Write failing `contract.test.ts` tests rejecting arbitrary argv, source revisions other than the approved SHA, caller-chosen sandbox IDs, unknown fields and expanded budgets. Fixed command definitions are controller-owned, never supplied by repository instructions.
- [x] Write failing `evidence.test.ts` cases for traversal, absolute names, duplicate artifact names, special entries, malformed manifests, missing required artifacts and streaming output limits at 10 MiB/512 MiB plus one byte. Accept limits exactly; refuse before unbounded buffering. Use generated path/chunk cases where sensible.
- [x] Run `moon run cloudflare-executor:test`; confirm the new tests fail for missing behavior, not an unrelated install/config failure.
- [x] Implement schemas and pure decisions using existing Effect conventions and Task 4A's input manifest. Normal tests run only named offline files, with no cloud calls or credential reads. Retain strict source typechecking; do not copy the ledger declaration exception. Refuse activation while private invocation or final image digest is unresolved.
- [x] Run focused tests, `moon run cloudflare-executor:typecheck`, root check and `git diff --check`; commit `feat: add bounded executor admission and evidence contracts`. Measured full-suite results and limits are in `docs/assessments/hosted-executor-contracts.md`; Task 3 and hosted activation remain unstarted.

### Task 3: Own Remote Execution And Cleanup

**Bounded execution split:** Task 3A implements only the simulated-driver
lifecycle and its offline tests. Task 3B retains the actual SDK/Worker/Alchemy
stack and approval-validating runner; it is not authorized or completed by 3A.
The private factory is refined to `makeExecutor(simulationDriver, sessionConfig)`:
`start(rawRequest)` owns admission internally rather than trusting a serialized
`Accepted` decision. No public package API changes. See the lifecycle assessment
for measured evidence and remaining integration work.

**Files:** Create `src/{control,worker}.ts`, `alchemy.run.ts`, `tests/control.test.ts` and `scripts/run-hosted.ts`.

**Interfaces (refined in Task 3A):** `makeExecutor(simulationDriver, sessionConfig)` exposes inferred Effect operations `start(rawRequest)`, `inspect(operationId)`, `cancel(operationId)` and `close(sessionId)`. Admission is internal. The driver interface is inferred from the concrete adapter implementation, not manually annotated Effect channels. One driver claims one non-releasable rehearsal owner; trusted assembly must not create independent drivers for the same authority. This is not distributed admission. `inspect` distinguishes known-running, known-exited and unknown outcome. `close` returns evidence with `Confirmed | CleanupUnconfirmed`.

- [x] Task 3A: Write failing fake-driver tests for concurrent start, duplicate request, authentication refusal before allocation, start response loss, cancellation with descendants, kill timeout, client disconnect and cleanup response/readback disagreement. Assert an unknown outcome is reconciled against the same operation, never blindly retried as a new execution. These are simulated states, not actual process/provider evidence.
- [x] Task 3A: Run focused tests red. Implement the smallest scope-owned Effect controller with its simulation driver supplied once at construction. Explicitly separate cancelling a local wait from terminating a remote process and its descendants; keep actual termination unqualified.
- [x] Task 3A: Verify simulated lifecycle, universal lint/format, all 12 workspace typechecks and the full serial test suite; address independent-review findings with failing regressions before fixes. See [measured evidence](../../assessments/hosted-executor-lifecycle.md). This does not complete Task 3B's negative hosted-runner dry-run or live integration.
- [x] Task 3B preparation: owner selected a signed Cloudflare Queue -> private Worker design, with hosted ingress/dead-letter queues proposed only. Prepare the inert approval-inspection envelope, external-key signature verifier and exact-mode offline runner. Preserve private invocation as hosted-unverified. See [design](../specs/2026-10-24-private-executor-invocation-design.md) and [evidence](../../assessments/hosted-executor-invocation.md).
- [x] Task 3B local follow-up: guard local-only Queue/Worker assembly, authenticate immutable routing and store one durable inspection receipt in SQLite. Prove transactional rollback, post-commit redelivery and separate-process replay. See [local evidence](../../assessments/local-executor-invocation.md). No SDK actuation or hosted authentication is qualified.
- [ ] Integrate the exact Task 1 SDK APIs and private binding in a separate Alchemy stack. Public routes, workers.dev and preview URLs stay disabled. No arbitrary shell HTTP API. Separate credential-free runtime configuration from trusted deployment credentials using Effect Config.
- [ ] Make the hosted runner refuse absent/mismatched approval worksheet, identity pins, session deadline or cost allowance. Sanitize its environment; never auto-load operational root `.env`. A dry-run validates inputs and prints only a redacted operation plan, performing no cloud calls.
- [ ] Run fake-driver tests, strict typecheck, root check and a negative dry-run proving missing approval cannot allocate resources. Commit `feat: add private executor lifecycle and fail-closed cleanup`.

### Task 4B: Connect Prepared Inputs To Hosted Cases

- [x] Approved offline subset: prepare pinned-tree source and browser-harness-source
      candidates, with source-byte/mode validation, nonzero journey discovery and an
      unconditional execution guard. See [measured scope](../../assessments/offline-executor-inputs.md).
      This does not complete the cache, extraction, hosted browser or safety cases below.
- [x] Freeze the Linux candidate registry inventory from the historical Bun lock,
      separate metadata-only npm resolution snapshots and pinned browser libraries.
      [Evidence](../../assessments/frozen-linux-dependencies.md) does not qualify cache
      contents, packed artifacts, native installs or any hosted/browser execution.

**Files:** Extend Task 4A's preparation files and README; create `tests/{baseline,network,lifecycle}.hosted.ts`.

**Interfaces:** Consume Task 4A's preparation manifest, Task 3's admitted operations and Task 2's evidence. Hosted cases require the resolved final image and payload hashes at activation; a pending image value must fail closed. Never invoke the SDK through a second control path.

- [ ] Extend Task 4A's tests for resolved payload mismatch and attempted network policy change mid-operation. Retain its source/artifact/redirect rejection cases rather than duplicate validators.
- [ ] Implement trusted source validation and registry/artifact preparation. Never run consumer scripts in the trusted controller or image builder with credentials. Build tools/browser are pre-provisioned; record exact provenance. A missing artifact stops offline execution.
- [ ] Implement the unchanged root frozen install/check/typecheck/test/build, Storybook and packed consumer/template checks from the historical inventory. Assert nonzero test discovery and unchanged baseline source. Do not use current FoldKit checkout commands by assumption.
- [ ] Implement the two fixed journeys at 1440x900 and 390x844: carousel buttons/desktop and mobile drag-settle, promo line point edit/settings consistency. Require interaction assertions, screenshots, trace, console/page-error inventory, deterministic inputs and proof Chromium sandboxing is enabled.
- [ ] Implement hosted negative cases: denied HTTPS, direct-IP/raw TCP and recorded DNS behavior; two sequential isolated jobs; process-tree cancellation/deadline; caller disconnect; ambiguous response reconciliation; teardown followed by failed process/filesystem access. Emit explicit blocked results rather than simulated passes if a platform control cannot be exercised.
- [ ] Run all offline tests, typecheck and root check. Verify normal Moon test targets cannot execute hosted cases. No image build/upload, account mutation or hosted case runs in this task without the separate paid-operation approval. Commit `test: define hosted toolchain browser and safety qualification`.

### Task 5: Review And Prepare The Activation Worksheet

**Files:** Create `docs/runbooks/hosted-executor-session.md`; update preflight assessment and probe README.

**Interfaces:** The filled worksheet is the sole activation input to Task 3's runner: exact account/stage, authenticated operator, approved image/toolchain/source/harness hashes, commands, resource tier/enforcement, cost bound, absolute start/deadline, cleanup owner and resource inventory. Unfilled or expired fields are refused, not defaulted.

- [ ] Write and exercise offline worksheet tests for absent approval, stale/hash-mismatched artifacts, invalid timing, excessive budgets, unsupported caps and unconfirmed cleanup from a previous session.
- [ ] Close the private invocation blocker with a concrete operator transport, authentication/authorization, required resources and pinned API support; test rejection before allocation. Disabled URLs or service binding declarations alone are insufficient. Do not deploy to discover an unreviewed authentication workaround.
- [ ] Prepare a separate image-build approval section: reviewed recipe/input hashes, trusted builder identity, credentials boundary, resource/time/cost limits, publication destinations and cleanup. It must not require the not-yet-built final digest. Stop for approval before any build/upload; perform only that approved preparation and record the resulting final image digest and payload hashes. This approval does not authorize probe deployment or execution.
- [ ] Validate the final digest against the approved recipe/build provenance and exact SDK/helper inputs. Only then complete the hosted worksheet with that immutable image identity. Pending, missing or mismatched identity keeps activation blocked.
- [ ] Document authenticated invocation, evidence export, stop conditions and teardown/recovery against the pinned APIs. Inventory billable residual resources and account entitlement without provisioning; credentials stay outside source and chat.
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

All spec sections map to Tasks 1/4A/2/3/4B/5/6: static compatibility (1), trusted
recipe/offline prerequisites (4A), schemas/budgets (2), ownership/cancellation (3),
browser/network/isolation cases (4B), build and activation gates (5), measured
hosted evidence/teardown (6). Review Focus items have tests in their owning tasks.
Exact SDK-dependent signatures are checked against pinned inputs during offline
implementation, not guessed. Private invocation and the final executor digest
remain independent blockers before hosted activation. The preparation-only
amendment does not waive either gate. Inline execution remains selected.
