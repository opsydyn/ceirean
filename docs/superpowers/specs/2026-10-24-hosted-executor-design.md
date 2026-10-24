# Hosted Executor Feasibility Proof

Status: Owner-approved 2026-10-24, including the proposed isolation difference.
Executor-only approach selected 2026-10-24. Implementation and activation remain
separate gates.

## Intent

Determine whether managed Cloudflare Sandbox can execute Ceirean's real FoldKit
repository checks and browser journeys with bounded networking, cancellation and
cleanup. Avoid further investment in disposable local VM infrastructure.

The local Effect/DO proof is complete at `334ca0a`. It does not establish hosted
executor compatibility. This document authorizes nothing to be deployed: design,
implementation and a timed hosted session are separate approval gates.

## Approaches

1. Executor-only probe, selected by the owner: qualify Linux, the repository
   toolchain, browser evidence and safety controls without controller migration.
   This isolates hosting failures but does not prove end-to-end repair.
2. Full hosted controller rehearsal: deploy coordination, persistence and an
   executor together. Deferred because it combines several unqualified boundaries.

## Scope And Non-Goals

Add a private `probes/cloudflare-executor` workspace and a separate infrastructure
stack/stage. Reuse existing policy concepts, not the operational ingress stack.
Keep the Draft replay profile and its Colima host identity unchanged.

No Flue or XState migration, model calls, dependency upgrade, candidate repair,
hosted ledger deployment, GitHub writes, PR creation, publication or auto-merge.
No listener/tunnel activation, webhook changes, custom DNS or public app previews.
No hostile multi-tenant security claim or native ledger ownership equivalence.

## Ownership And Architecture

The trusted operator invokes a private control Worker through a supported,
authenticated control path. Disable public routes, workers.dev and preview URLs;
if a private invocation path cannot be demonstrated, stop rather than opening
an unauthenticated endpoint. Never expose an arbitrary command HTTP API.

The Worker accepts only schema-validated predefined probe operations, assigns a
unique sandbox identity per job and enforces one active operation. Consumer source
and test output cannot select commands, destinations, credentials or other jobs.
Authentication and authorization precede allocation and evidence access.

Use Effect for configuration validation, error handling, scoped resources and
bounded control operations. The SDK owns the remote Linux mechanism; it does not
become a second business orchestrator. No new application run ledger is introduced.
Provider-required DO resources are infrastructure, not a hosted Ceirean ledger.

Keep cloud credentials in trusted deployment/control processes, never in the
image, source bundle, command arguments, sandbox environment or collected output.
No model or GitHub credentials are needed for this baseline-only proof.

## Compatibility Gate

Keep Alchemy at `2.0.0-beta.83`; its upgrade remains paused. Before implementation,
inspect its installed container support and the current Sandbox package/types.
The owner-approved sequencing amendment, 2026-10-24, permits trusted image recipe
and offline harness preparation after this static inspection. Pin the SDK and
helper/base image inputs while preparing; resolve and record the final custom
executor image digest after a separately approved build and before any hosted
activation. A helper/base digest is never the final executor digest. Do not mix
SDK generations or use floating image tags in execution.
Prefer the current documented SDK generation for new work, subject to compatibility
with the pinned Alchemy provider. If unsupported, report the exact blocker before
upgrading Alchemy or substituting another deployment tool.

Private invocation remains an independent activation blocker: document and verify
the operator transport, authentication/authorization, required resources and pinned
API support before deploying or invoking the hosted probe. Offline preparation
does not satisfy that blocker or authorize an unauthenticated endpoint. A failed
compatibility premise still stops affected implementation; the amendment moves
preparation earlier, not security checks later than activation.

Cloudflare documents a microVM boundary, but processes inside a sandbox have
root-equivalent capabilities. A Linux UID does not preserve the existing Colima
non-root/drop-capabilities/read-only-root contract. This proof requires explicit
approval of that different internal isolation model; it does not silently amend
the existing replay profile. Treat the whole sandbox as one disposable trust unit.

Chromium must launch with its own sandbox enabled. Record launch arguments and
runtime evidence; fail if the image requires `--no-sandbox`. This can block the
Cloudflare direction even if builds and unit tests succeed.

## Inputs And Preparation

Use only `opsydyn/fold-kit-experiments` at the existing historical replay base
`b7484cb46e66b162c8afddcfba235c9507b4f0ab`, without candidate changes. First verify
that revision is available and inventory its actual manifests, lockfile, tests,
consumer fixtures and commands; do not use the current checkout's tool versions.

Pin the historical repository's exact Bun, Node, Git, Playwright, Chromium, fonts,
architecture and harness identities. Ceirean's current Bun 1.4.2 is not a reason
to replace the historical runtime. Unresolved exact versions block execution.
Where the historical source did not pin a Node patch, Git or browser toolchain,
choose compatible exact qualification pins and label them as new choices, not
reconstructed historical facts. Keep the consumer source and its Bun pin unchanged.

Transfer only an inventoried source artifact with validated paths, file types,
symlinks and digest. Exclude local untracked inputs by construction; reject
credential-bearing tracked inputs rather than silently altering the baseline.
Never upload the operator checkout, `.env`, PEMs, Git credentials or local caches.

Prepare dependencies and browser binaries in a separate trusted image/artifact
operation. Registry access is restricted by destination, method and artifact path,
with redirects independently checked. No arbitrary repository build scripts run
inside the trusted control environment. Record artifact provenance and hashes.

Execution starts in fresh disposable storage with external network disabled.
Offline installation and any fixture installs must consume the prepared artifact
set. Missing packages are preparation blockers, not permission to enable Internet
access or omit tests. Do not change a running job's network policy.

## Hosted Checks

Run the unchanged baseline acceptance contract from the recorded revision:

- Frozen installation; root lint/format, typecheck, workspace tests and build.
- Web Storybook build and the existing packed consumer/template checks.
- Carousel button navigation and drag/settle, including the mobile pointer case.
- Promo line point editing and generated-settings consistency.

Use desktop 1440x900 and mobile 390x844, deterministic fixtures, fixed animation
controls and inventoried fonts/browser. Capture interaction assertions, screenshots,
traces and console/page errors. Browser traffic is limited to the job-owned local
test servers. Do not publish previews or automatically accept visual differences.

Record actual test discovery/counts and exit codes. No zero-test success, changed
thresholds, skipped required checks or unexpected source mutation qualifies.
This is baseline feasibility, not migration before/after evidence.

## Safety And Failure Tests

- Demonstrate external HTTPS and direct-IP/raw-TCP denial during execution, plus
  the actual DNS behavior. Assess DNS exfiltration separately; do not call this
  complete network isolation if arbitrary DNS remains available. Unexpected
  egress is a blocker, not an advisory warning.
- Attempt cross-job access with two sequential disposable identities; show that
  the second job cannot read the first workspace or evidence. Do not reuse names
  or snapshots. Isolation from provider infrastructure is documented, not inferred
  from this finite test.
- Cancel a process with descendants and a browser/server; prove remote termination
  and failed subsequent access. Cancelling a local SDK wait is not termination.
- Exercise a remote deadline, control-client disconnect and an unknown command
  outcome. Never blindly retry an ambiguous start/execute operation. Stop issuing
  new work; inspect the same operation, then destroy its sandbox if necessary.
- Enforce output/artifact limits while collecting, not only after buffering.
  Oversize, traversal, unsafe archive entries and missing evidence fail closed.
- Verify sandbox destruction, loss of filesystem/process access and cleanup of
  session-owned resources. If provider readback cannot prove cleanup, report
  `CleanupUnconfirmed`, block further sessions and give an operator recovery path.

Property tests suit command validation, identity separation, output budgets and
deadline/cancellation decision laws. Deterministic hosted tests establish actual
network, process and provider behavior; mocks are not hosted acceptance evidence.

## Proposed Session Bounds

These are proposed limits, not a claim about available provider enforcement:

- One active sandbox; sequential normal and failure cases only.
- A 60-minute operator window: at most 45 minutes execution, then 15 for cleanup.
- Start no new case when its deadline plus cleanup exceeds the session window.
- At most 2 vCPU, 8 GiB memory and 20 GiB writable storage; select and read back
  an eligible provider tier before deployment. Unsupported required caps block
  qualification; a timeout or usage alert is not a hard memory/disk limit.
- At most 10 MiB output per command and 512 MiB total exported evidence.
- Proposed USD 5 session spending allowance. Obtain current price/eligibility and
  a conservative cost bound, including image build/upload, storage and residual
  resources. This is not a provider billing cap. If the bound cannot be supported,
  obtain a revised allowance before activation.

Record the operator, account/stage, image/toolchain/source identities, exact
commands, start/end timestamps, region/instance observations, cleanup inventory
and stop conditions in a session worksheet. The owner approves that filled
worksheet before paid provisioning or a hosted command begins.

## Evidence And Decision

Export a bounded local evidence bundle with a schema-validated manifest, hashes,
redacted logs, command results, screenshots/traces, negative-control outcomes,
observed limits and teardown readback. Treat all sandbox output as untrusted data.
Use opaque artifact names and validate type/size/path before storage or display.
No remote evidence bucket is required by this design.

Possible outcomes are `Feasible`, `Blocked` or `Inconclusive`, each supported by
specific evidence. Missing security, browser or cleanup proof cannot be `Feasible`.
A passing probe authorizes only a recommendation for the next design: connecting
the existing coordinator to this qualified executor. It does not authorize
production ingress, persistence migration, repair, or publication.

## Approval And Delivery Gates

- [x] Owner selected executor-only scope.
- [x] Owner approves this design, including the proposed isolation difference.
- [ ] Write and approve the implementation plan; use a separate worktree.
- [ ] Resolve pinned SDK/Alchemy/image compatibility without deploying.
- [ ] Implement and verify the private harness with universal lint rules.
- [ ] Approve exact account permissions, cost/time bounds and session worksheet.
- [ ] Run hosted qualification; collect evidence and verify teardown.
- [ ] Review the measured result before expanding product scope.

Author builder-check only; no independent reviewer was available for this draft.
Unresolved provider compatibility, exact identities, private invocation, enforceable
limits and account eligibility are explicit preflight blockers, not assumed facts.

## References

- [Existing replay contract](2026-10-21-foldkit-replay-profile-design.md)
- [Local Effect/DO evidence](../../assessments/local-effect-do.md)
- [Cloudflare Sandbox overview](https://developers.cloudflare.com/sandbox/)
- [Cloudflare Sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)
- [Outbound traffic, SDK 0.x reference only](https://developers.cloudflare.com/sandbox/sdk/guides/outbound-traffic/)

Cloudflare references reviewed 2026-10-24. API details must be checked against the
exact chosen SDK generation; the 0.x networking reference is not a 1.x contract.
