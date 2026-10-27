# Runtime Feasibility Decision

2026-10-27. Assessed Ceirean `ca369af` and installed Alchemy `2.0.0-beta.83`.
Scope: the approved one-day, baseline/browser-first feasibility slice.

## Decision

**Conditional GO for the existing Cloudflare direction. NO-GO for a historical
Linux qualification or hosted activation today.** The pinned provider exposes the
required lifecycle primitives; no upgrade or platform replacement is justified.
An admitted execution observer and a mount policy that models kernel mounts as
well as data remain unfinished. The Linux readiness amendment now approves their
offline preparation, not acquisition or execution.

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

The amendment approves offline preparation of this reallocation, not a change to
the existing runtime limits or permission to execute it.
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

### Integrity And Ownership Review

The current `WorkerProcess` launches the fixed command with piped stdout and
stderr, collects each under a 256 KiB limit and returns those streams with the
exit code. That transport does not demonstrate an authenticated tracer-only
channel: a tracee can also produce ordinary output. A same-UID 0600 trace file
likewise does not isolate the file from that tracee. Neither is evidence of
complete, unforgeable observation.

The installed Effect `ChildProcess` API offers `additionalFds`; the current worker
does not use it. It is a candidate to investigate, not an established solution:
descriptor inheritance/closure, same-UID access through proc, tracer-only writes
and behavior on the intended Linux runner remain unproven. Select and review a
protected channel within the approved boundary, then test it; do not declare an
incompatibility merely because this mechanism has not yet been evaluated.

The rehearsal marker currently records the spawned child handle's PID, which is
Bun for the direct invocation. Wrapping that invocation in a tracer would make
the handle's PID the tracer's, not establish the actual Bun PID. Binding both
identities and the warm-up to the owned process tree, handling tracer loss and
descendants, and proving cleanup remain work for the owned supervisor and actual
canary. The supervisor's stop/force-remove and absence readback are implemented
controls, not proof that the proposed tracer lifecycle works on Linux.
`makeChildObservation` still refuses admission and the default provenance
preflight remains unavailable; neither a candidate channel nor a synthetic
result changes that state.

### Inventory Preparation

`inspectMountInventory` is a pure, bounded parser of supplied mount inventory. It
returns sanitized categories, capacity findings and `ReadinessOnly` with an
unreviewed kernel policy; it neither collects host data nor authorizes a workload
or produces a qualification receipt.

Offline preparation now includes a separate fixed readiness worker entrypoint,
accepting only `--worker`, and a collector for fixed mount, namespace, security
and cgroup inputs. Text reads and the emitted frame are bounded; namespace link
targets and mount identifiers are redacted, while numeric UID/GID tuples are
emitted when available. Raw errors are not exported. The
namespace length check limits subsequent classification, but `readLink` allocates
its result before that check, so allocation by the platform operation is not
bounded. Kernel mount details are known-only and incomplete; neither their absence
nor a synthetic summary is a final mount policy. A terminal newline rejects some
truncated reads but cannot prove a snapshot was not cut at a record boundary.
Observer, network negatives and
cleanup are explicitly `NotMeasured`. The worker produces no qualification receipt,
leaves kernel policy unreviewed and activation blocked.

The separate host handoff implements strict, canonical bounded framing and a
session-bound lifecycle simulation with injected fake ports. It supplies no
production Docker process, channel provider or authority, and always reports
`complete: false` and authority unavailable. Its fake ownership and cleanup
observations are not host evidence. No production worker or canary has run, and
this wiring is not an end-to-end runnable canary.

The fake lifecycle retains a 20-second cooperative removal phase, a separate
10-second readback bound and a 30-second cooperative outer cleanup budget.
Readback can start while removal is still settling; an early absent readback
cannot certify cleanup, even if removal later succeeds. Scoped finalizers are
awaited: an uninterruptible provider operation or finalizer can outlive 30 seconds,
and synchronous work can also prevent readback from being scheduled. Actual
production termination, independent resource-absence readback and a hard deadline
remain blocked. The simulation does not approve detached cleanup.

The fixed-worker supervisor now also schedules its actual cleanup through a single
20-second cooperative removal window covering inventory, ownership inspection,
a best-effort stop capped at three seconds, and force removal. Independent
inventory readback starts after removal settles or at the window's deadline, with
up to ten seconds inside a 30-second cooperative outer budget. A readback before
successful removal cannot establish confirmed removal; lost create acknowledgement
also remains uncertain. The supervisor retains scoped ownership and refuses to
start a later mutation once the removal deadline has elapsed. Fake-process and
test-clock checks demonstrate scheduling only: interruption cannot force an
uninterruptible process or finalizer to settle, synchronous blocking can prevent
the scheduler from running, and a request already issued to Docker can have
effects after cancellation. Real daemon termination, independent host readback,
descendant handling and hard-deadline enforcement remain unproved and blocked.

Unknown or refused controls may be reported for readiness only; they cannot admit
the historical workload. Review and freeze actual inventory before final kernel
policy admission.

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

## Canary Approval Preparation

This checklist defines the smallest requested scope to prepare for review; it is
not permission to acquire, build, publish or run anything. The exact builder,
build recipe and inputs, controlled Ceirean-owned harness and its identity,
runner and image identities, and actual tracer binary hash and provenance are
not yet selected or established. An approval request must name and freeze them;
do not invent their values or treat a source tag as a binary identity.

- [ ] Request a separate, bounded acquisition/build for only strace 6.19 at
      upstream tag object `129b5e1cc8edb89b80e75edda8e2dacb527ed89c` and peeled
      commit `1d78a4ce1bfa3754b3b99b1e4bb15790001b77cb`, plus the fixed
      Ceirean-owned canary harness and its necessary pinned build inputs. Specify
      the proposed builder, recipe, input identities, output custody and finite
      resource/time allowance before approval. No historical repository, consumer
      dependencies, secret, credentials or operational state enters the build.
- [ ] Independently review and approve the actual tracer binary hash and build
      provenance, not just the acquired source identity. Freeze the exact harness,
      its hash and inputs, tracer binary, and proposed runner/image identities
      before seeking a run; check the actual bytes against those approved
      identities at admission. Any needed image acquisition/build or publication
      requires its own explicit approval; none is implied here.
- [ ] Prepare one fixed, non-arbitrary harness invocation through the owned
      process/supervisor boundary. It must bind tracer PID and actual Bun PID
      separately to the warm-up and owned process tree, account for tracer and
      descendant lifecycle, and retain raw traces internally under the existing
      evidence bounds. No second installer transport or caller-supplied provenance.
- [ ] Fix the observation cases before approval: known child and grandchild execs;
      a harmless disallowed executable; `execveat` and relevant clone forms;
      unknown or escaping events; malformed, missing and truncated output; and
      tracer loss. Exercise a `CLONE_UNTRACED` descendant only if the mechanism is
      possible under the intended controls; record inability or uncertainty rather
      than claiming an observed escape or complete coverage. Each incomplete or
      unsupported observation must refuse, not silently pass.
- [ ] Fix channel-integrity cases for the actual nonroot UID/GID: read back tracer
      and tracee identities and descriptor ownership; check descriptor inheritance
      and closure across exec and descendants; attempt tracee writes or reopening
      through inherited descriptors and `/proc` FD paths; and attempt spoofed trace
      records through stdout, stderr and any candidate file/channel. Record access
      and refusal results without exposing raw trace data. A same-UID 0600 file is
      not isolation, and `additionalFds` is an unproven candidate, not a guarantee.
- [ ] Fix bounded readbacks of actual mount types, paths, capacities, flags,
      namespace ownership and protected submounts; UID/GID, capabilities, NNP,
      seccomp and rootfs; cgroup CPU, memory/swap and PID limits; and fixed HTTP,
      DNS and raw-TCP negatives. Export sanitized `ReadinessOnly` inventory and
      findings, including unknown/refused controls; DNS timeout alone is not proof
      of denial. Read back deadline/interruption behavior and whole-container
      removal/absence under the named cleanup owner, including descendant handling.
- [ ] Request a separate approval for exactly one Linux canary allocation and run,
      with frozen identities, fixed cases, runner, evidence recipient, cleanup
      owner and finite window. Retain at most 2 CPUs, 4 GiB memory with equal
      memory-swap, 128 PIDs and 3072 MiB total writable tmpfs; retain 90 seconds
      per command, the shared nine-minute sequence, fifteen-minute job and existing
      cleanup/evidence policy, including 256 KiB per stream and 16 MiB aggregate.
      The proposed 2688/128/128/64/64 MiB allocation remains subject to actual
      readback and policy review. No historical repository, install, browser,
      secrets, arbitrary diagnostics, widened privilege, fallback or retry is
      authorized. A failed, incomplete or unknown result stops for review.

## Next Bounded Work

1. Under the [approved offline amendment](../superpowers/specs/2026-10-27-linux-runtime-readiness-design.md),
   review the fixed worker and fake-only handoff, and finish the observer channel
   and production PID/lifecycle design. Establish independent termination and
   resource-absence readback and a hard deadline before any real run. Keep observer
   and provenance admission unavailable until independently supported; do not
   broaden the historical acceptance profile.
2. Complete the acquisition/build and one-run approval requests in the checklist
   above, including independent identity review and the unresolved builder,
   harness, image and runner details. Obtain each separate approval before acting.
3. Only after those approvals, run the frozen fixed control canary once and export
   its bounded sanitized evidence for review. No current gate supplies that authority.
4. Review actual results and freeze the mount policy and observer admission only
   where supported. A successful canary is necessary, not sufficient, for the
   historical one-attempt worksheet; the two P3 gaps, corpus fit, provenance and
   separate historical run approval remain. No retry is implicit.

No-go/stop: unsupported trace completeness, incompatible libc, unknown mounts or
network result, unavailable required controls, exceeded budgets, unknown cleanup
or a Chromium no-sandbox requirement. Record the precise failed premise; no retry,
fallback runtime, widened privilege, scheduling-policy change or budget increase
is implied by the failure.
