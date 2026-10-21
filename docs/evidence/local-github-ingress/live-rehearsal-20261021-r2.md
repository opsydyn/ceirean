# Second Live Rehearsal: Bounded Admission Passed

Outcome: **the five approved admission/replay/local-revocation scenarios passed**.
This is supervised live ingress acceptance on one repository, not deployment,
always-on authorization, autonomous assessment, worker or PR qualification.

## Source And Scope

- Clean source: `24f9877adc7e99991c064c8c434352bfc1d9aa4a`.
- Git tree: `8ae105b68530bf085a54cbe7ae9c004404e4aab8`.
- Bun lock SHA256: `bcfdba5c68b9e90daa6de2e4ed3acc4f6c14f6fedb27a3db312d61739e3a3217`.
- Code includes the offline-qualified opaque-token fix: 962 workspace tests,
  seven typechecks and clean lint/format were verified before this session.
- Fresh approved window: 21 October 2026, **20:54-21:19 UK** (19:54-20:19 UTC).
- Public connector lifetime: approximately **19:56:01-19:58:55 UTC**, under three
  minutes and below the 15-minute limit. Supervisors also enforced finite stops.
- Shutdown owner: assistant. No extension, automated retry or unattended service.
- Repository `opsydyn/fold-kit-experiments`, ID `1247366304`; ordinary open
  [issue 57](https://github.com/opsydyn/fold-kit-experiments/issues/57), ID `5965919353`.
- App `5407709`, installation `173668921`, operator/owner `257329185`.
- App API preflight confirmed Issues read, Metadata read, `issue_comment`,
  selected repository mode and no suspended installation. No grants changed.
- Endpoint `https://ceirean-hooks.opsydyn.xyz/webhook`, TLS verification enabled,
  existing signing secret retained. No secret values or raw payloads archived.
- Tunnel `1df21420-1ba8-4797-a43b-8fcbab108ea7`, verified zero connectors and
  exact `/webhook` route to loopback with a 404 catch-all before activation.

## Preserved Baseline And Policy

Before startup, status showed **0 decisions, 0 receipts, 0 evidence, 3 policy
revisions**, profile Disabled. The failed first attempt's history was preserved.
Port 8787 was closed and GitHub Active was unchecked. A new stopped backup of the
database, bound ownership sidecar and config was created at the protected state
root's `backups/rehearsal-20261021-r2`; stopped WAL files were absent/empty.
Directories/files used owner-only 0700/0600 modes.

Stopped `configure` returned Installed for the fresh Enabled revision
`ceirean-rehearsal-20261021-enabled-2`, policy
`ceirean-admission-20261021-enabled-2`, profile `foldkit-upgrade-0169-rehearsal`,
profile revision `ceirean-rehearsal-20261021-2`. It did not recreate storage.
Expected final counts were explicitly set to 2/2/1/5 before the first comment:
the two policy transitions add to, rather than replace, the existing history.

The listener bound only 127.0.0.1:8787. The dedicated foreground connector was
started once and retained through listener restarts. Non-webhook public paths
returned 404, and an unsigned empty webhook POST returned 415. These routing
checks were not treated as admission proof. GitHub delivery was then enabled.

## Acceptance Observations

Exactly two fresh comments containing `/ceirean assess` were posted:
[A](https://github.com/opsydyn/fold-kit-experiments/issues/57#issuecomment-6325218045)
and [B](https://github.com/opsydyn/fold-kit-experiments/issues/57#issuecomment-6325250153).
All delivery attempts below returned HTTP 200; disposition and ledger provenance,
not HTTP alone, establish their outcome. Decimal delivery IDs are strings.

| Scenario                                 | Delivery ID           | GitHub Delivered At UTC | Public Disposition |
| ---------------------------------------- | --------------------- | ----------------------- | ------------------ |
| Fresh A                                  | `3849606247976271872` | 19:56:41.044            | Recorded           |
| Redeliver A                              | `3849606290047238144` | 19:57:00.664            | Duplicate          |
| Redeliver A after clean listener restart | `3849606362065534976` | 19:57:34.202            | Duplicate          |
| Fresh B after Disabled policy/restart    | `3849606454814179328` | 19:58:17.390            | Rejected           |
| Redeliver A while Disabled               | `3849606484763615232` | 19:58:31.343            | Duplicate          |

A's original and redelivery GUID was `86ca3b10-cd89-11f1-8530-56f35238a56d`;
B's was `c1179d80-cd89-11f1-85f8-ddc7399087ba`. Before each manual redelivery,
the helper checked the exact GUID, issue, comment and repository identity.
No first-attempt delivery or unrelated issue was redelivered.

- A committed decision `1`, `AdmittedPreview`, with `LiveChecked` provenance,
  base permission `admin` and evidence ID `45598a79-0b6e-4bd4-98bf-a5339aabd877`.
  Command key: `[173668921,1247366304,6325218045]`.
- The first listener stopped with exit 0, then restarted on the same ledger and
  Enabled policy. The original decision, evidence ID, evaluation/commit times
  and counts were unchanged after both redeliveries.
- The second listener stopped with exit 0. Stopped `configure` returned Installed
  for `ceirean-rehearsal-20261021-disabled-2`, policy
  `ceirean-admission-20261021-disabled-2`, profile Disabled, before restarting.
- B committed decision `2`, `Rejected/ProfileUnavailable`, with `LocalPolicy`
  provenance bound to the Disabled revision and no new live evidence.
  Command key: `[173668921,1247366304,6325250153]`.
- Redelivery A after revocation remained Duplicate; its admitted result is
  historical, not authorization to execute under the current Disabled policy.
- Final stopped status: **2 decisions, 2 receipts, 1 evidence, 5 policy revisions**.
  A's evidence/decision remained unchanged and B's refusal remained recorded.

This tests local profile-policy revocation, not GitHub permission revocation.
Stable evidence/counts do not independently prove zero outbound API calls on
replay; no such telemetry claim is made. No assessment or dependency update ran.

## Verified Teardown

- Connector PID 6090 and final listener PID 6553 were signalled at 19:58:55 UTC;
  their supervised sessions both reported exit 0. Earlier listener PIDs 6063
  and 6373 also exited 0 at the approved restart boundaries.
- No unrelated cloudflared process or tunnel was stopped or modified.
- GitHub Active was unchecked, saved, then observed unchecked after reload;
  configured URL/secret and enabled TLS verification were retained.
- Cloudflare API independently reported zero tunnel connections.
- Port 8787 was verified closed, and the fresh Disabled revision was retained.
- The ephemeral connector-token file and temporary operator helpers were removed.
  Original App credentials, scoped CF_TOKEN, Alchemy state and ledger history
  were retained in protected storage. No secret was added to Git.
- No unexpected admission, operational failure, ownership issue or deadline
  extension occurred. Connector shutdown emitted termination messages and exited 0.

No always-on operation, publication or production durability is authorized by
this result. Next queued work is the separately scoped Fallow audit, with no
automatic fixes or deletion and no cloud upload. Resuming live ingress requires
fresh approval; completing this rehearsal does not authorize another session.
