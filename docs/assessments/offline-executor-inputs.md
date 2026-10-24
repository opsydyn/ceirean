# Offline Executor Inputs

2026-10-24, follow-up from `a7867b2`. Status: **source candidates prepared;
hosted activation blocked**. This is an offline subset of Task 4B, not its hosted
browser, networking, process or cleanup qualification.

## Source Candidate

The preparer reads the fixed historical consumer commit
`b7484cb46e66b162c8afddcfba235c9507b4f0ab` and verifies its expected tree
`8fcd5b7960541679a163dcbfbf60393e1e256241`. The observed local Git rejects
hash-mismatched commit and tree objects; isolated corrupt-object regressions
verify this while a correctly hashed tree remains readable. This is a required
compatibility test on any future preparation platform, not an assumption about
every Git version. Independently, the validated path/mode/blob-ID snapshot is
reconstructed through Git's own `update-index`/`write-tree` in a freshly owned
temporary bare repository. The resulting root must match the reviewed tree
before any source blob is read. This binds membership without relying on a
subsequent read of mutable source-tree objects or inventing a second tree parser.
An independent known-tree fixture and mode-change regression cover reconstruction.
The source repository is never written. It reads raw Git blobs, never copies
the working checkout or runs its code. Replacement objects and lazy network
fetching are disabled; protocols are forbidden. Git hooks/fsmonitor are disabled,
HOME is isolated and inherited environment is removed. Each subprocess has bounded
stdout/stderr and a ten-second scoped lifetime; the whole operation is bounded
to two minutes.

The full tree is validated before any blobs are staged: regular files only,
literal safe relative paths, no sensitive names, duplicate/file-parent collisions,
symlinks or special files. Counts are capped at 4096 files, one MiB per blob and
32 MiB aggregate. Exact byte count and Git blob identity are checked; per-file
SHA-256 values are inventoried. Existing known secret-marker checks scan blob
content. This is **not** a complete secret-discovery guarantee: independent
tracked-secret review and explicit transfer approval are still required.

The historical tree has 959 files and one executable. A freshly owned staging
directory retains original file modes and bytes, fixes timestamps and creates a
USTAR archive with normalized owner metadata. It calls the trusted system tar
with literal argv, without a shell. Nothing extracts an untrusted archive. The
source tar and its inventory are local candidates, not deployment-authorized
payloads. Future runtime extraction still needs full actual-header/type/path and
integrity validation; Bun's file-only archive view is not used as a security
validator for incoming archives.

Real preparation exposed a previously over-restrictive allowlist: the tracked
Astro catch-all route `apps/web/src/pages/request-diagnostics/[...path].astro`
was rejected. A regression failed first, then literal square brackets were
allowed without relaxing traversal, sensitive-name or file-type rules. No tracked
file was dropped or renamed. Future extraction must treat these names literally,
not as glob patterns.

Local builder provenance is Apple Git 2.50.1 (Apple Git-155), bsdtar 3.5.3 /
libarchive 3.7.4, Bun 1.4.2 on macOS ARM64. These are preparation tools, **not**
evidence that the proposed Linux image runs its Git 2.43.0/Bun 1.3.11 pins.
The preparation CLI currently uses the observed macOS tar options and
`/private/tmp`; it is not yet a portable Linux builder entrypoint. That adapter
needs separate qualification before the proposed Ubuntu builder can consume it.

## Harness Source Candidate

Five inventoried files form `browser-harness-source.tar`: the explicit execution
guard, Playwright config, journey code, browser policy and an exact-version
package manifest. It deliberately is **not** named `browser-harness.tar`: it
does not contain a frozen installed dependency closure. No complete `SHA256SUMS`
is emitted for the four required production payloads.

The private probe now pins `@playwright/test`, `playwright` and `playwright-core`
1.64.1 in Bun's lockfile. The exact public package cohort was installed with
lifecycle scripts disabled after a cache miss; no browser installer was run.
Effect remains 4.0.5 and Alchemy remains beta.83. No lint/declaration exception
was added. Harness source is included in strict typechecking against these APIs.

Discovery lists four cases: carousel and line, each at 1440x900 and 390x844.
Source selectors and assertions come from the recorded consumer, not current
FoldKit code. Prepared journeys cover button navigation, mouse/touch drag and
settle, keyboard point editing, chart description and generated-settings
consistency. They set a controlled clock, locale/timezone, reduced motion and
use fixed job-local origins. HTTP requests outside the selected origin,
redirect responses (including same-origin redirects), WebSockets, popups and
console/page errors fail the cases; service workers are
disabled. This is a browser routing guard, **not** OS/container egress or DNS
isolation.

The config requires the pinned Linux Chromium executable/version and requests
its sandbox. Runtime command-line checks reject known disabling flags, but still
report sandbox acceptance `Unverified`; actual sandbox enforcement is a separate
hosted proof. It prepares screenshots, traces and finite diagnostic counts.
Screenshot size is checked after capture; streaming trace/output budget enforcement,
redaction and export custody still belong to the real executor adapter. There is
no claim of bounded hosted artifact collection from these prepared tests alone.

An unconditional global setup guard rejects actual test execution before browser
launch or server requests. `--list` is allowed and asserts nonzero exact discovery.
Replacing this guard requires a separately approved, fail-closed activation path;
there is no environment flag or CLI switch to enable execution here. Neither
actual consumer builds/tests nor browser interactions/screenshots ran in this
slice. No synthetic page is presented as consumer acceptance.

## Reproduce Preparation

```sh
bun --no-env-file probes/cloudflare-executor/scripts/prepare-inputs.ts \
  --source-repository /absolute/path/to/fold-kit-experiments
```

Exit 2 means local candidates prepared with activation `Blocked`; 1 means refusal
with sanitized diagnostics; 64 rejects unsupported arguments. The source repo
path selects storage, not a revision, command or trust policy. Artifacts are kept
in a newly owned 0700 directory under `/private/tmp`, files mode 0600. No consumer
environment, current working files, cloud/model/GitHub credentials or root dotenv
are forwarded. No image, browser binary, source transfer, registry publication,
paid resource, main merge, push or operational ingress is authorized.

## Verification

Source identity/browser policies failed against placeholders, then passed. Git
blob mutation laws add 300 generated cases. A real archive test verifies payload
bytes and executable mode; existing unsafe path/type/registry tests remain.
Fresh-process tests verify sanitized CLI refusal, four-case discovery and blocked
execution. Independent review identified an unchecked-redirect issue: an actual
Playwright request against two synthetic loopback servers reproduced following a
302 to the second server. The fix sets `maxRedirects: 0`, refuses 3xx responses
before browser fulfillment and preserves successful non-redirect responses. The
regression passed after failing first; no browser or consumer server was used.

The review's forged loose-object attempt already failed in the installed Git.
Characterization tests preserve that boundary; independent snapshot reconstruction
also closes the broader tree-membership/changed-store assumption. The new native
reconstruction fixture failed before implementation, then passed. A future
preparation platform must pass these tests. Final candidate hashes and full-suite
measurements are recorded below after final formatting and verification.

Final checks passed:

- Universal lint/format: exit 0, 420 files, no new exceptions.
- All 12 workspace typechecks: exit 0, including the prepared Playwright source.
- Full serial repository tests: all 12 tasks passed in 10m 4.945s. Executor probe
  ran 128 tests across 18 files; native refinement retained all 3000 cases and
  existing local runtime phases confirmed owned-process cleanup.
- Frozen offline install with lifecycle scripts disabled: exit 0, no further
  dependency or lockfile changes.
- Preparation CLI: exit 2 (`OfflineInputsPrepared`, activation `Blocked`).
- `git diff --check`: exit 0.

These are local macOS preparation/controller measurements. The prepared browser
journeys remain deliberately unexecuted; they have no screenshots or traces yet.

Final local candidates are retained at
`/private/tmp/ceirean-offline-inputs-IuYXo3` (directory 0700; files 0600):

| Candidate                    | Files | Archive Bytes | SHA-256                                                            |
| ---------------------------- | ----: | ------------: | ------------------------------------------------------------------ |
| `source.tar`                 |   959 |       5245952 | `6acefc0258f22c9f66e6a188be4e26d68d38cf14c4d18a02ae7e5480e164f4d0` |
| `browser-harness-source.tar` |     5 |         16384 | `775136451041bfc57edc5f02094e2eb157c0e793b077c9a2c912726a10246309` |

The source digest reproduced across preparation runs. System tar inspection
counted 959 entries and confirmed the original executable remains mode 0755.
These observations do not approve transfer or substitute for the final image
digest. The local candidates and inventories are not checked into source control.

Remaining blockers include consumer Bun/npm caches, the full browser dependency
closure, frozen offline installs including nested generated consumers, archive
extraction, real browser/font/toolchain acceptance, process/network/provider limits,
authenticated hosted invocation, final custom image digest and build/session
approval. `fixtures/baseline.json` correctly retains all payloads as `Pending`.
