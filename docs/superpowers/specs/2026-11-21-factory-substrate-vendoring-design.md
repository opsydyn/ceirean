# Factory Substrate Vendoring

Status: **drafted, not approved.** This document authorizes nothing. It does not
approve dependency installation, vendoring, a Cloudflare deploy, an image build,
a GitHub App installation, a credential, a push or a publication. It does not
bring the [parked executor runtime](../../roadmap.md#parked-owned-executor-runtime-2026-11-18)
forward, and it does not substitute for the FoldKit migration pilot, which
remains the next approval. Read the
[assessment](../../assessments/astro-factory-foundation-20261121.md) first.

## Outcome

A vendored, pristine copy of twelve source files from `withastro/factory`, held
under one path with upstream provenance and licence recorded, re-pointed at our
own environment type by a recorded patch series, covered by their own tests
running under our gates. Our migration capability, acceptance contract and
ledger are written against it in Effect and are not part of the vendored tree.

## The Coupling Finding

The substrate is not separable by reading the directory names. Taking the
obvious set — router, coordinator, sandbox, `github/`, `config.ts` — produces a
48-file, 7,713-line closure that includes the whole release-security subsystem.

The cause is one type import. `src/github/client.ts` reads
`import type { WorkerEnv } from '../env.ts'`, and `src/env.ts` is a god-type
importing all eight coordinators and their contracts. `credentialsFromWorkerEnv`
uses exactly two fields of it, `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`.
`src/triage/sandbox.ts` imports the same type for one field, `TRIAGE_SANDBOX`.

Narrowing those two signatures to structural types collapses the closure from
48 files to 12 and from 7,713 lines to 2,005. That is the whole trick, and it is
two edits.

## What Is Vendored

Twelve files, 2,005 lines, at `withastro/factory@3a01af8`:

| File                                    | Lines | Why                                                                                                             |
| --------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `src/coordination/queue-coordinator.ts` | 233   | Per-entity serialisation, dedup by delivery id, alarm reconciliation. The single most valuable file in the tree |
| `src/triage/sandbox.ts`                 | 450   | Hardened clone, credential handling, bounded commands, commit/push, teardown                                    |
| `src/triage/sandbox-utils.ts`           | 182   | Identifier and ref assertions, shell quoting, command bounding, token redaction                                 |
| `src/github/issues.ts`                  | 473   | Issue, comment and label operations against the API                                                             |
| `src/github/skill.ts`                   | 160   | Skill directory validation and snapshotting from maintainer-controlled content                                  |
| `src/github/client.ts`                  | 78    | App auth and scoped short-lived installation tokens                                                             |
| `src/github/content.ts`                 | 62    | Repository file reads pinned to a ref                                                                           |
| `src/github/bots.ts`                    | 23    | Bot-author detection; prevents self-trigger loops                                                               |
| `src/triage/labels.ts`                  | 155   | Label state vocabulary                                                                                          |
| `src/triage/fsm.ts`                     | 92    | Event plus current label to action, with the live-state gate                                                    |
| `src/models.ts`                         | 79    | Model specifier validation                                                                                      |
| `src/thinking.ts`                       | 18    | Thinking-level vocabulary                                                                                       |

Plus `Dockerfile` (36 lines) as a starting point, not as a pin: it installs
pnpm 10 globally, which a Bun target does not want.

## What Is Not Vendored, And Why

- **`src/router.ts` (907 lines).** A rule table for eight capabilities we do not
  have. Take the discipline — pure function, data in and data out, delivery id
  threaded through, bot authors dropped before dispatch — and `isBotAuthor`
  verbatim. Write our own table for our own events.
- **`src/config.ts` (702 lines).** Validates eight capability config sections
  with Valibot. Our per-repository policy is different and is Effect Schema.
  Keep two decisions from it: configuration is read only from the default branch
  or the PR target branch, never a PR head or fork; and an invalid model
  specifier fails at config load, not at the first model call.
- **`src/env.ts`.** Replaced by ours. This is the coupling point.
- **The eight capabilities** — triage, review, adversary, author, release
  security, PR safety, merge risk, advisory — and their workflows, coordinators,
  agents, contracts and skills. We run none of them.
- **`src/triage/workflow.ts` (1,840 lines).** Read it, do not take it. It is the
  closest analogue to our migration loop, and the thing we are writing.
- **Flue agent definitions.** Ours are Effect; theirs are not.

## Layout And Provenance

```
vendor/factory/            upstream files, pristine
  LICENSE                  MIT, Copyright (c) 2026 Astro, copied verbatim
  PROVENANCE.md            upstream URL, commit, date, per-file path and SHA-256
  src/...                  original relative paths, unchanged
patches/vendor-factory/    our edits, as a numbered patch series
```

Pristine files plus a patch series, rather than edited files, because that is
what makes an upstream fix reapplyable: `git apply` the series onto a fresh
copy and see which hunks fail. The repository already uses this shape for
`patches/@alchemy.run%2Fcloudflare-runtime@2.0.0-beta.83.patch`.

Original relative paths are kept so an upstream diff lines up without a mapping
table.

MIT needs the notice to travel. Factory itself sets the precedent: its
`skills/review/LICENSE` carries the upstream MIT notice and a link to the
source. Mirror that exactly. There are no per-file copyright headers in
Factory's `src`, so one `LICENSE` at the vendored root plus `PROVENANCE.md` is
the obligation met. Do not reformat vendored files: oxfmt over them would
destroy diffability for no gain.

## The Patch Series

1. **`0001-narrow-worker-env.patch`** — `credentialsFromWorkerEnv(env: { GITHUB_APP_ID: string; GITHUB_APP_PRIVATE_KEY: string })` and `getTriageSandbox(env: { TRIAGE_SANDBOX: DurableObjectNamespace<Sandbox> }, id: string)`. Deletes the `../env.ts` imports. This is the patch that makes vendoring possible.
2. **`0002-rename-triage-paths.patch`** — the sandbox module hard-codes `/repo`, `/triage`, `triage/` git excludes and `/tmp/factory-commit-message.txt`. Rename to our own vocabulary, or decide deliberately to keep theirs. Cosmetic, and cheaper to do once than to diff forever.
3. **`0003-tests-to-bun.patch`** — see below.

Three patches is the budget. A fourth means the file is being rewritten rather
than adapted, and belongs in our own tree instead.

## Tests

Seven of Factory's 51 test files cover the vendored set: 796 lines over the
queue coordinator (195), the triage FSM (236), the sandbox (198), labels (60),
the workspace helpers (58), bots (26) and the client (23).

All of them are plain Vitest on `environment: 'node'`. None needs Miniflare or
the Workers vitest pool; `tests/queue-coordinator.test.ts` fakes the platform
with `vi.mock('cloudflare:workers', ...)` returning a stub `DurableObject` base
class. They are therefore portable.

**Port them to `bun:test`** rather than add Vitest and Biome to our toolchain:
`vitest` to `bun:test`, `vi.mock` to `mock.module`, `vi.fn` to `mock`. One
patch, then our existing Moon test task covers them and oxlint policy applies
to our code only. Two of the seven need re-pointing as well as porting:
`queue-coordinator.test.ts` imports `review/contracts.ts` and
`review/coordinator.ts`, so it must exercise our own `QueueCoordinator`
subclass, and `client.test.ts` imports `env.ts`.

The alternative — keep Vitest behind one Moon task — leaves the tests
byte-identical and upstream-diffable, at the cost of a second test runner, a
second lint config and a second expectation vocabulary in the repository. Not
recommended, but it is the honest fallback if the port finds behaviour that
depends on Vitest semantics.

Vendored tests must pass before any of our code is written against the
substrate. A vendored file whose test we cannot run is not vendored, it is
copied.

## Toolchain

| Concern          | Decision                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager  | Bun 1.4.2 as pinned. Factory's pnpm is not inherited                                                                                                                      |
| Build            | One Moon project at `vendor/factory`, `typecheck` and `test` tasks only                                                                                                   |
| Lint and format  | Vendored paths excluded from oxlint and oxfmt. Our code is not                                                                                                            |
| Schema           | Valibot arrives as a real dependency of the vendored files. Do not convert them to Effect Schema; keep Valibot at the vendored boundary and Effect Schema in our own code |
| New dependencies | `octokit`, `valibot`, `js-yaml`, `@cloudflare/sandbox`, `@flue/runtime`. The first four are new to this repository                                                        |
| Install default  | Factory's `pnpm install --no-frozen-lockfile` default is explicitly not inherited: the frozen lockfile is part of our acceptance contract                                 |

## Upstream Tracking

Record in `PROVENANCE.md` the upstream commit, the date, and a SHA-256 per
vendored file. To take an upstream change: fetch the new commit, diff the twelve
paths, apply by hand, reapply the patch series, run the vendored tests, update
the SHAs. No automation, no submodule, no subtree merge — twelve files do not
justify the machinery, and a quarterly manual pass is honest about how often
this actually needs doing.

Drop the vendored copy entirely if either becomes true: upstream diverges enough
that the patch series stops applying cleanly twice in a row, or our own
capability has replaced enough of the substrate that the remaining vendored
lines no longer earn their provenance overhead.

## Slices

Each slice ends in evidence, and none of them deploys anything.

1. **Vendor and prove.** Done 2026-11-21. Twelve files under `vendor/factory`
   with `LICENSE` and `PROVENANCE.md`, patches 0001 and 0002, the seven tests
   ported to `bun:test` and green at 59 tests and 144 assertions, `tsc --noEmit`
   clean. Three new dependencies, not five: `valibot` and `@flue/runtime` were
   already here at compatible versions.
2. **Bind it.** Done 2026-11-21 as `probes/factory-binding`; see
   [the binding probe](../../evidence/factory-substrate/binding-probe-20261121.md).
   A plain `DurableObject` subclass, a plain `WorkflowEntrypoint` subclass and
   `@cloudflare/sandbox`'s own `Sandbox` hosting a pinned-image container all
   bind by class name on an async Worker's `env`, and `InferEnv` resolves them
   for an ordinary `async fetch` handler. Typecheck only; no deploy, no account.
   Three corrections to this document came out of it: the prop is `env`, not the
   documented `bindings`; `Cloudflare.Workflow` takes one type parameter, its
   params; and an `image`-based container binds on an async Worker while a
   `main`-based one explicitly does not.
3. **Our router.** Done 2026-11-21; see
   [the router differences](../../evidence/factory-substrate/router-differences-20261121.md).
   The rule table already existed as `normaliseGitHubDelivery`, so the slice
   became a comparison, and the comparison found a defect: a classic bot on a
   plain user account, which GitHub reports as `User`, passed the actor gate and
   could reach admission by posting the command. Closed with the vendored
   `isBotAuthor`, plus six bot-login cases, three human controls, two
   malformed-login cases and two property laws.
4. **Our capability, offline.** Done 2026-11-21; see
   [the migration capability](../../evidence/factory-substrate/migration-capability-20261121.md).
   The acceptance contract was already built — `VerificationContract`,
   `validateReceipt` and `decideQualification` — so the gap was the middle.
   Delivered: the pure plan, the receipt projection and the sandbox port, under
   17 tests including a law joining the projection to `decideQualification`.
   The Effect capability was withdrawn once and then landed in the same
   session, with a scripted fake sandbox and tests for ordering, halting at the
   first failure and release on every path. The `CandidateVerifier` wiring then
   landed too, so `qualifyRun` drives the capability and a plan refusal reaches
   the outcome by its own reason rather than as an undecodable receipt: 28
   tests across the slice. Still ahead: a real sandbox behind the port, which
   needs a container and its own approval.
5. **Separately approved.** Anything that runs a container, touches Cloudflare,
   installs a GitHub App or uses a credential. Each its own gate.

   One requirement carried into it from
   [reading upstream's workflow](../../evidence/factory-substrate/triage-pipeline-read-20261121.md):
   the Workflow that enqueues runs through the vendored `QueueCoordinator` must
   register coordination as a step with a rollback that calls `complete`.
   Without it a crashed run holds that entity's queue slot until the
   60-second alarm reconciles. It cannot be closed before the Workflow exists,
   and it is the kind of thing that is invisible until a run dies, so it belongs
   in the plan rather than in someone's memory.

Slices 1 to 4 are local and reversible. Slice 1 needs external acquisition
approval for the new dependencies and nothing else.

## Separate Gates

Unchanged by this document, and each still requiring explicit approval:
external acquisition, image build, deployment, live execution, GitHub writes,
publication and push. No credential enters a repository process. The FoldKit
migration pilot remains the next approval, and none of this substrate is needed
to run it.
