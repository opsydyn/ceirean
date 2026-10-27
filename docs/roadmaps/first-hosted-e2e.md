# Path To The First Hosted End-To-End Run

Date: 2026-10-27. Status: proposed delivery roadmap, not execution approval.

## Outcome

An operator manually requests one private job against the pinned FoldKit source,
receives baseline and browser evidence bound to that source/toolchain, and has
separate active-cancellation/cleanup proof for the same hosted runtime/image.
Duplicate delivery must not start another executor. No repository writes, PR
creation, automatic merge or unattended jobs.

Recommendation: pursue a baseline-first vertical slice. This first milestone
proves the execution boundary, not Ceirean's eventual repair value. A subsequent
Flue slice must produce a useful migration patch and independently qualify it.
The owner selected baseline and browser evidence first on 2026-10-27. Including
the patch in the first milestone is therefore deferred. This scope choice does
not approve the remaining roadmap details, implementation or any live operation.

## Starting Point

- [x] Merge the reviewed offline Linux controller into local main at `10209fd`.
- [x] Confirm every existing local branch tip is contained in main.
- [x] Reconcile the remaining remote Dependabot history: its MCP SDK update was
      already applied; local merge `33096f3` has the identical tree to `10209fd`.
- [x] Finish post-merge lint/format, all Moon typechecks and all Moon tests.
- [ ] Separately approve any remote push. Local merge does not publish workflows.

Observed: local DO SQLite, Queue inspection/replay and the guarded Linux controller
have offline evidence. There is no demonstrated hosted executor, qualified final
image, live execution observer or executable migration application. Inspection,
simulation and metadata checks are not installation, baseline or browser results.

Post-merge verification: lint/format passed, all 12 Moon typecheck tasks passed,
and all 12 Moon test tasks passed in 9m56s. The duplicate Dependabot history merge
did not change the tested source tree. This roadmap adds documentation only.

The current record is [the Linux implementation plan](../superpowers/plans/2026-10-26-linux-cache-qualification.md).
Live prerequisites remain in [the one-attempt worksheet](../../qualification/linux-cache-run-worksheet.md).

## Routes Considered

- **Baseline first (recommended):** establish a real isolated execution path and
  evidence delivery before connecting agent decisions. Smaller failure surface;
  it deliberately does not prove migration usefulness yet.
- **Patch in the first hosted milestone:** test the complete user promise sooner,
  but combine runtime, model/tool policy, migration and acceptance failures.
- **Deploy inspection only:** useful as a transport smoke test, but it cannot
  satisfy this end-to-end outcome and must not be reported as such.

Retain Bun, Effect, the existing Moon monorepo and the selected Cloudflare/Alchemy
direction. No Alchemy upgrade, platform replacement or new orchestration framework
is needed to begin this roadmap.

## 1. Resolve The Runtime Feasibility Decision

The approved static assessment is [recorded here](../assessments/runtime-feasibility-20261027.md):
conditional GO for the existing Cloudflare design; NO-GO for execution today.
The [Linux readiness amendment](../superpowers/specs/2026-10-27-linux-runtime-readiness-design.md)
is approved for offline preparation. Its execution, tool acquisition/build and
publication remain separately gated; the hosted microVM isolation approval is
not reopened. No actual Linux runtime proof follows from the amendment.

- [ ] Prepare and review the selected strace candidate and a protected observation
      channel through the owned `WorkerProcess`. Existing stdout/stderr do not
      demonstrate tracer-only output, and a same-UID 0600 file does not isolate
      the tracee. Effect exposes `additionalFds`, but inheritance/closure, proc
      access, channel integrity and actual Linux behavior are unproven; investigate
      rather than assume either success or a concrete incompatibility. Bind tracer
      and actual Bun PIDs separately. Default observer and provenance stay
      unavailable until evidence supports admission.
- [x] Map the required isolation/lifecycle controls to both the Linux qualification
      runner and the pinned Cloudflare provider. Static API review can expose a
      missing mechanism; it cannot establish effective hosted enforcement. Resolve
      known unsupported requirements before investing in the final image.
- [x] Approve offline preparation of the proposed writable-mount reallocation,
      including auxiliary mounts, within the existing 3 GiB ceiling. Actual
      capacities, security and kernel-mount policy remain unmeasured and unadmitted.
- [ ] Implement fixed canary collection and bounded sanitized `ReadinessOnly`
      inventory export. The existing pure `inspectMountInventory` only evaluates
      supplied synthetic or other input; it does not collect actual mounts, run a
      canary, authorize execution or issue a receipt. Freeze the reviewed actual
      inventory before admitting the kernel policy.
- [ ] Prepare the [bounded acquisition/build and one-run checklist](../assessments/runtime-feasibility-20261027.md#canary-approval-preparation):
      independently approve and check the actual strace binary hash/provenance,
      freeze the fixed Ceirean-owned harness, and resolve the still-unknown builder,
      runner and image identities before requesting the relevant separate approvals.
      Fixed cases include `execveat`, conditional `CLONE_UNTRACED`, UID/FD/proc
      access and spoofing, actual control/network readbacks and owned cleanup.
      Readiness evidence is not a FoldKit install, historical qualification attempt
      or automatic retry authorization; this checklist grants no acquisition or run.
- [x] Record the static go/no-go result for observation, controls and cancellation;
      actual runner/provider behavior remains unknown and execution stays blocked.

Exit: reviewed actual canary evidence and a testable runtime design with the
observer, ownership and mount policy supported by that evidence. Offline
preparation and a pure diagnostic do not satisfy this exit. The assessment's
one-day appetite was for the feasibility decision, not a deployment commitment.
If testing establishes a conflict with the chosen isolation, return that concrete
conflict for a decision; an untested candidate alone is not proof of incompatibility.

## 2. Qualify The Real Linux Dependency Path

- [ ] Close the two retained P3 gaps: successful final input-handoff assembly and
      larger tar/body/processing-slice boundaries, using bounded synthetic tests.
- [ ] Build the reviewed Node harness/tool capsule on a trusted Linux amd64
      builder; independently bind executable, harness, lock and inventory hashes.
- [ ] Review the exact source revision, workflow SHA, runner allowance, artifact
      recipient, cleanup owner and one-attempt worksheet. Publish only after
      publication approval; execute only after the separate run approval.
- [ ] Run the existing ten-case qualification once with actual inputs: source
      admission, script suppression, warm-up, offline positive/negative installs,
      cache isolation, interruption/deadline and confirmed cleanup.
- [ ] Retain the complete bounded receipt and classify every refusal honestly.

Exit: actual Linux evidence that the frozen consumer installs using the intended
cache and controls. This is still not a FoldKit build, browser pass or deployment.
Keep the existing 15-minute job/resource/evidence limits. A failed or uncertain
attempt does not authorize an automatic retry or relaxed acceptance.

## 3. Produce The Immutable Executor Image

- [ ] Complete and verify the source, Bun/npm cache and browser-harness dependency
      payloads, including generated/packed consumers required by the baseline.
- [ ] Review the trusted builder, recipe and complete input hashes; obtain bounded
      image-build/publication approval. Repository scripts must not execute with
      cloud publication credentials.
- [ ] Build and publish the exact image; record its final immutable digest and
      actual Node/Bun/browser/tool readbacks. A helper/base-image digest is not it.
- [ ] Qualify unchanged baseline, packaging/Storybook and the fixed browser
      journeys with real artifacts in the isolated runtime. Missing offline
      metadata or browser sandbox support blocks; no network fallback or skips.

Exit: a measured image capable of running the unchanged historical baseline and
capturing the required browser evidence. Do not upgrade the historical toolchain
or use the current FoldKit checkout to make that baseline pass.

## 4. Implement Private Hosted Actuation

- [ ] Add the production private Queue/Worker/DO stack without deploying the local
      test bridge or its fault-injection routes.
- [ ] Replace simulation at the provider boundary with real start, inspect,
      cancel, status, evidence export and destroy/readback operations.
- [ ] Make execution admission durable before allocation. Verify concurrent and
      redelivered commands, lost acknowledgements and restart recovery without a
      second executor; inspection replay alone is insufficient.
- [ ] Enroll real operator trust through a separately reviewed boundary, bind the
      final image and payloads, and verify account eligibility, limits and spend.
      Keep public Worker URLs, routes and automatic execution disabled.
- [ ] Measure actual provider isolation, networking, resources and cancellation;
      do not promote Docker flags or local DO results to Cloudflare control proof.
- [ ] Obtain bounded deployment/session approval and run a Ceirean-owned active
      cancellation canary through the private transport. Include a live child,
      browser and server in its reviewed workload, then prove their termination,
      container removal and evidence delivery. Canceling a client wait or an
      already-finished process does not satisfy this case.

Exit: a real private hosted lifecycle with complete evidence and confirmed cleanup.
Hosting implementation, deployment and the live session remain separate approvals.
There is no end-to-end claim from an HTTP 200, queued message or matched signature.
The cancellation canary has its own approved operation/session identity, exact
runtime/image, finite allowance and cleanup owner. It is not the successful
FoldKit baseline attempt and grants no authority for another allocation.

## 5. Accept The First FoldKit Hosted Baseline

- [ ] Manually invoke one job for the immutable FoldKit revision through the
      private transport, using the qualified image and fixed acceptance profile.
- [ ] Export source/image/tool bindings, command results, browser captures,
      duplicate-delivery behavior and cleanup proof to the reviewed recipient.
- [ ] Bind the separate milestone-4 active-cancellation proof to this runtime/image,
      and independently verify this successful baseline allocation is removed.
- [ ] Record pass, fail or inconclusive and maintainer review; no automatic retry.

Acceptance: the operator gets a reviewable evidence bundle without shelling into
the worker or manually stitching logs together. Baseline status today is unknown,
not passing. The job must either deliver all required evidence or fail clearly;
partial evidence, skipped acceptance or unknown cleanup is not a pass.
Do not cancel the successful baseline to manufacture cancellation evidence.
Proposed hosted acceptance contains two distinct authorized cases: the canary and
the successful baseline. Each needs its own exact approval/window/allowance;
confirm removal before starting the next. A changed runtime/image invalidates
reuse of the canary proof. Any further negative case requires separate authority.

## 6. Add The Useful Repair Loop

- [ ] Approve the exact migration target, allowed files, model/provider policy,
      credential boundary and bounded repair/time/spend allowance.
- [ ] Wire Flue to the existing owned worker tools; do not grant repository code
      publication credentials or let the agent edit protected acceptance checks.
- [ ] Freeze the candidate and independently rerun acceptance on those bytes.
- [ ] Export a migration patch plus source-bound qualification evidence for
      maintainer review. Measure correctness and operator effort, not PR count.

Exit: one useful, reviewable FoldKit migration. PR publication, broader repository
discovery, scheduled updates and autonomous merges remain later product work.

## Operating Rules

The maintainer approves source, scope, spending and external actions. The executor
operator owns cancellation, artifact custody and escalation of unknown cleanup.
Name those roles and the finite session window before each live attempt; no
always-on service or response-time promise exists yet.

Record evidence per milestone and advance only when its exit condition holds.
Stop on unauthorized execution, escaped networking, uncertain ownership/removal,
incomplete evidence or budget exhaustion. A failure changes the next decision;
it does not expand authority. Scope may shrink, but consent, isolation and recovery
must not be removed to fit the appetite.

Next bounded action: complete the approved offline canary and observer preparation,
keeping acquisition, publication and the one bounded Linux run behind their
separate approvals. Review its evidence before considering historical qualification.
