# Ceirean Rehearsal Approval

Status: **restricted App setup approved and installed; live rehearsal unapproved**.
The owner approved creation/installation with Issues and Metadata read-only on
`opsydyn/fold-kit-experiments` only. No live ingress rehearsal has been performed.
This worksheet is not permission to read credentials, broaden grants, start a real-key
listener or open a tunnel. Fill every applicable field and obtain
explicit owner approval for the exact targets and actions before execution.
Use the [local ingress runbook](local-github-ingress.md) for operational limits.

## Exact Targets

| Field                                                   | Approved value                                     |
| ------------------------------------------------------- | -------------------------------------------------- |
| Owner and operator approving this session               | Unselected                                         |
| Source commit, tree and lockfile hash                   | Unselected                                         |
| Repository owner ID and repository ID                   | `257329185` / `1247366304`                         |
| Repository display name (informational only)            | `opsydyn/fold-kit-experiments`                     |
| Dedicated GitHub App ID and ingress scope ID            | App `5407709`; ingress scope not yet selected      |
| Installation ID, selected repository restriction        | `173668921`; selected repository `1247366304` only |
| Human operator ID, current base write/admin permission  | Unselected                                         |
| Ordinary issue ID and number for comments               | Unselected                                         |
| Profile ID/revision, policy revision and local revision | Unselected                                         |
| Exact start time, maximum duration and stop time        | Unselected                                         |

Do not substitute test IDs or treat a login/name as immutable identity. Confirm
the dedicated App has repository Metadata read and Issues read, `issue_comment`
subscription, and no write grants. Runtime tokens remain metadata-only and
restricted to the selected repository. Record inspected grants, not credentials.

### Observed Setup: 2026-10-21

The owner completed registration of `opsydyn-ceirean` and its installation.
The GitHub installation UI reports it installed on `@opsydyn`, with Read access
to issues and metadata, Only select repositories enabled, exactly one selected
repository (`opsydyn/fold-kit-experiments`), and no pending Save changes.
The App's General page reports App ID `5407709`, webhook Active unchecked, and
an empty webhook URL. No settings were changed during this verification.

Account/repository IDs were read from GitHub's metadata API; App and installation
IDs were read from the settings UI. These observations establish setup only,
not runtime authentication or admission. The issue-comment subscription still
needs verification before enabling delivery. Key custody/format has not been
inspected; the agent has not generated or read a private key or webhook secret.
No listener, tunnel, token minting or assessment was started.

- [App settings](https://github.com/settings/apps/opsydyn-ceirean)
- [Installation settings](https://github.com/settings/installations/173668921)

## Custody And Exposure

| Field                                                      | Approved value                       |
| ---------------------------------------------------------- | ------------------------------------ |
| Absolute configuration path (owner-only 0600)              | Unselected                           |
| Absolute webhook-secret file path (0600, no contents)      | Unselected                           |
| Absolute PKCS#8 RSA key path (0600, no contents)           | Unselected                           |
| Canonical local non-synced external state root (0700)      | Unselected                           |
| Database path and bound ownership sidecar                  | Unselected                           |
| New explicit init or approved existing ledger identity     | Unselected                           |
| Stopped backup path and restoration owner                  | Unselected                           |
| Tunnel provider, exact HTTPS URL and access controls       | Unselected                           |
| Tunnel target                                              | `http://127.0.0.1:8787/webhook` only |
| App webhook URL/secret setup and exact restoration actions | Unselected                           |

No repo/temp/synced database and no implicit legacy migration. Preserve old
ledgers and their ownership/replay state. Inspect file metadata without printing
secret contents. Any key conversion is separately approved operator-owned work.
Expose no status/configuration route or other local port.

## Approved Actions

- [ ] Owner approves all exact targets, custody paths, grants and finite timebox.
- [x] Owner approves App creation/configuration and selected-repository installation (restricted setup above).
- [ ] Owner approves local init or explicit reuse, key reading, listener and tunnel.
- [ ] Owner approves posting a fresh exact `/ceirean assess` comment on the selected issue.
- [ ] Owner approves manual redelivery of its exact delivery and a stopped restart.
- [ ] Owner selects one precise revocation: permission downgrade or local allowlist removal.
- [ ] Owner records the exact before/after grant or allowlist and fresh policy revisions.
- [ ] Owner approves a second fresh comment after revocation and exact restoration steps.
- [ ] Owner names who stops ingress/tunnel and restores webhook/grants at the deadline.

Permission downgrades must leave the selected human able to post the fresh
comment. If that cannot be arranged, scope the rehearsal to allowlist revocation;
do not claim live permission-negative qualification. Never revoke unrelated
access or reuse an existing shared integration without separate authority.
Local policy changes require stopped ingress, `configure` with the current
expected revision, a unique next revision, then restart. Restoration also uses
a fresh revision; it does not reset or replace the ledger.

## Acceptance Matrix

| Scenario                                | Required observed result                                                   |
| --------------------------------------- | -------------------------------------------------------------------------- |
| Fresh authorized exact comment          | Recorded, one AdmittedPreview outcome with live permission evidence        |
| Same delivery redelivered               | Duplicate; unchanged decision/evidence and no fresh permission check       |
| Same delivery after stopped restart     | Duplicate; same immutable decision/evidence                                |
| Fresh comment after approved revocation | Recorded Rejected; no admitted preview for that comment                    |
| Authority API failure, if encountered   | Operational/uncommitted failure; not a successful negative-permission test |

Use local structured status, correlation IDs and approved delivery records;
HTTP 200 alone cannot distinguish admission from business rejection. A duplicate
after revocation still does not reauthorize, so it cannot prove revocation works.
No assessment, worker, repository mutation or PR is executed by this ingress.

## Evidence And Stop Rules

- [ ] Record source identity, commands/exits, timings, immutable IDs and sanitized outcomes.
- [ ] Record before/after counts, decision IDs and provenance without raw private bodies.
- [ ] Preserve actual observations separately from synthetic qualification artifacts.
- [ ] Stop at the deadline, capacity, unexpected scope/grants, policy mismatch or unsafe paths.
- [ ] On operational failure, stop and inspect; do not add retries, reset storage or broaden grants.
- [ ] Treat FailedShutdown as failure, retain storage and inspect before any restart.
- [ ] Stop ingress and tunnel; restore approved webhook/grants/policy with fresh revisions.
- [ ] Record teardown/restoration results and any missing acceptance evidence.

Never archive secrets, tokens, authorization headers, environment dumps or private
webhook/API payloads. Live outcome: **not run**. Remaining approval/evidence:
**all remaining unselected fields, rehearsal approvals and live observations above**.
