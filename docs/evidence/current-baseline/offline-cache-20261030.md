# Current Offline Cache Composition

Portable registry/npm input preparation only. No package installation, target
scripts, archive extraction, browser, image pull/build/publication, provider call
or hosted activation ran. Bun's Linux-native cache is **not** materialized.

## Exact Inputs And Output

Fixed source remains `be0427e2aba2cf951ef4dbbbe9296e307ed41ad3`, tree
`0e3ea1ab2999dbd83cb3a38920cab47b2a02352e`; no consumer files changed.

The retained 897-archive input at
`/private/tmp/ceirean-current-registry-dNYEXx` was authenticated against both
previously recorded pins, then every blob and npm content-cache entry was read
back. The preparer also regenerates its expected inventory from fixed Git objects
so a different source cannot reuse these claims.

| Identity                                      | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Retained inventory                            | `26e90c75b2816a07cf5df9733062ede37e46664a4b0bf4a4c255aa3932840fc7` |
| Retained preparation receipt                  | `a112fa5612987803ec9a15e3f36a965b8b3e6caa297daafdf0bbd2b3a7c4c0f1` |
| Frozen current npm snapshot                   | `afbc49f88b06f39f1b64d321952cb0768e843b7fa57446c78d260f19993d496f` |
| Composed inventory                            | `940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed` |
| Composed preparation receipt                  | `09a1ab28e04a31565ad31d5de4af508d0aa20f3cbfed58d593c96d76b64d9fe6` |
| Independently re-read artifact-entry encoding | `680d15031fc7fc44b7419b1cbc464675de179a59f2bdc78ab20b5879b2b9fa23` |

Output root: `/private/tmp/ceirean-current-offline-Rg2onJ`.
Complete portable candidate: `cache/offline/` beneath that root, containing
`artifacts/0000.tgz` through `artifacts/0908.tgz` and `npm-cache/`.
The small `cache/delta/` subtree retains this operation's acquisition readbacks;
it is not another dependency set or a separate runtime cache.

- **909 unique archives, 429,561,867 bytes** in the complete set.
- **897 reused** from retained local bytes, never re-downloaded.
- **12 downloaded, 27,672,964 bytes**, exactly the canonical npm URLs/SRI from the
  [frozen npm delta](npm-20261030.md#next-cache-delta). No live version resolution.
- **71 minimal metadata packuments** from the frozen snapshot; no metadata GETs
  or target generator execution in this slice.
- Initial whole-output storage: **915,194,867 bytes / 5,431 entries**. A later
  independent readback plus replay measured **915,273,779 bytes / 5,435 entries**;
  the difference is npm diagnostic bookkeeping, not changed artifact/metadata
  bytes. Both fit the unchanged 1,153,433,600-byte / 20,000-entry bound.
- Compressed archive limits remain 64 MiB per artifact and 512 MiB aggregate.
  Retained bytes reserve their share before the first delta chunk is accepted.
  Acquisition/composition work is bounded to 20 minutes, overall preparation to
  25 minutes, with a fixed one-second response-release grace.

The original retained inventory and receipt hashes were checked again afterward
and are unchanged. New composition uses independent copies, not hard links.

## Replay And Regression Evidence

Every complete output artifact was independently re-read with SHA-512 SRI and
SHA-256, including its npm content-addressed copy. All frozen metadata cache
bodies were authenticated before/after native-guarded npm replay. All four
complete locks matched: common 48 selected/23 excluded, dataset 46/23, pure 0/0,
adapter 5/0. The older adapter pins remain unchanged.

Observed resolver: Node **v24.15.0**, npm **10.9.9**, Darwin arm64, with Linux/x64/
glibc lock selection. `--package-lock-only --offline --ignore-scripts` and the
existing native HTTP/TCP/DNS tripwire stayed active. There was no `node_modules`
installation. This is not Linux install acceptance.

Test-first coverage includes exact missing-set selection, SRI/URL/identity
conflicts, changed/symlinked/hard-linked input, foreign output collision,
zero-delta/no-network behavior, pinned retained manifests, the combined byte
budget, cancelled acquisition and partial-output cleanup. Three seeded property
runs cover 300 cache-union set differences.

Independent review found one important cancellation race: native recursive mkdir
could complete after cleanup and recreate output. The regression observed RED
then GREEN when directory mutations were drained before cleanup. The fixture
models the non-cancellable callback through the Effect filesystem service; no
native import boundary or lint exception was added. Archive response cleanup now
shares the already-tested one-second cancellation policy with metadata responses;
its hanging-cancellation regression also observed RED then GREEN.

Verification: **695 executor tests passed, 0 failed**, across 60 files with 28,688
assertions. Full log: `/private/tmp/ceirean-current-cache-tests-final.log`.
Strict lint/format and all 12 workspace typechecks passed before this slice's commit.
The test selection is tracked executor tests plus the three new `current-cache`
test files; unrelated observer/readiness-staging experiments are excluded.

## Remaining Gate

The configured default Docker endpoint is unavailable; no VM, image or container
was started. A named Colima context exists but was not activated or qualified.
Do not construct a guessed Bun cache layout on macOS and label it Linux-ready.

Next is one bounded, separately authorized Linux cache warm-up/offline-reinstall
using these exact inputs, Bun 1.4.3, Node 22.23.4 and npm 10.9.9, with scripts
disabled and controlled networking. It must produce the actual Bun-native cache
and validate npm install consumption, with ownership and cleanup recorded. Then
close archive extraction, native postinstall/harness/worker admission and exact
image staging as required by the baseline contract. Build and hosted activation
remain blocked; this preparation does not make the image manifest Ready.
