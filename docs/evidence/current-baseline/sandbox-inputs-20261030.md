# Sandboxed Baseline And Local Input Evidence

Date: 2026-10-30. Extends preparation commits `347bce4`/`0bacb00`; no image or
hosted activation. The owner approved resolving the launch conflict and preparing
trusted inputs. This is not a repository baseline or Linux qualification pass.

## Consumer Amendment

Local commit `be0427e2aba2cf951ef4dbbbe9296e307ed41ad3`, branch
`codex/foldkit-sandboxed-baseline`, directly descends from approved `1183e3c`.
Its tree is `0e3ea1ab2999dbd83cb3a38920cab47b2a02352e`. Exactly two files changed:
the 3D launch helper explicitly sets `chromiumSandbox: true`, and a unit test
intercepts only the external Playwright launch to observe those real options.
The missing option failed RED; the one-line fix passed GREEN. No browser launched.

The adapter's 51 tests, typecheck and strict lint passed. The full repository test
command passed 1,904 tests (including the release script's 33 tests and web's 408).
Verification used Bun 1.4.4 and existing local dependencies shared into the isolated
worktree, not a clean install of the pinned Linux closure. Adapter lint retained
pre-existing warnings, with no new error or rule relaxation.

The full repository check did **not** pass: `check:single-effect` saw both Effect
4.0.7 and 4.1.0 in those borrowed dependencies. The original checkout's baseline
typecheck/check passed; isolated root typecheck first hit sandbox write restrictions.
An initial adapter TypeScript incremental build also panicked before its referenced
workspace dependency links existed; adapter typecheck passed after completing links
and granting worktree-output access. None is native baseline proof, and no target
source was changed to hide these limitations. Initial root tests likewise hit write
restrictions, then passed with worktree-write and loopback access.

## Real Local Candidates

Prepared directory: `/private/tmp/ceirean-current-inputs-QgvPIC` (private 0700;
files 0600). It contains source, harness-source and contract bytes, two inventories
and a preparation receipt. Temporary local candidates are not durable evidence
storage or an image context; the command can reproduce them from fixed Git objects.

| Item                           |             Bytes | SHA-256                                                            |
| ------------------------------ | ----------------: | ------------------------------------------------------------------ |
| Source tar, 2,107 files        |        26,324,992 | `0c0213bd8b0ee3d6e75757450ef67ae55ab183fe978bb2e21d9ddad2e134d267` |
| Harness-source tar, five files |            16,384 | `775136451041bfc57edc5f02094e2eb157c0e793b077c9a2c912726a10246309` |
| Current contract               | See retained file | `487b4fa0a24dde7de46d41cbbc349b1b1103f4da41ce9c630b69554b617c50be` |
| Updated Dockerfile             |  See tracked file | `96698fb63e3434a0a4c61f86d9cb1c973317f65ff7142e8b847de773b7257c4b` |

Two preparations produced the same archive hashes. The fixed lock SHA-256 remains
`9b8f226992603213059977d39abb58acd399bfc2256d70d2890a0dfe6365cd89`.
The original `1183e3c` evidence and historical `b7484cb` preparation are retained,
not relabelled as this amendment. All 16 commands/four browser cases remain required.
The browser command cwd now matches the real archive's `browser/playwright.config.ts`
layout. Its activation-blocking global setup remains intact.

The current preparation reconstructs exact Git tree membership, validates blob
identities and the lock, bounds archive sizes and refuses unsafe entries. It never
reads source from the worktree. Output acquisition owns a finalizer: failure or
interruption attempts partial-output removal; an unconfirmed cleanup emits a
sanitized failure tag while the original preparation still fails. Successful
candidates remain for staging.

## Regression And Readback

Opt-in integration command uses local Git objects only:

```sh
CEIREAN_CURRENT_SOURCE_REPOSITORY=/absolute/local/fold-kit-experiments bun --no-env-file --no-install test probes/cloudflare-executor/tests/current-inputs.test.ts
```

Six tests passed, including independent rehashing of every archived blob against
the inventory, full member equality, unchanged lock and exclusion of newer-HEAD
docs. Current-source inspection refused corrupt lock/non-lock bytes, and an
isolated alternate-object fixture refused a substituted tree under the pinned
commit name. Every alternate fixture first read all 2,107 valid source files as a
positive control. Git preferred valid packed blobs over our forged loose blobs,
so the two byte-corruption tests were corrected to feed changed bytes directly
through the same current-source inspector used by preparation. No real Git
object or working file was mutated. The real current checkout was already ahead
and had unrelated untracked content; neither entered the archive.

Review found the missing test scope and insufficient current-wiring coverage; the
scope failure was reproduced and fixed, and the opt-in tests above now cover the
current path. These four real-repository tests skip explicitly when the local
repository environment variable is absent. Generic source integrity/property tests
and current contract/refusal tests remain portable.

Final Ceirean gates: 613 selected executor tests passed, zero failed, across 48
files with 28,546 assertions, including the opt-in local source checks. All 12
workspace typechecks and strict oxlint/oxfmt passed. No skipped integration test
is reported as executed. The initial unscoped harness test failed and was corrected.

## Remaining Work

Linux Bun/npm dependency closure, complete harness dependencies, trusted baseline
worker, final safe exact-byte staging/custody and native sandbox/preview checks are
still pending. The image manifest deliberately remains Pending/Unbuilt/Blocked;
local archive candidates do not promote it. No installs, downloads, image builds,
publication, provider calls, deployment, webhook/route activation, merge or push
were performed. The next slice is the bounded current Linux dependency acquisition
and worker preparation, then one separately approved image build/Linux run.
