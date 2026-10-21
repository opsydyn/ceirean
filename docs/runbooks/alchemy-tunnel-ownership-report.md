# Alchemy Tunnel Ownership Qualification

Status: reproduced offline; remote preparation remains blocked. This is a local
upstream report draft, not a filed issue or an applied provider fix.
The owner instructed that this report must stay local; do not submit it.

## Proposed Issue

Title: `Cloudflare Tunnel silently reuses foreign same-name resources despite adopt: false`

Environment: Alchemy `2.0.0-beta.83`, Effect `4.0.5`, Bun `1.4.2`.
The published `latest` tag was checked on 2026-10-21; `next` is beta.72, not a fix.
The current upstream provider at commit
[`10849d0`](https://github.com/alchemy-run/alchemy/blob/10849d0668c6df55569f7db8c5aae4f0c76780a7/packages/cloudflare/src/Tunnel/Tunnel.ts)
retains the same ownership paths after moving into the Cloudflare package.

### Expected

Without explicit adoption or positively verified ownership, a same-name tunnel
must be rejected before fetching its connector credential or mutating it.
An empty preflight result must not permit a conflicting tunnel that appears
before reconciliation to be claimed. Read-only preflight is not an ownership lock.

### Observed

Two offline cases use the actual published Tunnel provider and Distilled request/
response machinery, replacing only the HTTP transport. No cloud provider function
is mocked. Credentials, account ID, tunnel ID and hostname are synthetic; the
transport accepts only `cloudflare.invalid` and has no network implementation.

| Case                           | Inputs                                                                                                                     | Actual result                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Existing foreign tunnel        | `read` has no prior output; explicit name; `adopt: false`; list returns a matching tunnel                                  | Existing ID and connector credential returned; `Unowned.is(output)` is false                    |
| Tunnel appears after preflight | First `read` list is empty; reconcile has no prior output/olds and `adopt: false`; its next list returns a matching tunnel | Existing ID returned; configuration PUT sent; connector credential fetched; no create attempted |

The second case's synthetic request sequence is:

```text
GET tunnels          -> no matching tunnel (preflight)
GET tunnels          -> foreign same-name tunnel (reconcile)
PUT configurations   -> writes the foreign tunnel's routing
GET token            -> fetches its connector credential
```

The first case is relevant to the engine's documented ownership contract:
plain `read` attributes are treated as owned, whereas `Unowned` attributes
are rejected when adoption is off. The fixture directly verifies the provider
return marker, not a full planner/apply run. The second case directly verifies
the reconciler's outgoing HTTP writes, without a live Cloudflare account.

### Cause

`read` finds a matching name without prior resource output and returns ordinary
attributes. It does not positively establish ownership or mark the result
`Unowned`. In `reconcile`, `findTunnelByName(name)` runs whenever observing a
prior ID yields no result, including first creation. The returned match is reused
before the `news.adopt` condition, which guards only the create-error fallback.

### Suggested Acceptance Criteria

- Existing matching names without verified ownership are marked unowned or
  rejected; no implicit credential acquisition or mutation.
- First creation with adoption off does not reuse a newly appeared name;
  a conflict fails before configuration writes or token acquisition.
- Owned updates continue to address their persisted ID, not substitute a
  different same-name tunnel after a missing/failed observation.
- Auth, permission, rate-limit and server errors are not evidence of absence.
- Explicit adoption uses one clearly documented opt-in, tested separately.
- Recovery after lost state requires positive ownership evidence or explicit
  recovery/adoption, rather than silently claiming a name.

## Local Evidence

Run from the Ceirean worktree root:

```sh
bun --no-env-file --no-install test packages/infrastructure/tests/tunnel-ownership.test.ts
```

These are characterization tests: a pass confirms the unsafe pinned behavior,
not readiness to deploy. They must be replaced with fail-closed contract tests
when a provider fix is qualified. The separate rehearsal test asserts the real
stack body refuses all resource registration while qualification is blocked.
The fixture is repeatable with `--rerun-each 2` and never reads auth profiles,
environment credentials, PEMs, the real webhook secret or the real SQLite ledger.

## Upstream Search

Public issue searches for `tunnel adopt` and `Unowned tunnel` returned no matches
on 2026-10-21. This is a bounded search, not proof that no related issue exists.
An older [Tunnel hardening PR #216](https://github.com/alchemy-run/alchemy/pull/216)
was closed as superseded by #249. Its adoption guard concerns the create-error
fallback and does not close the pre-create lookup path reproduced here.
No fixed published release was found; no preview package or vendor patch was installed.

## Disposition

Preserve all existing lint rules and the current dependency-checking policy.
The owner accepted a stable random-suffixed name, fresh collision preflight,
reviewed creates and preserved state as a bounded mitigation for supervised
preparation. This does not fix the provider or eliminate race risk. The entrypoint
remains gated while type-policy and operational preparation are pending.
Publishing this report is explicitly disallowed. Opening an upstream PR, changing
SDK adoption semantics locally, installing a preview or accepting a typecheck
exception are separate next actions, not implied by this diagnostic result.
Do not configure credentials, deploy, start a connector/listener, enable webhooks
or run the live rehearsal without the separately required approvals.
