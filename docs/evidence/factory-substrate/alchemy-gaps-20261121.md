# Two Alchemy Claims, Settled Against The Installed Package

Recorded 2026-11-21. Prerequisite 5 of
[the Factory assessment](../../assessments/astro-factory-foundation-20261121.md).
**Done.** Both questions were answered by reading `alchemy@2.0.0-beta.83` in
this repository's Bun store, not the published documentation. No Alchemy command
was run and nothing was deployed.

## Fail-Fast On A Missing Secret

**There is no equivalent of wrangler's `secrets.required`, and a missing secret
fails during apply rather than at plan.**

Alchemy's secrets are Effect `Config` values. A binding declared as
`Config.Redacted('NAME')` is resolved through an Effect `ConfigProvider` whose
sources come from the stack's `secrets` option — `Secrets/DotEnv.ts`,
`Secrets/ProcessEnv.ts`, Doppler or Infisical. `WorkerAsyncBindings.toBinding`
then classifies the resolved value: a `Redacted` becomes `secret_text`, a
string `plain_text`, anything else `json`.

Two consequences, in opposite directions.

A missing secret cannot deploy a Worker with an absent binding, because the
value must resolve before the script is uploaded; an unresolvable `Config`
fails with Effect's `ConfigError`. So it does fail, loudly.

But it fails _late_. `Plan.ts` describes a node's input expression as "resolved
against tracker outputs **during apply**", so a plan does not prove the secrets
exist. In a multi-resource stack that means partial progress before the failure.
Factory gets its early failure from wrangler's declarative
`secrets: { required: [...] }`, which has no counterpart here.

**What to do about it:** reproduce the check ourselves. Before the stack runs,
assert that each required secret resolves, and refuse with a named list if any
does not. That is a few lines and it restores the property we would otherwise
lose by moving off wrangler. It is not yet written.

## Pinning A Container Image By Digest

**Better than the documentation suggested: digests are the deployed form either
way.**

`ContainerProvider.resolvePublishedImageRef` takes the digest embedded in the
image reference when one is present — `digestFromImageRef` splits on the last
`@` and accepts the remainder only if it is a valid registry digest — and
otherwise fetches the digest from the registry with pull credentials. Either
path returns `repository@digest`, so what reaches Cloudflare is always a
digest-pinned reference.

So both forms are safe:

| What we write                                    | What happens                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `image: 'docker.io/cloudflare/sandbox:0.12.5'`   | the tag is resolved to a digest at deploy time and the digest is what deploys |
| `image: 'docker.io/cloudflare/sandbox@sha256:…'` | used as-is, with no registry round trip                                       |

The tag form in `probes/factory-binding` is therefore already pinned in effect,
not merely by convention. The explicit digest form is still preferable for a
qualification run, because it removes a registry lookup from the deploy path and
records the exact image in our own source rather than in Cloudflare's resolution
of a mutable tag. Worth switching when a real container is approved; not worth
churning the typecheck-only probe for now.

`ImageContainerProps` also accepts `context` plus `dockerfile` for a local
build, and the docs' claim that a `main`-based (Effect-bundled) container cannot
be bound on an async Worker's `env` is confirmed in the source by the comment on
`Container`'s zero-argument form.

## What Is Still Docs-Only

The rest of the Alchemy table in the assessment — R2 buckets, queues, zones, DNS
records and custom domains — remains unverified against the installed package.
Nothing in the vendoring work needed them yet, and the two that did need
checking are the two settled here.
