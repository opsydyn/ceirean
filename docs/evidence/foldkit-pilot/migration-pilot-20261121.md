# FoldKit Migration Pilot: foldkit 0.170.0 to 0.171.0

Recorded 2026-11-21. The pilot the roadmap's parking record calls for: one
upgrade against committed `main`, the repository's own CI for the verdict, an
unchanged base compared with the candidate under the same checks. The candidate
was qualified as a genuine breaking upgrade first; see
[the candidate record](breaking-upgrade-candidate-20261121.md).

No FoldKit test, acceptance threshold or release workflow was modified. Nothing
was pushed, no branch was cut in the FoldKit repository, no release was made.

## The Base

`~/Projects/fold-kit-experiments` at `f5784e68`, clean, fast-forwarded to
`origin/main`, with `bun install --frozen-lockfile` under the pinned
`bun@1.4.4`.

`bun run ci:check` — the root script `ci.yml`'s `check` job runs, covering
lint, format, catalog, skills, typecheck, test, build, api-check, size-check,
schema-check, docs, then integration.

**Green.** 97 tasks uncached in 5m 17s, then 14 integration tasks (7 cached) in
3m 47s. 9m 05s wall clock. No suite reported a non-zero failure count.

One pre-existing warning, present in base and candidate alike:
`skills/foldkit-viz/assets/scatter` pins `@opsydyn/foldkit-viz@0.18.0` while
the package is at 0.19.0.

## What The Upgrade Actually Took

The surface was **not** knowable from the dependency graph. Each round below
was discovered by running the repository's checks, not by reading manifests.

### Round 1 — 14 specs across 7 manifests. Failed in 2 seconds.

Derived by enumerating every `foldkit`-scoped spec in every manifest: 8 exact
`0.170.0` literals (5 package `devDependencies`, 3 root catalog entries) and 6
peer ranges whose ceilings excluded 0.171.0. 18 `catalog:` consumers follow the
catalog and needed no edit.

`root:skills` failed — `tools/check-skills.ts`, which enforces that each
skill's `SKILL.md` and example assets name the version the examples install or
the catalog's. Two stale references. **A dependency bot editing manifests would
have produced exactly this patch and exactly this failure.**

### Round 2 — 4 more references, in a skill asset and in prose. Failed in 1m 27s.

- `skills/astro-foldkit/assets/counter/package.json` — an example's pin.
- `skills/foldkit-viz/SKILL.md` — a version named in Markdown.
- `skills/astro-foldkit/SKILL.md` — a named version **and** a peer range
  written out in prose, which had to track the manifest change.

The third surfaced only after the first was fixed, because the checker compares
a skill's text against what its own examples install. Correcting the asset
exposed the text.

Then `promo:test` failed on a real assertion, not a version fixture:

    expect(manifest.dependencies.foldkit).toBe(workspace.workspaces.catalog.foldkit)
    Expected: "0.171.0"   Received: "0.170.0"

`apps/promo` generates starter projects from templates that hard-code the
runtime version, and a test asserts the generated starter pins whatever the
catalog pins. The test was correct and was left untouched; the stale value was
in application source.

### Round 3 — 4 template literals and 6 documentation statements.

Source: three `foldkit: '0.170.0'` pins in `dataset-project.ts` and
`example-project.ts`, plus one line of generated-README prose naming the
version its starter installs.

Current-state documentation, which asserts the version the workspace is on and
would otherwise become false: `CLAUDE.md` (twice), the root `README.md`,
`apps/promo/README.md`, `packages/astro-foldkit/README.md` (a peer-range table)
and `packages/foldkit-phosphor/README.md`.

**Total: 18 files, 52 changed lines.** Against the 14 specs in 7 manifests that
a manifest-only reading predicted.

### Round 4 — a compatibility policy, decided by the maintainer.

`foldkit-zloz-mermaid:integration` failed. The cause was a choice made in round
1: that package's `foldkit` peer was an **exact pin** `0.170.0`, unlike every
sibling, and the patch preserved that convention by moving it to exactly
`0.171.0`. Its integration test installs a hard-coded `foldkit@0.170.0` into a
clean npm consumer and then installs the packed adapter, so an exact `0.171.0`
peer could not resolve:

    npm error Conflicting peer dependency: foldkit@0.171.0
    npm error   peerOptional foldkit@"0.171.0" from @opsydyn/foldkit-zloz-mermaid@0.8.0

Only this package conflicted. The other consumer tests passed because their
peers are ranges that still admit 0.170.0.

Two resolutions existed, and both changed meaning, so the choice was put to the
maintainer rather than taken by the agent:

1. **Widen the peer** to `>=0.170.0 <0.172.0`, matching `foldkit-zloz`. No test
   touched; changes that package's declared compatibility from exact-pin to a
   range.
2. **Bump the hard-coded install version** in the integration tests — one file
   minimally, seven for consistency. This is editing tests to obtain a pass,
   the class the roadmap forbids, even though the literals are fixtures rather
   than weakened assertions. (`foldkit@0.171.0` was already in the npm cache,
   so the test's `--offline` install would have worked.)

**The maintainer chose to widen the peer.** The devDependency still pins
`0.171.0`, so the package is developed against the new version while declaring
compatibility with both.

## What Was Deliberately Not Changed

**Historical records.** Roughly twenty further files contain `0.170.0`:
`docs/releases/foldkit-0.170.md`, `docs/releases/foldkit-0.169.md`,
`docs/migrations/foldkit-0.170.md`, dated assessments, and profiling evidence
under `apps/zloz-demo/evidence/`. These record what was true at a past version.
Rewriting them to make a build green would falsify the repository's history.

**Seven hard-coded `foldkit@0.170.0` install literals** in five consumer
integration tests, `apps/zloz-team/tools/qualify-packed.ts`, and a documented
install command in `packages/foldkit-zloz/README.md`. All left untouched, and
verified rather than assumed: `zloz-team:test` 196 pass, `promo:test` 184 pass,
`foldkit-phosphor:test` 9 pass, 0 fail. They resolve against peer ranges that
still admit 0.170.0.

This leaves a real residue worth recording: those consumer tests now install
0.170.0 while the workspace ships 0.171.0, so they no longer exercise the
version actually shipped. Nothing fails, and closing it would mean the test
edits the maintainer declined, so it is named here rather than fixed.

## Verdict

**The candidate is green under the same checks as the base.**

|                           | Base `f5784e68`             | Candidate                   |
| ------------------------- | --------------------------- | --------------------------- |
| Phase 1 (`:lint`…`:docs`) | 97 tasks, 5m 17s            | 97 tasks, 4m 52s            |
| Phase 2 (`:integration`)  | 14 tasks (7 cached), 3m 47s | 14 tasks (7 cached), 2m 45s |
| Wall clock                | 9m 05s                      | 7m 38s                      |
| Recorded exit             | `0`                         | `0`                         |
| Non-zero failure counts   | none                        | none                        |

Same task set, same two phases, both green. The duration difference is not a
performance result: the two runs happened on either side of an idle period and
differ in cache state, so only the pass/fail comparison is meaningful.

## The Measurement

The roadmap asks for "the maintainer's active review and rework time against a
comparable manual upgrade". Half of that is available and half is not.

**Rework rounds: four CI runs to green, three of them failures.**

| Run         | Duration | Outcome                                                      |
| ----------- | -------- | ------------------------------------------------------------ |
| Base        | 9m 05s   | green                                                        |
| Candidate 1 | **2s**   | `root:skills` — stale versions in skill assets and prose     |
| Candidate 2 | 1m 27s   | `promo:test` — stale version in a generated-starter template |
| Candidate 3 | 2m 06s   | `foldkit-zloz-mermaid:integration` — peer-pin conflict       |
| Candidate 4 | 7m 38s   | **green**                                                    |

About 20 minutes of CI across five runs, plus one targeted three-suite run used
to check the untouched test literals rather than assume them.

**Maintainer decisions required: one.** The mermaid peer-pin conflict, where
both resolutions changed meaning. Every other round was mechanical once the
failure named the file. The elapsed wall time spans an overnight gap that is
idle time waiting on that decision, not work, so elapsed time is not a
measurement of effort and is not reported as one.

**What is not measured: the comparison.** No comparable manual upgrade was
performed, so there is no baseline for review-and-rework time and no claim here
about whether the agent route was faster or slower than doing it by hand. The
roadmap's central question is therefore still open. What this pilot produced is
the _shape_ of the work — four rounds, one judgement call, 18 files — which a
manual attempt could now be measured against.

**Cost note.** The first failure arrived in 2 seconds and the full gate takes
under 10 minutes, so the feedback loop here is cheap. Harness setup stayed well
inside the roadmap's half-day cap: the repository's own `ci:check` script and
`tools/ci-local.ts` meant no harness was built at all.

## What This Pilot Does And Does Not Show

It measures the **coordination** cost of an upgrade across a root catalog,
scattered version literals, skill assets, prose documentation and a lockfile,
with the repository's own consistency checkers as the judge. That is precisely
the combination the roadmap records as unproven for Dependabot and Renovate,
and the two failing rounds are direct evidence: a manifest-only patch fails
this repository's checks twice before reaching the test suite.

It does **not** measure whether an agent can handle a semantic break. Neither
of 0.171.0's breaking changes reaches this codebase: `createKeyedLazy`, whose
default eviction policy silently inverted, has zero call sites, and the
narrowed `messages` constraint is satisfied by all 176 `Command.define`,
`Mount.define` and `Mount.defineStream` call sites, none of which passes an
empty list. The upgrade was mechanical. That is a property of this repository
meeting this release, not a general result, and it should not be read as
evidence that agent-driven migration handles semantic breaks.
