# Current Linux Cache CI

Local preparation only. Nothing in this runbook authorizes publication, retrieval,
CI, Docker, image building or hosted activation. The inactive template is
[`qualification/current-linux-cache.workflow.yml`](../../qualification/current-linux-cache.workflow.yml),
outside `.github/workflows`. It unconditionally refuses before acquisition.

## Inspect Locally

```sh
bun --no-env-file --no-install probes/cloudflare-executor/scripts/current-cache-ci.ts --check
```

Exit 2 is prepared-but-blocked; 64 is unsupported argv. There is no run mode.
The native adapter and controller are implementation candidates, not Linux proof.
Use the [publication/run worksheet](../../qualification/current-linux-cache-run-worksheet.md)
for the concrete remaining gates, including the unresolved controller checksum and
operational entry. Do not copy the draft into Actions and remove its guard casually.

## Data And Ownership

`current-ci-inputs.ts` reads exact Git blobs, checks the original inventory hash,
and stages only admitted files with explicit modes. It recreates all 909 raw/npm
cache inputs from their frozen URLs, sizes, SHA-256 and SHA-512 SRI plus frozen
metadata. It reports 909 downloads and zero reuses, never the old Mac receipt.
No target tarball is extracted on the host; existing authenticated transport
limits and cancellation remain in force. The capacity floor is 16 GiB on both
the preparation and Docker data filesystems, not an assumed runner property.

The controller uses three owned named volumes and fixed digest-pinned Bun/Node
images. Its staging helper has only the capabilities required to initialize
volumes and runs fixed system commands, not repository scripts. Consumer
readback requires user 1000:1000, no external network, all capabilities dropped,
no-new-privileges, read-only root, 2 CPUs, 3 GiB RAM/swap, 128 PIDs and exactly the
three approved mounts. Inputs/tools are read-only; no host binds, sockets,
credentials, ports or devices enter the consumer.

The worker audits warm-up identities before releasing warm-up source, creates and
seals a relative-link portable seed, and tests its independent fresh copy.
Fresh and npm phase scratch is released only after its audits. The original and
portable seed hashes can differ. Neither serialized inventories nor a copied
WeakMap-shaped object confer authority.

The stopped-consumer export reads only the seed, descriptor and fixed result.
Fresh admission scans actual files/inodes/modes/links against the independently
expected descriptor digest. The gzip tar uses pinned npm's tar 7.5.22 without
`portable: true`, because that option changes readonly modes. Archive readback
checks actual data, modes, links, inventory and descriptor. UID/GID fields are
inert metadata: later intake must not restore ownership. Preserve the 2-GiB /
200,000-entry cache limits, 64-MiB descriptor, 1-GiB compressed seed and 4-MiB
diagnostic limits. Hidden cache entries are inside the verified archive.

Cleanup is joined on failure, timeout and cancellation, verifies exact owner
labels, attempts each owned resource and independently confirms removal. Unknown
cleanup prevents a pass. It never prunes unrelated resources or images. Export
or upload failure is failure, even after a zero-exit installer.

## Verification And Limits

```sh
moon run cloudflare-executor:current-ci-test --concurrency 1
moon run :typecheck --concurrency 1
bun --no-env-file --no-install run check
```

Set `CEIREAN_CURRENT_SOURCE_REPOSITORY` only for the optional local Git-object
staging test; it selects the object store, not a source revision. Tests use real
temporary files, fixed data, fakes, seeded properties and inspection-only child
processes. They do not run Docker, installers, Linux CI or source scripts.

Action identities were checked against upstream commit metadata on 31 October:
[checkout](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683)
and [upload-artifact](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02).
The official [Bun release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)
does not supply a verified checksum in this local record; it remains a blocker.

A future accepted CI result supplies a reusable cache seed for Cloudflare image
preparation. It does not demonstrate the 16-check baseline, browser journeys,
Flue migration, final image or hosted execution.
