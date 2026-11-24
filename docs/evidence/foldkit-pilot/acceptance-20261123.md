# FoldKit Migration Pilot: Acceptance, And What Acceptance Did Not Cover

The [migration pilot](migration-pilot-20261121.md) left one item open: the
maintainer's acceptance decision. This records it, and records that acceptance
alone did not leave the target repository correct.

## Acceptance

[PR 188](https://github.com/opsydyn/fold-kit-experiments/pull/188),
`chore: upgrade FoldKit to 0.171.0`, was merged into `opsydyn/fold-kit-experiments`
`main` at 2026-11-23T08:51:52Z by `opsydyn`, as `058d3e5`. The upgrade is on that
branch: its root `package.json` reads `"foldkit": "0.171.0"`.

That is the roadmap's success condition for the Useful Migration Patch milestone
— an accepted, verified migration rather than a version bump or an open pull
request. It is met.

## The merge commit failed the repository's own CI

The pilot's verdict was the target repository's CI, green on all four jobs of the
pull request. The `ci` workflow run on the merge commit `058d3e5` concluded
**failure**: job `check`, at the step `Lint, typecheck, test, build, API reports,
size budgets, then integration tests`.

A green pull request and a green merge commit are not the same run. Nothing was
wrong with the patch as reviewed; what the pull request could not test is below.

## What PR 189 had to add

[PR 189](https://github.com/opsydyn/fold-kit-experiments/pull/189) (`44a06de`,
2026-11-23T18:47:46Z) restored the branch. Three things, from its own commit
messages:

1. `@opsydyn/foldkit-viz`'s README still documented the peer range
   `>=0.167.0 <0.171.0` and said the adapters were qualified on FoldKit
   `0.170.0`, contradicting the package it ships with.
2. `@opsydyn/astro-foldkit`'s README said the integration targets FoldKit
   `0.170.x` while the peer table directly below it already read
   `>= 0.170.0 < 0.172.0`, so the document disagreed with itself.
3. **The widened range never reached consumers.** PR 188 widened the peer to
   `<0.172.0` in the repository at `@opsydyn/foldkit-viz@0.19.0`, a version
   already published to npm declaring `<0.171.0`. Because `chore:` does not
   bump, release-please opened no release pull request and the manifest version
   still equalled the published one, so npm kept serving the old range:
   `npm install @opsydyn/foldkit-viz@0.19.0 foldkit@0.171.0` still failed
   ERESOLVE. A patch release was needed to publish the range PR 188 intended.

## Why this matters beyond the pilot

The pilot's recorded finding was that a manifest-only patch — what a dependency
bot produces — fails this repository's own checkers twice before reaching a test,
because the version also lives in skill assets, Markdown prose and
generated-starter templates: 18 files, not the 7 a bot would touch.

This extends it. The 18-file patch was correct, passed every check on the pull
request, was accepted by the maintainer, and **still did not deliver the
upgrade**, because whether a change reaches consumers is decided by the commit
type that governs release automation. No check in the acceptance contract tests
that. Two of the three gaps were documentation that contradicted the shipped
package, which again is prose, not manifests.

For a project whose differentiator is its acceptance contract, this is a design
input: "green on the candidate's pull request" is not the verdict a migration
needs. The verdict has to include whether the change is published and whether the
repository's own documents still agree with it.

## Supervision effort

The pilot record measured four rework rounds, three of them failures, about 20
minutes of CI across five runs, and one genuine judgement call. It declined to
claim a comparison against manual effort because no comparable manual upgrade was
performed. That stands, and this record adds one post-acceptance round: the
repair above was a further pull request roughly ten hours after the merge.

## Limits

This is a record of one upgrade in one repository the maintainer owns, verified
by that repository's existing CI. It is not evidence about Flue, the owned
worker, the baseline contract rerun, a container, a credential or a publisher,
none of which took part. The patch came from a human-triggered agent.

The target repository's CI also gained a flakiness fix the same day
([#194](https://github.com/opsydyn/fold-kit-experiments/pull/194), "bound the
deadlines behind the flaky CI failures"), so its determinism as a verdict is
itself bounded. Its `main` is green as of `6a8a83a`.
