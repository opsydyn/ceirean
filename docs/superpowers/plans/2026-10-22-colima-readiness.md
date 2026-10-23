# Colima Readiness Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a read-only preflight CLI and offline-tested diagnostic report/activation contracts, without enabling native diagnostics.

**Architecture:** A private probe workspace owns pure strict schemas/policy, a bounded host reader and a preflight-only CLI. Diagnostic aggregation and activation-manifest validation are pure and fixture-tested; there is no native Stage 2 executor in this plan. Existing engine, lifecycle, operational storage and replay inspection remain unchanged.

**Tech Stack:** Existing Bun 1.4.2, Effect 4.0.5, TypeScript, Moon, Oxlint/Oxfmt; Effect Schema/Arbitrary for property tests. No new external dependency or lint exception.

**Spec:** [Approved readiness design](../specs/2026-10-22-colima-readiness-design.md), written-spec approval received 2026-10-22.

**Implementation approval:** Owner separately approved C1 on 2026-10-23 and
selected subagent execution. Tasks 1-4 are independently reviewed through
`2e99143`; Task 5 guard tests are committed at `1b59157`. Controller full gates
passed on that code head (1227 tests, zero failures; ten typecheck/test tasks).
Task 5 review completed. Whole-branch review through `8a2a4a7` returned With
fixes; the owner authorized one fixwave for I1/I2/M1/M2. Historical full-gate
counts above are superseded by those code changes: fresh fixed-head full gates
and scoped rereview remain pending the controller, not implied by delivery items.
See the [assessment](../../assessments/colima-readiness.md) for measured results.

## Scope And Handoff

This is Plan C1, a standalone first tranche of Plan C. It implements Stage 1 and
the offline contracts needed to describe Stage 2. Real container challenges,
VM start/stop and native cleanup are intentionally not implemented. Their exact
commands cannot be responsibly selected before host, storage and image facts
are known. Follow-on Plan C2 must implement all seven native checks against an
owner-approved exact manifest; writing that plan and activating it are separate
gates. Approving C1 must not be represented as approval of C2 or activation.

## Global Constraints

- Stage 1: no daemon contact, VM start, installs/downloads, ledger initialization,
  consumer code, model calls, credentials, ingress or publication.
- Separate explicit Stage 2 approval must bind manifest and finite start/deadline.
- One dedicated `ceirean` VM; one disposable diagnostic container at a time.
- Twenty minutes total including cleanup; no automatic extension.
- Per-container ceilings: 2 CPUs, 8 GiB RAM, 256 PIDs, 20 GiB writable storage.
- At most 10 MiB combined output per command; 128 MiB retained evidence total.
- No host binds, agent forwarding, Docker socket, privileged/host-network/PID
  containers, or browser `--no-sandbox` bypass.
- Pass, Fail and Blocked are distinct. Missing, contradictory, truncated or
  ambiguous required evidence cannot pass. Preflight can never pass native readiness.
- Universal Effect lint remains unchanged; infer Effect success/error channels
  from implementation, not manually annotated port contracts.
- Keep report types private to this probe. No WorkerReadyReceipt, replay blocker
  mutation, production orchestrator or operational ledger integration.

## Review Focus

1. Host config includes secrets/custom executable hooks: project only safe fields,
   never execute hooks or dump raw config (Task 3).
2. Symlink/special-file/profile substitution: bounded regular-file no-follow
   reads, explicit parent trust, identity-bound observations (Tasks 2-3).
3. Inherited PATH/environment causes unexpected execution: fixed executable
   candidates and empty inherited environment, no shell (Task 2).
4. Partial evidence or duplicate check IDs suggests false success: reject excess,
   duplicate, incomplete and cross-invocation records (Task 1).
5. Cancellation/timeouts leave child processes running: scoped subprocess
   termination and bounded output, tested with owned synthetic children (Task 2).

## File Map

Create private workspace `probes/colima-readiness/`:

- `src/contracts.ts`: schema types, check IDs, manifest and evidence bindings.
- `src/policy.ts`: pure report construction and activation validation.
- `src/host-reader.ts`: scoped bounded regular-file/process access for preflight.
- `src/preflight.ts`: allowlisted host observations and safe config projection.
- `src/cli.ts`, `src/main.ts`: explicit preflight-only entrypoint and composition.
- `tests/{contracts,policy,host-reader,preflight,cli}.test.ts`: focused tests.
- `tests/fixtures.ts`, `tests/child.ts`: synthetic inputs/owned child behavior.
- `package.json`, `tsconfig.json`, `moon.yml`, `README.md`: private packaging.

Modify `.moon/workspace.yml`, `bun.lock`, the design approval state and
`docs/roadmap.md`. Create `docs/runbooks/colima-readiness.md` and
`docs/assessments/colima-readiness.md`. Do not edit engine/domain/replay APIs.

## Verification Convention

Execute commands with credential-free temporary HOME, explicit PATH, OS-level
denial of real `.env` reads and external networking, following the retained
Plan B verification harness. Never source the root environment. Test sockets
may use owned loopback only when explicitly required; no operational listeners.
Create an isolated Ceirean worktree at execution time, not a FoldKit worktree.
Establish baseline root check, all Moon typechecks/tests before edits. Cache-only
frozen installation may refresh local workspace links; a missing cached dependency
blocks rather than authorizes network installation. Record raw RED/GREEN evidence.

Focused commands after adding Moon project `colima-readiness`:
`moon run colima-readiness:test colima-readiness:typecheck --force --no-actions`.
Final gates: `bun --no-env-file run check`,
`moon run :typecheck --force --no-actions`,
`moon run :test --force --no-actions`. Expect exit 0, no warnings/failures;
record actual counts rather than hardcoding a future total.

### Task 1: Strict Contracts And Pure Readiness Policy

**Files:** Create workspace metadata, `src/contracts.ts`, `src/policy.ts`,
`tests/contracts.test.ts`, `tests/policy.test.ts`, `tests/fixtures.ts`;
modify `.moon/workspace.yml` and workspace-only lock metadata.

**Interfaces:** Schema-derived `CheckId` is exactly EndpointOwnership,
HostIsolation, ContainerRestrictions, ResourceEnforcement, NetworkDenial,
BrowserSandbox, CancellationCleanup. `CheckEvidence` binds invocation ID,
manifest digest, check ID, outcome, finite reasons and artifact digests.
`ActivationManifest` contains exact argv arrays, absolute executable paths,
image digest/architecture, endpoint/daemon identity, security/storage/network
configuration, VM allocation, per-command budgets and cleanup reserve.
`ActivationApproval` binds manifest digest and absolute start/deadline.
`PreflightReport` and `DiagnosticReport` are separate tagged schemas.
Export pure `decodeManifest(input: unknown)`,
`validateActivation(manifest, approval, nowMs)`, and
`summarizeDiagnostics(manifest, invocationId, evidence, cleanup, approval, execution)`; use inferred
Effect Result types, strict decoding and no native effects.

Final-review fixes bind the digest to canonical manifest content (top-level
digest excluded, recursive lexical object keys, ordered arrays, compact
schema-encoded UTF-8 JSON, Bun SHA-256). Reports retain strict exact approval and
actual diagnostic execution times; every check/cleanup has approval and observed
interval provenance. Timing must preserve command budget/cleanup reserve.
Explicit post-deadline `CleanupOnly` records are retained but cannot qualify
timely Pass. No scheduler, native executor or freshness TTL is introduced.
Fixture launchers use absolute `process.execPath`; production execution policy
is unchanged. Only the seven approved unused export declarations are narrowed.
Existing property seeds/counts remain unchanged; two new provenance laws use
0/1/163 x 1000. See assessment and retained `final-fix-report.md` for fixwave proof.

- [x] Write failing examples: reject unknown fields/duplicate IDs/cross-invocation
      evidence, deadline beyond 1200000ms, negative/nonfinite budgets, missing cleanup
      reserve, output above 10485760 bytes, retained total above 134217728 bytes,
      CPU/memory/PID/storage ceilings above 2/8589934592/256/21474836480.
- [x] Run focused tests; confirm failures identify absent contracts/policy.
- [x] Implement schema/policy. Preflight always carries `canExecuteReplay: false`;
      diagnostic pass requires every exact check once, matching identities, complete
      artifacts and confirmed cleanup. Manifest validity is not operator approval.
- [x] Add Effect Arbitrary properties: downgrade/remove any check or cleanup,
      substitute invocation/digest, truncate required evidence or exceed any bound;
      never obtain Pass. Three seeds 0/1/163, 1000 runs per law, no reduced budgets.
- [x] Run focused types/tests and root check, record outcomes, review and commit
      `feat: define private readiness evidence contracts`.

### Task 2: Bounded Credential-Free Host Reader

**Files:** Create `src/host-reader.ts`, `tests/host-reader.test.ts`,
`tests/child.ts`; extend fixtures.

**Interfaces:** `makeHostReader(config)` returns inferred Effect methods
`readRegular(request)` and `runVersion(request)`; config fixes allowed read roots,
executable candidates, temp HOME and clock. Requests use finite observation IDs,
not arbitrary argv/path strings. Results contain bounded bytes/projected values,
finite errors and truncation flags, never raw exception/environment dumps.
Export no general shell/process runner.

- [x] Write failing synthetic tests for directories/FIFOs/symlinks, 256 KiB file
      cap, invalid UTF-8, replacement between metadata/read, oversized output,
      nonzero exit, stalled child, cancellation and sentinel environment leakage.
- [x] Run tests and confirm the intended RED failures.
- [x] Implement bounded metadata/no-follow/descriptor reads using existing replay
      reader conventions, plus scoped Effect subprocesses using the pinned Bun
      platform APIs. Use fixed executable candidates and exact version argv only,
      5-second per-command ceiling and 64 KiB combined version output cap; inherited
      environment is empty. No PATH search, shell, Docker server-info/version queries,
      executable config hooks or fallback command execution.
- [x] Prove timeout/cancellation reaps synthetic owned children and limits output
      during collection, not merely after buffering. Record parent-directory trust;
      refuse changed/nonregular descriptors rather than retrying arbitrary paths.
- [x] Run focused types/tests and root check, review and commit
      `feat: add bounded host preflight reader`.

### Task 3: Safe Read-Only Preflight Observations

**Files:** Create `src/preflight.ts`, `tests/preflight.test.ts`; extend fixtures.

**Interfaces:** `inspectHost(reader, request)` returns an inferred Effect of
`PreflightReport`. Request fixes profile `ceirean` and explicitly supplied
Colima config path within an approved root. Report projects architecture,
resource snapshot, client versions, relevant config fields and finite missing
prerequisites; endpoint is a proposed address, never verified daemon identity.

- [x] Add RED fixtures for absent tools/config, unsafe mounts, agent forwarding,
      unknown config version, embedded credentials/hooks, inherited Docker endpoint,
      symlinked profile, insufficient headroom and unsupported storage information.
      Assert no daemon/start/download method exists on the reader interface.
- [x] Run tests to establish RED.
- [x] Implement host observations via the bounded Effect-platform adapter
      transferred to Task 4 and Task 2's version-only commands: `colima --version`
      and `docker --version`, only after
      verifying installed-version semantics against official docs. Parse YAML with
      Bun's structured parser; strictly project an allowlist of fields and reject
      ambiguous/unsupported forms. Never evaluate provisioning scripts or templates.
      Collect no user identity, process inventory or credential-bearing paths.
      Per ledger ruling, `colima version` is not client-only. Both production
      executable candidates remain Unsupported; no installed client was executed.
      Synthetic observations qualify the adapter, not actual host facts.
- [x] Report absent configuration and unverified native controls as Blocked.
      Do not propose automatic host modifications or infer quota/browser feasibility
      from config alone. A sanitized manifest draft lists unresolved identities as
      blockers; it is not a valid ActivationManifest until all exact fields resolve.
- [x] Verify fixtures include hostile synthetic fields but reports contain none
      of their marker values. Run focused gates/root check, review and commit
      `feat: inspect dedicated Colima profile without daemon access`.

### Task 4: Preflight-Only CLI And Process Regression Tests

**Files:** Create `src/cli.ts`, `src/main.ts`, `tests/cli.test.ts`, `README.md`.

**Interfaces:** `runCli(argv, dependencies)` returns inferred Effect output
`{ exitCode, stdout, stderr }`. Main provisions dependencies once at its exported
boundary. Only `preflight --config <absolute-path>` is supported; importing
modules performs no work. No activation, run, cleanup or arbitrary command mode.

- [x] Add failing tests for unknown flags/subcommands, relative config paths,
      import-only execution, hostile cwd/environment, serialized output excess and
      an attempted `activate` invocation. Assert zero host calls on usage errors.
- [x] Run process tests and confirm RED without installed Colima/Docker or daemon.
- [x] Implement one strict JSON stdout report, at most 256 KiB, using Task 3.
      Exit 2 for a valid preflight report (native readiness unqualified), 1 for finite
      sanitized collection/encoding failure, 64 for usage. Never emit raw config,
      subprocess output or exception stacks. Oversized report fails, never truncates
      into valid-looking JSON. Preserve no-import-effects behavior from replay CLI.
- [x] Verify real subprocess entrypoint with injected synthetic executable/config
      fixtures in owned temp roots. Package remains private, with explicit CLI script
      using `bun --no-env-file --no-install`; no install/start hooks.
- [x] Run focused gates/root check, review and commit
      `feat: expose read-only readiness preflight CLI`.

### Task 5: Closure, Independent Review And Native Handoff

**Files:** Create runbook/assessment paths in File Map; update roadmap and spec
approval state. Modify implementation only to repair reviewed findings.

**Interfaces:** Runbook documents exact C1 invocation, report interpretation and
C2 prerequisites. Assessment separates synthetic proof, optional explicitly
authorized host observation, and absent native evidence.

- [x] Write runbook mapping all seven native checks to required evidence and
      explicit C2 follow-on work; no executable activation recipe is implied.
      Capture unresolved image/storage/security/network identities as blockers.
- [x] Record written-spec approval and C1 implementation approval independently.
      Do not mark Plan C native readiness or replay qualification complete.
- [x] Close deferred Task 2 minor with runtime-invalid IDs, relative root/executable/
      HOME paths and untrusted runVersion parents, finite errors and zero I/O.
      Verified test-only commit `1b59157`; production/test code frozen for controller.
- [x] Complete controller-owned full verification with raw logs and unchanged
      property budgets. Root check, all ten typechecks and all ten test tasks
      passed on `1b59157`: 1227 tests / zero failures in 4m24.248s. Existing
      migration-storage refinement: 3000 cases, 148083.89ms within 180000ms.
- [x] Obtain controller-owned Task 5 and independent whole-branch reviews;
      findings repaired through `a2c1287`, with the final typed-interval gap
      closed by owner-approved `ed98a19`. Independent bounded review clears I2
      with no findings. Controller full gates at `ed98a19`: root check, ten
      typechecks and ten test tasks / 1333 tests, zero failures, 4m24.630s.
      Existing property budgets unchanged; actual host/native work not approved.
- [x] Run Fallow report-only under existing no-network/no-secret/no-telemetry
      conventions; distinguish retained compatibility dependencies from new findings.
      Exit 1: nine new probe static findings plus one retained compatibility
      dependency warning; disclosed in assessment, not suppressed or auto-fixed.
- [x] Commit verified documentation/fixes as
      `docs: record offline readiness foundation evidence`. Stop for owner review:
      no merge/push, host preflight execution, VM startup, download or native activation
      is implied by fixture tests or this implementation plan.

## C2 Entry Gate And Primary References

After C1 review, separately authorize actual host preflight. Its findings must
support a concrete C2 implementation plan with reviewed argv, exact native image
and browser, effective storage mechanism, safe resource challenges, authoritative
network-denial evidence and cleanup reconciliation. If a control is unavailable,
report Blocked and reshape explicitly rather than weakening the approved spec.

- [Colima configuration defaults](https://github.com/abiosoft/colima/blob/main/embedded/defaults/colima.yaml):
  verify installed-version mount/agent/context semantics, not mutable main alone.
- [Docker storage drivers](https://docs.docker.com/engine/storage/drivers/) and
  [daemon storage options](https://docs.docker.com/reference/cli/dockerd/):
  filesystem/snapshotter support must be observed; VM disk size is not quota proof.
- [Playwright Docker](https://playwright.dev/docs/docker): non-root Chromium needs
  suitable sandbox/seccomp support. Do not copy permissive example flags into
  Ceirean's stricter isolation contract.
