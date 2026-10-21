# Bounded FoldKit Live Rehearsal

Status: rehearsal design approved on 2026-10-21; activation remains gated by the
exact endpoint, session time and issue. No listener, tunnel or webhook has been
enabled by this plan. See the [approval worksheet](ceirean-rehearsal-approval.md)
for verified IDs, protected local paths and preparation evidence.

## Tunnel Recommendation

For repeated rehearsals, prefer a dedicated remotely-managed Cloudflare Tunnel
with a hostname such as `ceirean-hooks.<owner-selected-domain>`. The account,
Cloudflare-managed zone, full hostname, tunnel identity and route still require
selection and approval. Do not infer ownership from names in other projects.
This replaces the proposed Quick Tunnel only after the owner selects the domain.
Quick Tunnel remains a disposable alternative, not the long-term endpoint.

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

- [ ] Select/approve Cloudflare account, zone, hostname, tunnel and exact HTTPS endpoint.
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
- [Cloudflare Quick Tunnel tradeoffs](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
- [GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [Fallow quick start](https://fallow.tools/docs/quickstart/)
