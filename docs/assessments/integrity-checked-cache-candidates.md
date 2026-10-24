# Integrity-Checked Cache Candidates

2026-10-24. Local preparation only, following `be5a960`. Hosted activation stays
**blocked**. No consumer install/script, browser execution, source transfer,
image build, hosted allocation, merge or push is authorized by this slice.

## Candidate Contract

The frozen 661-artifact registry inventory remains the authority. Preparation
allows only exact canonical HTTPS npmjs GETs; it refuses redirects and non-200
responses. It has a 30-second per-request deadline and a 20-minute preparation
deadline. Already-started native filesystem writes settle before partial-directory
cleanup, so a stalled OS write can delay cancellation/return beyond that deadline;
this is not a process-kill or hard wall-clock guarantee.
Headers and actual streamed bytes are checked before buffering beyond the budget.
Every tarball must match its independent frozen SHA-512 before being persisted;
SHA-256 and byte sizes are recorded for later evidence.

Limits are 64 MiB per tarball, 512 MiB downloaded tarball bytes, 2 MiB per metadata
document, 16 MiB metadata total, and 1100 MiB/20000 entries/16 levels for candidate
storage. Failed or interrupted preparations remove their owned partial directory;
a cleanup failure emits an explicit sanitized unconfirmed-cleanup event.

The initial 32 MiB blob limit correctly refused the pinned workerd tarball at
36,641,282 bytes before body collection. Only the per-blob limit was raised to
64 MiB; aggregate and storage limits were not expanded. Sequential downloads keep
body-buffering memory bounded. Compressed bytes are never extracted here.

Candidates live in a newly owned mode-0700 temporary directory, not Git. It holds
`artifacts/NNNN.tgz`, a private npm `npm-cache/_cacache`, and `cache-manifest.json`.
The pinned npm 10.9.9 distribution's cacache 19.0.1 implements its own cache
format; a narrow declaration shim describes the methods used, without lint or
third-party declaration-check exceptions. No dependency upgrade was needed.

The verifier re-reads each raw blob and its content-addressed cache copy, checks
both hashes, verifies exact derived metadata content, and bounds the entire
candidate tree. It refuses symlinks and unsupported file kinds. A manifest cannot
redefine the trusted artifact set or bless changed bytes. Extra candidate files
are storage-bounded but not approved build inputs; archive/extraction admission
remains a separate gate. Cache checking is local/read-only at the semantic level;
it does not invoke npm or resolve dependencies.

## Offline Metadata Replay

Minimal deterministic packuments are projected from the seven independently
hash-bound inventory inputs, specifically the three pinned npm lock snapshots.
They preserve exact versions, registry URL/integrity and resolution fields,
including excluded-platform versions. They omit scripts and are **not** verbatim
registry responses. They are a qualification dataset, not new dependency choices.
The generated profile keeps Vite 8.3.1 rather than the Bun workspace's 8.0.13.
These three metadata profiles do not cover a browser-harness install or Bun's
complete registry metadata needs; their verified raw tarballs alone do not imply
that either package manager can yet install every consumer fully offline.

Replay starts each inert profile in a fresh owned directory with **no lockfile**.
Only `npm install --package-lock-only --offline --ignore-scripts` runs, with audit,
funding and notifications disabled, exact Linux/x64/glibc flags and isolated
HOME/config/cache. The complete resulting selected/excluded/local inventory must
match its independently pinned snapshot. No installed `node_modules` is allowed.
Empty-cache and missing-Vite negative controls must refuse rather than falling
back to the network or accepting a different graph.

A trusted Node preload tripwire exits 76 before standard HTTP(S), TCP/TLS, UDP or
DNS entrypoints can connect. Direct HTTPS/TCP/DNS tests verify this refusal.
Together with npm's offline mode this observes local metadata replay, **not** an
OS-level sandbox or proof against arbitrary untrusted native code. Only trusted
npm code runs; no consumer code, install scripts or downloaded binaries execute.

## Commands

Explicit public-GET preparation, with an absolute trusted Node path supplied
through Effect Config; operational dotenv is never loaded:

```sh
CEIREAN_INVENTORY_NODE=/absolute/path/to/node \
  bun --no-env-file probes/cloudflare-executor/scripts/prepare-caches.ts --prepare
```

Offline byte verification of a retained candidate:

```sh
bun --no-env-file probes/cloudflare-executor/scripts/prepare-caches.ts --check /absolute/candidate
```

Both successful modes return **exit 2**, activation `Blocked`. Exit 1 is sanitized
refusal; unsupported argv exits 64 before data/config/network work. Ordinary test
targets contain synthetic fetch fixtures and offline metadata replay only. They
cannot run the actual network preparation mode, browser journeys or hosted cases.

## Evidence And Remaining Gates

Preparation returned exit 2 with activation blocked. The retained local candidate:
`/var/folders/wv/3m5dhh6x5pv9w0fbfzymldnw0000gn/T/ceirean-cache-candidate-68YaxD`.

| Measurement                          | Observed                                |
| ------------------------------------ | --------------------------------------- |
| Verified tarballs                    | 661 / 307,879,445 bytes                 |
| Minimal metadata                     | 64 documents / 27,054 bytes             |
| Complete storage, including manifest | 616,278,484 bytes / 4,049 entries       |
| Largest compressed artifact          | workerd 1.20260706.1 / 37,344,866 bytes |
| Generated replay inventory           | 41 selected / 23 excluded               |
| Pure Viz replay inventory            | 0 selected / 0 excluded                 |
| Viz adapter replay inventory         | 5 selected / 0 excluded                 |

Inventory SHA-256:
`d416b758e7410ad2069120b58df9272bed86c4ef9d24a3088d4904e46d7308cb`.
Candidate manifest SHA-256:
`387729f276c769d981771be2a37372027ee4722ff46d1c52f034bd15fcdaa31a`.
Independently re-read entry-list SHA-256:
`de3475dae4adf2f75618c03a578e3268f925a0af0d80ed1cb80934ba9734e428`.

The original candidate manifest's storage field is measured before writing its
own 237,090 bytes. The separate offline check measured the complete tree above;
the preparer now also enforces its storage budget after writing the manifest.
The manifest's own digest is returned separately, not embedded as a self-pin.
The real candidate was prepared before the cancellation-ordering repair and
re-read with the final verifier afterward. That repair changes write ownership,
not candidate bytes; its failure ordering is tested with inert delayed writes.

Real replay used the explicit Node 24.15.0 macOS ARM64 executable and npm 10.9.9;
it is not target Linux/Node 22 acceptance. Ordinary replay tests use the explicit
current Bun executable, not PATH's Node shim: Moon's shim depends on tool-manager
state absent from the deliberately isolated HOME. This distinction was observed
as a failing Moon test, then verified with the explicit test runtime.

The 30 new tests include 300 generated overflow cases, altered-blob refusal,
deadline abort, URL/status/redirect/size guards, deterministic metadata, actual
offline replay, missing-cache controls and direct native network-tripwire tests.
Independent review reproduced one P2 cleanup race: an uncancellable cacache write
could finish after directory removal and recreate a supposedly cleaned candidate.
Delayed real cacache writes reproduced this for both tarball and metadata paths.
Both regressions now pass: native writes drain before cleanup, and the directory
remains absent after settlement. Owned directory/blob/manifest writes use the
same sequencing. No findings were deferred. Final lint/format and all 12 workspace
typechecks passed. The fresh post-fix serial suite passed all 12 tasks in 9m28s,
including 176 executor tests and the unchanged 3,000 native storage refinement
cases. The lifecycle-disabled frozen install made no dependency changes. Final
inventory and candidate byte checks both returned exit 2 with activation blocked.

This is a verified raw registry blob set plus private npm cache candidate, **not**
a warmed Bun cache, Linux installation, packed-artifact equivalence, browser
binary acceptance or final image. Bun cache layout/materialization, native
postinstall and fallback downloads, `bun x tsc`, Linux/Node 22 toolchain readback,
safe archive extraction, private hosted invocation and the final image digest
remain unqualified. Preparation manifest payload fields deliberately stay pending.

Next bounded slice: qualify the Linux cache consumer/layout and missing-artifact
refusal using the same immutable inputs, before any consumer script or image
activation is proposed.
