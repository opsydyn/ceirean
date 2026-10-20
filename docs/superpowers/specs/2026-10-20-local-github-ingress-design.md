# Local GitHub Ingress Rehearsal

Status: conversational design and written spec approved by the owner on
2026-10-20. This document does not approve implementation, credentials, a listener,
an App installation, a tunnel, or live GitHub activity. An implementation plan
and execution-method selection follow written-spec approval. A live rehearsal
requires a separate, exact-target approval after local qualification.

## Outcome And Scope

Let one explicitly allowlisted human issue `/leviathan assess` on an ordinary
issue in one configured repository, and record one admission preview after fresh
GitHub access checks. Preserve replay protection across process restart. A
preview is historical admission evidence, not an assessment result or a future
execution capability.

The owner selected local Bun, persistent local SQLite, and an operator-managed
temporary HTTPS tunnel for testing. Cloud hosting is deferred, not rejected for
production. Retain the pinned Bun/Effect/Flue cohort and universal Effect lint
rules. Do not add workers, models, repository execution, upgrade resolution,
GitHub comments, PRs, discovery, scheduling, publication, or automatic redelivery.

Baseline: local `main` at `f2ef8b2`, with the completed
[offline admission design](2026-10-20-github-admission-design.md) and
[recovery evidence](../../assessments/github-admission-recovery.md). Its 645 local
tests do not establish live API, tunnel, permission or deployment readiness.

## Architecture And Ownership

Use one local Bun process, one exported Effect application boundary, one
ManagedRuntime, and one file-backed inbox. Bind only to IPv4 loopback. The tunnel
forwards only the webhook route; its provider, URL and lifecycle are operator
owned. No tunnel provisioning or cloud resource creation belongs to Leviathan.

| Boundary                  | Responsibility                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`         | Pure identity, command and permission-evidence schemas; admission decisions and invariants. No HTTP, secrets or database I/O.     |
| `packages/engine`         | Inferred replay, local-policy, evidence and atomic admission contracts; use-case orchestration. No Flue agent or worker dispatch. |
| Private GitHub adapter    | Flue signature/protocol handling, bounded request capture, schema-decoded GitHub reads and scoped SQLite implementation.          |
| Private local ingress app | Explicit initialization/start/status commands, configuration, credentials, loopback listener and resource ownership.              |
| Existing probe            | Independent offline qualification with synthetic authority; never production configuration.                                       |

The implementation plan must name concrete workspace paths and extract reusable
adapter modules without making a runnable app import probe fixtures. Do not
create empty generic adapter packages. No new state machine is needed for one
admission decision; the worker lifecycle remains unchanged.

Compose dependencies at service acquisition or the exported application boundary.
Infer contracts from real factories, as existing engine ports do. Keep all 141
Effect rules universal, strict declaration checking for new work, one physical
Effect installation, and the two already approved declaration patches only.
Do not add per-request runtimes, inline helper provisioning, lint waivers,
undeclared transitive imports, hand-written cryptography, or a replacement webhook
verifier. The later plan must pin and qualify any new direct authentication SDK
dependency before adoption; this spec authorises no dependency installation.

## Configuration And Identity

Configure exactly one GitHub.com App, installation, owner and repository by
immutable IDs; an ingress scope; an enabled central profile and its revision;
policy revision; and a nonempty immutable-ID operator allowlist. No PAT fallback,
GitHub Enterprise host, wildcard scope, automatic onboarding or multi-repo mode.

Names and logins are routing/display metadata only. Resolve canonical repository
and user names from current ID-bound API responses. A rename must preserve
identity; a transfer, different installation, wrong App or changed owner must not
inherit admission authority. Never follow URLs supplied by webhook content or
arbitrary redirects with credentials attached.

Snapshot validated configuration at startup. Changes require stopping ingress
and an explicit revisioned configuration update; no configuration hot reload in
this slice. Preserve the transactional local revision barrier nevertheless, and
test a competing update while a request is awaiting GitHub.

Only new `issue_comment.created` events on ordinary issues can carry the command.
Retain exact whole-body matching, human sender/author equality, schema validation,
and current byte/identifier limits. Ignore edited/deleted comments, PR comments,
bots and ordinary conversation. Header labels, `author_association`, repository
names and signed payload permission claims never establish authority.

## Live Credentials And Permission Evidence

Use a dedicated, selected-repository GitHub App for the eventual rehearsal. The
proposed grant is repository Metadata read and Issues read, with `issue_comment`
subscription and no repository/organisation write grant. The required event
grant must be checked against the actual App registration before live use;
[GitHub's event documentation](https://docs.github.com/en/webhooks/webhook-events-and-payloads#issue_comment)
and [permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
describe platform requirements, not proof of an installed App.

Load the webhook secret and App private key from explicit owner-only secret-file
references, not command-line secret values, committed config or implicit ambient
credentials. Never persist tokens, JWTs, keys or their hashes to the ledger or
logs. Mint short-lived installation tokens restricted to the configured repository
and necessary read grants. Token creation is the sole permitted outbound POST;
it is authentication, not permission to publish or modify repositories.

For each previously unseen, locally eligible command, the adapter must obtain
fresh decoded evidence through this bounded GitHub API sequence:

1. App-authenticated installation lookup: match App, installation and account
   IDs, and require an unsuspended installation.
2. Create a repository-restricted installation token; validate its returned scope
   and expiry before use.
3. Read the repository by ID with that token: require the configured repository
   and owner IDs, available access, and a repository that is not archived/disabled.
4. Resolve the allowlisted user by ID, requiring the same human account ID.
5. Read that canonical user's repository permission with the installation token;
   require the response user ID to match and base permission `write` or `admin`.
   Do not infer authority from a custom role name. GitHub maps maintain to write
   and triage to read in this endpoint.

Relevant endpoint contracts are documented for
[App authentication and installation tokens](https://docs.github.com/en/rest/apps/apps),
[ID-based user lookup](https://docs.github.com/en/rest/users/users#get-a-user-using-their-id),
and [collaborator permissions](https://docs.github.com/en/enterprise-cloud@latest/rest/collaborators/collaborators#get-repository-permissions-for-a-user).
Pin `Accept` and an explicit supported REST API version in the implementation
plan. Qualify this exact endpoint/token/grant combination before any claim that
the live policy works; documentation and mocked responses are not live proof.

No positive permission cache, startup-only permission decision or webhook-only
revocation detection. API denial, identity mismatch, unavailable evidence,
malformed responses, redirects, timeouts and rate limits block fresh admission.
Do not reinterpret ambiguous 404 responses as a successful negative permission
observation. An authoritative decoded read/none permission is a policy rejection;
an unavailable check is an operational failure, not a durable rejection.

Evidence must bind the request's command identity, all configured IDs, checked
base permission, policy/profile revisions, observation times and expiry. Derive
freshness from the first live observation, not the final response, so slow checks
cannot renew old evidence. Enforce monotonic elapsed-time and stored wall-clock
floor checks; clock rollback or future-dated evidence fails closed.

## Replay And Atomic Commit

After bounded body capture, real Flue signature verification and normalisation:

1. Resolve known delivery/command identities against the inbox before live API
   checks. Matching receipts return their recorded outcome; content or identity
   conflicts preserve original records and return a conflict. No new authority is
   granted. Never expose this lookup as an unsigned public query endpoint.
2. Reject locally out-of-scope requests without GitHub calls. For an unknown,
   locally eligible command, obtain fresh request-bound live evidence.
3. Commit in one short SQLite transaction. Re-resolve receipt/command uniqueness,
   compare the exact local policy/profile revision used for the checks, validate
   evidence binding/freshness and clock floor, and enforce capacity.
4. Atomically insert the decision, its immutable sanitised evidence, and receipt,
   or roll back all writes. Concurrent checks for the same command may happen,
   but only one decision may commit. A loser returns the existing historical
   outcome, never a second admission.

Distinguish local-policy refusals from live-checked outcomes with schema-derived
provenance. A refusal made before any API call must not fabricate permission
evidence. An admitted preview always requires complete request-bound live
evidence; a reference to a mutable current snapshot is not sufficient.

No network calls inside transactions. Do not install each request's live result
as the shared global authority snapshot: concurrent operators must not borrow or
overwrite one another's evidence. Local configuration revisions and per-decision
live evidence are separate concepts. Extend inferred contracts minimally to make
this distinction and replay-first resolution testable.

Current code has no replay-only engine port and stores only the current authority
snapshot plus revision identities, not immutable live evidence per decision.
Those are required changes, not already delivered capabilities. The plan must
retain the old offline evidence's meaning and explicitly test any schema change.

Permission revocation after GitHub responds but before local commit cannot be
made atomic with SQLite. Record the observation interval and this residual race;
do not promise immediate revocation or future execution authority. Any future
execution boundary must reauthorise independently.

## Local Storage And Initialization

Default macOS path:

```text
~/Library/Application Support/Leviathan/github-admission.sqlite
```

Resolve this to an absolute path, with an explicit `--database` override outside
the checkout. Reject memory databases, unsafe symlink targets and the repository
tree for this rehearsal. Use an owner-only directory (0700) and database (0600),
including safe WAL/SHM permissions. Do not place it in a worktree, build directory,
container layer, synced folder or temporary directory. Overrides on other hosts
require an explicit operator-selected local filesystem path.

An explicit initialization command creates a new schema-versioned database and
binds the ingress scope and reviewed configuration. It refuses an existing
database. Normal startup uses create-disabled open and validates schema/version,
scope, configuration and access; it must not execute initialization DDL, seed
authority, auto-migrate, overwrite or repair an incompatible/empty file.
The current probe initializer is not sufficient for this stricter start contract.

Preserve SQLite WAL, FULL synchronous mode, foreign keys, immediate transactions
and zero busy timeout. One listener owns the database; a second listener using the
same database must refuse startup. CLI status is read-only, runs without GitHub
credentials, and reports counts and structured outcomes, not secrets or full
payloads. Broken storage never becomes an empty successful ledger.

Implementation-plan proposal for review: an owner-only `<database>.owner.sqlite`
sidecar supplies a lifetime SQLite exclusive lock on a separate connection, not
an open admission transaction. It is operational ownership state, not another
inbox. Missing or mismatched sidecar state blocks start; child-process tests must
prove competing-owner exclusion and lock release after process death.

Persist only normalised command facts/IDs, digests, receipts, timestamps, decisions,
policy/profile revisions and immutable minimal permission evidence. Existing
bounded repository names may remain as display metadata, never authority. Do not
persist comment bodies, webhook/API response bodies, user profiles, conversations,
repository contents, credentials or model output.

Use existing ceilings: 256 decisions, 1024 receipts and 256 local authority
revisions. Live permission observations are per decision and must not consume
global configuration revision slots. No automatic expiry, pruning or rotation of
deduplication keys. Refuse new writes at capacity without losing known outcomes.
Known receipt replays remain readable at capacity; a duplicate command with a new
delivery ID may still be refused if recording its receipt would exceed capacity.
These row limits are not a hard disk-byte quota or production retention policy.

No application reset command in this slice. Operator destruction/reset requires
ingress stopped and a separate explicit acknowledgement that replay protection is
lost. A new scope or empty database does not make an old signed command safe.
Do not delete old keys as routine cleanup or restore an older snapshot and claim
complete replay protection. Backups, retention migration and cloud durability are
separate design work; laptop/disk loss and power-loss recovery remain unqualified.

## Listener Budgets And Failure Responses

The following proposed constants are part of this written-spec review, not
previously measured guarantees: loopback port 8787; four concurrent requests with
no unbounded queue; 60 request starts per rolling minute; an eight-second overall
request budget; a six-second total GitHub-check budget with at most two seconds
per HTTP attempt; and a ten-second graceful-shutdown budget. Keep body capture at
65536 bytes and bound each GitHub response to 1 MiB before parsing. No automatic
HTTP retries or redirect following. The evidence interval expires no later than
six seconds after the first live observation and must also fit the request budget.

Enforce limits before expensive work, including body-reading time, and decode
every used API field. Rate limits apply process-wide, not to a spoofable forwarded
IP. Return 429 on local saturation, with no queued admission. Do not call GitHub
for invalid signatures, ignored commands or configured-identity mismatches.

Preserve current typed body/signature/conflict/refusal semantics where applicable.
Return a successful preview only after commit. API/storage/runtime failures yield
a sanitised non-success response; timeout cannot leave a detached task committing
later. A commit followed by a lost response is ambiguous to the caller and must
resolve through replay, not rollback fiction or a new identity.

Public webhook responses contain only a minimal disposition and correlation ID;
full permission evidence, policy details and operator lists stay in local status.
No public status, database download or administration route. Verified pings and
unsupported events can be acknowledged without permission calls or admission.

On shutdown, stop accepting requests, drain bounded in-flight work, interrupt
remaining cancellable reads, then dispose the runtime and storage. Preserve the
qualified async-reader ownership: do not close storage while owned work can
still commit. If finalisation cannot finish within the shutdown budget, report a
failed shutdown/nonzero exit rather than claim a clean disposal. Forced process
termination is a distinct recovery case, not evidence that finalizers completed.

[GitHub documents a ten-second response deadline](https://docs.github.com/en/webhooks/using-webhooks/handling-webhook-deliveries)
and [no automatic failed-delivery retry](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries).
Local budgets leave headroom but cannot guarantee tunnel/network latency. Recovery
uses an operator-requested GitHub redelivery against the unchanged ledger; no
reconciliation poller or automatic retry service is included.

## Qualification And Live Rehearsal Gate

The later plan must include the following acceptance evidence:

- Strict type/lint/format gates and existing workspace suites remain green under
  the pinned cohort; new workspace gates are uncached and explicit.
- Deterministic fake-HTTP tests cover exact methods/paths/headers, token scope,
  response schema/size limits, permission mapping, ID binding, rename/transfer,
  suspended/revoked installation, API failures, cancellation and expiry.
- Tests prove no permission calls for invalid/ignored/out-of-scope input or known
  replay, no positive cache across new comments, and no positive reuse after restart.
- Property-based laws exercise reordered/duplicate deliveries, different delivery
  IDs, policy changes and two operators with distinct evidence. Include accepted
  cases and behavioural negative controls, not refusal-only generators.
- Native SQLite tests prove per-decision evidence/receipt atomicity, revision
  races, capacity, clock rollback, no bootstrap on start, exclusive listener
  ownership and process-kill/lost-response recovery. Old schema files fail closed.
- Actual local listener tests use ephemeral ports, temporary test-owned paths and
  synthetic credentials only. Verify slow bodies, saturation, disconnects and
  shutdown with no detached work; never discover ambient real credentials. These
  paths are explicit test fixtures, not overrides of the operator storage policy.
- A runbook covers initialization, status, permission setup, tunnel lifecycle,
  redelivery, capacity, lost-response recovery and secret-safe evidence collection.

Only after those gates and independent review, request separate approval naming
the real App/installation/repository/operator IDs, granted permissions, tunnel
provider/URL, database path and finite session duration. Do not obtain credentials
or create/change the App, issue/comments, webhook configuration, public tunnel or
real-credential listener as part of documentation or automated qualification.
Synthetic loopback listener tests above do not require a live GitHub rehearsal.

The live operator posts the command and performs any access changes/redelivery.
Capture one successful stored preview, duplicate and restart behaviour, and a
fresh command refused after a controlled permission/allowlist revocation. Restore
test permissions only through operator action. Record exact source/config/API
versions, observed grants, timestamps, sanitised outcomes and database counts.
An unavailable live case remains an evidence gap, not a synthetic success.

Stop if the pinned cohort cannot support the API/authentication boundary without
new waivers, if least-privilege grants cannot satisfy the checks, if finite
shutdown ownership is unprovable, or if replay/authority/evidence invariants fail.
Return the finding for review instead of switching runtime, granting write access,
adding a queue or weakening the policy. Live success qualifies only this bounded
single-repository rehearsal, not unattended operation, production availability,
host-loss durability or exactly-once execution.

## Handoff

The owner approved this written spec. The subsequent
[implementation plan](../plans/2026-10-20-local-github-ingress.md) requires review
and execution-method selection before implementation. It resolves concrete
module placement, dependency/API-version pins and test tasks within these
boundaries; broader architecture changes require renewed approval. Live activity
remains separately gated.
