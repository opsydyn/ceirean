# FoldKit Replay Profile And Local Worker Boundary

Status: written spec approved by the owner on 2026-10-21, including the historical
case, controller-managed Docker boundary and Colima on this Mac. The
[first implementation plan](../plans/2026-10-21-foldkit-replay-profile.md) covers
offline profile inspection only and was approved for inline implementation on
2026-10-22. Native-execution approvals are still separately required.
This document starts no VM, worker, model call or migration.
Independent read-only design review found no material issues; that is not native
feasibility or isolation evidence. Repository lint/format validation passed for
this documentation-only slice; runtime tests were not rerun or newly qualified.

## Product Outcome And Scope

A maintainer receives one scope-valid migration patch with evidence sufficient
to accept or reject it without reconstructing the run manually. Admission,
container startup and passing exit codes alone are not the product outcome.

Replay one completed FoldKit API migration first, then use the proven path for
a current-version migration. The historical patch is an evaluation reference,
not a prescribed answer. Different correct patches may pass the same contract.
The current alternative is the maintainer performing and qualifying the migration.
Maintainer review/supervision effort has no measured baseline yet; record it
during the replay, without claiming an improvement in advance.

The proposed one-day appetite covers profile/isolation feasibility and design,
not delivery of every native adapter below. The implementation plan must name
its effort allowance and stop conditions before execution. Existing synthetic
worker tests and the live admission rehearsal do not qualify native migration.

Excluded: current-release discovery, arbitrary repositories, private registries,
organisation onboarding, campaigns, PR publishing, deployment, unattended
execution and broad dependency/security remediation. Existing transitive
security findings stay visible in their separate assessment.

## Approved Historical Case

| Identity             | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| Repository           | `opsydyn/fold-kit-experiments`                                  |
| Base commit          | `b7484cb46e66b162c8afddcfba235c9507b4f0ab`                      |
| FoldKit              | `0.165.0` to exact `0.166.0`                                    |
| Companion            | `@foldkit/vite-plugin` to exact `0.26.1` where already declared |
| Effect               | retain existing `4.0.0` pins and peer contract                  |
| Historical reference | `248636efea03a2048432260da6261bb657a282dc`                      |

The observed source migration is the carousel's `Subscription.lift` accessor:
`toChildModel` becomes `read`, returning `Option.some(model.carousel)`.
Downloaded promo templates need matching dependency pins. Historical source
observations are not fresh evidence that this base still builds today.

The worker receives only a sanitized archive of the base, approved release/API
material and bounded diagnostics. It receives no `.git`, current checkout,
untracked reference trees, reference patch or future migration assessment.
The evaluator stores the historical reference outside model-visible tools.
Existing source/AGENTS files are untrusted data and cannot grant authority.

## Reviewed Profile And Patch Contract

Load the central profile from an approved Ceirean revision and validate it with
Effect Schema. The profile is data, not executable repository configuration.
Bind repository/base/target identities, profile and policy digests, execution
caps, toolchain/image identities, command arrays, fixture inventory, permitted
paths/manifest fields, artifact policy and disabled publication.

A draft profile is inspectable but cannot start workers. A qualified profile
requires measured host/image/network/quota readiness, exact artifact inventory
and a baseline acceptance contract. Missing fields or unsupported capabilities
produce a visible blocked result, never implicit defaults or invented values.
This distinction does not add a second business state machine.

Permit only:

- `foldkit` pins in the existing manifest sections of `apps/web`, `apps/promo`,
  `packages/astro-foldkit` and `packages/foldkit-viz`.
- Existing Vite-plugin dependency fields in web and Astro integration.
- The two package FoldKit peer ranges, exactly `>=0.165.0 <0.167.0`, conditional
  on successful installed-package checks against both versions.
- The generated root `bun.lock`, produced by the native package manager.
- `apps/web/src/apps/carousel/subscription.ts` for the accessor migration.
- Only the FoldKit/Vite-plugin values in the generated package manifest inside
  `apps/promo/src/lib/example-project.ts`.
- Version-accurate package README notes and one migration report, bounded by
  explicit paths in the final profile; no new runnable documentation scripts.

Reject other manifest fields, package scripts, workflows, exports, package
release versions, lint/type configuration, existing tests/assertions/snapshots,
AGENTS/CLAUDE files and unrelated source changes. Validate manifest/template
structures, not textual path matching alone. Stop for profile review if a
necessary fix falls outside this contract; the agent cannot expand it.

The controller supplies a separately reviewed, read-only acceptance harness.
It can add consumer/browser checks without giving the model permission to alter
the base tests. Never copy the historical test rewrite as the worker's answer.

## Controller And Storage Ownership

Retain the existing split: pure domain decisions, Effect services/scopes,
RunCoordinator qualification, one existing XState Effect worker lifecycle and
Flue reasoning. Docker is mechanism, not a replacement coordinator or authority.
Infer new ports from real factories; dependency assembly stays at service or
exported application boundaries. Keep universal lint rules unchanged.

The manual entrypoint admits an explicit replay request, not an issue event.
It uses one controller owner and one active run. A separate operator-approved
local migration state directory holds the SQLite run/worker ledger, lock,
bounded Flue conversation storage and retained evidence. Never initialize,
reuse or migrate the live-admission ledger implicitly.

Native run/worker persistence and a real mechanism adapter are prerequisites;
the current memory-journal tests are not usable production adapters. Keep Flue
conversation tables separate from authoritative application records. Worker
processes cannot read either database or the controller's credentials.

On 2026-10-22 the owner approved one atomic migration ledger boundary for run
state and worker authority: cancellation and generation changes must update the
run and all affected worker records together. The
[Plan B draft](../plans/2026-10-22-native-migration-ledger.md) details explicit
initialization, single-owner SQLite scope and local recovery qualification.
Its written plan/bounds/appetite and execution method still require review.
Planning approval initializes no operational storage and starts no worker.

Keep current actor intent-before-mutation, immutable container binding,
revision/current-generation checks and ambiguity handling. Docker names/labels
only aid discovery. No blind retries after a claimed or uncertain mutation.
Reconstruction uses ledger records plus observed resources, never persisted
XState snapshots or a fresh deadline. Preserve retained artifacts during cleanup.

Native readiness needs explicit typed readback of root-filesystem mode and
resource/security limits, beyond the current synthetic configuration fields.
Extend the owned configuration/observation contracts where necessary; do not
hide these requirements behind an opaque adapter success flag. Preserve existing
actor laws and requalify affected fixtures. This does not migrate old ledgers.

## Colima And Docker Boundary

Use a dedicated Colima profile named `ceirean`, with the Docker runtime. Address
its explicit Docker endpoint/context on each controller operation; do not switch
the user's global context or touch other profiles/containers. Register and bind
the approved host, daemon and context identities before admitting a run.

Disable host directory sharing, including Colima's default home mount, and SSH
agent forwarding. Use controller-validated source transfer and daemon-owned
worker storage, not host bind mounts. The Docker socket belongs only to the
trusted controller; never pass it, host networking/PID namespaces, privileged
mode or cloud/model/publication credentials into a worker.

The trusted worker image and any build context are Ceirean-owned and reviewed,
not consumer Dockerfiles or model output. Resolve an immutable image digest,
native architecture, exact Bun 1.3.11, compatible exact Node 22 and Git versions,
and matching Playwright/Chromium identities during profile qualification. The
historical CI says Node 22, not an exact patch. Do not invent an image digest or
claim a browser/image combination qualified from manifest ranges.

Start non-root with read-only root filesystem, dropped capabilities,
no-new-privileges and an approved browser-capable seccomp policy. Writable
workspace/cache/temp locations are explicit disposable storage. Do not use
`--no-sandbox` to make Chromium pass. Fail readiness if readback does not match
the approved configuration and operation identity.

Source transfer rejects escaping/absolute paths, unsafe symlinks, special files,
archive traversal and unsupported submodule/LFS content. Do not extract an
untrusted archive into controller storage without validating each entry.
Reject credential-bearing tracked inputs before model access or worker transfer;
do not silently omit required tracked inputs and call the altered base qualified.
This pilot supports an allowlisted internal repository, not hostile tenants or
a claim of protection against VM/kernel escape.

## Network And Preparation

Dependency preparation is a separate bounded worker operation with its own
configuration and evidence. Permit package retrieval only through a trusted
host/VM-enforced allowlist or artifact proxy, initially the approved npm registry.
Reject redirected/external artifact hosts unless separately approved and pinned.
Restrict retrieval methods and artifact/metadata paths as well as destination;
an unrestricted forward proxy or arbitrary registry requests are insufficient.
Browser binaries/toolchains are pre-provisioned in the trusted image.

After preparation, migration/check/verification workers have no external network;
local browser traffic is restricted to their owned test server. Do not change a
live operation's pinned network configuration mid-run. Transfer an inventoried,
digest-bound dependency cache/artifact set to fresh workers; do not share mutable
cache volumes across baseline, candidate and verifier.

Historical consumer tests themselves install packed fixtures and dependencies.
Qualification must inventory and prewarm those exact packages and registry
metadata, then prove the complete test suite works offline. An uncached fetch is
a blocked dependency/preparation result, not permission to skip a test or enable
general internet. Ordinary Docker bridge networking and proxy environment
variables alone are not proof of restricted egress. If enforceable registry-only
access or offline acceptance is unavailable, block the profile.

## Acceptance And Evidence

Run the base contract before mutation, then the candidate, then a fresh verifier
from the original base plus validated frozen patch. No verifier reuse of the
candidate workspace. Pin all approved command argv/cwd pairs from this base:

1. Frozen dependency installation from the prepared artifact set.
2. Root `bun run check`, `bun typecheck`, `bun run test`, `bun run build`.
3. Web workspace `build-storybook`.
4. Packed Astro/Viz consumer checks and generated promo templates. Baseline
   consumers use 0.165.0; candidate/verifier consumers must cover both 0.165.0
   and 0.166.0 to substantiate the retained peer range.
5. Fixed browser journeys: web `/carousel` button navigation and pointer drag/
   settle; promo `/examples/line` point editing and generated settings consistency.

Capture chart/integration behavior, console errors, traces and before/after
screenshots at desktop 1440x900 and mobile 390x844. Use reviewed deterministic
data, browser version, fonts, time and animation controls. Visual differences
need review, never automatic snapshot updates. Capture mobile-appropriate pointer
interaction as well as a desktop drag; merely loading a nonblank page is not
equivalent evidence.

Record the actual baseline test inventory/counts instead of treating the old
assessment's 385/386 totals as today's proof. Both preserved baseline tests and
controller-owned target-version checks must run. Zero discovered tests, weakened
checks, missing artifacts or unexpected generated files cannot qualify a patch.
Baseline failure blocks migration until separately reviewed.

The controller also runs a separate negative control: install the target pins
without the accessor migration and require the expected type failure. This is
not the baseline contract. It demonstrates that a manifest-only patch cannot
pass; the full candidate must restore the check without altering expectations.

Export locally: complete validated patch, bounded command logs, artifact digests,
machine-readable receipt and concise maintainer report. Bind base/target/profile/
policy/toolchain/image/cache/harness/candidate identities, attempts/deadline,
results, omissions, cleanup readback and observed review effort. Independently
evaluate correctness against the contract; the reference diff is advisory only.
Escape/redact logs, inspect allowed artifact paths and retain evidence outside
worker cleanup. Never export a full worker filesystem or credential-bearing DB.

## Limits And Cancellation

Proposed run caps require explicit approval before execution: one active run,
45 minutes end-to-end, two repair attempts, 2 CPU cores, 8 GiB memory, 256 PIDs,
20 GiB writable storage per worker, 10 MiB combined output per command and
512 MiB total retained artifacts. Colima VM allocation is separate and must leave
measured headroom; its total disk size is not a per-worker quota.

Prove actual CPU/memory/PID/storage enforcement. Unsupported storage quotas or
browser restrictions block qualification; do not substitute advisory monitoring
while claiming a hard cap. Preserve the original deadline and consumed limits
across process restart. Logs exceeding limits retain a truncated indicator and
cannot masquerade as complete evidence.

Cancellation persists intent, aborts model work, stops/removes owned disposable
resources and confirms absence through readback. An exited CLI or timed-out
Effect is not cleanup proof. Ambiguous cleanup blocks subsequent runs and emits
resource identities for controlled reconciliation; never remove foreign resources.

No API key is needed for design or the synthetic probe. A real-model run needs
separate provider/model/data approval and a nonzero explicit spending cap;
missing approval blocks it. Keep model credentials in the controller, with only
bounded validated repository tools exposed through Flue. No arbitrary host shell,
direct ledger/actor access, qualification tool or publishing capability.

## Implementation And Qualification Gates

- [x] Owner reviews and approves this written spec.
- [x] Owner reviews the implementation plan, execution method and effort cap.
- [x] Offline profile validation and property tests cover identity/scope/budgets,
      traversal, instruction injection and immutable acceptance configuration.
- [ ] Native ledger/ownership/recovery and Docker mechanism pass focused tests,
      preserving the existing actor and pure qualification contracts.
- [ ] Separately approved Colima readiness probe proves no home/secret/socket
      exposure, network denial, enforced quotas and non-root browser sandboxing.
- [ ] Crash/cancellation and lost-response tests prove owned cleanup, artifact
      retention, no replayed mutation and no accidental default-context access.
- [ ] Operator approves exact image/toolchain/harness/cache identities, model
      policy/caps and finite execution window before the real replay.
- [ ] Base, migrated candidate and fresh verifier pass the full acceptance
      contract; seeded behavior/check weakening cannot obtain qualification.
- [ ] Maintainer records acceptance/rejection and supervision effort.

Stop if the case cannot meet isolation, baseline or acceptance requirements
within its approved appetite. Record the precise blocker and reshape the case
explicitly; do not claim product success from a manifest-only update.

This design extends the [worker lifecycle spec](2026-10-19-worker-lifecycle-design.md)
and concretizes the [service draft](2026-10-18-internal-upgrade-service-design.md).
It does not change [ADR-0002](../../decisions/0002-adopt-xstate-effect-for-worker-lifecycle.md)
or reopen completed admission/publication permissions.
Colima references: [profiles](https://colima.run/docs/profiles/),
[configuration](https://colima.run/docs/configuration/),
[Docker runtime](https://colima.run/docs/runtimes/).
