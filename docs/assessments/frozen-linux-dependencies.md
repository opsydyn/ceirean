# Frozen Linux Dependency Inventory

Follow-up: [integrity-checked local cache candidates](integrity-checked-cache-candidates.md)
now have measured byte verification and offline metadata replay; the original
inventory-only scope and remaining activation gates below remain historical evidence.

2026-10-24, follow-up from `1ffb971`. Status: **inventory frozen; hosted
activation blocked**. This freezes metadata and retrieval expectations, not
installed dependencies, cache archives or Linux/browser acceptance.

## Frozen Inputs

`probes/cloudflare-executor/fixtures/dependencies/` contains exact raw snapshots.
`src/dependency-pins.ts` independently owns their SHA-256 expectations. The
checker reads bounded regular files without following final symlinks, verifies
those hashes before parsing, recomputes the catalog and compares its exact bytes
with `inventory.lock`. Changing a snapshot and its catalog together cannot bless
new input. No runtime JSON import or resolver runs before argv validation.

Historical source remains `b7484cb46e66b162c8afddcfba235c9507b4f0ab`, tree
`8fcd5b7960541679a163dcbfbf60393e1e256241`. The lockfile, template generator
and Viz package manifest were captured through the existing verified Git-tree
reader, never copied from current working files or imported as code.

| Group                                        | Registry Candidates | Excluded |             Local Records |
| -------------------------------------------- | ------------------: | -------: | ------------------------: |
| Historical Bun workspaces                    |                 674 |      226 |              4 workspaces |
| Generated line/histogram/scatter npm profile |                  41 |       23 | root/vendor/link metadata |
| Pure Viz npm profile                         |                   0 |        0 | root/vendor/link metadata |
| Viz adapter npm profile                      |                   5 |        0 | root/vendor/link metadata |
| Browser harness libraries                    |                   4 |        0 |                         0 |

Across selected groups, **661 unique registry URL/SHA-512 pairs** are frozen.
Nested lock keys and multiple versions remain in their owning groups. Deduplication
is only for identical retrieval URLs; conflicting integrity claims fail closed.
Workspace and inert vendor records are not registry downloads or built artifacts.

The target is Linux/x64/glibc. Explicit incompatible OS/CPU/libc records are
excluded, including Bun's unsupported `none` selectors. The historical Bun lock
does not carry libc metadata, so both GNU and musl packages can remain in the
conservative candidate set. It is **not** a minimal installed closure. Optional
packages are inventoried rather than silently discarded. Actual native selection,
postinstall/fallback downloads and Linux frozen installation remain unqualified.

Every registry record has an exact name/version, canonical HTTPS npmjs tarball
URL and SHA-512 integrity. These are expectations from frozen metadata, not proof
that tarball bytes were downloaded or verified. No cache archive or complete
production `SHA256SUMS` was produced.

## npm Resolution Boundary

The generated templates request Vite **8.3.1**, unlike root Bun's **8.0.13**.
They share seven exact external dependencies and a local generated Viz vendor
manifest at version 0.9.0. Separate pure/adapter metadata profiles represent the
published Viz manifest at 0.10.0, with its optional FoldKit/Effect peers.

The exact generated manifest and production peer fields were reviewed against
the captured source. Inert resolver manifests omit executable scripts, source and
compiled package contents. Resolution uses local metadata directories, **not**
the real packed tarballs. These snapshots do not prove packed-artifact equivalence
or replace the original packed consumer tests.

Official Node release metadata reports npm **10.9.9** for the already-pinned Node
22.23.4. The private probe adds that exact resolver package; its bundled tooling
adds lock entries but changes no previously locked package entry. Lifecycle
scripts were disabled during installation. Effect and Alchemy remain unchanged.
The proposed image/recipe were not changed, pulled or built; its npm version still
needs actual readback before execution.

Observed resolver host: Node **24.15.0**, macOS ARM64, npm **10.9.9**. Explicit
`--os=linux --cpu=x64 --libc=glibc` settings select the intended target; this is
not execution under the target Linux/Node 22 runtime. Resolutions are new
qualification choices dated 2026-10-24, not reconstructed historical npm locks.

Only `npm install --package-lock-only` ran against inert owned directories, with
scripts, audit, funding and update notifications disabled. Each profile confirmed
no installed `node_modules`. HOME/TMPDIR/cache are owned and isolated; inherited
environment is removed. Two distinct empty npm config files avoid both private
configuration reads and npm's duplicate-config-path error. Git system/global
configuration and remote protocols are disabled. Node is supplied explicitly
through Effect Config's `CEIREAN_INVENTORY_NODE`, not root dotenv.

Public metadata resolution used npm's configured npmjs registry. This is not a
network-confinement proof: no OS/container egress or redirect enforcement is
claimed for that resolver. Produced artifact URLs were checked strictly before
sealing. Any later artifact downloader must enforce the exact GET allowlist,
verify bytes and independently refuse unapproved redirects.

The retained capture and metadata-only cache candidate live at
`/var/folders/wv/3m5dhh6x5pv9w0fbfzymldnw0000gn/T/ceirean-dependency-snapshots-NtFrBq`.
They are not a complete npm-cache payload and are not checked into Git. Only
the seven hash-bound input snapshots and derived catalog are committed.

## Browser Inventory

The harness freezes `@playwright/test`, `playwright` and `playwright-core` 1.64.1,
plus Effect 4.0.5, from Ceirean's `1ffb971` lock. Inter 5.3.0 is explicitly
bound to its historical Bun record. Chromium 156.0.8078.4/revision 1248 and its
Linux executable path remain bound to the previously pinned Playwright image.
The image is an input identity, not observed binary/font/sandbox acceptance.
No browser installer, browser journey or screenshot run occurred here.

## Check And Refresh

Read-only, offline check:

```sh
bun --no-env-file probes/cloudflare-executor/scripts/check-dependencies.ts --check
```

Exit 2 means `DependencyInventoryFrozen`, activation `Blocked`; 1 is sanitized
refusal; 64 rejects unsupported argv before reading inputs. The check neither
resolves packages nor installs, fetches, builds, deploys or changes policy.

The separately named capture/seal tools are explicit maintenance operations,
not normal test targets. A refresh needs review of new immutable input hashes;
sealing refuses anything different from the compiled pins. Capture cannot accept
caller-selected commands or dependency manifests. It does not read/execute the
historical generator or forward its environment.

The shared bounded reader retains its original 64 KiB default for signed approval
inputs. Only inventory callers request larger reads, capped at two MiB; existing
approval-reader regressions remain in the suite.

## Verification And Next Gate

Parser tests failed against placeholders before implementation. Tests preserve
alias versions, refuse missing/bad integrity and custom/nonregistry origins, and
cover 300 generated platform-selector cases. CLI tests detect modified source,
npm, browser or derived catalog files; unsupported argv is rejected before file
loading. The isolated npm config/version probe runs with `--offline`.

Independent review found no P0-P2 issues. Its noncanonical SHA-512 padding finding
was reproduced with a failing test, then fixed by admitting only canonical final
base64 characters. All 661 frozen digests were already canonical; the catalog
remains unchanged at SHA-256
`d416b758e7410ad2069120b58df9272bed86c4ef9d24a3088d4904e46d7308cb`.

Repository lint/format, all 12 workspace typechecks and the lifecycle-disabled
frozen install passed. The full serial workspace suite passed all 12 tasks in
9m18s, including 146 executor tests and all 3,000 native storage refinement cases.
The offline inventory check returned its required exit 2 with activation blocked.

Next bounded step: prepare integrity-checked Linux cache candidates with explicit
size budgets, including immutable metadata replay. Still blocked independently:
actual packed artifacts, standalone `bun x tsc` resolution, native postinstalls,
Linux installs, browser/toolchain/sandbox proof, extraction safety, authenticated
hosted invocation, final image digest and build/session approvals. The macOS-only
source archive adapter also remains unqualified as a Linux builder entrypoint.
No source transfer, consumer execution, image build, hosted activation, merge or
push is authorized by this inventory.

References: [npm lock-only installation](https://docs.npmjs.com/cli/v10/commands/npm-install/),
[npm target settings](https://docs.npmjs.com/cli/v10/using-npm/config/),
[Node release metadata](https://nodejs.org/dist/index.json).
