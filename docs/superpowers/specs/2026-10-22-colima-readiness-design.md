# Bounded Colima Readiness Design

## Intent And Approval State

Plan C investigates whether the dedicated local Colima/Docker boundary can
support Ceirean's historical FoldKit replay safely. It follows the
[replay architecture](2026-10-21-foldkit-replay-profile-design.md) and the completed
[local migration ledger qualification](../../assessments/native-migration-ledger.md).
It is not a migration run, production adapter or deployment.

The owner approved the conversational design on 2026-10-22: two stages, an
explicit activation gate, diagnostic limits, seven individual checks, and the
report/test strategy. This written spec still requires owner review. Approval
of this design does not authorize implementation or activation. After written
spec approval, prepare a separate implementation plan for review and execution
method selection.

Success means producing trustworthy, bounded evidence about specific native
controls, or precise blockers. A partial result is useful but is not readiness.
No real Colima/Docker behavior is claimed by this document.

## Approach And Boundaries

Use staged preflight and diagnostics. Inventory alone cannot prove enforcement;
building a full worker adapter first would mix feasibility and production work.

Keep the existing RunCoordinator, XState Effect lifecycle and ledger authority.
This probe neither creates another orchestrator nor manufactures lifecycle
readiness receipts. Diagnostic ownership and evidence are separate from the
operational ledger. No operational storage is initialized.

Neither stage accesses consumer repository content, model providers, secrets,
the operational ledger, ingress or GitHub publication. Listener, tunnel and
webhooks remain disabled. No credentials are inherited by diagnostic commands.
Use synthetic fixtures and an isolated temporary HOME. Never read real `.env`,
private keys, Docker credential stores or the operational Ceirean data directory.

## Stage 1: Read-Only Preflight

Collect host architecture, available resources, and installed Colima/Docker
versions using an explicit, reviewed command allowlist. Inspect only sanitized
configuration needed to identify the dedicated `ceirean` profile, its explicit
Docker endpoint, host mounts, SSH-agent forwarding and global-context dependencies.
Do not dump arbitrary configuration or inherited environment variables.

Do not start a VM, contact a Docker daemon, install/download anything, change
configuration, initialize a ledger or activate any worker. Missing prerequisites
are reportable blockers, not permission to provision them. Missing or unreadable
configuration is not evidence that sharing or forwarding is disabled.

Produce a preflight report and a proposed Stage 2 activation manifest containing
exact commands, image digest/architecture, security configuration, resource
limits, VM allocation, test destinations and cleanup procedure. Determine VM
allocation from measured host headroom; VM disk capacity does not establish a
container storage quota. Consult current primary documentation when selecting
mechanisms; configuration intent alone is not enforcement evidence.

## Activation Gate And Limits

Stage 2 requires separate explicit owner approval of the manifest and a finite
start/deadline window. Planning or implementing the probe cannot activate it.
An unavailable image needs separately approved retrieval, source, digest and
download bounds; activation itself does not authorize downloads or image builds.
If the pinned image/toolchain/browser cannot be resolved, activation is blocked.

- One dedicated `ceirean` VM, one disposable diagnostic container at a time.
- Twenty minutes total, including cleanup; no automatic extension.
- Per-container ceilings: 2 CPUs, 8 GiB RAM, 256 PIDs, 20 GiB writable storage.
- At most 10 MiB combined output per command and 128 MiB retained evidence total.
- No host binds, home sharing, SSH-agent forwarding or container Docker socket.
- No privileged container, host network/PID mode or browser `--no-sandbox` bypass.

The activation manifest assigns bounded command deadlines and a cleanup reserve
within the twenty-minute window. Refuse work that would consume that reserve;
do not silently extend the deadline to finish remaining checks. Resource
challenges must remain safe for the VM/host and stop at their approved bounds.
If a hard ceiling cannot be enforced, report Blocked rather than substitute
monitoring. The VM must have measured headroom independent of container limits.

The window is an execution limit, not permission to abandon cleanup: after its
deadline no diagnostics continue. Any necessary cleanup-only reconciliation is
reported explicitly, does not extend qualification and cannot authorize another
run. Report unresolved identities and require controlled operator reconciliation.

## Individual Diagnostic Checks

Each check yields Pass, Fail or Blocked with sanitized supporting evidence.
Missing tooling, truncated required evidence and ambiguous results cannot pass.

1. **Endpoint and ownership.** Explicitly address the `ceirean` daemon and verify
   its identity before mutations. Never fall back to the global/default context.
   Bind every disposable resource to the invocation and immutable resource ID;
   do not modify foreign resources or an unexpectedly pre-existing VM session.
2. **Host isolation.** Verify no host directories, SSH agent, controller
   credentials or Docker socket reach the container. Use synthetic markers and
   inspect actual mount/environment/readback evidence, never real secret probes.
3. **Container restrictions.** Read back non-root execution, read-only root,
   dropped capabilities, no-new-privileges and the approved seccomp policy.
   Attempt prohibited writes and require rejection. Intended flags alone do not
   prove that restrictions apply.
4. **Resource enforcement.** Inspect configured limits and run bounded CPU,
   memory, PID and writable-storage challenges with explicit expected outcomes.
   Verify effective constraints, including writable volumes/temp storage within
   the approved aggregate allowance. Unsupported quota enforcement blocks readiness.
5. **Network denial.** Require failure for external DNS and direct-IP attempts
   against manifest-approved test destinations. Pair negative probes with
   authoritative network-configuration readback; one failed connection alone
   does not prove isolation. Separately verify browser access to its own loopback
   test server. Registry-only dependency preparation remains a later gate.
6. **Browser sandbox.** Run pinned Chromium against a synthetic local page,
   capture a screenshot, and verify sandbox operation with reviewed evidence.
   Never infer sandboxing merely from successful launch or use `--no-sandbox`.
7. **Cancellation and cleanup.** Interrupt an active synthetic diagnostic;
   stop/remove only owned containers and volumes, confirm their absence by
   readback, then stop the dedicated VM. Preserve bounded evidence outside the
   disposable resources. A process exit is not cleanup proof.

Exact mechanisms, expected results and probe argv belong in the implementation
plan/activation manifest. Failure to find a safe, measurable mechanism is a
blocker, not permission to weaken this contract. A repeat invocation must refuse
unresolved prior resources rather than blindly retry creation or execution.

## Reports And Evidence

Use strict Effect Schema data with finite reason codes. Capture:

- Invocation identity; exact host/daemon, image, architecture, tool and browser
  identities; approved manifest/configuration identity.
- Start and absolute deadline, individual check outcomes, sanitized observations,
  bounded artifact identities/digests and explicit omissions.
- Observed limits, command timeouts/output truncation and cleanup readback,
  including any unresolved owned resource identities.
- Remaining replay blockers and a clear statement of the evidence boundary.

Stage 1 cannot produce an overall native-readiness pass. Stage 2 passes only
when every required check passes and cleanup is confirmed. Failed, blocked,
missing, contradictory or incomplete evidence prevents an overall pass.
Retain completed observations on early exit without representing skipped checks
as success. Enforce the total evidence cap and mark truncation explicitly;
evidence loss must not masquerade as complete proof.

Reports are local diagnostic evidence, not production WorkerReadyReceipt values.
No report automatically changes replay-profile blockers or authorizes execution.
Evidence is bound to the exact approved invocation/configuration; changed
identities, altered configuration or stale observations require revalidation.
The later operational acceptance gate determines freshness, not an invented TTL.

## Test Strategy

Develop offline against deterministic command-runner fixtures first. Preserve
universal lint policy and inferred Effect channels; no rule exceptions.

- Strict report decoding rejects excess fields, missing evidence and contradictory
  aggregate/check outcomes.
- Property tests establish that any required failed, blocked, absent or incomplete
  check prevents an overall pass; changing identity invalidates evidence binding.
- Fixture tests cover wrong daemon, absent prerequisites, command timeout,
  excessive output, cancellation, exhausted time/cleanup reserve and report caps.
- Ownership tests refuse foreign-resource deletion and blind mutation retries;
  ambiguous cleanup blocks completion and subsequent activation.
- Tests establish that preflight cannot call daemon mutation/start/download paths,
  and activation is denied without an exact approved manifest/window.

Real Colima checks are opt-in and remain behind the activation gate. Synthetic
tests qualify report/control logic only, never native enforcement. Later measured
assessment records exact versions, commands, limitations and raw bounded evidence.

## Non-Goals And Handoff

No consumer migration, paid model work, registry preparation, production Docker
adapter, operational ledger initialization, publication or ingress activation.
No claim of hostile-tenant isolation, VM/kernel escape protection, power-loss
durability or qualification of the full replay acceptance contract.

After owner review of this spec, write the implementation plan. After plan and
execution-method approval, implement/verify the offline probe and commit verified
tasks. Only a further explicit activation approval may start native diagnostics.
