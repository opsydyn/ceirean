# Cloudflare Executor Preparation Probe

Private, offline preparation and simulated lifecycle only. A guarded Linux Docker
controller exists, but no production authority, observer/control provider or
Linux runtime proof is admitted. No Worker deployment or remote SDK adapter exists.
Operational ingress, Flue,
the application ledger and the Draft Colima replay profile are unchanged.

## Commands

From the repository root:

```sh
moon run cloudflare-executor:test
moon run cloudflare-executor:typecheck
bun --no-env-file probes/cloudflare-executor/scripts/prepare.ts --check
```

`--check` reads the committed manifest and recipe only. Exit **2** means a valid
`PreparationOnly` report with activation blocked; exit **1** means invalid or
unreadable inputs; exit **64** rejects unsupported arguments. There is deliberately
no success/activation exit code. Do not interpret `prepare-check` as a green
deployment readiness task. No build, download, extraction, source checkout or
consumer script is executed. Run Bun with `--no-env-file`; the command does not
request or read cloud credentials through Effect Config or otherwise.

## Guarded Linux Qualification

`bun --no-env-file probes/cloudflare-executor/scripts/qualify-linux.ts --check`
returns **1** with an explicit incomplete diagnostic, without Docker or retrieval.
`--run` also refuses before acquisition because the exact reviewed worksheet and
production capability/provenance provider are absent. Extra arguments return
**64**; JSON and environment variables cannot supply authority.

The library-only `makeQualificationHost(reviewed, locations, authority)` composes
`LinuxInputHost`/`LinuxInputs`, fixed Docker process/session adapters, metadata and
owned durable output. Reviewed build context and run/preflight authority remain
explicit trusted in-process dependencies. The discovered Docker path must match
the host's fixed executable. The ordinary CLI has no such provider.

The in-process `runQualification` composes Task 2 source admission, owned producer
supervision, bounded actual-file evidence, Task 1 aggregation and delivery. Ownership is
registered before create, with no retry/replacement and unconditional removal
readback. Unknown/late create acknowledgement cannot confirm cleanup. Explicit
unprivileged UID/GID matches 0700 input staging and tmpfs ownership. Only inputs
and tools are read-only host mounts; no home, checkout, environment or socket is
mounted. The canonical evidence path is `/work/evidence`, inside the existing
2816 MiB work tmpfs. No root alias, root overlay write or additional writable
mount is needed. The trusted library composition is
`src/linux-qualification/controller-worker.ts`, not executable CLI main.

Docker inspect, kernel mount/status/cgroup readers and fixed HTTP/DNS/TCP
negative probes are composed by `makeProductionWorkerPlatform` and the worker
entrypoint, but remain Linux-unqualified. Its provenance and child/native observer
are explicit trusted dependencies; defaults refuse. A future admitted observer
receives the existing fixed `WorkerProcess`, retaining the real warm-up spawn hook.
No observer, tracer or synthetic success provider is acquired by this composition.
Requested flags and synthetic readbacks never count as effective control proof.
Effective admission accounts for all writable mounts, not only the three requested
tmpfs roots. Their approved allocations fill the 3 GiB ceiling; additional writable
auxiliary/default mounts, unknown capacities or writable submounts block. A compatible
measured Docker layout or a separately reviewed design decision is required before
a live attempt. Mount names and root ownership do not grant exemptions.

The worker owns nine cases and returns `PendingHostFinalization`, not a full
qualification pass. It never calls a cancellation provider or certifies its own
container removal. The host collects producer evidence while the namespace is
alive, then ACKs collection and performs exit/removal readbacks. Only the host
may generate the tenth `CancellationDeadline` case after actual owned rehearsal
proofs and removal, write its evidence and cleanup document, and attempt full
admission. The owned producer, session-bound seal admission and sequential fixed
rehearsal/finalization writer are implemented and tested offline with fakes.
Their actual Docker pause/top/EOF/removal behavior remains unqualified. Missing
host evidence blocks; request flags and READY data cannot replace it.

`QualificationOutput.deliver` exclusively acquires the owning checkout's fixed
`qualification-output/` directory. It rechecks admitted file identity/hash with
no-follow reads, writes only the ten case JSON files, worker diagnostic and cleanup,
and verifies destination bytes. Receipt overhead shares the 16 MiB total cap.
The verified pending receipt is renamed last; partial delivery is removed, while
collisions are preserved. Successful output survives source/staging scope exit.
No source/cache/environment/link discovery, arbitrary CLI destination or new mount
is involved. The inert workflow lists those exact completed output files only.

One 15-minute controller budget covers acquisition through delivery. Production
work gets 12 minutes, retaining the shared 9-minute producer/rehearsal cap; cleanup
gets at most 2 minutes (including the existing 30-second stop grace), and delivery
gets the remaining minute, including 10 seconds reserved for partial-output cleanup.
Timeout or unknown cleanup never produces a qualification receipt. Offline
controller verification and independent task/whole-branch reviews passed. This
is not a live attempt or Linux qualification. Two nonblocking coverage gaps remain:
successful final input-handoff assembly and larger archive processing boundaries.

The lifecycle-only host case may have `Unknown` digests: removal destroys the
cache inodes, so it must not copy the last worker hashes as new observations.
Its bounded admitted facts and confirmed cleanup remain mandatory. Every cache
case from `Warmup` through `CaseIsolation` still requires independently anchored
recorded source/lock/seed before-and-after digests.

Only fixed JSON files cross the bounded stdout tar transport. The existing
pinned Header codec rejects links, extra members and truncation before host writes.
The 256 KiB stream cap also bounds each transported file to 260,608 bytes; larger
documents block without splitting or raising caps. Actual-file admission uses
no-follow metadata, bounded content decoding, observation consistency and SHA-256.
Files plus the sanitized receipt share the 16 MiB total. Stdout is never forwarded
as workflow commands. Source, caches, installed files and environment are not
artifacts. Worker exit 0 is not qualification: all cases, independently validated
source, trusted seal admission, evidence and confirmed cleanup are required.
Pre-seal refusal produces a nonzero incomplete diagnostic, not a fake receipt.

The [inert draft](../../qualification/linux-cache.workflow.yml) stays outside
`.github/workflows` and unconditionally refuses while the approved implementation
SHA, [worksheet](../../qualification/linux-cache-run-worksheet.md) and capability
proofs are absent. Publication and one-attempt run approvals remain separate.
Synthetic tests and thin local dependency reuse are not clean Linux proof.

## Pinned Inputs, Not A Built Image

`fixtures/baseline.json` fixes the consumer at
`b7484cb46e66b162c8afddcfba235c9507b4f0ab`. Bun 1.3.11 and the consumer's lockfile
are historical inputs. Node 22.23.4, Git 2.43.0 and Playwright 1.64.1/Chromium
156.0.8078.4 revision 1248 are new qualification choices, not recovered CI facts.
The image recipe requires the exact Git version and binary locations; no image
has been run to verify those assumptions. A mismatch must fail the build.

The recipe pins Linux amd64 base, Node, Bun and Sandbox helper images by digest.
The Node stage replaces the base image's Node toolchain; the base contributes
preinstalled browser/system dependencies. Nothing runs apt, npm install, remote
shell installers or consumer build scripts during this proposed image build.
The SDK helper is pinned to 1.0.3, but the SDK package itself is not installed.
New workspace dependencies are only the existing Effect/platform-bun 4.0.5 cohort.

`image/Dockerfile` is **unbuilt**. Digest-pinned inputs and a recipe hash are not
the final executor digest. Chromium must later be launched with its sandbox
enabled and verified on the actual hosting platform; `USER pwuser` is not proof
of restricted capabilities in Cloudflare's root-equivalent sandbox model.

## Offline Payloads Still Required

The ignored `payload/` directory must eventually contain four approved,
digest-inventoried archives and their trusted checksum list:

| Payload               | Required content                                                            |
| --------------------- | --------------------------------------------------------------------------- |
| `source.tar`          | Exact tracked source at the baseline SHA, validated before extraction       |
| `bun-cache.tar`       | Root frozen-install artifacts plus packed-consumer `bun x tsc` requirements |
| `npm-cache.tar`       | Metadata/tarballs for nested line/histogram/scatter generated npm installs  |
| `browser-harness.tar` | Pinned Playwright package/dependencies and reviewed browser harness         |
| `SHA256SUMS`          | Exactly those four archive names and hashes, bound to build approval        |

All four archives remain `Pending`; no cache is populated by `--check`. The
Dockerfile copies only these files and checks their recorded hashes. This is not
proof of archive safety or complete offline coverage: the future trusted builder
must validate the checksum-list entries against the approved inventory, and the
runtime extraction adapter must validate actual archive headers/content before
using them. Never trust a consumer-supplied checksum list.

The preserved source contract includes root check/typecheck/test/build, web
Storybook, Astro packed smoke tests and generated promo consumer installs. Those
generated projects have transitive npm requirements not frozen by the root Bun
lock. Inter fonts 5.3.0 must come from the baseline dependency inventory. Uncached
requests block preparation; they do not permit general network access or skips.
The historical install argv is preserved; actual offline execution is a network
enforcement requirement, not an assumption about a newer Bun flag.

The fixed journey inventory covers carousel buttons/desktop and mobile drag,
and promo line point-edit/settings consistency at 1440x900 and 390x844. It is not
an implemented browser journey or a screenshot result yet; those belong to Task 4B.

## Validation Boundaries

`src/preparation.ts` validates an input manifest against the reviewed pins and
hashes the recipe. `src/pins.ts` owns expectations independently of the runtime
JSON input, which is read only inside the CLI's bounded, sanitized workflow.
It rejects readiness assertions instead of allowing a boolean
to activate anything. Source inventory checks reject unsafe paths, all symlinks,
special files, duplicate/file-parent collisions and known sensitive names/key
markers. These are checks over supplied inventory data, **not** a tar parser,
filesystem scanner, credential-discovery guarantee or transfer authorization.
An actual export still requires a complete inventory, digest binding and review
of tracked secrets; do not hide required tracked files and call it the same base.

Registry validation admits only exact inventoried HTTPS GET URLs at
registry.npmjs.org, without credentials, queries or fragments. A redirect is a
new request and must be independently checked against the reviewed URL inventory.
The validator performs no fetch and does not enforce runtime egress by itself.

Proposed builder: an ephemeral GitHub-hosted `ubuntu-24.04` Linux amd64 job in
Ceirean, with a reviewed Ceirean-owned context and a 15-minute job timeout. Keep
registry publication in a separate trusted step and exclude consumer execution.
Exact runner entitlement, enforceable limits, permissions and costs belong to
the separate build-approval worksheet; this is a proposal, not a configured job.
Do not restart Colima, create a builder, push a workflow,
publish an image or spend money under preparation authority. Package credentials
must stay in a trusted retrieval service, never consumer commands or the payload.

## Offline Admission And Evidence Contracts

`src/contract.ts` fixes the six probe operation names and source revision. It
rejects arbitrary argv, caller-selected sandbox IDs, extra fields and requests
above the 10 MiB command / 512 MiB exported-evidence ceilings. The wider outcome
vocabulary exists for future hosted reporting, but the current offline manifest
cannot claim `Feasible`, verified integrity or enabled activation.

`makeAdmissionGate` owns one **process-local** atomic reservation using Effect
Ref. Exact duplicate IDs replay only the existing reference, including after
expiry; replay is not permission to start or restart work. Conflicting ID reuse
is refused. A different operation cannot take the occupied slot. New reservations
must fit the execution deadline and the full 15-minute cleanup reserve; recorded
clock regression cannot reopen a refused expired session. The owning controller
supplies time, never a request field. This is not distributed admission or a
replacement for the authoritative ledger. There is deliberately no release/reset
API. The simulated controller below also retires the session permanently after
cleanup; a synthetic confirmation cannot authorize a second hosted allocation.

`makeEvidenceCollector` binds a snapshot of the request, lower-or-equal budgets
and nonempty required artifact names. It meters chunks without storing their
payloads. Per-command output bytes and reserved artifact sizes share the total
export budget, so concurrent opens cannot oversubscribe it. It also bounds file
and command metadata counts to 64 each. Duplicate/unsafe/special entries,
over-budget chunks, missing required artifacts and incomplete files fail closed;
a rejected collector cannot be reset by retrying a smaller chunk.

The caller must check each returned Result **before** forwarding bytes to a
storage sink, and apply backpressure rather than queueing unbounded pending
Effects. These contracts do not implement a stream reader, writer, file export,
hash verifier or archive extractor. A claimed SHA-256 is syntax-checked metadata,
not verified content integrity. Finalization seals the collector and emits only
`Blocked`, `Unverified`, `CleanupUnconfirmed`, activation `Blocked`, with the
constructor-bound identity. No caller-supplied final identity or cleanup claim
is accepted by the collector.

## Simulated Lifecycle Ownership

`makeExecutor(simulationDriver, sessionConfig)` is a private Effect scope-owned
service. `start(rawRequest)` performs admission internally using Effect Clock;
it never trusts caller-authored admission decisions or resource IDs. The resource
identity is derived from validated session and operation IDs. `inspect`, `cancel`
and `close` select only that owned identity. The short reservation lock contains
no transport waits. Duplicate starts replay a reference without dispatching.
The driver holds an atomic, non-releasable owner claim, so a second factory call
with that same driver is refused before any I/O, including after closure. The
trusted composition root must supply one driver for the rehearsal. This is not
a global registry across independently constructed drivers or processes; the
future real adapter still needs authoritative durable/session admission.
Caller input is decoded and snapshotted once before admission and dispatch.

An owner fiber races the admitted absolute deadline and explicit cancellation,
including while Start is pending. Interrupting the initial client waiter requests
owner cleanup; it is not proof that an external process stopped. Scope exit also
owns teardown. Close is coalesced, and escaped handles cannot reopen a retired
owner. There is no session reset, concurrent provider owner or durable recovery.

The simulation protocol separates physical state (`Absent`, `Running`, `Exited`)
from attempt history (`NeverIssued`, `Issued`, `Unknown`) and mutation settlement
(`Quiescent`, `Uncertain`). Only an absent, never-issued, quiescent identity can
start. Lost acknowledgement is reconciled by inspection of the same identity,
never another Start. Cleanup issues Terminate then Destroy, followed by readback.
Acknowledgements alone are insufficient: confirmation requires successful calls
and an absent, quiescent observation. Unknown settlement remains
`CleanupUnconfirmed` even when physical state is absent. Driver replies must match
the expected action and all three identity fields; malformed replies fail closed.

Each local transport wait is capped at one second; the sequential cleanup path
has three such waits. These are simulation-controller wait bounds, **not** remote
termination enforcement or provider latency promises. The driver fixture ignores
AbortSignal deliberately in hanging cases. No real Linux process descendants,
Cloudflare cancellation or network disconnect have been qualified by these tests.
Every public result retains activation `Blocked`. A future real adapter must
prove attempt/settlement semantics; a `running: false` field cannot invent them.

Task 3A covers this offline contract only. The Task 3B preparation below adds
approval inspection, not a live SDK/private binding or deployable Worker stack.

## Private Invocation And Offline Runner

The owner-selected design is authenticated Cloudflare Queue publication to a
private Worker, with independently verified signed, session-bound approvals.
The hosted ingress and dead-letter queues remain **proposed, not created**.
A separate guarded local-runtime stack now exercises Queue delivery and durable
inspection replay; it has no executor capability. See the
[local evidence and limits](../../docs/assessments/local-executor-invocation.md).
Public routes, workers.dev and previews stay disabled.
See [the design](../../docs/superpowers/specs/2026-10-24-private-executor-invocation-design.md).

The current message accepts only `InspectOfflineApproval` and calls the same
Ed25519 verifier as the CLI. It grants no executor capability. Publication is not
completion; at-least-once delivery requires durable deduplication before real
actuation. Status/export and cancellation valid through cleanup remain future
integration requirements. Do not connect Task 3A's process-local gate directly
to an at-least-once consumer and call it durable ownership.

```sh
bun --no-env-file probes/cloudflare-executor/scripts/run-hosted.ts \
  --dry-run --worksheet /absolute/path/session.json --approval /absolute/path/approval.json
```

The worksheet's exact bytes are signed with the domain prefix
`ceirean.hosted-executor.approval.v1\n`. The receipt contains `keyId` and the
hex-encoded Ed25519 signature. The trusted public key, account, operator, stage,
session and immutable input hashes come from a separate reviewed trust boundary,
never the worksheet or a `--trust` flag. No real trust policy is configured yet;
there is no signing CLI and no real private key is read/generated by this runner.

Exit 64 means unsupported syntax; 1 means refused input/approval; 2 means a
blocked dry-run. A configured synthetic match reports approval `Matched`, not
hosted approval or deployment readiness. No report or exit value can enable
execution. Missing/malformed/oversized inputs are sanitized and refused; each
file is limited to 64 KiB. Final-component symlinks and partial reads are refused;
parent-directory containment is not claimed. BOM-prefixed JSON is refused without
silently stripping bytes before signature verification. The runner has
no send, execute, build, deploy, HTTP endpoint or credential-loading mode, and
accepts no allocator/transport capability. It never forwards an environment.
Always use `--no-env-file` so Bun does not load dotenv before program startup.

Metadata checks reject mismatched pins, arbitrary commands, unresolved images,
expired/overlong windows, insufficient cleanup reserve, expanded caps, excessive
allowances and unconfirmed prior cleanup, even if signed. Known base/helper and
toolchain image digests cannot masquerade as the final executor. USD 5 is an
operator stop allowance, not an enforceable provider spending cap. Actual image
provenance, file integrity and caps still need qualification; hashes are not proof
of verified payloads. [Measured scope](../../docs/assessments/hosted-executor-invocation.md).

## Activation Gates

The [Linux dependency inventory](../../docs/assessments/frozen-linux-dependencies.md)
freezes 661 unique registry URL/integrity pairs from independently hash-pinned
Bun/npm/browser snapshots. Its read-only `check-dependencies.ts --check` exits 2
with activation blocked. Registry artifacts, cache materialization, native and
packed-consumer acceptance remain separate; no resolver runs in that check.

Offline source/harness preparation now produces local candidate archives from
the pinned historical Git tree, with byte identities, original executable modes
and a source-only browser harness. See [scope, commands and remaining gates](../../docs/assessments/offline-executor-inputs.md).
The harness lists four cases but refuses actual execution before browser launch.
Its installed dependency closure, consumer caches, extraction and actual browser
acceptance remain pending; these candidates do not change the baseline manifest
or authorize source transfer, image build or hosted activation.

Private authenticated operator invocation and the final executor image digest
remain independent blockers, alongside pending payloads, offline acceptance,
Chromium sandbox viability, provider limits and the session approval worksheet.
Image-build approval binds reviewed recipe/input hashes and the trusted builder;
it does not authorize hosted deployment or execution.

Local integrity-checked cache candidates now contain the frozen registry blob
set and private npm content/metadata cache, with size budgets and no-lockfile
offline metadata replay. See [evidence, commands and limits](../../docs/assessments/integrity-checked-cache-candidates.md).
These are not extracted Bun caches, Linux installation or browser acceptance;
preparation payload fields stay pending and hosted activation remains blocked.

See [the implementation plan](../../docs/superpowers/plans/2026-10-24-hosted-executor.md)
and [preflight](../../docs/assessments/hosted-executor-preflight.md).

## Primary Metadata

Reviewed 2026-10-24; metadata pins are not executed runtime evidence:

- [Node release index](https://nodejs.org/dist/index.json)
- [Node image](https://hub.docker.com/v2/repositories/library/node/tags/22.23.4-bookworm-slim)
- [Bun image](https://hub.docker.com/v2/repositories/oven/bun/tags/1.3.11)
- [Playwright package](https://registry.npmjs.org/playwright/1.64.1)
- [Playwright image manifest](https://mcr.microsoft.com/v2/playwright/manifests/v1.64.1-noble)
- [Browser versions](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/browsers.json)
- [Sandbox helper](https://hub.docker.com/v2/repositories/cloudflare/sandbox/tags/1.0.3)
