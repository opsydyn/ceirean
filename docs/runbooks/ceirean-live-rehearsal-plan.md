# Bounded FoldKit Live Rehearsal

Status: the first approved live attempt on 2026-10-21 stopped on HTTP 503 /
`OperationalFailure`, before any admission was recorded. Connector and listener
are stopped, webhook delivery is disabled, and the local profile is Disabled.
See the [observed outcome](../evidence/local-github-ingress/live-rehearsal-20261021.md)
for timings, preserved counts and missing acceptance evidence. A new live attempt
requires a fresh approved window. The repaired authority-only probe passed all
five real API stages, but did not exercise signed admission or replay. The design
below remains the intended acceptance sequence, not a record that it passed.

## Tunnel Recommendation

The owner corrected the hostname to `ceirean-hooks.opsydyn.xyz` on 2026-10-21 and approved named
tunnel preparation only, explicitly keeping the listener and webhooks disabled.
The intended endpoint is `https://ceirean-hooks.opsydyn.xyz/webhook`. The signed-in
dashboard verified account `d95812af050c2e549a3296899b7b43b3` and active zone
`65de6815d54763e90ebf4e5df3a7030c`. The seven-record DNS inventory had no explicit
`ceirean-hooks` record; its existing wildcard and all other records remain untouched.
The provisioned tunnel is `1df21420-1ba8-4797-a43b-8fcbab108ea7`; its exact ingress,
proxied CNAME and zero connectors were independently verified on 2026-10-21.
This replaces the Quick Tunnel recommendation for this setup. A Quick Tunnel
remains a disposable alternative, not the selected endpoint.

### Alchemy Assessment And Preparation Boundary

Alchemy supports the required remotely-managed Tunnel, Configuration and DNS
Record resources. Its published `2.0.0-beta.83` release declares Effect `^4.0.0`
as a peer, which accepts Ceirean's pinned 4.0.5. This metadata is not installation,
typecheck or deployment qualification. The isolated `@ceirean/infrastructure`
workspace now pins this release and 4.0.5. Its offline tests exercise real Alchemy
resource registration and output resolution, without cloud providers or network.
The owner approved infrastructure-only `skipLibCheck: true` for the incompatible
Workers/Bun/Node declaration globals. Our source remains strict and every Effect
lint rule remains enforced; this does not validate or fix the skipped declarations.

Recommend an isolated infrastructure workspace, not a dependency of the ingress
application or domain/engine packages. Keep all existing Effect lint rules and
pins unchanged. Use Alchemy's local state initially, ignored by Git and protected
as credential-bearing operational state. Do not bootstrap `Cloudflare.state()`:
that would provision additional state-store Worker, Durable Object and Secrets
Store resources outside this tunnel-only scope.

The intended owned resource set is one dedicated tunnel named `ceirean-rehearsal-bcea4099a8934e32`,
one remote configuration matching hostname `ceirean-hooks.opsydyn.xyz` and exact
path `^/webhook$` to `http://127.0.0.1:8787` with a 404 catch-all, and one proxied
CNAME for that hostname pointing to the created tunnel. Inspect existing records
and tunnels before applying; refuse conflicts instead of enabling adoption or
replacement. Do not take over the zone or any other records.

Use only the account/zone permissions needed for tunnel and DNS management;
verify the provider's required read scopes before credential issuance. No global
API key, account-wide connector certificate or secret stack outputs. Authentication
setup and credential storage must not print token values or put them in Git.
Provisioning must not run a connector, listener, OS service, GitHub update, profile
enablement or assessment. The intended final tunnel state is disconnected with
zero connectors, not an active origin behind the new hostname.

The owner supplied the scoped token privately in the ignored root `.env`.
Effect Config now validates `CF_TOKEN` as a redacted non-empty value without
whitespace and maps it to Alchemy's environment contract at the exported provider
boundary. No auth profile is persisted. Local validation does not establish live
permissions; use the absolute `--env-file` path described in the infrastructure
README. Read-only API verification on 2026-10-21 confirmed an active token
(expiry `2026-10-28T23:59:59Z`), the pinned zone/account, and zero exact-name
collisions in complete live/deleted tunnel inventories and exact-hostname DNS.
Write grants remain separate from this read-access proof. The owner-approved
temporary plan-only config subsequently produced exactly three creates in both
ordinary and detailed CLI plan runs, from owner-only protected local storage.
The state directory remained empty; this is not write-durability/recovery proof.
The temporary config was removed. The subsequently approved operational guard now
requires the exact protected working/state/auth directories, canonical paths,
0700 permissions, consistent ownership, valid redacted config, rehearsal stage
and disabled dev/adoption before resource registration. The real entrypoint has
also produced the same three-create plan. Provisioning still requires separate
apply approval and another collision check immediately before apply. The guard
does not itself authorize apply or prevent hostile local filesystem races.
In the pinned provider, an existing
same-name tunnel can be reused despite `adopt: false`; preflight alone does not
close a race. The owner accepted the stable random-suffixed name and supervised
preflight as a bounded mitigation, not a provider fix. All three resources pin
engine adoption off. Unsafe operational contexts fail before registering resources,
and direct package deploy scripts were removed. Browser sign-in does not grant CLI access. The CLI help was
checked with isolated temporary auth storage and telemetry disabled; no credential
was entered through that CLI flow. Alchemy's default OAuth scope selection is broad, so do
not accept All/Basic scopes for this tunnel-only task. See the infrastructure
[README](../../packages/infrastructure/README.md) for custody and permission gates.
The later separately approved apply created only the reviewed tunnel, ingress
configuration and DNS record. Fresh collision checks preceded interactive plan
confirmation. Protected state files are 0600 under 0700 directories, and a fresh
CLI plan reports no changes. See the infrastructure README's provisioned checkpoint
for exact non-secret IDs and evidence; no live rehearsal has occurred.

After the owner unlocked the Mac, the complete four-tunnel dashboard inventory
showed no match for the pinned Ceirean name. Repeat this check just before apply.
Protected operational/auth directories now exist outside Git, both mode 0700.
An account-owned seven-day token review is prepared but not submitted: cloudflared
Write for the account, plus DNS Write and Zone Read for `opsydyn.xyz` only.
Credential generation/entry is an owner handoff; no token value was read.

- Map only the selected hostname's `/webhook` path to `http://127.0.0.1:8787`;
  reject unmatched paths. The application still validates method, signature,
  event/action, body limits, immutable identities and current admission policy.
- Use a dedicated per-tunnel connector credential stored outside the checkout
  with owner-only permissions. Do not share another service's connector or use
  an account-wide certificate just to run this connector.
- Run the connector in the foreground for the rehearsal, not as an OS service.
  Stable DNS does not authorize an always-running local service.
- This is a public webhook endpoint, not private networking. Cloudflare terminates
  public HTTPS and can process webhook traffic; the private App key stays local.
  Keep TLS verification and the application webhook-secret validation enabled.
- Do not put interactive email authentication or browser challenges in front of
  GitHub's non-interactive webhook client. A domain alone is not authentication.
- `cloudflared` was not on PATH at planning time; installation is a separate
  preparation action. No installation or Cloudflare mutation has been performed.

## Approved Timebox And Scope

One supervised 25-minute session, at most 15 minutes of public exposure, no
automatic extensions. Set an exact start/deadline in Europe/London at execution;
do not start the clock until the prerequisites and operator are ready.

| Elapsed time  | Activity                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0-5 minutes   | Verify source, protected files, local baseline, exact issue and shutdown owner; no public connector                  |
| 5-12 minutes  | After endpoint approval, activate and test admission, redelivery and stopped listener restart                        |
| 12-20 minutes | Restore the Disabled profile with a fresh revision; test a fresh rejected comment and replay of the admitted comment |
| 20-25 minutes | No new tests; disable webhook delivery, stop connector and listener, inspect status and record teardown              |

The 15-minute exposure limit starts when the connector becomes publicly
reachable, even if GitHub activation is still awaiting confirmation. Cut exposure
by elapsed minute 20 or sooner at its own limit. If webhook deactivation is
blocked, stop the connector immediately; never wait online for a UI repair.

## Proposed Acceptance Run

Use only the selected ordinary issue in `opsydyn/fold-kit-experiments`, App
`5407709`, installation `173668921`, and operator `257329185`. Before startup,
approve and install one Enabled profile descriptor with fresh local and policy
revisions using stopped ingress and explicit `configure`; do not replace storage.
Use exactly two fresh comments containing `/ceirean assess` and manual redeliveries
of the first delivery. Ignore ping/setup events as admission evidence.

1. Comment A records one AdmittedPreview with LiveChecked authority evidence.
2. Redelivery A is Duplicate, retaining the same decision and evidence.
3. Stop/restart the listener while retaining the same connector and ledger;
   redelivery A remains Duplicate. Do not recreate the tunnel mid-session.
4. Stop ingress, configure a Disabled profile with another fresh revision and
   restart. Comment B records Rejected/ProfileUnavailable with LocalPolicy provenance.
5. Redelivery A after local revocation remains Duplicate with unchanged evidence.

This tests local profile-policy revocation, not live GitHub permission revocation.
The sole-operator allowlist cannot be empty, and downgrading the personal repository
owner is unsuitable. Leave real permission-negative qualification explicitly open.
Under this exact isolated sequence, expect two decisions, two receipts, one live
evidence record and three policy revisions including the prepared initial revision.
Unexpected outcomes require investigation, not rewriting expected counts.
Unchanged evidence alone does not independently measure outbound API-call count;
do not claim a live no-reauthorization trace without appropriate secret-safe telemetry.

Stop on identity/grant mismatch, signature failures, operational errors, unexpected
ledger outcomes, ownership trouble, saturation or deadline. HTTP 200 alone is not
admission proof. No automated retries, assessments, workers, code changes or PRs.
Preserve all ledger history. A failed shutdown or incomplete teardown remains a
failed/incomplete result, not a successful rehearsal.

## Remaining Activation Gates

- [x] Owner selects `https://ceirean-hooks.opsydyn.xyz/webhook` and authorizes named tunnel preparation only.
- [ ] Verify/approve Cloudflare account, zone, existing DNS and exact tunnel identity.
- [ ] Approve connector installation and protected credential custody.
- [ ] Select/approve ordinary issue ID/number, Enabled profile ID/revision and fresh policy revisions.
- [ ] Record exact session start/deadlines and who performs shutdown/restoration.
- [ ] Verify issue_comment subscription and least-privilege installation grants.
- [ ] Approve runtime credential acquisition, network authority checks, connector exposure,
      webhook-secret submission to GitHub, activation, two comments and manual redeliveries.
- [ ] At teardown, disable delivery, stop public connector/listener, leave the profile
      Disabled, and verify closed local port plus retained status/evidence. Retaining
      a stable DNS route or the read-only App is not permission to resume service.

## Follow-Up: Fallow Audit

After rehearsal teardown, install and run the owner-selected
[fallow-rs/fallow](https://github.com/fallow-rs/fallow) against Ceirean first.
This is queued work, not an installation performed by this plan.

- [ ] Pin the verified CLI release and add it as a development tool in a separate commit.
- [ ] Run local dead-code/dependency analysis and retain a report of unused
      dependencies, exports, types and files; optionally report architecture cycles.
- [ ] Configure workspace entrypoints, package exports, Moon-invoked CLI files and
      test/probe usage before treating a finding as confirmed unused code.
- [ ] Do not upload the repository, credentials or reports to a hosted service;
      check telemetry behavior before the first scan. Prefer a tracked-file-only
      clean checkout so ignored PEMs and external operational state are absent.
- [ ] Do not run auto-fix or remove dependencies as part of the first audit.
      Trace findings and report confirmed candidates separately from false positives.
- [ ] Qualify any later cleanup with focused tests, workspace typechecks, lint,
      formatting and the existing full acceptance gates; preserve patches and
      declaration-only dependencies unless their purpose is actually disproved.

## Primary References

- [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)
- [Alchemy tunnel resources](https://alchemy.run/cloudflare/networking/tunnel/)
- [Alchemy local and remote state](https://alchemy.run/state-store/)
- [Cloudflare Quick Tunnel tradeoffs](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [Fallow quick start](https://fallow.tools/docs/quickstart/)
