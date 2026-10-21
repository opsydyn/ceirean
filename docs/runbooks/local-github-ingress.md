# Local GitHub Ingress Runbook

## Approval Boundary

Tasks 1-7, scoped final-fix review and fresh whole-branch controller verification
are complete. This is local acceptance, not merge or live acceptance. See the
[controller closure](../evidence/local-github-ingress/controller-closure.md).
This runbook proposes an operator-controlled
rehearsal; none of its live steps has been performed. No deployment, production
availability/durability or exactly-once execution guarantee is made. Admission
records do not execute assessments, agents, workers, repositories or GitHub writes.

The original `b7f5d4e` qualification remains historical; changed source is bound
separately in [final-fix evidence](../evidence/local-github-ingress/final-fix/final-fix-report.md). See the
[assessment](../assessments/local-github-ingress.md) and
[measured manifest](../evidence/local-github-ingress.json). The manifest separates
tested source from later documentation/evidence commits. Synthetic API fixtures
do not prove real GitHub grants. Frozen installation is not zero-network proof.

## Operator Prerequisites

Use the pinned Bun toolchain and an operator-selected local, non-synced filesystem.
Run from a local, non-synced checkout. The default state root is
`$HOME/Library/Application Support/Leviathan`; an explicit absolute custom
`stateRoot` is allowed. The database must be a contained descendant, outside
repositories, build, temporary and known synced roots. Path checks do not discover
arbitrary network mounts, external build roots or third-party sync software.
Do not claim locality from a pathname alone.

The operator must prepare an explicit JSON configuration and explicit webhook
secret/private-key files outside the repository. Keep the directory 0700 and
configuration/secret/key 0600, owned by the effective user. Secret and key must
be single-link, nonempty regular files with canonical nonsymlink paths; their
parent components must also be nonsymlink. Check ownership, modes and link count
with local `stat`/`ls` without printing contents. The application enforces 0600,
owner UID, one link and canonical file path for credentials. Keep configuration
owner-only operationally; the current configuration reader does not enforce its
mode. Never pass credentials on argv, through environment variables or `.env`.

The SDK accepts PKCS#8 (`BEGIN PRIVATE KEY`) RSA material only. A downloaded
PKCS#1 key is not accepted. Operator-owned local conversion to PKCS#8 is a
prerequisite before any separately approved rehearsal, never an application
fallback. No real key has been accessed, converted or tested by this work.

Configuration has exactly `policy`, optional `stateRoot`, `webhookSecretFile`,
and `privateKeyFile`. Policy contains revision, ingressScopeId, appId,
installationId, ownerId, repositoryId, enabled profile ID/revision, policyRevision
and a nonempty unique allowlist of at most 100 immutable numeric operator IDs.
Use verified real immutable IDs only after approval, not login names or the
synthetic IDs from tests. Revisions must be new bounded values, not reused.

## Explicit Local Commands

The implemented command forms below are proposed operator actions, not a record
of commands run against live credentials. From `apps/github-ingress`, substitute
the approved absolute configuration path (and optional contained database path):

```sh
bun --no-env-file --no-install src/main.ts init --config /ABSOLUTE/config.json
bun --no-env-file --no-install src/main.ts status --config /ABSOLUTE/config.json
bun --no-env-file --no-install src/main.ts start --config /ABSOLUTE/config.json
bun --no-env-file --no-install src/main.ts configure --config /ABSOLUTE/config.json --expected-revision CURRENT_REVISION
```

All commands accept `--database /ABSOLUTE/contained/database.sqlite` if needed.
Use the same path every time. Init is explicit and exclusive; start never creates
or migrates storage. Init/status/configure do not read credentials or call GitHub.
Status is local and read-only, not an HTTP endpoint. Configure requires stopped
ingress, matching current revision and a unique next revision; it preserves
replay keys. Stop the process before editing configuration, then configure and
restart. Changing a file while running does not mutate the acquired policy/key.

Before authority acquisition or listening, start holds ledger ownership and
compares the complete validated file policy with the active stored policy.
Any disagreement fails closed without installing policy or making API calls,
and releases ownership. Status and configure intentionally do not require this
equality: status inspects the ledger, and configure installs a different policy.
`Refused` configure outcomes retain structured JSON (`AuthorityChanged`,
`RevisionReused`, `CapacityExceeded`) and exit 1; Installed/init/status exit 0.

Status reports counts, current policy, bounded policy history and up to 256
structured outcomes from one validated read-only transaction, including while
a listener owns the ledger. Outcomes contain decision identity/key, operator ID,
decision/reason, local revision, timestamps and LocalPolicy or LiveChecked
provenance. LiveChecked includes only the normalized permission observation's
IDs, revisions, permission and observation/expiry times. These are historical
facts, never reusable permission leases. No credentials, tokens, raw bodies,
receipt digests or display names are returned. Corrupt rows fail status rather
than yielding partial/empty success. No public status route exists.

Start binds only `127.0.0.1:8787`, serving only `POST /webhook`. It refuses a
second owner. A bind failure or malformed acquired key unwinds storage ownership.
Never delete an ownership sidecar to bypass an active owner. Process death
releases the kernel-held SQLite ownership lock; stale PID cleanup is unnecessary.

## Rehearsal And Redelivery

Only after the checklist below is approved may the operator create/manage a
temporary HTTPS tunnel to the exact loopback webhook endpoint. Tunnel provider,
URL, access controls and teardown are operator decisions; this application does
not provision a tunnel. Do not expose status/configuration or other local ports.

Only a new ordinary-issue comment containing exactly `/leviathan assess` is
eligible, from a human whose sender/author IDs agree. The configured App,
installation, owner, repository and allowlisted operator IDs must all match.
Each new admission freshly checks installation, restricted token, repository,
canonical user and base write/admin permission. Read/none/custom-role labels do
not authorize admission. No positive permission cache, redirects or HTTP retries.

Responses expose only disposition and opaque correlation ID. A Recorded response
means a decision committed locally, not assessment execution. A lost response
after commit is ambiguous to the caller: operator-managed redelivery of the same
delivery resolves Duplicate without another permission check, retaining the
original immutable evidence. Changed delivery digest or command actor/issue
conflicts even when API access is unavailable. No automatic redelivery exists.
Do not repeatedly send fresh deliveries to overcome an operational refusal.

There are four retained request owners, 60 starts per rolling minute, an
eight-second request outcome, six-second total API budget and two seconds per
attempt. Unsettled native cleanup retains ownership even after a finite error.
429 indicates saturation; 503 is operational/uncommitted, not permission denial.
Stop and inspect sanitized status rather than extending budgets or adding retries.

## Capacity And Shutdown

Hard ceilings: 256 decisions, 1024 receipts, 256 local authority revisions. Known
receipt replay remains readable at capacity; new decisions/receipts/revisions
may refuse. Stop the session at capacity. There is no pruning/reset/migration
command and no authority to create a new empty ledger to continue the session.

SIGTERM/SIGINT stops accepts, aborts/drains owned work, awaits real native
cleanup, then closes storage. If disposal is still pending at ten seconds,
main forces exit 1 and emits `FailedShutdown`. This is a failed shutdown, not
proof that finalizers ran. Record it and inspect/reopen storage separately before
considering restart. Do not increase timeouts to disguise unresolved cleanup.

SIGKILL recovery tests cover before transaction, after decision/evidence writes,
after commit before a response, and pending API work. Precommit deaths leave
zero complete records; committed death leaves one complete record with matching
evidence. This is tested local Bun/SQLite process-death recovery, not disk-loss,
host-crash, deployment or production durability qualification.

## Backup And Recovery

Stop ingress and confirm no owner before an operator-approved consistent backup.
Preserve the database and its bound `.owner.sqlite` state, permissions and
identity; do not copy a running WAL database file alone or discard sidecars.
Partial init, mismatched ownership/schema, zero-byte files or corrupt evidence
must stop startup. Preserve originals and seek an explicit recovery decision;
there is no silent repair or seeding of synthetic history.

Restoring an older valid snapshot is **replay-history loss**. It can look valid
yet lack later decisions/receipts. Status cannot discover that lost history, and
fresh redelivery can record again after fresh API checks. Do not reconcile it
automatically into a completeness/exactly-once claim. Reset/new database changes
the replay boundary and requires separate approval and retention of old evidence.

## Secret-Safe Evidence

Record approved immutable IDs, source/tree/lock identities, command exit status,
finite dispositions, counts, correlation IDs and operator timings. Do not archive
keys, tokens, secrets, authorization headers, environment dumps or raw private
webhook/API bodies. Canonical qualification artifacts live in
`docs/evidence/local-github-ingress/`; planning scratch is not permanent evidence.

## Unapproved Live Checklist

- [x] Controller accepts Tasks 1-7 (task acceptance only).
- [x] Controller completes scoped final-fix review and whole-branch verification/triage.
- [ ] Owner approves real App/installation/owner/repository/operator immutable IDs.
- [ ] Operator inspects actual App installation grants, repository restriction,
      token permissions and fresh base write/admin response; no broadened grants.
- [ ] Owner approves explicit credential custody and PKCS#8 preparation.
- [ ] Owner approves local non-synced external database path and backup identity.
- [ ] Owner approves tunnel provider, URL, endpoint and teardown/revocation actions.
- [ ] Owner approves a finite session duration and exact operator command/comment.
- [ ] Owner approves revocation, redelivery and restoration actions plus stop rules.
- [ ] Operator records actual observed live results separately from synthetic proof.

Live qualification is unavailable until those approvals and actual observations
exist. This document does not authorize API access, a listener with real keys,
tunnel creation, publication, push or merge.
