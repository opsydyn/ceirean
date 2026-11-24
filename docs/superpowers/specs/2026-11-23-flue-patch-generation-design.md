# Flue Patch Generation

Status: **drafted, not approved.** This document authorizes nothing. It does not
approve a model key, a provider call, model spend, a container, a Cloudflare
resource, a credential, a GitHub write, a push or a publication. It does not
bring the [parked executor runtime](../../roadmap.md#parked-owned-executor-runtime-2026-11-18)
forward. Read [the pilot](../../evidence/foldkit-pilot/migration-pilot-20261121.md)
and [its acceptance](../../evidence/foldkit-pilot/acceptance-20261123.md) first.

## Outcome

One Flue agent, given a target repository checkout at an immutable revision and a
restricted tool surface, produces a migration patch that the existing acceptance
contract can judge, and the run records what it touched and what it cost.

Success is a patch that passes the target repository's own checks without a human
writing the diff. A recorded failure is an acceptable outcome of this slice; a
patch a human wrote is not, because that is what the pilot already did.

## Why this is next

Decided on 2026-11-23, ahead of
[Reliable Publication](../../roadmap.md#3-reliable-publication-after-the-flue-slice).
Publication automates the last mile. The pilot's acceptance showed that a bundle
green on its own pull request can both break the target's `main` and fail to
reach consumers, so automating that verdict first would industrialise a signal we
now know to be incomplete. Flue producing the patch is the first mile, and it has
never run.

## Three gaps found while scoping

### 1. There are no existing restricted worker tools

The roadmap item reads "give Flue only the existing restricted worker tools". No
such tools exist. The repository defines exactly one Flue tool:

```
probes/bun-effect-flue/src/flue-probe.ts   defineTool({ name: 'record_token' })
```

It records a synthetic token and returns its sequence number, against a
`fauxProvider` with `env: {}`. That is a compatibility probe, not a worker tool
surface.

The pattern exists upstream, in the vendored substrate: `vendor/factory/src/triage/sandbox.ts`
wraps Flue's bash tool with `boundAgentCommand`, forces `GIT_TERMINAL_PROMPT=0`
and imposes a hard timeout, because Flue bounds a command only when the model
passes `timeout` and one stuck command otherwise runs until the container dies.
Running that path is slice 5. So the tools a migration needs — read a file, write
a file, search, run one bounded check — have to be designed and built here, and
the upstream module is the reference for their bounds, not their implementation.

### 2. The sandbox port cannot tell the agent why a check failed

This is the central design decision of the slice.

`MigrationSandboxDriver.exec` in `packages/engine/src/migration-sandbox-port.ts`
returns `SandboxExecution`, which is `Schema.Struct({ exitCode })`. There is no
stdout and no stderr. The discard is deliberate and consistent:
`probes/cloudflare-executor/src/preparation-process.ts` collects stderr under a
4096-byte bound and then drops it, so diagnostics stay sanitized.

That is defensible for a preparation step whose only question is "did it work".
It is fatal for this slice. The pilot took four rounds, and the first two
failures were consistency checkers that named the files they objected to — that
output is how the surface was discovered at all. An agent given only an exit code
is blind in exactly the loop this slice exists to test. It would also make
failure indistinguishable: a lint error, a test failure and a timeout all arrive
as a non-zero integer, and only the timeout is separable, by `TIMEOUT_EXIT_CODE`.

Three ways out, to be decided rather than assumed:

1. **Bounded redacted capture.** Return output alongside the exit code, length-
   capped and filtered, as the sandbox already caps and filters elsewhere. The
   smallest change; it reopens a channel that was deliberately closed, so the
   redaction rules become a security surface.
2. **A structured check-result contract.** The target repository's checkers emit
   a machine-readable result the agent consumes instead of raw output. Cleanest
   boundary; it requires the target to cooperate, which a repository we do not
   own will not.
3. **Artifacts from the checkout.** The agent reads report files the checks
   already write, through the same restricted read tool as any other file. No new
   channel; it only works where checks write reports, and says nothing when a
   check dies early.

None is free, and the choice shapes every tool in gap 1. It should be settled
before implementation, not during it.

### 3. No model budget has been approved

The roadmap item also reads "and approved model budget". None exists. The only
recorded figure is about **$0.13 per candidate**, from
[the Factory assessment](../../assessments/astro-factory-foundation-20261121.md):
that is Cloudflare Sandbox container cost on `standard-2`, not model spend. A
budget has to be set as a number with a hard stop, per run and in total, before
any provider call, and the run has to refuse rather than exceed it.

## The provider boundary

Our probe runs a faux provider. The vendored substrate bundles only
`cloudflare-ai-gateway`, with credentials held in Factory-scoped Worker secrets,
so inheriting its model path implies the gateway and a Cloudflare credential —
slice 5, and a wider boundary than this slice needs.

The alternative is a direct provider locally, with one key supplied at the process
boundary and never written into the repository, under the standing rule that no
credential enters a repository process. That is narrower but new.

Which boundary to open is the owner's decision and is a separate gate either way.

## What the pilot already specified

The pilot is an unusually exact acceptance target, and this slice should be judged
against it rather than against a synthetic task:

- Four rounds to green, three of them failures.
- 18 files, against the 7 manifests a dependency bot would touch.
- Versions hidden in skill assets, Markdown prose and generated-starter templates.
- One genuine judgement call — a compatibility policy the maintainer decided, not
  a mechanical edit.

So the agent's required behaviour includes stopping. When it reaches a question
like round 4's, it should report and ask rather than choose; a run that silently
picks a compatibility policy has failed even if the checks pass.

## Slices

1. **Tool surface, offline.** Read, write, search and one bounded exec over a
   checkout, with the faux provider and no model key. Proves the tools and their
   bounds, and costs nothing.
2. **Failure visibility.** Implement whichever option gap 2 resolves to, with
   tests that an agent can distinguish a lint failure, a test failure and a
   timeout, and that redaction holds on adversarial output.
3. **One provider call under budget.** The first model spend, its own gate, with
   the refusal path tested before the spending path.
4. **One recorded attempt at the pilot's own upgrade**, judged by the acceptance
   contract, with tool calls, rounds and cost recorded, and compared against the
   human-agent patch at `d30bbf5a`.

Slices 1 and 2 need no credential and no spend. They are the implementable part
of this document.

## Separate gates

Each of these remains its own explicit approval and none is granted here: a model
key or any provider credential; the first provider call and its budget; any
container or Cloudflare resource; a GitHub App installation or any repository
write; running against a repository the maintainer does not own.

## Limits

This is a scope, not a design of the agent's prompt, its reasoning or its model
choice, and it does not claim Flue can do this. It asserts only that the three
gaps above are real and that the first two can be closed without spending
anything. The pilot remains the only evidence of a completed migration, and it
was produced by a human-triggered agent.
