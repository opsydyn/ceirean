# Ceirean Tunnel Preparation

Status: offline declaration tests pass; type and provider ownership qualification
are blocked. The stack entrypoint fails closed before registering any resources.
No Cloudflare resources have been applied. No CLI credential has been configured.

This private workspace declares the proposed `CeireanHooks` / `rehearsal` stack:

- A remotely managed tunnel named `ceirean-rehearsal`, without adoption.
- An exact `ceirean-hooks.opsydyn.xyz` + `^/webhook$` route to
  `http://127.0.0.1:8787`, with a final 404 catch-all.
- A proxied CNAME in zone `65de6815d54763e90ebf4e5df3a7030c` pointing to that tunnel.

The declaration refuses any provider account other than
`d95812af050c2e549a3296899b7b43b3` before registering resources. Stack outputs are
limited to the tunnel ID and endpoint. There are no connector processes,
listeners, Worker deployments, GitHub mutations or assessment activation.

The pinned Tunnel provider can reuse a same-name tunnel even with `adopt: false`:
its `read` returns an existing tunnel without an `Unowned` marker, and its
reconciler looks up/reuses names before checking adoption. A preflight check does
not close that race. This must be fixed and tested before any remote plan/apply.
No provider source patch or custom replacement provider has been introduced.
The real stack body is a deliberate configuration failure until qualification;
the proposed graph is exercised separately offline. There is no environment
switch or package deploy shortcut to bypass the gate.

## Qualification

```sh
moon run infrastructure:test --force --no-actions
moon run infrastructure:typecheck --force --no-actions
bun run check
```

Alchemy `2.0.0-beta.83` shares the existing Effect `4.0.5`; no existing lockfile
package resolution changed. Its public Cloudflare declarations pull in Workers
globals and optional database peers. Full dependency checking currently fails
with incompatible Workers/Bun/Node globals. `skipLibCheck` remains false; all
existing Effect lint rules and cohort pins remain unchanged. This is a failed
qualification gate, not permission to bypass types or deploy.
Adding Workers ambient types and database peers was tested and did not produce
a compatible host type environment; those experimental additions were removed.
The dependency set stays limited to Alchemy and its Effect platform peers.

The tests compile the actual resource graph with an in-memory state store and
offline credentials, resolve references against a synthetic tunnel ID, assert
the complete resource set and secret-free outputs, and reject a wrong account.
They do not call Cloudflare, validate a live plan or prove deployment.
An additional test proves the actual entrypoint body fails without registering
any resources, even with the approved account fixture.

## Authentication And State

Browser sign-in is not Alchemy CLI authentication. Before the first remote plan,
the owner must approve a dedicated, least-privilege credential and enter it
without exposing its contents to chat, shell history or tracked files.

Prefer a scoped API token: Cloudflare Tunnel Edit for the verified account,
DNS Edit for the exact zone, plus only provider-required read permissions.
Confirm those scopes against the actual provider reads before issuing it.
Do not use a global API key. Alchemy's OAuth flow defaults to All Scopes;
neither All nor Basic is appropriate for this tunnel-only preparation.

Use a dedicated `ceirean-rehearsal` Alchemy profile. Keep auth under protected
`ALCHEMY_HOME` outside the checkout. Never inspect or print profile JSON or tunnel
tokens. Set `ALCHEMY_TELEMETRY_DISABLED=1` for every CLI invocation. There are
deliberately no package scripts for remote plan/deploy or authentication.

Local Alchemy state contains credentials and must survive worktree removal.
Do not deploy from this temporary worktree. After qualification and integration,
run the pinned CLI from a dedicated owner-only operational directory outside
the checkout, passing the absolute `alchemy.run.ts` path, explicit profile and
stage. Alchemy anchors `.alchemy/state` to its invocation directory. Use umask
077; protect auth/state directories as 0700 and files as 0600. Preserve and back
up the state securely. Never use `Cloudflare.state()` here: that would add
Worker, Durable Object and Secrets Store resources outside this scope.

## Remote Preparation Gates

- [x] Verify the active account and zone in the Cloudflare dashboard.
- [x] Inspect the full DNS inventory: no explicit hostname conflict; preserve wildcard.
- [x] Test exact routing, the proposed resource set and secret-free outputs offline.
- [ ] Pass dependency type qualification without an unapproved exception.
- [ ] Qualify fail-closed Tunnel ownership, including same-name collision/race tests.
- [ ] Approve and configure scoped Alchemy authentication with protected custody.
- [ ] Inspect tunnels for a `ceirean-rehearsal` name collision; never adopt one.
- [ ] Review a remote plan: exactly three creates, no replacements/deletions/adoption.
- [ ] Apply only that plan; verify remote route/DNS and zero connectors.

Do not use `alchemy dev`, `--adopt`, automatic approval, or start cloudflared.
The [bounded rehearsal plan](../../docs/runbooks/ceirean-live-rehearsal-plan.md)
retains separate approval gates for connector installation, listener startup,
GitHub webhook activation and the timeboxed live session. Fallow remains queued
until rehearsal teardown, not part of this infrastructure task.

## Execution Record

2026-10-21: watched both offline tests fail against an empty declaration, then
pass against the real stack declaration. Confirmed account/zone and DNS inventory
read-only. Installed pinned dependencies without lifecycle scripts. CLI help
checked with an isolated temporary Alchemy home and telemetry disabled.

Ruling: retain full dependency typechecking and stop before authentication/apply
while the type-policy question is unresolved. The cost is delayed remote
preparation; the benefit is not presenting an unqualified toolchain as ready.

Independent review found the Tunnel adoption bypass and unsafe direct package
scripts. Verified both against the pinned provider source. Removed the scripts
and added a failing-entrypoint gate with a RED-to-GREEN test; no remote action
was attempted. Resolving the type policy alone does not clear the ownership gate.

A read-only process inspection found an older cloudflared process owned by a
separate 40k-builder worktree (started 2026-10-17). It was not stopped or modified.
No Ceirean connector was started; local port 8787 had no listener.

The approved follow-up reproduced two ownership failures against the actual
published provider with a synthetic, non-network HTTP transport. See the
[upstream report draft](../../docs/runbooks/alchemy-tunnel-ownership-report.md)
for the request traces, pinned upstream source, prior hardening PR search and
acceptance criteria. The two characterization tests confirm a blocker, not
deployment safety. No issue/PR has been posted and no vendor source changed.
