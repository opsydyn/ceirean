# Linux Cache Rehearsal Preflight

**The bounded cache-only rehearsal ran and refused before installation.**
Linux amd64 ran through QEMU on the default aarch64 Colima VM, not a physical
amd64 host. No package installer or repository script ran. Image builds/publication,
browser/app checks, provider calls, webhooks/public routes and hosted activation
remained blocked.

## Runtime And Scope

At initial preflight, both Colima profiles (`default`, `eh-containment`) were stopped. Default
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

## Approved Contained Attempt

The owner approved inert numeric UID/GID metadata only for the verified non-root,
capability-dropped worker, output ownership checks, temporary default-VM startup
and the two fixed tool images. The authority is derived from `/proc/self/status`,
not environment/arguments: all four UIDs/GIDs are 1000, all capability sets zero,
and NoNewPrivs is 1. A process-local WeakSet refuses forged authority objects.
The default archive policy still refuses nonzero IDs; names and every other
path/link/mode/size/checksum rule remain unchanged. Nothing restores ownership.

The default VM ran from 21:47:51 to 22:03:34 UTC on 30 October, before the fixed
22:12:51 cleanup deadline. The pinned Bun image was acquired; Node was already
cached. Isolated tool readbacks were Bun 1.4.3, Node v22.23.4 and npm 10.9.9.
The worker ran as 1000:1000 with network `none`, all capabilities dropped,
no-new-privileges, read-only root, 2 CPUs, 3 GiB RAM, 128 PIDs and a 720-second
outer timeout. Inputs/tools were read-only named volumes, work was writable;
there were no host/socket/credential mounts or published ports. Staging alone
used a temporary CAP_CHOWN helper on the empty work volume, never an installer.

The worker started at 21:59:50 and exited 1 at 22:01:48. It admitted **240/909**
archives, stopping at **`@types/argparse@1.0.38`**. The unchanged archive SHA-256 is
`00756b3f06b5c1a50b9508fd57f190afbc712cd29e453164e12654b083056b4c`.
Read-only `tar -tvzf` shows four regular files rooted at `argparse/`, not the
required literal `package/` root. Numeric ownership is zero. This is the next
archive-layout policy incompatibility, not an installer or Cloudflare failure.
Counters including the refused prefix: 289,712,680 compressed bytes,
1,004,941,385 expanded bytes and 23,583 entries. No cache was materialized.

Retained local evidence:

- `/private/tmp/ceirean-linux-214751-evidence/result.json`: CacheOnlyFailed,
  phase ArchiveAdmission, qualified false, activation Blocked. The sanitized
  reason is UnclassifiedFailure; the container log supplies the refused identity.
- `/private/tmp/ceirean-linux-214751-controls.json`: launch controls (captured
  while running, not shutdown evidence), SHA-256
  `a7d1c45a0e277635e21ff72f156eefcca3a36f35cb38cacc1ddbaf8e58752d58`.
- Executed worker bundle SHA-256
  `0f930bff4a810a5e5b8aec7be0fab1dfa146788ef7dd4c6fb9018b385d0d46c6`.

Both lease containers and all three exact lease volumes were removed. No unrelated
container was running; existing stopped resources were left untouched. `colima list`
confirmed default and eh-containment stopped; the independent watchdog exited 130
after confirmed manual shutdown. Acquired immutable images remain cached.

Independent review identified pre-write workspace admission and failure-evidence
ownership gaps, plus cleanup defects bypassing typed-error reporting. These were
repaired and regression-tested offline; the executed bundle hash above is
the earlier attempt, not native evidence for subsequent source changes. The new
tests are registered in both standard baseline-preparation task lists. Unrelated
observer experiments and their suppression comments are excluded from this slice.

Next bounded work: test-first admission of legacy single-top-directory npm layouts,
without changing authenticated bytes or allowing traversal, mixed roots, links or
special entries. That policy change and another VM run need separate approval.
The worker's Bun path currently verifies the unchanged lock and output ownership,
but reports installed identities as unchecked; complete identity readback remains
required before claiming cache qualification. The npm path checks lock-selected
installed identities. Neither path reached installation in this attempt.

## Verification

710 tracked executor/new-preflight tests passed, 0 failed, across 62 files and
28,725 assertions. All 12 workspace typechecks and strict lint/format passed.
Full test log: `/private/tmp/ceirean-linux-preflight-tests-final.log`.
This proves the local compatibility/security fixes and command/preflight contracts,
not Linux cache materialization or the app/browser baseline. Unrelated observer
experiments remain excluded; no merge or push is part of this slice.

Contained-worker follow-up: **734 executor tests passed, 0 failed**, across
64 files and 29,461 assertions, including 100 seeded inert UID/GID cases and
18 worker tests. Root admission precedes writes; owner-bound exclusive no-follow
evidence writes refuse replaced directories. Full-exit reporting observes cleanup
defects and external interruption after finalizers; a joined, interruptible owned
child bounds evidence I/O without inheriting the parent's pending interrupt.
No new native boundary or lint suppression was added.

All 12 workspace typechecks, strict lint/format and the other workspace test targets
(12 Moon tasks including the native operator-test dependency) passed. Logs:
`/private/tmp/ceirean-linux-live-tests-verified.log` and
`/private/tmp/ceirean-linux-other-workspace-tests.log`. Independent follow-up review
found no residual important finding in the repaired boundary. These are local
code/contract results; no second VM run, cache success or hosted readiness is claimed.
