# Linux Cache One-Attempt Worksheet

Status: BLOCKED. This is not approval, a capability token or a dispatch input.
Do not publish or run the draft to rediscover known missing capabilities.

| Required Binding                                                         | Reviewed Value / Evidence                                                                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner approval and exact one-attempt run ID / attempt 1                  | Missing                                                                                                                                                                       |
| Approved implementation commit SHA / current lock Git blob               | Missing                                                                                                                                                                       |
| Public source retrieval authorization and visibility readback            | Missing                                                                                                                                                                       |
| Historical source SHA/tree / frozen inventory SHA-256                    | Fixed in tool-pins.ts; recheck                                                                                                                                                |
| Source admitted file inventory hash / input capsule hash                 | Missing                                                                                                                                                                       |
| Controller 1.4.2 SRI and measured executable SHA-256                     | Missing runtime proof                                                                                                                                                         |
| Installer / Node image manifest and config identities                    | Pinned; actual readbacks missing                                                                                                                                              |
| Node executable hash / harness hash / tool capsule inventory hash        | Missing reviewed build provenance                                                                                                                                             |
| Trusted child/native observer acquisition identity and behavior review   | UNAVAILABLE; separate acquisition review required                                                                                                                             |
| Effective mount, UID/GID, security and behavioral HTTP/DNS/TCP negatives | UNAVAILABLE; request flags are not measurement                                                                                                                                |
| Actual deadline and interrupted-warmup process/container removal proof   | UNAVAILABLE                                                                                                                                                                   |
| Runner image/version, Linux amd64 glibc, Docker version and eligibility  | Missing                                                                                                                                                                       |
| Billing, entitlement and available memory/storage allowance              | Missing                                                                                                                                                                       |
| Effective budgets                                                        | 2 CPU; 4 GiB memory/swap; 128 PIDs; 3 GiB total tmpfs                                                                                                                         |
| Per-mount limits and owner                                               | work 2816 MiB; home/tmp 128 MiB each; 0700 matching unprivileged UID/GID                                                                                                      |
| Time limits                                                              | Job 15 min shared; acquisition/supervision/admission 12 min; worker 9 min shared; commands 90 s; cleanup 30 s cooperative budget; output 1 min including 10 s cleanup reserve |
| Evidence recipient, fixed allowlist and seven-day retention              | Missing recipient review; 16 MiB total / 256 KiB streams                                                                                                                      |
| Cleanup owner and escalation for unknown/late create acknowledgement     | Missing named owner; never retry/replacement                                                                                                                                  |
| Final status / all cases / actual-file admission / independent cleanup   | NOT RUN                                                                                                                                                                       |

Canonical worker evidence storage is `/work/evidence`, within the existing
2816 MiB `/work` tmpfs. Collect its nine producer case files and diagnostic while
the worker/namespace is alive; ACK is collection only. The worker remains
`PendingHostFinalization`. The host owns actual interruption/deadline rehearsal
proofs and writes case 10 plus cleanup only after confirmed removal. No root
alias, extra writable mount, caller proof boolean or budget increase is allowed.
The lifecycle-only host case may use `Unknown` digests, never copied worker
digests represented as new measurements. Its admitted cancellation facts and
confirmed cleanup remain mandatory; `Warmup` through `CaseIsolation` require
recorded source/lock/seed before-and-after digests against independent anchors.

Cleanup schedules inventory, ownership inspection, a best-effort stop capped at
3 seconds and force removal in a 20-second cooperative removal window. Independent
readback starts when removal settles or at that window's deadline, with up to
10 seconds inside the 30-second cooperative outer budget. An early absent readback
cannot confirm removal. Uninterruptible operations or finalizers, synchronous
blocking and already-issued Docker requests can outlive these limits; no hard
cleanup deadline or actual removal is proven. See the
[runtime assessment](../docs/assessments/runtime-feasibility-20261027.md).

The historical admission remains the three fixed data mounts and allocations
listed above; they fill the complete 3 GiB allowance. Effective
admission also checks auxiliary/default mounts; extra writable capacity, unknown
sizes and writable submounts block, without name or root-ownership exemptions.
Review a compatible measured layout before any live attempt. This worksheet does
not authorize increasing the ceiling or silently shrinking approved allocations.
The assessment's five-mount 2688/128/128/64/64 MiB reallocation is a proposal for
offline preparation only: it is unmeasured, unadmitted and not active.

Offline production composition and durable-output code is implemented, not live
authority. `makeQualificationHost` still requires trusted reviewed build context
and run/preflight authority; `makeProductionWorkerPlatform` still requires trusted
provenance and an admitted child observer. Defaults and ordinary CLI remain closed.
The existing effective control adapters and fixed rehearsal code need actual Linux
proof. No new observer acquisition is authorized. A future observer must execute
through the supplied `WorkerProcess`, not start a parallel installer transport.
The candidate readiness-image recipe and pending manifest described in the runtime
assessment do not provide a buildable or runnable canary, a real production
provider, or approval to acquire inputs, build an image or run it.

## Canary Build Gate

The bounded build remains a separate, unapproved operation. Before requesting it,
independently review the origin, exact SHA-256, size, target platform, build
toolchain and dependency closure of each of the readiness worker bundle, strace
executable and observer harness. Pin the resulting identities in reviewed
source; a manifest or checksum supplied with the artifacts is not authority.
The strace source tag and commit in the candidate manifest are not executable
provenance. Acquire no artifacts under this worksheet alone.

Stage only through a fresh private context with exclusive custody from admission
through the build. Reject links, nonregular files, unexpected entries and changed
bytes; bind the exact pinned recipe and artifact snapshots. Do not use a mutable
untrusted input directory or treat `.dockerignore` as an admission boundary.
Filesystem metadata checks alone do not establish exclusive custody or a hard
deadline. A synthetic staging test is not proof that the real build context is
safe or that its artifacts are approved.

The custody review must exclude competing same-UID processes and privileged
writers, not merely other users: mode `0700` is insufficient on its own. A
bounded reader must not block indefinitely when a regular file is replaced by a
FIFO before open, and final-component no-follow checks do not protect parent
directories. For hostile paths, require a reviewed descriptor-relative native
boundary or an equivalent qualified mechanism; do not silently fall back to
path-based checks. For a controlled source, document who holds exclusive custody
and how it is maintained through the builder's final read. Prefer binding a
deterministic context archive or stream to the approval, while retaining custody
of the exact bytes. Neither approach by itself proves the builder consumed them.

The Linux amd64 native filesystem boundary is preparation only. It opens below a
borrowed root descriptor with `openat2` and rejects links, mount crossings and
nonregular files before reopening a pinned inode through a caller-supplied procfs
descriptor. The caller must independently establish trusted root, genuine procfs,
mount namespace and descriptor-table custody. `O_NONBLOCK` does not bound regular
file or metadata latency; an independently qualified filesystem and isolation or
deadline mechanism are required. Fake-operation tests and cross-compilation do not
prove Linux kernel, procfs or race behavior. No production staging caller, pinned
helper executable, artifact provenance or builder handoff is admitted yet.

Record the reviewed implementation revision, artifact identities, context
inventory, runner and builder versions, pinned base-image readbacks, platform,
resource and time budgets, cleanup owner, and output/evidence destination. A
separately approved one-attempt build must bind these values; it does not itself
authorize running the image, hosted execution or webhooks. The final image digest,
configuration and runtime controls require independent readback and review.

The host delivers only the fixed admitted JSON allowlist to the owning checkout's
`qualification-output/`, before staging cleanup. Existing destinations refuse,
partial output is removed, receipt publication is last, and all bytes including
the receipt share 16 MiB. The recipient must review the exact workflow allowlist;
there is no arbitrary CLI destination. A failed/incomplete diagnostic is not a
qualification receipt. Output cleanup failure remains an operational failure,
never run or retry authority.

Before publication, replace the unconditional workflow refusal only through a
separate reviewed change binding an exact immutable implementation SHA and these
proofs. No branch-tip checkout, environment toggle, supplied JSON provenance,
secrets, OIDC, cache restore, automatic retry or dispatch parameters are allowed.
One failed or uncertain attempt consumes its authority; no implicit second run.

Offline tests use synthetic files and fake Docker/process adapters. They prove
controller behavior, not Linux controls, Bun compatibility, cache fit, historical
installation, observer coverage or runner eligibility. Even a future measured
pass leaves final-image construction, private invocation and activation blocked.
