# Current Linux Cache CI Preparation

Status: owner approved local implementation on 31 October 2026. No workflow publication, source push,
input retrieval, image pull, CI dispatch, image build or hosted activation is
authorized by this document. Cloudflare remains the product execution destination;
CI supplies the missing Linux-native cache evidence and reusable seed.

## Outcome

One manually authorized ephemeral Linux amd64 job runs the existing current
cache-only worker, returns a reviewable result and, on success, retains its sealed
Bun cache for later Cloudflare image preparation. It does not run repository
scripts, the 16-check baseline, browsers, Flue, model providers or deployment.

## Chosen Handoff

The owner selected pinned public-source retrieval, not a private uploaded capsule.
The FoldKit revision is exactly `be0427e2aba2cf951ef4dbbbe9296e307ed41ad3`, with
the existing tree, lock and source-inventory hashes unchanged. The local branch
`codex/foldkit-sandboxed-baseline` currently points to it. Later publication must
explicitly approve making that exact revision reachable on a qualification branch;
it must not merge it to FoldKit main or publish another branch tip accidentally.

CI anonymously fetches the approved object, verifies its SHA/tree and reconstructs
only its admitted files. No checkout hooks, submodules, LFS smudge, target Git
credentials or mutable default branch are used. An unavailable object refuses.

Promote the existing portable 909-artifact inventory to a reviewed fixture,
preserving its exact SHA-256 `940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed`.
Re-derive the requested set from the accepted source and frozen npm snapshot, then
compare with that fixture. Download only its frozen URLs; verify size, SHA-256 and
SHA-512 SRI. Recreate npm content/metadata from those blobs and the existing frozen
snapshot without refreshing metadata or resolving versions. Fresh retrieval must
not fabricate the original local preparation receipt or claim 897 local reuses.

## Job Shape

- Prepare an inactive `qualification/current-linux-cache.workflow.yml` template,
  not an active `.github/workflows` file. Manual dispatch only, no dispatch inputs,
  push/PR/schedule/reusable triggers, retry, self-hosted or fallback execution.
- Use one ephemeral `ubuntu-24.04` amd64 runner. Read back actual architecture,
  runner image, Docker and available capacity; the runner label is not an immutable
  image identity. Freeze the reviewed Ceirean implementation SHA before publication.
- Keep contents-read permissions only, no secrets/OIDC or Actions cache restoration.
  Host preparation may fetch public pinned tools and data. No consumer receives
  Actions tokens, credentials, host checkout/home, command files or Docker socket.
- Reuse the pinned Bun 1.4.3 and Node 22.23.4 images and npm 10.9.9, without an image
  build. Controller Bun 1.4.2/tool acquisition remains separately pinned. An unresolved
  immutable tool identity blocks publication, not a fallback to ambient binaries.
- Adapt the current preparation paths deliberately for Linux. Stage verified source
  files directly from Git blobs; this cache-only worker does not require a source tar
  extraction or the browser harness. Do not revive the historical observer/controller
  qualification programme or invent another manifest transport.
- Run the current worker as 1000:1000, network none, cap-drop ALL, no-new-privileges,
  read-only root, two CPUs, 3 GiB memory, 128 PIDs, no ports/devices and three owned
  named volumes: read-only inputs/tools and private writable work. The fixed staging
  helper may initialize ownership of the empty work volume; it never runs package code.

## Execution And Bounds

1. Trusted host preparation verifies source, controller/tool capsule and the frozen
   input inventory before starting the consumer. No target-package tarball is
   extracted on the runner; separately pinned controller tools are trusted
   preparation inputs. Acquisition finishes before the consumer starts.
2. The consumer obtains genuine Linux ownership authority, inspects all archives,
   warms Bun through verified loopback replay, closes replay, seals/copies the cache,
   and reinstalls fresh with default registry settings and no external network.
3. Reuse the current installed-identity audits and all four offline npm profiles.
   Scripts stay disabled. Phase-owned scratch may be removed after its audits and
   cache/source checks, reducing peak disk without weakening any comparison.
4. Stop the consumer before exporting results or the sealed seed. Independently
   verify stopped/removal state; failures, cancellation and deadlines also clean up.
   Never prune unrelated containers/images/volumes or remove arbitrary runner files.

Proposed bounds: a 30-minute job; public acquisition capped at eight minutes;
the worker's existing 15-minute execution deadline inside a 16-minute outer wall
limit; two-minute cleanup reserve. The controller must leave time for bounded
evidence export and never extend deadlines or retry automatically.

Before retrieval, compute capacity from the frozen inputs, cache limits, copies and
export allowance. Check actual free space and refuse insufficient capacity; do not
pretend the standard runner has a guaranteed disk size. Preserve the current 2 GiB
seed/200,000-entry limits. Bound the successful compressed seed export to 1 GiB.

## Evidence And Seed Retention

Return fixed, sanitized result/control/cleanup JSON plus digests and bounded logs,
within a 4 MiB evidence budget. Failure evidence is retained after cleanup; missing
evidence or uncertain cleanup cannot pass. Do not forward raw child output as
workflow commands or discover artifact paths from untrusted stdout.

The worker must persist the canonical `CacheEntry` inventory and `CacheModesV1`
descriptor before exit, binding their exact digests to its result. Its current
process-local WeakMap seal and digest-only result are not a durable handoff.

For portability, use the existing verified case-copy transformation to normalize
internal links to relative targets, then seal that portable copy inside the live
worker. Bind both the original materialized-seed digest and portable-seed digest;
they may differ after link normalization. The fresh positive install consumes an
independent copy of the portable seed and verifies it unchanged afterward, so
the artifact being retained is the one whose consumption was actually tested.

After stopping the worker, export that portable seed and complete descriptor as a
separate fixed-name archive, including hidden entries without following links.
Re-read and compare all content, mode, link and inventory hashes against the
persisted descriptor and result. Reject absolute or escaping links in the portable
output, rather than silently relocating them during host export. No archive owner
IDs are restored. Later intake must verify again in a fresh owned filesystem and
establish new file identities; deserializing the descriptor never recreates an old
WeakMap capability or substitutes for scanning actual bytes and metadata.

Retention is mandatory for an accepted job: oversize output, export/readback or
artifact-upload failure prevents a pass. Failure diagnostics may still be retained
without a seed, but cannot be presented as successful materialization. Never upload
source, workspaces, node_modules, environment, secrets, runner home or arbitrary
consumer paths. Proposed retention is seven days through SHA-pinned artifact actions.
Uploads remain part of the separately approved CI run, not local preparation.

Acceptance requires the fixed runtime/source identities, all 909 authenticated
archives, both Bun identity summaries, four npm results, verified seed export,
zero-exit worker and independent cleanup. A pass is cache-only evidence, not the
baseline/browser result, a final Cloudflare image or hosted readiness.

## Local Deliverables And Separate Gates

Local implementation: thin tested Linux preparation/supervision adapter, frozen
portable inventory, inactive workflow template, run worksheet and runbook. Use
Effect services, existing parsers/cache machinery and universal lint rules; any
new native boundary needs its own explicit review.

After local verification and commit, stop for source-branch/workflow publication
approval. Verify published identities without dispatching. Then obtain approval
for one bounded CI attempt and its retrieval/artifact scope. Cloudflare image build
and activation remain separate later gates, even after a CI pass.
