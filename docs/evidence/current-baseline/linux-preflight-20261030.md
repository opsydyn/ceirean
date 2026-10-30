# Linux Cache Rehearsal Preflight

**Native rehearsal has not run.** No VM/container was started, no image acquired,
no package installed and no repository script executed. Image builds/publication,
webhooks/public routes and hosted activation were not changed.

## Runtime And Scope

Both existing Colima profiles (`default`, `eh-containment`) were stopped. Default
is configured for aarch64 with 2 CPUs, 4 GiB RAM and a 20 GiB disk. Both Docker
endpoints were unavailable; the named endpoint was retried outside the filesystem
sandbox to distinguish access denial from a stopped daemon. Image availability
is unknown. The separate eh-containment profile must not be repurposed.

The owner was asked for bounded default-VM startup, acquisition of only the
already-pinned Linux amd64 Bun/Node images if absent, and cleanup/VM shutdown.
That VM-only question was superseded by the combined ownership-policy/rehearsal
question after the archive preflight revealed the restriction below. Neither
activation nor the requested policy change has been inferred from silence.

`src/current-linux-cache.ts` records the fixed **command plan**, not an executable
runner: Bun 1.4.3, Node 22.23.4, npm 10.9.9, Linux x64; frozen installs with scripts
off and copyfile backend. Loopback is used only for warm-up; the fresh case must
use the default registry configuration after replay stops. Success with the
loopback setting alone would not prove the real baseline can consume the cache.

## Read-Only Archive Preflight

```sh
cd probes/cloudflare-executor
bun --no-env-file --no-install scripts/check-current-archives.ts --inspect /private/tmp/ceirean-current-offline-Rg2onJ
```

The compiled inventory pin is
`940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed`.
Each compressed file is independently checked for regular single-link ownership,
size, SHA-512 SRI and SHA-256 before the existing streaming parser sees its bytes.
The operation writes no output or extracted file and has a five-minute deadline.
Exit 1 is input/policy refusal, 2 is data inspection only, and 64 is invalid argv.
It cannot start an installer, VM, listener, build or hosted run.

Host-only inspection exposed and fixed compatibility defects:

- `@adobe/css-tools@4.5.0` omits UID/GID. Absent IDs are not nonzero ownership
  metadata and are now accepted; nonzero IDs remain rejected.
- `@ag-ui/client@1.0.2` uses another valid octal width/padding format. Numeric
  fields must contain only complete octal digits followed by spaces/NULs and
  retain the library codec's numeric value. Every other header byte remains exact.
- `@alchemy.run/acme@2.0.0-beta.84` leaves device-number fields absent. Empty and
  zero are accepted as equivalent, but a nonzero wire field cannot be erased by
  codec normalization. Nonzero directory sizes remain rejected for the same reason.

Independent review found a checksum-width ambiguity in the pinned decoder: its
`header.js` reads 12 bytes at offset 148 although the checksum field is eight
bytes. A crafted checksum could consume the following typeflag and falsely
validate. Admission now independently parses exactly bytes 148–155 and compares
them to the raw unsigned header checksum. A reproducing fixture observed RED then
GREEN; 300 seeded checksum-ambiguity cases also pass. No library declaration
exception or unchecked cast was introduced.

Traversal/ambiguous paths, links, special files, nonzero ownership, setuid modes,
unsupported extended headers, numeric junk, malformed/truncated tar/gzip, CRC,
padding/EOF errors and the original finite budgets remain refused.

## Concrete Stop

After these fixes, fresh read-only preflight admitted **94 of 909** archives and
stopped at **`@emmetio/stream-reader-utils@0.1.0`**. Its first regular-file header
(`package/package.json`) records **UID 501 / GID 20**. It is a correctly
checksummed ordinary header, but the accepted policy explicitly rejects nonzero
ownership metadata. This is a policy decision, not a broken Cloudflare deployment.

Retained report: `/private/tmp/ceirean-linux-archive-preflight.json`.
Partial counters include the refused archive's consumed prefix:
105,587,053 compressed bytes, 503,887,935 expanded bytes, 14,002 entries. These
are not complete inventory or extraction/native-install evidence.

Proposed owner decision, **not implemented**: allow inert numeric UID/GID metadata
only inside a non-root, capability-dropped installer with no ownership restoration,
verify resulting file ownership, and retain all path/link/mode/size/checksum rules.
Raw bytes/SRI must remain unchanged; do not omit, repack or silently rewrite the
package to get a passing result. Native worker implementation/execution remains
pending that decision and runtime authority.

## Verification

710 tracked executor/new-preflight tests passed, 0 failed, across 62 files and
28,725 assertions. All 12 workspace typechecks and strict lint/format passed.
Full test log: `/private/tmp/ceirean-linux-preflight-tests-final.log`.
This proves the local compatibility/security fixes and command/preflight contracts,
not Linux cache materialization or the app/browser baseline. Unrelated observer
experiments remain excluded; no merge or push is part of this slice.
