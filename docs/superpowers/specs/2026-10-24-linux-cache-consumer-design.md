# Standalone Linux Cache Qualification

2026-10-24. **Design draft for owner approval.** Based on Ceirean
`9a83e0c498589c10f8577efc07abdb10d0a19f3a`.

This document authorizes no implementation, workflow publication, CI run,
consumer execution, image pull/build/publication or Cloudflare activation.
The current hosted approval policy remains `Option.none()`. Alchemy migration
stays paused. A successful future qualification never enables the hosted executor.

## Intent

Prove that the pinned historical FoldKit workspace can obtain a fresh dependency
installation from a reproducible Linux Bun cache, without executing its scripts
or reaching an external network. Detect missing inputs and cache contamination
before attempting application builds, browser evidence or a final executor image.

The owner selected standalone, credential-free Linux CI qualification rather
than combining it with the final executor image build. Root Bun installation is
the first slice. The controls and numeric limits below are author proposals, not
previously approved execution permissions.

## Existing Evidence And Limits

- Historical source: `opsydyn/fold-kit-experiments`, revision
  `b7484cb46e66b162c8afddcfba235c9507b4f0ab`, tree
  `8fcd5b7960541679a163dcbfbf60393e1e256241`.
- The source reader checks Git tree membership and blob bytes; it never imports
  consumer code. Its macOS `/private/tmp`, `/usr/bin` and BSD tar assumptions are
  not yet a qualified Linux entrypoint.
- The frozen inventory has 661 distinct registry tarballs, including a conservative
  Linux candidate set rather than an exact installed closure. GNU and musl entries
  can coexist because the historical Bun lock lacks libc selectors.
- The local candidate verifies 307,879,445 tarball bytes and 64 minimal npm metadata
  documents. Three inert npm profiles replay under controlled local tools.
  Those packuments do not cover root Bun or browser-harness resolution.
- Inventory SHA-256:
  `d416b758e7410ad2069120b58df9272bed86c4ef9d24a3088d4904e46d7308cb`.
- No Bun cache layout, Linux consumer install, safe archive extraction, native
  postinstall, browser runtime or final executor image is qualified.

The target repository was observed public through GitHub's read API on
2026-10-24. Visibility is rechecked before an approved run; it is not permission
to transfer or execute its contents. Do not upload the current macOS temporary
candidate or use a developer's checkout as the Linux source of truth.

## Approaches

| Approach                                               | Benefit                                                                                  | Cost / Decision                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Standalone ephemeral Linux CI qualification            | Isolates cache/input failures from image and hosting failures; no Cloudflare credentials | Selected by owner. Requires its own bounded run approval and runtime evidence     |
| Fold qualification into the final executor image build | Tests closer to the eventual image in one operation                                      | Not selected: combines cache, build and image-publication authority too early     |
| Revive local Colima or rely on macOS fixtures          | Potentially convenient during development                                                | Not selected: local VM effort was rejected; macOS cannot establish Linux behavior |

## Goals And Non-Goals

Success means a new Linux workspace, with no installed dependencies, can complete
the qualification-specific frozen Bun install from a sealed native Bun cache.
It also means absent/corrupt artifacts, unsupported extraction, hidden scripts,
outbound attempts and cross-case cache mutations cannot be reported as success.

Out of scope: application check/typecheck/test/build, Storybook, generated npm
consumers, `bun x tsc`, browser-harness installation, Playwright/Chromium execution,
native postinstall/fallback downloads, final cache delivery archives, final image
construction, GitHub writes to the target repository, live invocation or deployment.

Do not change the historical source, dependency versions, frozen lock, platform
selectors or existing command pins to make this job pass. Do not remove optional
dependencies or use `--production` as a shortcut. Discovery of a new input produces
a blocked receipt and a separately reviewed inventory change, never a live fetch.

## Trust And Job Structure

Proposed execution venue: one ephemeral GitHub-hosted `ubuntu-24.04` amd64 job in
Ceirean, manual dispatch only. No push/PR/schedule trigger, reusable external
caller, `pull_request_target`, automatic retry or self-hosted fallback. Exact
workflow/actions/tool identities are frozen during implementation planning and
must be reviewed before workflow publication. An unresolved pin blocks execution.

The trusted host controller may check out the approved Ceirean revision and
retrieve public pinned inputs. Its GitHub token is limited to repository contents
read; checkout credentials must not persist. No secrets, OIDC, package publication,
GitHub App key, Cloudflare token, SSH agent or developer dotenv is requested.
GitHub job credentials still exist on the runner: "credential-free" describes
the consumer compartment, not an assertion that GitHub has no control-plane token.

The consumer compartment gets only explicitly listed, read-only inputs, an
allowlisted environment and fresh writable scratch. Never mount the checkout,
`.git`, the runner home, host environment, Actions command files, Docker socket,
package-manager configuration or any operational `.local` state. Host retrieval
finishes before the consumer starts; it is not a proxy available to the consumer.

All Docker control remains in the trusted host controller. The workload cannot
allocate a second container or reach the host Docker API. A container is a bounded
qualification compartment, not proof of Cloudflare's isolation model.

## Runtime Inputs

The installer uses the existing Linux amd64 Bun 1.3.11 image identity:
`docker.io/oven/bun@sha256:38919894db4e117a37f74e3dca503e84f24d97f19cabc5f499a289c2a5d0db7c`.

The trusted in-container harness uses Node 22.23.4 from the existing identity:
`docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09`.
The host copies only the fixed Node executable from a created, never-started
container into a read-only tool capsule. No Dockerfile or image build is required.
Record manifest/config identities, executable digest, platform and provenance.
If the Node binary cannot run against the Bun image's libc, block: do not install
libraries, change images, or fall back to the runner's ambient Node.

The Ceirean-owned harness is bundled for Node from reviewed source and the exact
Effect 4.0.5 cohort. Use the existing pinned npm distribution's tar parser where
appropriate, not a new archive-format implementation. No dependencies are resolved
inside the consumer. Its tool capsule has a reviewed file inventory and digest.
Controller Bun 1.4.2 and any bundling/tool dependencies are separate from installer
Bun 1.3.11; their missing immutable acquisition pins must be resolved in the plan.

Before inputs are interpreted, read back Linux, x86_64, glibc, Bun 1.3.11 and
Node 22.23.4. Capture the actual runner image/version and Docker version, but do
not pretend `ubuntu-24.04` identifies an immutable VM image. No npm consumer runs
in this slice, so npm 10.9.9 remains a provenance pin rather than new install proof.
Git verifies source outside the compartment; no consumer Git runtime claim is made.

## Data Flow

### 1. Retrieve And Verify, Without Consumer Execution

The trusted controller retrieves the fixed public Git revision anonymously in a
new bare repository, with hooks/config/replacements/lazy fetching disabled where
applicable. Use the existing independently pinned tree and blob-validation model.
Port tool locations/temp paths deliberately for Linux; do not invoke the macOS
tar adapter or treat a source archive's self-declared hash as its own authority.

Recreate raw artifacts from the frozen GET allowlist, using the existing redirect,
SHA-512, SHA-256 and size rules. No ambient/global cache or cross-run Actions cache
is restored. No npm metadata refresh or new version resolution occurs. Private
target visibility or inaccessible history blocks the run instead of adding tokens.

The controller stages a source file set, raw verified blobs, frozen input/catalog
bytes and trusted harness. It does not unpack third-party tarballs on the runner.
All supplied hashes are checked against the approved source/catalog or tool
provenance, not just against a manifest supplied alongside the same bytes.

### 2. Validate Extraction And Script Suppression First

Inside the isolated compartment, validate tarball entries with a proven streaming
parser before Bun sees them. Enforce compressed and expanded limits while reading,
not after allocation. Reject absolute/traversal/ambiguous paths, duplicate or
conflicting destinations, special files, ownership/setuid metadata, links and
unsupported extended headers. Initial policy admits directories and regular
files only. A legitimate package needing another entry type blocks for a reviewed
policy change; never omit that package or silently discard its entries.

Exercise synthetic traversal, symlink/hardlink escape, duplicate, malformed-header
and expansion-bomb fixtures before historical packages. No fixture can create a
file outside its owned root. This proves the adapter policy on these cases, not
that every future tar implementation is safe.

Then run inert fixtures containing root and trusted-dependency lifecycle canaries.
`--ignore-scripts` must leave every marker absent. Non-allowlisted child execution,
native helper execution or a canary marker invalidates the case. Verify exact
1.3.11 flags/optimizations against the pinned runtime; current Bun docs alone do
not establish behavior. A failed canary stops before the real source is installed.

### 3. Let Bun Materialize Its Own Cache

Author proposal: use a fixed, private loopback replay origin,
`http://127.0.0.1:4873`, inside the network-none compartment. The trusted Node
harness serves only GETs mapping exactly to frozen registry tarball paths and
verified bytes. No forwarding, redirects, upload, arbitrary file path or metadata
lookup is allowed. Bind loopback only; never publish a container/host port.

The first dataset is tarball-only. A request for a packument, unrecognized path,
different method or absent blob fails immediately and records a bounded missing
input category. Do not turn the current 64 npm packuments into an invented Bun
metadata closure. If Bun's frozen install needs more metadata, stop with
`BlockedMissingBunMetadata`; adding that dataset is a later reviewed change.

Bun 1.3.11 warms its native cache by installing the exact source in a disposable
workspace using the qualification command below and that fixed registry origin.
Capture cache layout from the resulting filesystem; never synthesize cache
directory names from package names/versions or assume prerelease hash conventions.
All consumer scripts stay disabled. Warm-up dependencies are deleted with the
owned workspace, not reused as evidence for the fresh-install case.

This origin convention is a deliberate author choice. The replay/warm-up and
offline case use the same registry configuration so cache namespace differences
are explicit. It is **not** default `registry.npmjs.org` cache-key parity and cannot
be copied into the final executor without approving the same convention or
separately qualifying default-origin materialization.

### 4. Seal, Clone, Stop Replay, Install Fresh

Seal the materialized cache with a content/mode/path inventory and SHA-256 root
digest, excluding no opaque state without a documented rule. Validate any cache
links remain inside the admitted cache; reject special files or escapes. This
cache-link policy is separate from raw tarball entry admission.

Keep the sealed seed read-only. Each case receives a physically separate cache
copy, never hardlinks to the seed or another case, plus a fresh workspace copied
from validated source files. The cache copy may be writable for Bun's bookkeeping.
The seed is rehashed after each case. Require `--backend=copyfile`, then verify a
controlled installed-file mutation cannot change the case cache or seed. Verify
that the option exists and is effective in pinned Bun; do not silently drop it.

Stop and confirm termination of the loopback server before the positive offline
case. No server, retrieval callback, inherited download cache or existing
`node_modules` may make an incomplete cache look complete.

The qualification-specific argv is:

```text
bun install --frozen-lockfile --ignore-scripts --backend=copyfile \
  --registry=http://127.0.0.1:4873
```

Use a fresh isolated HOME/TMPDIR and explicit `BUN_INSTALL_CACHE_DIR` per case.
No blanket host environment or inherited config is forwarded. Assert no source
dotenv, package config or host cache has been introduced. Do not rely on
`--offline` as the enforcement boundary; external networking is denied by the
namespace and the replay listener is absent. Confirm the listed flags on 1.3.11
before running source; an unsupported flag blocks, not a fallback command.

This is not the unchanged historical `pins.ts` install operation: script
suppression, registry convention and copy backend are qualification-only changes.
Existing baseline argv/pins remain untouched and unqualified by this result.

## Isolation And Proposed Bounds

Docker setup must read back and test: `--network=none`, read-only root filesystem,
explicit unprivileged UID/GID, dropped capabilities, no-new-privileges, no extra
devices, no host PID/IPC namespace, no published ports and no Docker socket.
Only loopback exists for warm-up; the server must be absent for offline cases.
Credential-free network/DNS/raw-TCP negative probes use controlled targets and
must fail; flag inspection alone is not execution evidence.

Writable source/cache/workspace areas are fresh, bounded tmpfs, with noexec,
nosuid and nodev. Only the immutable trusted tool capsule is executable. Noexec
does not prevent a trusted interpreter reading a script: lifecycle suppression
and the fixed harness command allowlist remain necessary. Never claim it is a
general untrusted-code sandbox. Test effective mount/security settings first.

| Bound                         | Proposed ceiling                                      |
| ----------------------------- | ----------------------------------------------------- |
| Whole GitHub job              | 15 minutes, one job, no automatic rerun               |
| In-compartment qualification  | 9 minutes; 90 seconds per command                     |
| Cleanup grace                 | 30 seconds before forced stop/removal and readback    |
| Worker CPU / memory / PIDs    | 2 CPUs / 4 GiB, swap limit equal to memory / 128 PIDs |
| Combined writable tmpfs       | 3 GiB; smaller per-mount limits sum to this cap       |
| Raw artifact limits           | Existing 64 MiB each / 512 MiB total                  |
| Expanded package / entry      | 256 MiB / 192 MiB                                     |
| Total expanded package bytes  | 2 GiB across the approved artifact set                |
| Package entries / all entries | 10,000 / 200,000; paths at most 512 bytes             |
| Exported evidence             | 16 MiB total; 256 KiB per stdout/stderr stream        |

These are proposed fail-closed ceilings, not observed resource requirements.
Tmpfs usage counts toward memory, so size caps do not add RAM. Preflight must
verify runner entitlement, available memory/storage, effective controls and
billing allowance before work. Exceeding a cap reports blocked/incomplete and
requires a revised approval; no automatic increase or less-isolated fallback.

The host controller alone may perform trusted retrieval/image pulls before the
worker starts. Fixed public image pulls are future run authority, not permission
to build/publish an image. No user-controlled OCI reference, argv, environment,
source revision, registry URL or resource cap is accepted from dispatch inputs.

## Required Cases And Evidence

| Case                        | Required observation                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime/isolation preflight | Exact runtime identities and tested effective controls, otherwise no source execution                                                |
| Archive admission negatives | Invalid/oversized archives refused before extraction can escape or exceed limits                                                     |
| Script canaries             | Root/trusted dependency markers absent; unexpected child/native execution refuses                                                    |
| Warm-up                     | Only inventoried replay GETs, exact source/lock unchanged, native cache inventoried                                                  |
| Fresh positive              | No initial node_modules; replay stopped; fixed install exits 0 from its cache copy                                                   |
| Empty cache                 | Fresh workspace + empty cache fails; it cannot borrow seed/node_modules or fetch                                                     |
| Missing required artifact   | Remove a demonstrated, directly required nonoptional package from a case copy; install fails                                         |
| Corrupt cache content       | Independently hash-admit the copy before use; mutation refuses before install rather than trusting Bun to revalidate extracted bytes |
| Isolation across two cases  | Distinct writable cache/workspace copies; mutation in one does not affect seed or next case                                          |
| Cancellation/deadline       | Supervisor stops all owned processes/containers and confirms removal, including interrupted warm-up                                  |

Inventory actual installed identities and workspace links against the frozen
lock/platform, allowing only explainable platform exclusions. Record which of
the conservative GNU/musl candidates were actually used; do not require all 661
tarballs to appear in node_modules. A source or lock hash change, unexpected
identity, missing direct dependency or unexplained skip invalidates success.

Do not import installed JS, execute package binaries, run native version probes,
build/test the consumer or start a browser to inspect installation. Read bounded
package metadata and link targets as data. Native usability remains unqualified.

The receipt binds the approved Ceirean revision, source SHA/tree, frozen inventory,
tool/image/harness identities, registry convention, effective limits, runner/run
identity, case observations, source/seed before/after digests and cleanup evidence.
Logs are bounded/sanitized; uploaded evidence is a fixed allowlist of small JSON
receipts and diagnostic summaries, never source, node_modules, cache blobs,
arbitrary archive paths or runner environment. Proposed retention is seven days.

Root installation qualification may be `Passed`, `Failed` or `Blocked`; activation
is always `Blocked`. Only all mandatory cases plus confirmed cleanup can yield
`Passed`. Missing/truncated evidence, timeout, ambiguous container state or absent
receipt cannot be inferred as success. Expected negative cases must demonstrate
their intended refusal, not merely any unrelated startup failure.

A future CI harness exits 0 only for that narrowly defined qualification pass;
nonzero for failed/blocked/incomplete and 64 for unsupported invocation. Existing
offline preparation commands retain their current exit-2 blocked semantics.

## Approval And Delivery Gates

1. **Now:** review this design. No new functional code or workflow exists.
2. **After design approval:** write an actionable implementation plan; freeze
   missing tool/action pins, manifest/case contracts and synthetic negative tests.
3. **After implementation approval:** implement locally with TDD/property tests,
   universal lint rules and independent review. Workflow text stays outside active
   `.github/workflows` until publication is explicitly approved. Ordinary Moon
   tests remain offline/synthetic and cannot start Docker, CI or consumer installs.
4. **Separate publication approval:** publish only the reviewed manual workflow
   and controller code; verify its trigger/ref/permission restrictions.
5. **Separate run approval:** bind exact workflow/tool/source/input hashes,
   fixed cases, public retrieval/source staging, image pulls, time/resources,
   runner eligibility/billing allowance and cleanup owner in a qualification
   worksheet. No credentials reach the consumer. A job id is one attempt, not
   authority to retry after uncertain failure.
6. **After measured pass:** decide the next npm/browser/Bunx dataset or final
   cache-payload work. This does not advance Cloudflare private invocation,
   final-image, paid hosted-session or production rollout approval.

## Builder Discretion

The implementation plan may choose module/file names, exact approved action/tool
acquisition pins, fixed per-mount splits within the total budget, parser plumbing,
case ordering and stable diagnostic names. Use existing Effect error/schema,
inferred service and boundary patterns; preserve every lint rule. It may not
change the source, versions, registry convention, trust boundary, accepted archive
types, case meaning or resource ceilings without returning for design approval.

## Draft Review

A fresh, read-only builder check on 2026-10-24 reported "nothing important left".
That establishes planning clarity, not implementation verification or owner
acceptance. The branch contains documentation only. Repository lint/format and
local reference checks are the draft verification gates; runtime, container and
CI qualification are intentionally not run for this document.

## Primary References And Caveats

- [Pinned Bun 1.3.11 installer source](https://raw.githubusercontent.com/oven-sh/bun/bun-v1.3.11/src/install/PackageInstall.zig)
  includes backend selection. Source inspection is not Linux execution proof.
- [Bun cache documentation](https://bun.com/docs/pm/global-cache) describes native
  cache naming and Linux hardlinks; current docs are not the pinned version's
  compatibility contract.
- [Docker network-none](https://docs.docker.com/engine/network/drivers/none/),
  [resource/isolation controls](https://docs.docker.com/engine/containers/run/)
  and [tmpfs limits](https://docs.docker.com/engine/storage/tmpfs/) motivate the
  proposed controls; effective behavior still requires the stated run evidence.
- [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use)
  and [checkout credential behavior](https://github.com/actions/checkout) motivate
  least privilege and separating control-plane credentials from consumer inputs.

See [cache-candidate evidence](../../assessments/integrity-checked-cache-candidates.md)
and [the existing executor plan](../plans/2026-10-24-hosted-executor.md). Their
historical commands and hosted activation gates remain unchanged.
