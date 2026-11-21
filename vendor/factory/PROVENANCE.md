# Provenance

Vendored from [`withastro/factory`](https://github.com/withastro/factory), MIT
licensed. The upstream `LICENSE` is copied verbatim beside this file; the
copyright notice stays with these files, as Factory itself does for the skill it
vendored in `skills/review/LICENSE`.

| Field | Value |
| --- | --- |
| Upstream | `https://github.com/withastro/factory` |
| Commit | `3a01af8566a580c3cefd5d1f06e1884679a1f135` |
| Commit date | 2026-11-11 |
| Vendored on | 2026-11-21 |
| Licence | MIT, Copyright (c) 2026 Astro |

Files keep their original upstream relative paths so an upstream diff lines up
without a mapping table.

What is committed here is **upstream plus the applied patch series**, because
the tree has to compile. The SHA-256 columns below are of the *pristine*
upstream file, so provenance stays checkable: fetch the upstream commit and
compare. The delta is never implicit — it is exactly the series in
`patches/vendor-factory/`, and both patches apply to a pristine copy, in order,
with `git apply -p1`.

Two rules, and they are the whole discipline:

- **Never hand-edit a file here.** Change the patch, reapply it to a fresh
  pristine copy, and commit the result. Otherwise the delta from upstream stops
  being visible and this stops being vendoring.
- **Never run oxfmt or `oxlint --fix` over this directory.** Factory uses tabs
  and our policy does not, so a reformat would destroy every hunk in the series.
  `vendor/**` is excluded in `.oxfmtrc.json` and `oxlint.config.ts` for exactly
  this reason.

`Dockerfile.upstream` is kept for reference only. It is not our image: it
installs pnpm globally and carries a Rust toolchain shim for Astro's own
repositories.

## Verified State

As of 2026-11-21, on Bun 1.4.4: `tsc --noEmit` clean, and `bun test` green at
59 tests and 144 assertions across 7 files.

## Applied Patches

| Patch | Touches | Why |
| --- | --- | --- |
| `0001-narrow-worker-env.patch` | `src/github/client.ts`, `src/triage/sandbox.ts` | Narrows two signatures from upstream's `WorkerEnv` to the fields they read. Without it the closure is 48 files and 7,713 lines instead of 12 and 2,005 |
| `0002-tests-to-bun.patch` | the six ported test files | vitest to `bun:test`, so the vendored tests run under our existing gates instead of adding a second test runner |

## Vendored Source

| Vendored path | Upstream path | Lines | SHA-256 of the pristine upstream file |
| --- | --- | --- | --- |
| `src/coordination/queue-coordinator.ts` | `src/coordination/queue-coordinator.ts` | 233 | `4ca386a49ee10f3afa031c7bc3069da6e06df7294e54e4f6e1e5976c720417c6` |
| `src/github/bots.ts` | `src/github/bots.ts` | 23 | `bb3beb4afa074ed9765908e96b195624006a40499cd0cbb1563ec526e49d55be` |
| `src/github/client.ts` | `src/github/client.ts` | 78 | `a5790430ffff9199605f62c84cc41fcacf88434e03ea5857c9b8479c4bf46d8b` |
| `src/github/content.ts` | `src/github/content.ts` | 62 | `6b8a2ccb68ddf97305f058fb2b0c084415f7d64bfc0a3b800d5d3a315904476a` |
| `src/github/issues.ts` | `src/github/issues.ts` | 473 | `2c41322c38c3e0c5c1fe74ee7b9794dcd7a8a4e5744befca4a948381805fd847` |
| `src/github/skill.ts` | `src/github/skill.ts` | 160 | `b6de2d7a476b370b79fec2ace17c391a30f9f65f8f918485e73ccc011480e417` |
| `src/models.ts` | `src/models.ts` | 79 | `276cc1e7f2def7efdb3eaca1ffb1c31778fda1ee92bb5c8372a35d455ee4b809` |
| `src/thinking.ts` | `src/thinking.ts` | 18 | `7989da530218fc96a50df3af99fe0c7267a21ec7aef41bf58a9e59c420c51b04` |
| `src/triage/fsm.ts` | `src/triage/fsm.ts` | 92 | `7bff9866daf7771fd32680dbfb67922bb9c580c194d9cf9fee8697bfb7c27ab6` |
| `src/triage/labels.ts` | `src/triage/labels.ts` | 155 | `f76450c52d4c8cb66376b16b03ef785439f2b368725715707ee2e0aba947ac46` |
| `src/triage/sandbox-utils.ts` | `src/triage/sandbox-utils.ts` | 182 | `98d1e34f62ab4aa96b0806519778ce08baedda834c210f12a8c132ecd87dd09e` |
| `src/triage/sandbox.ts` | `src/triage/sandbox.ts` | 450 | `d1726df8d72f49b2ff1c295764806dd7ea274ba33fee256c2b892fd4297b900f` |
| `LICENSE` | `LICENSE` | 21 | `6a44fbf70dd55e5f188d7354066c388fee42596445118a1356776efbd20fd38b` |
| `Dockerfile.upstream` | `Dockerfile` | 36 | `c34886c5ca39814d90acbbbb06d79f06e947ce748dc89bf74cbd35c33e865b7f` |

## Vendored Tests

Seven of Factory's 51 test files cover this source. Six are upstream files under
patch `0002`:

| Vendored path | Upstream path | Lines | SHA-256 of the pristine upstream file |
| --- | --- | --- | --- |
| `tests/bots.test.ts` | `tests/bots.test.ts` | 26 | `1054c88dd7a4eca7f400879c3369e88cf00d7453cbee4bf732a895be1b2e74d2` |
| `tests/client.test.ts` | `tests/client.test.ts` | 23 | `95330aed83d68ce851513ae4096ac6db6832b721de2f24a778c14b5835df8bcd` |
| `tests/sandbox.test.ts` | `tests/sandbox.test.ts` | 198 | `38b51318abac9781a9d6b3034b1b1e242463fd4e4a9f65161a5252eaeb082438` |
| `tests/triage-fsm.test.ts` | `tests/triage-fsm.test.ts` | 236 | `113af410d76786160b5e085c09a99c40299860f2be18de84e5f8689f4850af84` |
| `tests/triage-labels.test.ts` | `tests/triage-labels.test.ts` | 60 | `a4f322fb4fc7401a1f84215a2f19eb47e5dd17f037306ebe1070f4f44a345e1f` |
| `tests/triage-workspace.test.ts` | `tests/triage-workspace.test.ts` | 58 | `9eac8d484fbb24b1898af54949ab1d9721c6252df896fe6a85f80f778cc46584` |

## Derived, Not Vendored

| Path | Derived from | Why it is a rewrite |
| --- | --- | --- |
| `tests/queue-coordinator.test.ts` | `tests/queue-coordinator.test.ts` | Upstream exercises the queue through `ReviewCoordinator` and the review params schema, neither of which is vendored. Rewritten against a local subclass with a minimal schema of the same shape. Every upstream case is kept, so do not diff this file against upstream — read it |

## Required Dependencies

Carried in by these files: `octokit`, `valibot`, `js-yaml`,
`@cloudflare/sandbox`, `@flue/runtime`. `valibot` and `@flue/runtime` already
existed elsewhere in this repository at compatible versions; `octokit`,
`js-yaml` and `@cloudflare/sandbox` were new to it. Versions are pinned exactly
in `package.json`, at Factory's own floors.

`src/coordination/queue-coordinator.ts` imports `cloudflare:workers` and uses
the ambient `Workflow<P>` and `DurableObjectNamespace<T>` types, which nothing
else in this repository needs — our own Cloudflare code takes its types from
Alchemy. This directory is therefore the first place requiring
`@cloudflare/workers-types`, pinned to the same major the rest of the dependency
graph already pulls in transitively.

## Taking An Upstream Change

Fetch the new commit, diff these upstream paths, apply by hand, reapply the
patch series, run `tsc --noEmit` and `bun test` here, then update the commit and
the SHAs above. No submodule and no subtree merge: twelve files do not justify
the machinery.

Drop this directory entirely if the patch series stops applying cleanly twice in
a row, or if our own capability has replaced enough of it that the remaining
lines no longer earn the provenance overhead.
