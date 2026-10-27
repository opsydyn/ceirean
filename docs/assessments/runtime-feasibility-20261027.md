# Runtime Feasibility Decision

2026-10-27. Assessed Ceirean `ca369af` and installed Alchemy `2.0.0-beta.83`.
Scope: the approved one-day, baseline/browser-first feasibility slice.

## Decision

**Conditional GO for the existing Cloudflare direction. NO-GO for a historical
Linux qualification or hosted activation today.** The pinned provider exposes the
required lifecycle primitives; no upgrade or platform replacement is justified.
Two concrete Linux-readiness changes need review before implementation: an admitted
execution observer and a mount policy that models kernel mounts as well as data.

The recommended next deliverable is one credential-free, Ceirean-owned Linux
control canary, not another simulation layer or an attempt against FoldKit known
to be blocked. Its preparation, publication and execution are separate gates.

## Evidence And Boundaries

Observed: current source/contracts, installed provider/type declarations, public
upstream documentation and Git tag metadata. No Docker, tool installation,
archive/image acquisition, source checkout, consumer execution, browser, cloud
account query, deployment, signing key, dotenv or operational ledger was used.
No runtime-enforcement or actual capacity-fit claim follows from this assessment.

The [approved hosted design](../superpowers/specs/2026-10-24-hosted-executor-design.md)
already accepts the whole sandbox as a disposable trust unit, including its
root-equivalent internal processes. That is not a new blocker and does not alter
the stricter [Linux qualification design](../superpowers/specs/2026-10-24-linux-cache-consumer-design.md).
The two designs' resource envelopes must not be conflated.

## Linux Mount Policy: Concrete Admission Defect

`controls.ts` requires `writable.length === 3` and every writable mount to be one
of `/work`, `/home`, `/tmp`. It therefore refuses writable kernel filesystems too,
not merely additional bulk storage. The OCI reference layout includes `/proc`,
`/dev`, `/dev/pts`, `/dev/shm` and `/dev/mqueue`; it is reference evidence, not an
observation of our actual runner. See the [OCI configuration example](https://github.com/opencontainers/runtime-spec/blob/main/config.md#configuration-schema-example).

The three current data allocations also fill the whole 3072 MiB ceiling. A
specific proposed reallocation is:

| Mount      | MiB      | Status                                                   |
| ---------- | -------- | -------------------------------------------------------- |
| `/work`    | 2688     | Reduce by 128; source/cases/cache/evidence stay here     |
| `/home`    | 128      | Unchanged                                                |
| `/tmp`     | 128      | Unchanged                                                |
| `/dev`     | 64       | Count auxiliary tmpfs, do not recreate/mask device nodes |
| `/dev/shm` | 64       | Explicit shared-memory allowance                         |
| **Total**  | **3072** | Unchanged total ceiling                                  |

This is a proposed policy amendment, not permission to modify existing limits.
Actual mount capacities, modes, devices, masking/read-only submounts and namespace
ownership must be measured. A different layout refuses; it does not auto-grow the
allowlist. All writable tmpfs capacity still counts. Kernel pseudo-filesystems
need their own exact reviewed type/path/security policy, not blanket exemption.
The root remains read-only, capabilities dropped, nonroot UID/GID and NNP retained,
with 2 CPU / 4 GiB memory-and-swap / 128 PIDs unchanged.

The smaller work area may expose a real cache-fit failure. Do not raise the budget,
skip consumers or claim fit from compressed archive size. Docker documents that
tmpfs usage also consumes the memory cgroup: [tmpfs semantics](https://docs.docker.com/engine/storage/tmpfs/).

## Observer: Select A Candidate, Not An Attestation Shortcut

Selected candidate for bounded canary evaluation: **strace 6.19**, upstream tag
object `129b5e1cc8edb89b80e75edda8e2dacb527ed89c`, peeled commit
`1d78a4ce1bfa3754b3b99b1e4bb15790001b77cb`. Identities came from public
`git ls-remote --tags`; [upstream release metadata](https://github.com/strace/strace/releases/tag/v6.19)
agrees. No binary/source archive was acquired or executed. Source identity does
not supply a binary hash, trusted build provenance or acquisition approval.

The versioned [manual](https://raw.githubusercontent.com/strace/strace/v6.19/doc/strace.1.in)
supports following forks, process-lifecycle tracing and killing tracees when the
tracer exits. It also documents `CLONE_UNTRACED`, which can escape tracing.
Therefore an unqualified `strace -f` log cannot certify complete observation.
Avoid attach/daemonization/detach options and silent optimization fallback.
Ambiguous, missing, truncated or escaping events must refuse qualification.
Whole-compartment removal remains mandatory even after tracer termination.

Required admission work: trusted executable/build identity, complete bounded
process-event accounting including execveat/clone variants, owned output that the
tracee cannot forge, and real canaries for tracing gaps and cleanup. If those
properties cannot be established under existing privileges, this candidate fails.
Do not add SYS_PTRACE, privileged mode, unconfined seccomp or a host daemon to force
it through. Docker's [seccomp documentation](https://docs.docker.com/engine/security/seccomp/)
does not prove behavior of our actual runner/kernel/profile.

Current integration is not plug-and-play: `commandSpec` spawns Bun directly,
the tool capsule admits exactly Node plus worker, and paused `docker top` accepts
only node/bun. A reviewed observer needs corresponding capsule, process ownership,
warm-up PID and rehearsal changes. A tracer PID must never be called the Bun PID.
The observer must continue through the owned `WorkerProcess` boundary, not launch
an independent installer. Linux DNS error classification also needs real canary
evidence; a resolver timeout must not be relabeled concrete denial.

## Pinned Provider Mapping

Static installed-source audit: `ContainerClient.ts` exposes start, argv exec,
bounded-collection-compatible byte streams, exit, signals, inspect/monitor and
destroy. Exec scope finalization kills the direct process only and ignores that
kill's error; it does not certify descendant or filesystem removal. The future
controller must explicitly destroy and independently reconcile the owned sandbox.
Its start convenience wrapper retries selected errors; a one-attempt adapter must
not accidentally inherit those retries or retry an ambiguous allocation.

The pinned surface exposes no Docker-style rootfs, tmpfs, cap-drop, seccomp or PID
limit knobs. This establishes no Docker parity, not provider impossibility.
The native inspect shape is image/labels, not an effective security/resource report.
Installed types are `@cloudflare/workers-types` `5.20261021.1`; provider schemas
resolve to `@distilled.cloud/cloudflare` `1.0.0-rc.15`. No version changes are needed
to continue the already approved approach.

Current public [Container API documentation](https://developers.cloudflare.com/containers/api/durable-object-container/)
confirms policy-specific root capabilities, direct-process-only exec cancellation,
and DNS timeout behavior with Internet disabled and no intercepts. Preserve the
approved whole-microVM trust model, stream bounds and absolute deadline; a UID,
cancelled Effect or inactivity timeout is not a remote cleanup receipt. Chromium's
own sandbox remains required.

The separate hosted envelope is at most 2 vCPU / 8 GiB RAM / 20 GiB writable
storage, not Linux qualification's 4 GiB/3 GiB. `standard-3` currently maps to
2 vCPU / 8 GiB / 16 GB. Custom sizing requires at least 3 GiB per vCPU; do not
request 2 vCPU / 4 GiB and treat rejection as an Alchemy defect. These are documented
options, not account eligibility/enforcement proof: [current limits](https://developers.cloudflare.com/containers/platform/limits/).

## Next Bounded Work

1. Review the [proposed Linux amendment](../superpowers/specs/2026-10-27-linux-runtime-readiness-design.md).
2. After approval, prepare exact observer/capsule admission, mount contracts and a
   Ceirean-owned control-canary implementation plan. Do not implement a new hosted
   stack or broaden the historical acceptance profile in that slice.
3. Obtain separate immutable-tool preparation/build permission and freeze actual
   binary/harness identities. Then request publication and one canary-run approval
   with a finite allowance and cleanup owner. No current gate supplies those.
4. Only a successful actual canary can justify preparing the historical one-attempt
   worksheet. Keep the two P3 coverage gaps and corpus-fit test in that later gate.

No-go/stop: unsupported trace completeness, incompatible libc, unknown mounts or
network result, unavailable required controls, exceeded budgets, unknown cleanup
or a Chromium no-sandbox requirement. Record the precise failed premise; no retry,
fallback runtime, widened privilege, scheduling-policy change or budget increase
is implied by the failure.
