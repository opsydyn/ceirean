# Astro Factory As Foundation

Assessed 2026-11-21. Verdict: **viable as the execution substrate, not as the
product. Adopt by vendoring the substrate, not by forking the repository.**
Everything Factory's `wrangler.jsonc` declares is expressible in the Alchemy
version already installed here, verified against that package's source.

## Approval And Evidence Boundary

Read-only source review of a shallow clone of `withastro/factory` at
`3a01af8566a580c3cefd5d1f06e1884679a1f135` (2026-11-11), held in the session
scratchpad. No dependency install, no image build, no deploy, no credential use
and no GitHub write. Nothing was added to this repository's dependency graph.

Alchemy claims are of two kinds and are labelled as such. **Verified** claims
were read from the source of the `alchemy@2.0.0-beta.83` already installed in
this repository's Bun store, under `src/Cloudflare/`. **Docs-only** claims were
read from `alchemy.run` on 2026-11-21 via a fetch subagent and are _not_
verified; where the published docs and the installed package disagree, the
installed package wins and the disagreement is recorded. No Alchemy command was
run: nothing here was deployed, planned or applied.

This assessment is not approval to fork, vendor, install, deploy or publish.

## What Factory Is

| Property        | Observed                                                        |
| --------------- | --------------------------------------------------------------- |
| Licence         | MIT                                                             |
| Size            | 194 tracked files; 31,614 lines of TypeScript                   |
| Tests           | 51 Vitest files, 9,173 lines, `environment: 'node'`             |
| Runtime         | Cloudflare Worker, Hono ingress, Node >= 22.19.0                |
| Package manager | pnpm 10.28.0                                                    |
| Quality tooling | Biome 2.6.2                                                     |
| Validation      | Valibot 1.4.2                                                   |
| Agents          | `@flue/runtime` and `@flue/github` 2.3.0                        |
| Isolation       | `@cloudflare/sandbox` 0.12.5, container built from a Dockerfile |
| Durable Objects | 12 bindings, 10 migration tags (`v1`..`v10`)                    |
| Workflows       | 8                                                               |
| Model access    | One provider only: `cloudflare-ai-gateway`                      |

Its README states it is "**not a general-purpose tool** for anyone to install —
the package is private by design", and directs other projects to "**fork this
repository**". There is no release, no version and no published package.

## The Overlap With The Parked Runtime

Each row is a thing [milestones B and C](../roadmaps/first-hosted-e2e.md) were
going to build, set against what Factory already runs.

| Parked Ceirean work                                      | Factory equivalent                                                                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed GitHub admission                                  | `@flue/github` channel with webhook-secret verification                                                                                                                                                                 |
| Deterministic command routing                            | `src/router.ts`, 907 lines, pure rule table, data in / data out                                                                                                                                                         |
| Single-flight per target, dedup, restart recovery        | `QueueCoordinator` Durable Object: one active and one pending entry, dedup by delivery id, 60s alarm reconciling against the Workflows API                                                                              |
| Durable run lifecycle                                    | 8 Cloudflare Workflows, one per capability                                                                                                                                                                              |
| Immutable executor image                                 | `@cloudflare/sandbox` container, image pinned to the SDK version                                                                                                                                                        |
| 909-archive offline cache, mount policy, strace observer | Not needed in this shape: the sandbox is a managed container, not a host-local Docker lifecycle we own                                                                                                                  |
| No credentials in repository processes                   | Public repos clone anonymously and blobless; private repos clone with a one-shot `http.extraHeader` token and then `origin` is removed; push injects a contents-only token into a single command, never into git config |
| Bounded execution                                        | Every sandbox command wrapped in `GIT_TERMINAL_PROMPT=0 timeout -k 5 <n>`; the Flue bash tool is wrapped so a model that omits a timeout still gets one                                                                 |
| Teardown                                                 | `destroy()` raced against a 10s timer, failures tolerated because the sandbox sleeps on its own                                                                                                                         |
| Evidence export to a reviewed recipient                  | R2 report buckets, private and public output paths                                                                                                                                                                      |
| Separately approved draft PR, never auto-merge           | Personas never merge; the fix branch is force-pushed, the PR is separate                                                                                                                                                |
| Per-repository policy from maintainer-controlled content | `.github/factory.yml`, read only from the default branch or the PR target branch, "never from PR heads or forks"                                                                                                        |

The code quality is high and the comments carry the reasoning, not just the
what. `src/triage/fsm.ts` gates every mutating action on the issue's live state
rather than the delivery's action, with the regression it prevents written out.
`commitAndPushFastForward` rebases once on rejection and aborts rather than
resolve a conflict, "so a human's commits are never rewritten or discarded".
`git fetch` plus `git rebase` is used in place of `git pull` because pull
records its command line, token URL included, in the reflog. This is the
reasoning the parked milestones were accumulating, already paid for.

## What Factory Does Not Supply

1. **No migration capability.** Its eight capabilities are triage, review,
   adversary, code author, release security, PR safety, merge risk and advisory
   triage. There is no dependency upgrade, source-API migration or codemod
   anywhere in it. This is the entire product.
2. **No acceptance gate.** Triage ends when a human confirms: reproduce, fix,
   optional preview release, reporter agrees. A migration has no reporter — the
   target repository's own suite is the only verdict — and nothing in Factory
   expresses "this candidate is accepted only if the frozen contract passes
   unchanged". The acceptance contract stays ours.
3. **No ledger of record.** Coordinator state is a Durable Object key, enough to
   serialise and dedup, not an auditable history of what was decided and on what
   evidence.
4. **One model provider.** `flue.config.ts` deliberately exposes only
   `cloudflare-ai-gateway`; everything reaches models through that gateway.

## Alchemy Under It

This repository already depends on `alchemy@2.0.0-beta.83` in
`packages/infrastructure` and `probes/cloudflare-ledger`, already carries
`patches/@alchemy.run%2Fcloudflare-runtime@2.0.0-beta.83.patch` (Effect fibre
scoping in remote bindings), and already writes stacks as
`Stack(name, { providers, state }, program)`. Alchemy v2 is "Infrastructure as
Effects"; the stack body is an `Effect.gen`. So this is not a new tool to adopt,
it is the tool we are already on.

Note one thing before the table: the published docs describe
`@alchemy.run/cloudflare`, which is **not** what beta.83 exposes. The installed
surface is subpaths of the `alchemy` package — `alchemy/Cloudflare`,
`alchemy/Cloudflare/Containers`, `alchemy/Cloudflare/Workers/DurableObjectState`
— which is what our own stacks already import. Read the docs for intent and the
installed source for API.

Coverage for everything Factory's `wrangler.jsonc` declares, verified in the
installed source unless marked docs-only:

| Factory needs               | Alchemy resource (docs)                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker + Hono fetch handler | `Cloudflare.Worker(name, { main: "./src/worker.ts" })`; `main` is a plain module path and the async-Worker path takes an ordinary `async fetch` handler                                                                                                     |
| Durable Objects             | `bindings: { Name: Cloudflare.DurableObject<Class>("Name", { className }) }`, where `className` matches "the exported `DurableObject` subclass in your worker source file". Defaults to the namespace name. `Cloudflare.InferEnv` types the handler's `env` |
| DO migration tags           | Driven by Alchemy, not by us: the provider emits `{ new_tag: "alchemy:v1", new_sqlite_classes }` on first deploy, then diffs deployed against declared classes and emits `new_sqlite_classes` / `deleted_classes` under a bumped tag                        |
| Workflows                   | `Workflow(name, { className })` props-only form, which "carries just enough metadata to emit the `workflow` binding for an async Worker"; plus `workflowName`, `limits`, `schedules`                                                                        |
| Container from a Dockerfile | `alchemy/Cloudflare/Containers`: `dockerfile?: string \| InlineDockerfile`, image refs resolved by digest in the provider. We already drive `ContainerClient`, `ContainerProcess`, `ContainerExecOptions` and `ContainerStartupOptions` from this package   |
| Worker Loader               | `alchemy/Cloudflare/Workers/WorkerLoader` exists in the installed tree                                                                                                                                                                                      |
| R2 buckets                  | `Cloudflare.R2.Bucket` _(docs-only)_                                                                                                                                                                                                                        |
| Secrets                     | `Config.Redacted("NAME")` bound as `secret_text`, sourced from the stack's secrets option — dotenv, Doppler or Infisical _(docs-only)_                                                                                                                      |
| Queues                      | `Cloudflare.Queues.Queue`, `WriteQueue`, `Consumer`; at most one Worker consumer per queue _(docs-only)_                                                                                                                                                    |
| Zone, DNS, custom domain    | `Cloudflare.Zone.Zone`, `Cloudflare.DNS.Record`, `Worker({ domain })`, `Workers.WorkerRoute` _(docs-only, though `DNS` and `Tunnel` are already imported by our stacks)_; `adopt(true)` for pre-existing ones, which we already use                         |

### The pivotal question, resolved

Factory declares 12 plain Durable Object classes and exports them by name from
`src/cloudflare.ts`, including `Sandbox` re-exported straight from
`@cloudflare/sandbox`. The published docs show definition through an Effect
combinator, `Cloudflare.DurableObject<T>()("Name", Effect.gen(...))`, which
would have meant rewriting every coordinator and would have sunk the "build on
top" premise — we do not author the Sandbox class.

The installed package documents and implements the other path explicitly. Its
own example is a plain `export class Counter extends DurableObject` from
`cloudflare:workers` in a worker module, bound from the stack as
`bindings: { Counter: Cloudflare.DurableObject<Counter>("Counter") }`, consumed
from a plain `async fetch(request, env)` through `Cloudflare.InferEnv`. That is
precisely Factory's shape, and Alchemy computes the DO migration tags itself. So
the substrate is adoptable without rewriting its runtime, and this is no longer
a go / no-go spike.

Three cautions remain:

- **Docs and installed package disagree**, on the provider's package name and on
  how DO classes are declared. The docs describe an `exports`-based flow and warn
  that a Worker cannot return to the `migrations` flow once deployed that way;
  beta.83 emits classic `migrations`. Trusting the docs over the installed source
  would have produced a wrong plan here, so treat every docs-only row above as
  provisional.
- **We are on a patched pre-release.** `alchemy@2.0.0-beta.83`, plus our own
  patch to `@alchemy.run/cloudflare-runtime` for Effect fibre scoping in remote
  bindings. Adding 12 DO classes, 8 Workflows and a container to a patched beta
  is a real upgrade-path risk, and the patch has to be re-landed on every bump.
- **No documented `wrangler.jsonc` interop, and no documented equivalent of
  `secrets.required`** or `wrangler secret put`. Either the stack owns the
  configuration or wrangler does; Factory relies on `secrets.required` to fail
  fast on a missing secret, so that check becomes ours to reproduce.

## Where Effect Survives

Effect 4.0.5 is pinned across our probes and is the subject of
[ADR-0001](../decisions/0001-adopt-effect-and-domain-boundaries.md). Factory
contains no Effect: it is Hono, Valibot and plain `DurableObject` subclasses.
Three tiers keep both true at once:

| Tier                                                         | Language                        | Rule                                      |
| ------------------------------------------------------------ | ------------------------------- | ----------------------------------------- |
| Infrastructure                                               | Alchemy stack, Effect           | Ours already                              |
| Our capability: migration, acceptance contract, ledger       | Effect 4, Effect Schema, XState | Ours, written as we write everything else |
| Inherited substrate: router, coordinators, sandbox, channels | Plain TypeScript, Valibot       | **Do not rewrite to Effect**              |

The third rule is the load-bearing one. Rewriting 31,614 lines into Effect
discards exactly what makes Factory worth having — the paid-for reasoning in its
comments and the 9,173 lines of tests pinning it — and buys uniformity, which is
not a verification signal. Put the boundary at the capability edge: a Factory
workflow step calls into an Effect program; the program returns data. If that
boundary cannot be kept clean, that is a finding against the whole approach, and
it surfaces in the first slice rather than the fifth.

## `@alchemy.run/domain` Is Not Domains

Worth saying plainly, because the link suggests otherwise: `alchemy.run/domain`
documents `@alchemy.run/domain`, a domain-driven-design runtime — Commands,
Aggregates, Events, Views, Projections, Policies, Sagas. It is not domain
registration or DNS. The Cloudflare DNS, zone and custom-domain material is
under `/cloudflare/networking/...` and is listed in the table above.

What it actually offers is closer to our ledger than to our infrastructure: an
aggregate instance maps to "one Durable Object, named by its id"; a command
receipt is stored under the command's id so a replay "returns the stored receipt
without deciding again"; `decide` returns events or a typed rejection without
mutating, `evolve` must always accept; events, new state and reply "commit
together, or not at all"; sagas are Effect workflows; a deploy waits for new
consumers to receive prior history. Dedup, replay and atomic commit are
properties the GitHub admission inbox and the migration ledger already need.

Two reasons not to reach for it yet. Where events are persisted is **not
documented**, and no stability label is given. And ADR-0001 states that DDD here
"does not require event sourcing, distributed services or a framework-specific
aggregate runtime" — which is precisely what this is. Adopting it is an ADR-0003
that revises ADR-0001, not an implementation detail.

## Toolchain Collision

| Concern                     | Ceirean                                   | Factory                            |
| --------------------------- | ----------------------------------------- | ---------------------------------- |
| Runtime and package manager | Bun 1.4.2 (pinned via `.prototools`)      | pnpm 10.28.0, Node >= 22.19.0      |
| Monorepo                    | Moon 2.5.4                                | none                               |
| Lint and format             | oxlint 1.88.0, oxfmt 0.73.0               | Biome 2.6.2                        |
| Schema                      | Effect Schema                             | Valibot                            |
| Tests                       | Bun test, Effect Arbitrary property tests | Vitest, `environment: 'node'`      |
| Build                       | Moon tasks                                | Vite 8 + `@cloudflare/vite-plugin` |

None of this is fatal and none of it is free. A vendored subtree can keep its
own Vitest and Biome configuration behind one Moon task; what it cannot do is
share our lint policy, our schema types or our property-test machinery. Note
also that Factory's **default install command is
`pnpm install --no-frozen-lockfile`**, chosen deliberately so an agent can add a
dependency mid-reproduction. For a migration pilot the frozen lockfile is part
of the acceptance contract, so this default must be overridden, not inherited.

## Three Shapes, And A Recommendation

**Fork the repository.** Take all 31,614 lines, delete the seven capabilities we
do not want, keep triage's pipeline as the migration shape. Fastest to a running
system, and it makes us the maintainer of someone else's in-house bot, including
the capabilities we deleted and the upstream changes we then cannot take.

**Vendor the substrate, write the capability.** Take the router, the
`QueueCoordinator`, the sandbox modules, `github/`, `config.ts`, the Dockerfile
and their tests — on the order of a quarter of the tree — under a vendored path
with upstream provenance recorded. Write the migration capability and the
acceptance contract ourselves, in Effect, against that substrate. Alchemy owns
the infrastructure.

**Track upstream, copy nothing.** Read Factory as the reference implementation
and write our own against the same Cloudflare primitives. No licence or
provenance questions, no inherited toolchain, and we pay again for every piece
of reasoning in those comments.

Recommended: **vendor the substrate**. It takes the parts that are genuinely
substrate, leaves the product ours, keeps Effect where it earns its place, and
does not make us the owner of seven capabilities we will never run. MIT requires the copyright notice travel with
the vendored files; record upstream SHA and path per file so a later upstream fix
can be reapplied by hand.

## Before Anything Is Committed To

Each of these is bounded, and the first two are prerequisites, not nice-to-haves.

1. **A typecheck-only stack.** Declare one plain `DurableObject` subclass and
   `@cloudflare/sandbox`'s `Sandbox` in an Alchemy stack here and typecheck it.
   No deploy, no account. The API is confirmed; this confirms the generics and
   `InferEnv` behave with a class we do not author.
2. **Factory's own suite, locally.** `pnpm install` and `vitest run` in the
   scratchpad clone, to establish the 51 test files pass outside Astro's CI
   before we rely on any of them. Requires external acquisition approval.
3. **Read the triage pipeline end to end.** `src/triage/workflow.ts` is 1,840
   lines and is the closest thing in the tree to our migration loop. This
   assessment read its sandbox, FSM and coordinator, not the workflow itself.
4. **Container economics.** `instance_type: standard-2`, `max_instances: 10`,
   `sleepAfter: '1h'`. A FoldKit install and full suite per candidate, against
   bounded cost, needs a number before a hosted run is approved.
5. **Alchemy gaps.** Confirm against the installed package, not the docs:
   fail-fast on missing secrets, and whether a container image can be pinned by
   digest rather than rebuilt.

## What This Does Not Change

The [parking record](../roadmap.md#parked-owned-executor-runtime-2026-11-18)
stands, and this assessment strengthens it: a managed sandbox makes the unbuilt
image, the 909-archive cache and the observer programme unnecessary in this
shape, so there is even less reason to resume them. The next approval is still
one FoldKit migration pilot against the repository's own CI. Nothing here is a
reason to bring it forward, because none of this substrate is needed to answer
the question that pilot asks, which is whether an agent-produced upgrade saves
the maintainer time. Owned isolation remains the prerequisite for the Repeatable
Service outcome — running untrusted patches against repositories we do not own —
and that is the outcome this substrate serves.
