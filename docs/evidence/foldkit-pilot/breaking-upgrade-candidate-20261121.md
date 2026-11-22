# foldkit 0.171.0 Is A Genuine Breaking Upgrade

Recorded 2026-11-21. Settles the candidate precondition on the FoldKit
migration pilot in [the roadmap's parking record](../../roadmap.md), which
requires "a genuine breaking upgrade" and says to record the absence rather than
manufacture one. A candidate **is** available, so the precondition is met.

**Method.** Both published `foldkit` tarballs were fetched from
`registry.npmjs.org`, verified against the registry's own `dist.shasum`
(`bb3a265e` for 0.170.0, `47c148d4` for 0.171.0), extracted into separate
directories, and compared as type declarations only. No `foldkit` package code
was executed and neither version was installed into any project. A separate
`bun install --frozen-lockfile` was later run in the FoldKit checkout to
restore its own committed baseline; that is recorded under **Checkout State**
below and installed no new `foldkit` version.

The complete set of packages the upgrade touches is tabulated under **The
Complete Upgrade Set**.

## The Manifest Was A Misleading Proxy

`dependencies`, `peerDependencies`, `optionalDependencies` and `engines` are
byte-identical between the two versions — both keep `effect ~4.1.0`,
`@effect/platform-browser ~4.1.0` and `node >=20.19.0`. The `exports` map has
the same 37 entry points, none added and none dropped.

On that evidence alone 0.171.0 reads as a routine minor bump, which is the
category the roadmap assigns to a dependency bot. **That inference was wrong.**
The declarations carry two breaking changes the manifest cannot show, which is
the reusable lesson: unchanged dependency metadata is not evidence of an
unchanged contract.

Across 227 declaration files (225 before, two added, none removed), 21 changed.

## 1. A Compile-Time Tightening, Caught By Typecheck

`Command.define`, `Mount.define` and `Mount.defineStream` narrowed their
`messages` parameter. Every overload changed from

    const Messages extends ReadonlyArray<Schema.Top>    // messages: Messages

to

    const Messages extends MessageSchemas               // messages: ResultMessageSchemas<Messages>

where the new `dist/messageSchemas.d.ts` defines `MessageSchemas` as the
non-empty tuple `readonly [Schema.Top, ...ReadonlyArray<Schema.Top>]`, and
`ResultMessageSchemas` maps any entry whose decoded type is `never` to `never`.

Confirmed empirically rather than inferred, by typechecking the same probe
against each extracted version with `effect` 4.1.0 and TypeScript from this
repository:

| Probe                        | 0.170.0  | 0.171.0                                                       |
| ---------------------------- | -------- | ------------------------------------------------------------- |
| `messages: [Done]` (control) | compiles | compiles                                                      |
| `messages: []`               | compiles | **TS2769** — `[]` not assignable to `ResultMessageSchemas<…>` |
| `messages: [Schema.Never]`   | compiles | compiles                                                      |

The empty-list rejection reproduces exactly. The `never`-entry rejection the
declaration comment claims does **not** hold, and this was pinned down rather
than left open. Two further probes against 0.171.0 establish that:

- `Schema.Schema.Type<typeof Schema.Never>` does resolve to `never`, so the
  entry is the case the comment describes.
- `ResultMessageSchemas<[typeof Schema.Never]>[0]` nonetheless does **not**
  resolve to `never`, so the guard never engages.

The comment therefore overstates what the type enforces: a `Schema.Never`
entry compiles. That is an upstream documentation or type defect, not something
this repository must work around, and it does not weaken the first finding —
the non-empty-tuple constraint is real and does reject `[]`.

A typecheck gate catches this class of break.

## 2. A Silent Behavioural Flip, Invisible To Typecheck

`createKeyedLazy` gained an optional parameter:

    createKeyedLazy: ()                      => …   // 0.170.0
    createKeyedLazy: (config?: KeyedLazyConfig) => … // 0.171.0

The signature is backward-compatible, so **no typecheck will fail**. The
default behaviour nonetheless inverted. 0.170.0's own documentation stated that
"entries are never evicted" and described an evicting variant as a future
"upgrade path". In 0.171.0 that variant is the default: `evict` defaults to
`AbsentFromRender`, releasing entries unused by a completed render. Retaining
the old semantics now requires passing `{ evict: 'None' }` explicitly.

Code that relied on cross-render retention keeps compiling and changes
behaviour. This is the more valuable half of the candidate: it is precisely the
class of change a human reviewer must catch and an agent patching to a green
build may miss, so it exercises the pilot's value claim rather than its
plumbing.

Two further changes are internal and not publicly reachable:
`makeOutsideIsolation` lost its `contains` method (`dist/dom/inert.d.ts` only,
and `dist/dom/public.d.ts` is unchanged), and the `__`-prefixed boundary
exports in `dist/html/index.d.ts` grew from two to six.

## The Complete Upgrade Set

Checked against `registry.npmjs.org` at the dist-tag `latest`, for every
`foldkit`-scoped spec in the repository at `f5784e68`:

| Package                  | Pinned    | Latest  | Moves?               |
| ------------------------ | --------- | ------- | -------------------- |
| `foldkit`                | 0.170.0   | 0.171.0 | **yes**              |
| `@foldkit/devtools`      | 0.170.0   | 0.171.0 | **yes**              |
| `@foldkit/ui`            | 0.170.0   | 0.171.0 | **yes**              |
| `@foldkit/vite-plugin`   | `^0.29.0` | 0.29.1  | no — caret satisfies |
| `@foldkit/oxlint-plugin` | `^0.15.3` | 0.15.4  | no — caret satisfies |
| `@foldkit/devtools-mcp`  | 0.26.0    | 0.26.0  | no — already current |

Three packages move together. `@foldkit/ui` was an open gap in the first draft
of this record and is now closed: it does have a 0.171.0.

## The Ceiling Is Six Packages, Not One

The first draft of this record named only `packages/foldkit-viz` and called the
ceiling a single self-imposed line. That understated it. **Six** packages
declare a `foldkit` peer range that excludes 0.171.0, and one of them pins the
exact version:

| Package                         | `peerDependencies.foldkit` |
| ------------------------------- | -------------------------- |
| `packages/astro-foldkit`        | `>=0.170.0 <0.171.0`       |
| `packages/effect-three-foldkit` | `>=0.167.0 <0.171.0`       |
| `packages/foldkit-phosphor`     | `>=0.170.0 <0.171.0`       |
| `packages/foldkit-viz`          | `>=0.167.0 <0.171.0`       |
| `packages/foldkit-zloz`         | `>=0.170.0 <0.171.0`       |
| `packages/foldkit-zloz-mermaid` | `0.170.0` (exact)          |

These remain self-imposed rather than upstream constraints, so widening them is
still not the break. But every one must be widened for the upgrade to resolve,
which makes the patch a coordinated multi-package edit rather than a one-line
bump — and that is the part a dependency bot is least likely to get right.

## Where The Version Literals Live

Enumerated mechanically across all `packages/*` and `apps/*` manifests:

- **8 exact `0.170.0` literals** outside peer ranges: five package
  `devDependencies` (`astro-foldkit`, `effect-three-foldkit`, `foldkit-viz`,
  `foldkit-zloz`, `foldkit-zloz-mermaid`) and three root catalog entries
  (`foldkit`, `@foldkit/devtools`, `@foldkit/ui`).
- **6 peer ranges** as tabulated above.
- **18 consumer specs** written `catalog:`, which follow the root catalog
  automatically and need no edit.
- Plus `bun.lock`.

So the patch must change **14 version specs across 7 manifests**, then refresh
the lockfile, while 18 consumers follow along by themselves. This mixture of a
root catalog, published version literals and `bun.lock` is exactly what the
roadmap records as unproven for Dependabot and Renovate.

## Checkout State

The roadmap requires the pilot run "against committed `main`, not the dirty
local checkout". That is now satisfied. `~/Projects/fold-kit-experiments` is
clean at `f5784e68`, fast-forwarded from `42c6f35d` with no local commits ahead.

`bun install --frozen-lockfile` was run with the repository's pinned
`bun@1.4.4` and **succeeded** (exit 0, 79 packages added), which also confirms
the committed manifests and `bun.lock` agree. The frozen flag was deliberate:
the pilot needs the committed state reproduced, not a silently updated
lockfile. `git status` is still clean afterwards, so the install changed no
tracked file.

The prior local work is preserved in `stash@{0}`, "Zloz LikeC4 integration
trials before FoldKit pilot sync". Of its 21 files, 16 are byte-identical to
content that landed upstream in opsydyn/fold-kit-experiments#187 and 5 differ.
On the two application files upstream is the longer version
(`src/editor/main.ts` 2960 vs 2888 lines, `test/runtime.test.ts` 5055 vs 4989),
and `experiments/zloz-likec4/adapter.mjs` is a one-line stub upstream against a
155-line implementation in the stash. The stash therefore looks like a
superseded draft rather than unmerged work, but
`experiments/zloz-likec4/README.md` is longer locally (92 vs 58 lines), so it
was not dropped.

Note that the Bun store holds 18 older `foldkit` versions from 0.125.0 to
0.170.0. That is accumulated cache, not competing resolution.

## Not Yet Done

The pilot itself has not run. No upgrade was applied, no branch was cut, and
the repository's CI has not been exercised against a candidate.
