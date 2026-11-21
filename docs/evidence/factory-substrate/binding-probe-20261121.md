# Factory Binding Probe

Recorded 2026-11-21. Verdict: **the async-Worker binding form works for plain
classes we do not author.** Slice 2 of
[the vendoring design](../../superpowers/specs/2026-11-21-factory-substrate-vendoring-design.md)
is satisfied. Typecheck only: nothing was deployed, no image was built, no
Cloudflare account was contacted and no credential was used.

## What Was Asked

The published Alchemy documentation shows Durable Objects declared only
through its Effect combinator, `Cloudflare.DurableObject<Self>()(name, impl)`,
which is also how our own objects are written in `probes/cloudflare-ledger`.
The vendored factory substrate declares plain `DurableObject` subclasses and
re-exports `@cloudflare/sandbox`'s `Sandbox` unchanged. If only the combinator
form could be bound, every vendored coordinator would need rewriting and the
`Sandbox` class — which we do not own — could not be hosted at all.

## What Was Established

`probes/factory-binding` typechecks clean under `tsc --noEmit` on
`alchemy@2.0.0-beta.83` as patched in this repository, establishing four
things against the installed package rather than the documentation:

| Claim                                                    | How it is expressed                                                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A plain `DurableObject` subclass binds by class name     | `MigrationCoordinator extends QueueCoordinator` (the vendored base), bound as `Cloudflare.DurableObject<MigrationCoordinator>('MIGRATION_COORDINATOR', { className: 'MigrationCoordinator' })`                    |
| A plain `WorkflowEntrypoint` subclass binds the same way | `Cloudflare.Workflow<MigrationParams>('MIGRATION_WORKFLOW', { className: 'MigrationWorkflow' })`                                                                                                                  |
| A class we do not author can host a container            | `Sandbox` re-exported from `@cloudflare/sandbox`, bound as `Cloudflare.Container('SANDBOX', { image: 'docker.io/cloudflare/sandbox:0.12.5', className: 'Sandbox', instanceType: 'standard-2', maxInstances: 1 })` |
| `InferEnv` resolves all three for an ordinary handler    | `async fetch(request, env: Cloudflare.InferEnv<typeof FactoryBinding>)` calls `env.MIGRATION_COORDINATOR.getByName(...).enqueue(...)` and passes `env.SANDBOX` to `getSandbox`                                    |

The decisive evidence is in the installed source, not the docs. `WorkerProps`
says of its `env` prop: "`env` is the only option for async (non-Effect)
Workers." `Container` carries a `~alchemy/Container/ClassName` marker whose
comment reads "The Durable Object class name this container backs when bound
on an async Worker's `env`". The `DurableObject` module documents the async
form with a plain `export class Counter extends DurableObject` example.

## Corrections To The Design Document

- The docs' `bindings: { ... }` prop does not exist in beta.83. The prop is
  `env`.
- `Cloudflare.Workflow` takes **one** type parameter, the workflow's params.
  Passing two selects the Effect-implementation overload and fails with a
  `className` property error, which is how this was found.
- An `image`-based container is bindable on an async Worker's `env`. A `main`-
  based (Effect-bundled) container is explicitly **not**: its application is
  created by a Layer inside an Effect-native Durable Object host. Use the image
  form for the sandbox.

## Boundaries

The stack body refuses unless `CEIREAN_PREPARE_FACTORY_BINDING` is exactly
`approved`, and the probe's Moon project declares `typecheck` and nothing else.
There is no test task, because a binding declaration has no behaviour to
assert without a deploy.

What this does not establish: that the Worker deploys, that the container
starts, that the Sandbox runs a command, that migrations are expressible, or
that costs are acceptable. Each remains its own approval. The placeholder
`MigrationWorkflow` does no migration work; it exists so the stack has a real
class to bind.
