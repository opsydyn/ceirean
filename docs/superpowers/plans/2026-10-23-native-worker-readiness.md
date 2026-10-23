# Native Worker Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify one real disposable diagnostic worker, including sandboxed browser evidence and confirmed cleanup, before implementing repository repair execution.

**Architecture:** Extend the private readiness probe, not the engine or operational ledger. Keep host preparation, diagnostic activation and replay admission separate. Existing C1 evidence contracts remain the diagnostic authority; they never issue a production worker receipt.

**Tech Stack:** Existing Bun 1.4.2 / Effect 4.0.5 / Moon / Oxlint / Oxfmt for the controller; dedicated Colima/Docker boundary; native arm64 Chromium. No Alchemy upgrade or new controller framework.

**Spec:** [Approved readiness design](../specs/2026-10-22-colima-readiness-design.md), [replay architecture](../specs/2026-10-21-foldkit-replay-profile-design.md), [actual host preflight](../../assessments/colima-readiness.md).

**Status:** Planning authorized after `e5a5ad1`. Implementation, retrieval,
provisioning and activation are not authorized by this document. Task 1 is
implementation-ready. Task 2 is a bounded feasibility gate. Tasks 3-4 are an
explicit downstream blueprint, not implementation-ready task briefs: they must
not execute until Task 2's concrete lock and updated briefs are reviewed.

## Global Constraints

- One dedicated `ceirean` VM and one disposable container at a time.
- Twenty minutes including cleanup; no automatic extension.
- Container ceilings: 2 CPUs, 8 GiB RAM, 256 PIDs, 20 GiB aggregate writable storage.
- At most 10 MiB combined output per command and 128 MiB retained evidence.
- No host directory sharing, host binds, SSH-agent forwarding or worker Docker socket.
- Non-root, read-only root, dropped capabilities, no-new-privileges and pinned seccomp.
- No privileged mode, host networking/PID/IPC namespaces, `SYS_ADMIN`, or browser sandbox bypass.
- Keep model calls, consumer code, operational storage, ingress and publication off.
- Keep all lint rules universal; inferred Effect channels and service-owned provisioning.
- Synthetic/property tests do not establish native enforcement.
- Use an isolated worktree for implementation; commit each verified task.

## Measured Starting Point

Main `e5a5ad1` records arm64, 24 GiB physical memory and 12 logical CPUs.
The free-page snapshot was about 2.69 GiB: not reclaimable memory or permission
to allocate an 8 GiB VM. Dedicated config is absent. Homebrew symlink names
suggest Colima 0.8.1 and Docker 27.5.1, but neither executable/version is qualified.

### Blocking Discovery: Empty Mounts Are Not Disabled Mounts

Installed-version [Colima 0.8.1 generation](https://github.com/abiosoft/colima/blob/v0.8.1/environment/vm/lima/yaml.go)
maps empty mounts to default home/temp sharing and adds a cache mount for custom
mounts. C1 currently projects an empty list as `Disabled`, which is incorrect
for that version. All replay blockers remain present, and no VM was started.

[Colima 0.10.1](https://github.com/abiosoft/colima/blob/v0.10.1/environment/vm/lima/yaml.go)
distinguishes null from empty mounts, but its generation still adds a cache
share. Do not propose `mounts: null`, `--mount=none`, or a blind Homebrew upgrade
as proof of zero sharing. A cache share is still a host directory share.

Retain Colima if a reviewed, version-pinned mechanism produces zero effective
host shares without breaking startup or socket forwarding. Otherwise report
Blocked and bring back one explicit architecture decision. Do not patch generated
VM configuration after startup, invent a `mount-none` flag on 0.8.1, introduce a
fork, or relax isolation silently. Direct Lima or revised sharing policy would
change the approved design and require separate owner approval.

## Review Focus

1. Empty/null/omitted mounts across versions must never imply native isolation.
2. Preparation failure after partial provisioning must not orphan an unowned VM.
3. Docker create succeeds but its reply is lost: never create a replacement blindly.
4. Chromium launches while its sandbox is off: screenshot alone must not pass.
5. Deadline/output exhaustion during diagnostics must preserve cleanup authority
   without permitting more diagnostics or foreign-resource deletion.

## Task 1: Correct Preflight Semantics And Preserve Fail-Closed Behavior

**Files:** modify `probes/colima-readiness/src/preflight.ts`,
`tests/preflight.test.ts`, and `docs/runbooks/colima-readiness.md`.
Paths beginning `tests/` below are relative to the probe workspace.

**Interfaces:** Keep `InspectRequest`, `inspectHost` and `PreflightReport`
compatible. `config.mounts` remains a conservative observation, not native proof.
Without a reviewed version-specific effective configuration, no value of the
input mounts array may produce `Disabled`.

- [ ] Write `empty mounts cannot disable installed Colima defaults`: use the
      existing `safeYaml` fixture; require `config.mounts !== 'Disabled'`, a finite
      unsafe/unknown blocker, `nativeReadiness === 'Unqualified'`, and replay false.
- [ ] Run focused tests and observe the empty-list regression fail before editing.
- [ ] Correct `safeConfig`: nonempty explicit mounts are Enabled; empty mounts
      remain Unknown with `UnknownConfiguration`; omitted mounts remain Unknown.
      Keep null outside the current narrow accepted dialect; do not infer installed
      semantics from fixture version text. Update the misleading safe fixture name
      and existing assertions rather than weakening unrelated controls.
- [ ] Add property cases covering empty, absent, null and bounded nonempty arrays
      plus contradictory version observations: no unreviewed combination yields
      Disabled. Keep secrets out of reports. Use Effect Arbitrary with explicit seeds
      0, 1 and 163, 1000 runs per law per seed.
- [ ] Run restricted root check, probe typecheck and all probe tests. Expected:
      exit 0, no warnings; preflight-only CLI remains unchanged.
- [ ] Commit `fix: stop treating empty Colima mounts as disabled sharing`.

## Task 2: Resolve The Native Setup Lock Before Building An Executor

**Files:** create `docs/assessments/native-worker-setup.md`; update this plan
and the readiness runbook. This task is research/lock preparation, not provisioning.

**Interfaces:** Produce one reviewed setup record containing exact executable
paths/digests, Colima/Lima/Docker versions and source semantics, VM image source
and digest, no-sharing mechanism, native container image source/digest, browser
build and Playwright version, seccomp bytes/digest, and preparation commands with
download/build/disk/time bounds. A missing field produces a finite blocker, not
a placeholder activation manifest.

- [ ] Review the complete installed-version startup/config generation and Lima
      integration path against primary source. Establish whether zero host shares
      can coexist with Docker socket forwarding under the approved design. Check
      effective generated config, global/default overlays, cache sharing, agent and
      credential inheritance; do not inspect actual secrets or start the VM.
- [ ] If no supported path is established, record the blocker and stop this plan
      after Task 1. Do not spend on image retrieval or executor implementation yet.
- [ ] If supported, resolve reviewed executable identities and matching client-only
      version argv. `colima version` remains disallowed as a client-only command:
      [its 0.8.1 implementation](https://github.com/abiosoft/colima/blob/v0.8.1/cmd/version.go)
      enters application runtime code. Preserve credential-free bounded execution.
- [ ] Choose a Ceirean-owned diagnostic image, not a consumer Dockerfile. The
      [official Playwright image](https://playwright.dev/docs/docker) is a candidate
      base, not a qualified worker: resolve native arm64 manifest, package/browser
      match, non-root execution and seccomp. Pin digests, never `latest` or guessed
      fixture values. No image pull/build is authorized during this research task.
- [ ] Decide whether the diagnostic image also meets the replay spec's exact
      Bun 1.3.11 / compatible exact Node 22 / Git requirements. If not, label it
      DiagnosticOnly; later replay needs separate image qualification. Controller
      Bun 1.4.2 does not replace the historical worker toolchain.
- [ ] Resolve VM allocation from a fresh bounded headroom observation and a
      declared host reserve. Do not derive it from physical RAM or the old free-page
      snapshot alone. Document measurement argv for approval before collecting new
      observations outside the existing allowlist.
- [ ] Replace Tasks 3-4 below with exact file/interface/test/argv briefs tied to
      the resolved setup. Obtain review and owner approval of the setup and briefs.
      Commit the verified decision record; no live execution or download.

## Task 3 Blueprint: Bounded Diagnostic Mechanism And Evidence

**Proposed files:** private probe `src/setup-contracts.ts`, `src/native-commands.ts`,
`src/native-runner.ts`, `src/native-checks.ts`, `src/evidence-store.ts`,
`src/diagnostic-main.ts`, matching tests, and `image/` with trusted diagnostic
sources. Final file split and interfaces are fixed at Task 2, not left to an
implementer to guess.

- [ ] Keep setup approval separate from `ActivationManifest`/`ActivationApproval`:
      a daemon ID cannot be known before its first approved startup. Bounded setup
      may establish that identity and stop the VM; it cannot run diagnostic work.
      Never use a synthetic daemon ID to break this dependency.
- [ ] Use finite command IDs and typed arguments, explicit endpoint and immutable
      IDs; no shell, arbitrary executable override, environment/context fallback or
      implicit pull. Revalidate resolved executables/config before execution.
- [ ] Record invocation-owned intent before mutation in a separate bounded local
      diagnostic journal, not the operational ledger. Ambiguous create/start replies
      require readback/reconciliation, never blind repetition. Foreign/pre-existing
      resources block. Separate preparation leftovers from diagnostic ownership.
- [ ] Enforce absolute and monotonic budgets; proposed 20-minute diagnostic window
      reserves 5 minutes for cleanup. Catalog worst-case diagnostic time must fit
      15 minutes. Every readback/transfer/retry consumes the same approved budget;
      command output <= 10 MiB and aggregate retained evidence <= 128 MiB.
- [ ] Test all seven checks using deterministic runner fixtures, then property-test
      command substitution, identity mismatch, timing/cap mutations and ambiguous
      replies. Root lint policy remains unchanged. No default native test execution.

| Check                 | Native assertions required before Pass                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EndpointOwnership     | Explicit endpoint; bound daemon ID; invocation labels and immutable IDs; reject foreign or unresolved prior resources.                                           |
| HostIsolation         | Effective guest and container mount inventories show no host shares/binds; no forwarded agent/socket/controller credentials; synthetic-marker negative readback. |
| ContainerRestrictions | Readback UID != 0, readonly root, all capabilities dropped, no-new-privileges and exact seccomp; attempted prohibited write fails.                               |
| ResourceEnforcement   | Readback and bounded challenge of CPU/memory/PID/storage; no swap bypass; account for every writable mount including `/dev/shm`, temporary files and metadata.   |
| NetworkDenial         | `none` network readback plus interface/route inventory, DNS and direct-IP failures, and successful same-container IPv4 loopback server.                          |
| BrowserSandbox        | Explicit `chromiumSandbox: true`; non-root pinned browser, command line without bypass, reviewed sandbox/process evidence, nonblank synthetic screenshot.        |
| CancellationCleanup   | Interrupt active synthetic work; reconcile immutable owned IDs; remove container/volumes, read back absence, stop dedicated VM and verify stopped state.         |

**Storage approach to evaluate:** readonly root plus size-bounded tmpfs writable
areas and no volumes is simpler than relying on a VM disk size or unsupported
overlay quota. Include shared memory and all implicit writable mounts in the
aggregate, not just workspace/tmp. Docker documents that [tmpfs consumes container
memory and can spill to swap](https://docs.docker.com/engine/storage/tmpfs/).
Set and verify swap limits; prove a deliberately small bounded write reaches
ENOSPC without threatening VM memory. Resolve actual capacities and mount flags
in Task 2. If this cannot support the later repository footprint, report that
limitation; do not quietly substitute unbounded disk storage.

Network `none` leaves [container loopback](https://docs.docker.com/engine/network/drivers/none/),
so browser/server can run together without published ports. Playwright's
`--ipc=host`/`SYS_ADMIN` troubleshooting shortcuts are not permitted here.

**Contract work:** Chromium build versions may have four components; C1 currently
uses a three-component `Version` for `browserVersion`. Add a browser-specific
strict four-component schema with regression fixtures rather than truncating
identity. Keep controller tool versions separate. Retain `summarizeDiagnostics`
and strict `DiagnosticReport` decoding as the final reporting boundary.

## Task 4 Blueprint: Native Acceptance And Closure

- [ ] Finish implementation review and root check, all workspace typechecks and
      all workspace tests under the existing credential-free runner. Add negative
      controls for the five Review Focus cases. Native test commands remain opt-in.
- [ ] Obtain explicit approval for resolved preparation/download/build bounds,
      then provision only the dedicated setup and resolve authentic identities.
      Preparation has its own finite deadline and cleanup; no hidden image retrieval
      or setup inside the diagnostic window. Never alter default/global contexts.
- [ ] Generate the exact manifest digest and seven-check command catalog after
      setup. Ask for a specific absolute start/deadline, <= 20 minutes. Approval
      must bind that digest; no fabricated timestamps or automatic extensions.
- [ ] Execute one bounded diagnostic session. Preserve partial results on failure;
      missing/truncated/contradictory evidence cannot pass. Late reconciliation is
      CleanupOnly and never changes the diagnostic result to Pass.
- [ ] Retain artifact digests/bytes and sanitized readbacks, review the screenshot,
      verify cleanup and decode the final report. Publish only local evidence.
- [ ] Commit the measured assessment and roadmap update. A Pass qualifies this
      diagnostic configuration only; repository execution, prepared dependencies,
      model use, repair acceptance and PR publication remain later slices.

## Handoff And Stop Condition

The next implementable change is Task 1. The next product-enabling decision is
Task 2's zero-sharing compatibility result. Do not claim this is an executable
activation plan until its concrete lock and downstream briefs exist.

Self-review: the seven spec checks and ceilings are mapped above; live mechanisms
are deliberately unresolved where evidence is absent. The strict zero-sharing
requirement is not weakened to force a green result. This staged plan prevents
building a large executor against an incompatible local VM boundary.
