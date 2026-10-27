# Linux Runtime Readiness Amendment

2026-10-27. **Owner approved offline preparation; execution remains separately gated.**
Implements the next step from the [feasibility decision](../../assessments/runtime-feasibility-20261027.md),
not a replacement for the existing hosted design or historical qualification.

## Intent And Scope

Make the existing standalone Linux qualification capable of an honest readiness
decision with a real observer and realistic kernel mounts. Preserve the historical
source/toolchain and strict limits. First exercise only reviewed Ceirean-owned
canaries, not the historical repository or browser suite.

Do not implement Cloudflare actuation here, restart Colima, upgrade dependencies
or Alchemy, acquire a tracer, publish/run workflows, pull/build images, read cloud
credentials, enable webhooks or change `trustedApprovalPolicy: Option.none()`.
Those operations keep their separate approval gates.

## Approaches And Decisions

- **Recommended:** retain Docker for the already selected credential-free Linux
  qualification; add a version-pinned observer candidate and exact kernel/data
  mount policy. Validate them in an explicitly authorized, finite control canary.
- A host-wide eBPF/audit observer would add privileged infrastructure and does not
  have an approved acquisition/runtime boundary. Do not introduce one implicitly.
- Marker absence/process polling cannot supply complete child-execution evidence.
  Do not replace the observer gate with these weaker checks.

Strace 6.19 at peeled source commit
`1d78a4ce1bfa3754b3b99b1e4bb15790001b77cb` is the author-selected candidate,
not an admitted executable. Its actual binary hash/build provenance must be
independently approved and checked. Prefer a single self-contained executable in
the existing bounded tool capsule; an unavailable libc/extra-library dependency
blocks rather than adding ambient libraries or another runtime.

## Mount Contract Proposed For Approval

Reallocate within 3072 MiB: work 2688, home 128, tmp 128, dev 64, dev/shm 64.
Work/home/tmp retain their existing owner/mode and noexec/nosuid/nodev controls;
do not apply nodev to standard device nodes needed by the trusted runtimes.
Do not replace `/dev` with an empty tmpfs. Explicitly bound `/dev/shm` and measure
the actual runtime-provided `/dev` capacity; an unexpected capacity is a refusal.

Account all writable tmpfs by unique mount identity, including auxiliary mounts,
with checked aggregate arithmetic. Reject unknown capacities, aliasing, unexpected
mounts/overmounts and unapproved writable submounts. Separate an exact reviewed
kernel-mount inventory from data capacity: proc/devpts/mqueue are not generic
storage exceptions. Require type/path/namespace/security and protected submount
readbacks from the real canary before finalizing that inventory. Root ownership
alone is never admission. Rootfs stays read-only; no extra host binds/devices,
socket, capabilities or writable root are introduced.

Avoid a discovery/admission cycle: the first fixed, Ceirean-owned canary may export
bounded `ReadinessOnly` inventory with unknown/refused controls for review. That
result is not a qualification receipt or complete observer admission, and cannot
start a historical workload. Review and freeze the measured inventory before
implementing/admitting its final policy. Its publication/run approval must name
the exact inventory/observer/network probes; it grants no arbitrary diagnostics.

Retain 2 CPU, 4 GiB memory with equal memory-swap, 128 PIDs, 90-second commands,
the shared nine-minute qualification sequence, fifteen-minute job and existing
bounded cleanup/evidence policy. This amendment does not raise a ceiling or claim
the smaller work area fits the real corpus.

## Observer And Ownership Contract

Use a fixed owned wrapper for the exact permitted installer invocation. Follow
process creation/exec/termination and require kill-on-tracer-exit. No arbitrary
argv, attach/daemon/detach, silent tracing fallback or privileged switch. Admit
only complete bounded events; unknown syscall form, unsupported clone flags,
CLONE_UNTRACED, gaps, malformed/oversized output and tracer failure refuse.
This is observation of the qualification workload, not a hostile-code sandbox or
a claim that every native instruction/library load is an exec event.

Review trace-output integrity against the tracee's UID and file-descriptor access;
same-UID writes or unverifiable output ownership cannot certify completeness.
If the existing privilege policy cannot protect the observation, stop and return
that concrete incompatibility rather than asserting a pass.

The observer still calls through `WorkerProcess`. Extend the strict tool inventory
for exactly the reviewed tracer, retain source/tool byte checks and independent
receipt admission, and update the paused rehearsal process inventory deliberately.
Track tracer and actual Bun PID separately. No second installer transport, fake
warm-up marker or caller-supplied provenance is permitted. Keep raw tracing internal
and bounded; export only finite admitted facts through existing fixed evidence
files, within 256 KiB stream/16 MiB aggregate caps.

## Required Canary Evidence

- Exact Node/Bun/tracer identities, actual libc/kernel/security/mount/cgroup data.
- Known child and grandchild execs observed; a harmless disallowed executable
  classified as the intended refusal, not an unrelated startup failure.
- Trace escape/unknown-clone, execveat, malformed/truncated trace and tracer loss
  produce incomplete/refused outcomes; no false complete observation.
- Actual warm-up PID binding, interruption/deadline and whole-container removal
  readback, including an untraced-descendant canary if that mechanism is possible.
- Fixed HTTP/DNS/raw-TCP negatives and exact mount-policy acceptance. DNS absence
  or timeout alone is not concrete denial. Capture incompatible primitive behavior
  for a decision instead of changing classifications to green.
- Actual tooling and evidence fit; no copied secret/config/operational state and
  no historical source, dependency resolution, consumer install or browser run.

Prepare deterministic/property tests for chunk partitions, missing/duplicate
events, capacity boundaries, identity mutations and cancellation ordering. They
verify policy logic only; runtime support requires the authorized actual canary.

## Unchanged Hosted Direction

Keep the already approved whole-microVM/`durable_object` model and pinned Alchemy.
Do not carry Linux's numeric/mount/capability requirements over as claims of
Cloudflare parity. Hosted cancellation must own sandbox destruction/readback,
not just an exec scope; prevent implicit allocation retries. The hosted 2 vCPU /
8 GiB / 20 GiB envelope and Chromium sandbox requirement are unchanged.

## Approval And Exit

This document asks approval of the proposed mount reallocation, exact kernel/data
policy work and observer-canary preparation direction. It does not approve tool
acquisition/build, publication, one-attempt execution or hosting. After design
approval, write a focused implementation plan for those offline changes.

Exit from preparation: reviewed code and exact prepared inputs, with run gates
still closed. Exit from the separately approved canary: actual complete bounded
evidence with confirmed cleanup. Failure or uncertainty blocks the historical run
and consumes no implicit retry authority.
