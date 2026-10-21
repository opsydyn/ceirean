# Ceirean Rehearsal Approval

Status: **restricted App setup, local preparation and disconnected Cloudflare provisioning complete; test issue selected; live activation unapproved**.
The owner approved creation/installation with Issues and Metadata read-only on
`opsydyn/fold-kit-experiments` only. No live ingress rehearsal has been performed.
Beyond the explicitly approved local key conversion, configuration, secret
creation and new-ledger initialization below, this worksheet is not
permission to acquire runtime credentials, broaden grants, start a real-key
listener or open a tunnel. Fill every applicable field and obtain
explicit owner approval for the exact targets and actions before execution.
Use the [local ingress runbook](local-github-ingress.md) for operational limits.
The owner approved the [bounded rehearsal design](ceirean-live-rehearsal-plan.md)
(25 minutes total, at most 15 minutes public exposure, profile-disable negative
test). The owner corrected the hostname to `ceirean-hooks.opsydyn.xyz` and approved named tunnel
preparation with Alchemy only. Cloudflare account/zone and the absence of an explicit
DNS record were verified in the dashboard. Dependency type qualification, scoped
authentication, collision preflight and the separately approved three-resource
apply are complete. Exact session activation remains pending; those approvals do not start any connector,
listener or webhook delivery.

Cloudflare preparation targets: account `d95812af050c2e549a3296899b7b43b3`, active
zone `65de6815d54763e90ebf4e5df3a7030c`, tunnel name `ceirean-rehearsal-bcea4099a8934e32`, and endpoint
`https://ceirean-hooks.opsydyn.xyz/webhook`. The created tunnel is
`1df21420-1ba8-4797-a43b-8fcbab108ea7`, independently verified with zero connectors.
The exact ingress and proxied CNAME match; the local listener is stopped and the
assessment profile remains Disabled. See the infrastructure README for evidence.
The earlier `.net` hostname was corrected before any provisioning.

## Exact Targets

| Field                                                   | Approved value                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Owner and operator approving this session               | Owner approved local preparation; `opsydyn` is the sole staged operator |
| Source commit, tree and lockfile hash                   | Preparation source identity recorded below                              |
| Repository owner ID and repository ID                   | `257329185` / `1247366304`                                              |
| Repository display name (informational only)            | `opsydyn/fold-kit-experiments`                                          |
| Dedicated GitHub App ID and ingress scope ID            | App `5407709`; scope `github-app-5407709`                               |
| Installation ID, selected repository restriction        | `173668921`; selected repository `1247366304` only                      |
| Human operator ID, current base write/admin permission  | Allowlisted ID `257329185`; fresh live permission not yet checked       |
| Ordinary issue ID and number for comments               | ID `5965919353`; issue `57`; open ordinary issue, not a PR              |
| Profile ID/revision, policy revision and local revision | Profile Disabled; revisions recorded below                              |
| Exact start time, maximum duration and stop time        | Start/stop unselected; 25 minutes total, at most 15 minutes public      |

Do not substitute test IDs or treat a login/name as immutable identity. Confirm
the dedicated App has repository Metadata read and Issues read, `issue_comment`
subscription, and no write grants. Runtime tokens remain metadata-only and
restricted to the selected repository. Record inspected grants, not credentials.

### Selected Rehearsal Issue

The owner approved the FoldKit upgrade assessment as the test subject. Created
and verified [issue #57](https://github.com/opsydyn/fold-kit-experiments/issues/57),
**Assess FoldKit 0.169.0 upgrade for Astro and Viz**, with numeric ID `5965919353`.
Its scope separates required migrations from optional Transition/Lazy/SSR/input
improvements, paired Vite/MCP tooling, verification and package-version advice.
It does not authorize upgrade implementation, PR creation or publishing.

This rehearsal exercises existing admission, deduplication and evidence, not an
autonomous migration assessment. No assessment command/comment was posted. The
exact UK start time, operator stop deadline and activation approvals remain open.

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
inspected at that checkpoint; no private key or webhook secret was accessed then.
No listener, tunnel, token minting or assessment was started.

### Approved Local Key Preparation: 2026-10-21

The owner supplied the downloaded PEM and explicitly requested local conversion.
The key was converted to unencrypted PKCS#8 outside the repository at
`/Users/alancurrie/Library/Application Support/Ceirean/credentials/github-app.pkcs8.pem`.
OpenSSL reported `Key is valid`; metadata showed owner `alancurrie`, mode 0600 and
one link. The Ceirean state root and credentials directory were set to 0700.
The conversion refused an existing destination. No key contents were printed,
uploaded or committed. The original remains locally ignored in the worktree,
also mode 0600; its relocation/removal is not part of this conversion.
This approval did not authorize token minting, runtime key acquisition, a
listener, a tunnel or webhook activation. No webhook secret had been prepared
at that checkpoint.

### Approved Local Preparation: 2026-10-21

The owner explicitly approved merging the setup commits into local main and
preparing the local configuration, webhook secret and SQLite ledger while
keeping the listener, tunnel and webhooks disabled. Main fast-forwarded to
`9c29d1df4450ae1be7e9a958af3760ea8ae1ec4b` before preparation. Its tree was
`dd8f63c0043c3e9ff72f0398ea2741576c79a569`; the lockfile SHA-256 was
`6e9f3b34d91f2aadb00fc9c686ad99e82a26b3053f7a272e5bd3157a93b29341`.
Later documentation commits do not change that preparation source identity.

The owner-selected state root is
`/Users/alancurrie/Library/Application Support/Ceirean`, outside the checkout.
Mount inspection showed local APFS storage; this is not automatic proof against
arbitrary third-party sync software. New config/secret creation refused existing
paths. The secret contains 32 cryptographically random bytes encoded as 64 hex
characters, with no trailing newline. No secret contents or secret hash were
displayed or archived. The existing private key was inspected by metadata only.

The native CLI ran only `init` and read-only `status`, using `--no-env-file` and
`--no-install` with a minimal environment. Init returned `Initialized`. Status
returned zero decisions, receipts and evidence, one authority revision, and no
outcomes. The sole operator allowlist is `[257329185]`; this does not replace a
future fresh live base-permission check. The initial assessment profile is
deliberately Disabled. Policy revisions are:

- Local revision: `ceirean-local-prep-20261021-1`
- Admission policy revision: `ceirean-admission-prep-20261021-1`

The config, webhook-secret file, database and ownership sidecar were owned by
`alancurrie`, mode 0600, with one link each; the state root and credentials
directory were mode 0700. Port 8787 had no listening process before or after
preparation. No `start` command, tunnel, token minting, live permission check,
GitHub webhook update, legacy-ledger migration or backup was performed.
The prepared secret has not been submitted to GitHub. Webhook activation and
an enabled profile require separate approval; policy changes must use stopped
ingress, explicit `configure` and fresh revisions, not ledger replacement.

Repeat the non-listening status inspection from `apps/github-ingress` with:

```sh
bun --no-env-file --no-install src/main.ts status --config '/Users/alancurrie/Library/Application Support/Ceirean/ingress.json'
```

- [App settings](https://github.com/settings/apps/opsydyn-ceirean)
- [Installation settings](https://github.com/settings/installations/173668921)

## Custody And Exposure

| Field                                                      | Approved value                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Absolute configuration path (owner-only 0600)              | `/Users/alancurrie/Library/Application Support/Ceirean/ingress.json`                                                 |
| Absolute webhook-secret file path (0600, no contents)      | `/Users/alancurrie/Library/Application Support/Ceirean/credentials/webhook-secret`                                   |
| Absolute PKCS#8 RSA key path (0600, no contents)           | `/Users/alancurrie/Library/Application Support/Ceirean/credentials/github-app.pkcs8.pem`                             |
| Canonical local non-synced external state root (0700)      | `/Users/alancurrie/Library/Application Support/Ceirean`                                                              |
| Database path and bound ownership sidecar                  | State root + `github-admission.sqlite` and `github-admission.sqlite.owner.sqlite`                                    |
| New explicit init or approved existing ledger identity     | New explicit init, zero recorded outcomes; no legacy ledger reused                                                   |
| Stopped backup path and restoration owner                  | Unselected                                                                                                           |
| Tunnel provider, exact HTTPS URL and access controls       | Cloudflare named tunnel; `https://ceirean-hooks.opsydyn.xyz/webhook`; provisioned, zero connectors; no active origin |
| Tunnel target                                              | `http://127.0.0.1:8787/webhook` only                                                                                 |
| App webhook URL/secret setup and exact restoration actions | Unselected                                                                                                           |

No repo/temp/synced database and no implicit legacy migration. Preserve old
ledgers and their ownership/replay state. Inspect file metadata without printing
secret contents. Any key conversion is separately approved operator-owned work.
Expose no status/configuration route or other local port.

## Approved Actions

- [ ] Owner approves all exact targets, custody paths, grants and finite timebox.
- [x] Owner approves App creation/configuration and selected-repository installation (restricted setup above).
- [x] Owner approves local config, webhook-secret creation and new-ledger init (completed above).
- [ ] Owner approves GitHub runtime credential acquisition, listener and public connector exposure.
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
