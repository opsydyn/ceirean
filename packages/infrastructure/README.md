# Ceirean Tunnel Preparation

Status: the owner approved the infrastructure-only declaration exception;
operational preflight remains pending. The stack entrypoint still fails closed.
No Cloudflare resources have been applied. The owner supplied a scoped token in
the ignored root `.env`; no stored Alchemy auth profile has been created.

This private workspace declares the proposed `CeireanHooks` / `rehearsal` stack:

- A remotely managed tunnel named `ceirean-rehearsal-bcea4099a8934e32`, without adoption.
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
not close that race. The owner accepted a bounded mitigation for this supervised
preparation: use the pinned random-suffixed name, check for collisions immediately
before creation, preserve its exact ID and state, and review exactly three creates.
This reduces collision risk; it does not repair the SDK or eliminate races.
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
with incompatible Workers/Bun/Node globals. The owner approved `skipLibCheck: true`
only in this workspace on 2026-10-21. TypeScript still checks our source with the
root's strict settings; third-party declarations are not validated here. All
existing Effect lint rules, other workspace configs and cohort pins are unchanged.
This scoped policy is not a fix to the SDK declarations or deployment approval.
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

The stack reads `CF_TOKEN` with Effect `Config.Redacted`, rejecting missing,
empty or whitespace-containing values without including the value in errors.
It adapts that value to Alchemy's `CLOUDFLARE_API_TOKEN` config key and pins
`CLOUDFLARE_ACCOUNT_ID` to the verified account at one exported provider boundary.
This does not mutate `process.env`, persist an auth profile or verify remote
permissions. A missing `CF_TOKEN` fails closed rather than selecting another
token or falling back to a stored profile. Tokens stay redacted in application
config; the adapter unwraps only into the in-memory Alchemy config provider.

Keep the root `.env` ignored and owner-only (0600); never print it or pass token
values as CLI arguments. For the operational invocation, pass the absolute file
path with `--env-file /Users/alancurrie/Projects/Leviathan/.env` and use Bun's
`--no-env-file` flag to disable implicit Bun dotenv loading. Alchemy loads the
explicit file through its Effect Config provider. Do not copy it into a worktree.
Keep the explicit `ceirean-rehearsal` profile and protected `ALCHEMY_HOME` outside
the checkout for isolation even though credentials now come from configuration.
Never inspect or print profile JSON or tunnel tokens. Set
`ALCHEMY_TELEMETRY_DISABLED=1` for every CLI invocation. There are deliberately
no package scripts for remote plan/deploy or authentication.

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
- [x] Owner approves infrastructure-only declaration exception; strict source checking retained.
- [x] Pass the canonical infrastructure typecheck with that approved policy.
- [x] Owner accepts bounded unique-name mitigation; keep the SDK defect documented.
- [x] Owner supplies scoped token privately; Effect Config adapter qualified offline.
- [x] Verify active credential and live tunnel/DNS/zone read access without printing credentials.
- [ ] Review write grants separately; successful GETs do not prove write permissions.
- [x] Inspect all four existing tunnels: no `ceirean-rehearsal-bcea4099a8934e32` collision; repeat immediately before apply.
- [x] Create owner-only operational/auth directories outside Git; no credential entered.
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

The owner instructed that the report must remain local and approved continuing
with Alchemy using the bounded mitigation above. The 64-bit random suffix was
generated once and pinned in source, not regenerated on each plan. All three
resources now explicitly set engine adoption off as well as the Tunnel provider
property. A diagnostic `tsc --noEmit --skipLibCheck` passes; no persistent
declaration-check exception had been approved or applied at that checkpoint. Browser preflight was
attempted but the Mac was locked; no unlock bypass or Cloudflare mutation occurred.

The owner subsequently approved the infrastructure-only `skipLibCheck` exception
and unlocked the Mac. The exception is now applied to this workspace alone;
operational preflight and dedicated authentication remain separate gates.

All seven canonical Moon workspace typechecks now pass, including infrastructure;
lint/format and all five offline infrastructure tests pass. The approved policy
only changes this workspace's `skipLibCheck`; the root strict settings, other
workspace configs, Effect lint config and lockfile are unchanged.

The signed-in dashboard's complete four-tunnel inventory has no matching name.
The seven-record DNS inventory has no explicit Ceirean hostname. These are
read-only observations, not a collision lock or permission to skip a fresh check
before applying. No resource was created or adopted.

Created `/Users/alancurrie/Library/Application Support/Ceirean/infrastructure`
and its `auth` subdirectory, both owned by `alancurrie` and mode 0700. No credential
was generated or entered. The browser is left at the unsubmitted account-token
review for `ceirean-rehearsal-setup`, expiring 28 October 2026. Proposed policies:

- Account: `Cloudflare One Connector: cloudflared Write` (account-wide tunnel
  management; Cloudflare does not scope this policy to our one name).
- Only `opsydyn.xyz`: `DNS Write` and `Zone Read`. Alchemy's DNS lookup calls
  `getZone` when checking an absent record, so the metadata read is required.

The owner subsequently created the reviewed token, stored it privately and left
the token screen. They chose the ignored root `.env` (`CF_TOKEN`) instead of the
interactive stored-profile flow. The exported Effect Config adapter now supplies
Alchemy's environment credential contract; the deployment gate remains closed.
Local validation through Effect's dotenv provider passed without displaying the
token or making a network request. File metadata confirms the root `.env` is
owner-only (0600) and Git-ignored. Live permissions have not been verified.
Do not read the token screen, clipboard or credential file into agent output;
do not use broad OAuth or a global key.

Read-only API preflight on 2026-10-21 subsequently passed using the root token
through Effect's dotenv provider. All requests used GET with redirects disabled;
only HTTP status and selected non-secret evidence were displayed:

- Account-owned token verification: HTTP 200, active, expires
  `2026-10-28T23:59:59Z` (token ID/value not displayed).
- Exact zone lookup: HTTP 200; zone name, zone ID and account ID match the pins.
- Complete live tunnel inventory: HTTP 200, four rows, one page; zero exact
  matches for `ceirean-rehearsal-bcea4099a8934e32`.
- Complete deleted tunnel inventory: HTTP 200, zero rows; zero matching names.
- Exact-hostname DNS query: HTTP 200, zero rows for `ceirean-hooks.opsydyn.xyz`.

The disposable helper initially refused to claim completeness because tunnel
responses use `total_count`/`per_page` rather than `total_pages`. After adapting
to the documented metadata, the complete preflight passed. No resources were
written, connector tokens retrieved, auth profile stored or services started.
These reads prove live read access only, not write grants or deployment readiness.
Repeat collision checks immediately before any approved apply. The actual stack
entrypoint remains unconditionally closed pending protected-state/plan review.
