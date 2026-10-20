# Offline GitHub Command Admission

Status: the owner approved the conversational design, this written spec and the
[implementation plan](../plans/2026-10-20-github-admission.md) on 2026-10-20,
selecting subagent-driven execution with controller-owned independent review.
The original Task 1 failure was restored and is preserved in the
[historical assessment](../../assessments/github-admission.md). The owner then
approved a bounded [compatibility repair](../../assessments/github-admission-repair.md)
at `629ada7`: the patched local cohort passes strict new-probe types, all existing
checks and 466 tests / 1924 assertions. Task 2's pure policy slice is complete at
`0a435bc`, independently reviewed with no findings, and passes 481 total tests /
2058 assertions. See [pure policy evidence](../../assessments/github-command-policy.md).
Task 3's inferred service/test-only memory contract is complete at `18695a6`,
independently reviewed with no findings, with 518 total tests / 2422 assertions.
See [memory contract evidence](../../assessments/github-inbox-contract.md).
Task 4's scoped native SQLite adapter is complete at `db21cc4`, with clean
independent review and 549 total tests / 3810 assertions. See
[native inbox evidence](../../assessments/github-sqlite-inbox.md).
Tasks 5-6 remain pending separate approval. No live
GitHub access, execution or publication is authorised by this offline approval.

## Outcome And Scope

Prove that one explicit maintainer request can cross a GitHub ingress boundary
without granting a model, conversation or webhook the authority to run an upgrade.
The first command is exactly `/leviathan assess`, posted as a new comment on an
ordinary issue in the target repository. Its only successful outcome is a stored
admission preview, not an assessment, migration, qualification or publication.

Use signed synthetic fixtures, trusted local authorisation fixtures and a local
SQLite inbox. Exercise the real selected channel handler through in-process
Fetch requests; do not start a listening server. No real repository metadata,
credentials, model, Docker worker or outbound GitHub request is required.

This is a new ingress subsystem, not an extension of the run coordinator's
execution authority. It does not change the CLI-first deployment direction in the
[broader service draft](2026-10-18-internal-upgrade-service-design.md), or bypass
the real-worker, permission and durable-reconciliation gates in the
[roadmap](../../roadmap.md). Organisation discovery, inventory reconciliation,
release polling and configuration self-PRs remain separate work.

## Selected Approach And Alternatives

Reuse Flue's verified webhook ingress, then apply application-owned runtime
validation, authorisation and transactional deduplication before producing a
preview. Flue remains an outer protocol adapter, not the policy authority, inbox,
run ledger or publisher.

A custom webhook verifier duplicates an existing protocol facility and is not
selected. Direct dispatch to a Flue agent mixes authorisation with model cost
and is not selected. A new XState machine is unnecessary for one transactional
admission decision; the existing worker lifecycle remains untouched.

The assessed upstream source is pinned at
[`deee93b40d275ecc9a50c50af2158f20089d54bc`](https://github.com/withastro/flue/tree/deee93b40d275ecc9a50c50af2158f20089d54bc).
Its GitHub channel verifies exact-body signatures, parses JSON and passes native
event shapes to a callback. Its static payload types do not replace runtime
validation, and the channel does not supply an application inbox or authorisation
policy. These are observations of that source, not proof of an installed package.

## Compatibility Gate

Before implementing the adapter, qualify an exact published `@flue/github`
artifact against the existing Bun `1.4.2`, Effect `4.0.5`, Flue runtime `2.3.0`,
TypeScript `7.0.2`, oxlint `1.88.0`, oxfmt `0.73.0` and Effect lint `2.0.1` cohort.
The assessed source manifest declares GitHub channel `2.3.0`; registry metadata,
tarball exports, peers and exact transitive resolution must be checked before
the later plan chooses that installation. Source version is not publication proof.

Require strict source and declaration checking for the new workspace, including
`skipLibCheck: false`, the real handler's good/bad signature paths under Bun, and
unchanged existing workspace checks. Preserve one physical Effect instance and
one root lockfile. Do not upgrade the cohort or inherit the older probe's vendor
declaration exception. Any necessary direct routing dependency must be explicitly
pinned and justified by the implementation plan; do not import undeclared
transitive dependencies.

All 141 Effect rules remain errors universally. No disables, ignored new paths,
manual Effect/Layer channels, fake inference factories, vendor patches, per-call
runtimes or inline helper provisioning. Incompatibility blocks adoption and is
reported for review; it is not permission to write a replacement verifier.

Later owner-approved exception: retain only the Flue 2.3.0 and Gaxios 7.3.1
declaration patches and explicit Google optional MCP peer in `629ada7`. Their
removal criteria and local-only qualification are recorded in the repair
assessment. This is not a general vendor-patch or type-check waiver.

## Package Ownership

| Boundary                  | Responsibility                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`         | Schema-derived identities, exact command parsing, trusted evidence shapes, pure decisions and refusal reasons. No GitHub SDK, database or runtime I/O.           |
| `packages/engine`         | Command-admission use case, inferred service contracts and atomic inbox orchestration. No invocation of `qualifyRun`, worker services or Flue agents.            |
| `probes/github-admission` | Private compatibility harness, GitHub normalisation, bounded raw-body capture, SQLite adapter, fixtures and in-process request tests. No production application. |

Use narrowly named command-admission modules, distinct from run admission and
qualification. Infer services from real factories as existing engine ports do;
compose live dependencies once at the probe's exported application boundary.
Expected refusals are typed values; database, runtime and compatibility failures
are distinct sanitised operational errors, never successful previews.

Add only the new probe's explicit Moon project and uncached tasks when a reviewed
implementation plan is approved. Do not scaffold an HTTP application, generic
event bus, publisher, new workflow engine or empty production adapter package.

## Command And Identity Boundary

Only `issue_comment` with `action: created` can carry the command. Ignore other
events/actions, ordinary conversation, edited/deleted comments and PR issue
comments. The entire comment body must equal `/leviathan assess`; do not trim or
interpret extra text, quoted instructions, case variants, arguments or markdown
as a command. A rejected request is retried with a new exact command comment.

Runtime-decode every field used: installation, repository and owner IDs; issue
and comment IDs; issue number; action; command body; and sender/comment-author
identity. Require matching sender and comment-author IDs and a human operator,
not a bot. Invalid numeric identities, unsafe integers and absent or malformed
fields cannot reach admission. Preserve identifiers without lossy conversion.

The target is always the comment's repository. Use immutable installation,
repository, owner and operator IDs for policy. Repository names, logins, URLs,
issue titles and Flue's name-based conversation IDs are display/routing metadata,
never authority or instructions. Do not accept a model-supplied target, revision,
dependency version, shell command or execution profile.

An admitted preview binds the enabled central repository profile and its reviewed
revision. It does not resolve a live source SHA or dependency target, reserve a
budget, allocate a worker or create an UpgradeRun. Those require a separately
approved request-resolution and execution boundary.

## Trusted Authorisation Evidence

Signature validity establishes ingress authenticity, not permission to do work.
The signed payload is still input, not its own authorisation evidence. Header
delivery/event/hook metadata and `author_association` do not grant authority.

The offline controller supplies a separately validated fixture snapshot binding:

- The configured ingress scope, authorised installation and expected repository
  owner/repository IDs, including current access and revocation state.
- An enabled central repository profile and explicit immutable-ID operator
  allowlist for the assessment-preview action.
- Policy, profile and evidence revisions, observation time and finite validity
  interval, evaluated using an explicit trusted current time.

Missing, unavailable, expired, future-dated, inconsistent or revoked evidence
blocks fresh admission. Transfer to another owner must be reauthorised; a rename
alone does not change identity. Fixtures represent permission facts for tests,
not proof of real installation coverage or actual GitHub collaborator permission.
No API response or access check is fabricated as live evidence.

Before committing a new preview, check that the locally authoritative fixture
policy/evidence revisions still match those used for the decision and remain
valid at commit time. Revision changes or expiry refuse/conflict rather than
commit an obsolete permission decision. Do not hold a SQLite transaction across
network calls or other asynchronous work. The later plan must make this local
revision barrier and explicit time semantics testable. Keep its test-owned current
authority revision record in the same SQLite transaction boundary as admission;
an independently checked in-memory revision followed by an insert is not atomic.
This does not claim atomicity with GitHub's live permission state.

## Ingress And Result Contract

The adapter captures exact delivered bytes within a finite body limit, then
passes those unchanged bytes through the real Flue signature-verification path.
The callback's parsed payload does not expose the original bytes: obtain the
raw-body digest at this bounded adapter boundary, not by reserialising JSON.
Do not add an unbounded request clone or a second bespoke signature verifier.
No domain decision or inbox mutation runs before successful verification.

The later plan must select explicit finite fixture body, field and diagnostic
limits and test limit violations. These are local test parameters, not approved
production capacity or retention defaults. Secrets are synthetic constants in
fixtures and never enter persisted records or diagnostic output.

Application decisions are the schema-derived union `AdmittedPreview`, `Ignored`
or `Rejected`, with typed reasons and applicable policy/evidence revisions.
Malformed ingress can fail before a domain decision exists. A duplicate is a
transport disposition referring to its original recorded decision, not a fourth
business outcome or another successful admission.

The harness returns an explicit success response only after any required inbox
transaction commits. Signature, payload or limit failures do not become admitted
previews. Storage failure produces an operational failure/non-success response,
not an ACK that implies recording. Such a request remains safe to retry, but this
does not claim GitHub automatically redelivers failures. Unsupported events may
be ignored without storing arbitrary payloads; they cannot reach command admission.

## Inbox, Replay And Retry Semantics

The application inbox is separate from Flue's conversation database. It owns:

- A transport receipt keyed by trusted configured ingress scope and delivery ID,
  with the exact raw-body digest and bounded validated routing metadata.
- A command identity keyed by installation ID, repository ID and comment ID.
  The accepted action is fixed by this spec; names and delivery IDs are excluded.
- A bounded normalised request, stable decision identity, original recorded
  decision/reasons, decision time and policy/profile/evidence revision bindings.

Header delivery IDs are untrusted labels, not capabilities. Transport receipts
must also bind the validated event kind and normalised immutable command facts;
a changed header must not reinterpret a previously handled delivery. A repeated
transport key with identical bound content refers to the original result. The
same key with a different body digest or event/identity binding is rejected as
a delivery conflict, without replacing the original receipt.

The same command under a different delivery ID cannot produce another admission.
If its immutable command facts agree, the new receipt refers to the existing
decision. Conflicting actor, issue or command facts for an existing comment key
are rejected, not silently rewritten. Names alone are not immutable-command
conflicts. Different raw delivery bodies may therefore deduplicate semantically
while remaining separately auditable as transport receipts.

Use database uniqueness constraints and one transaction to record the validated
request, relevant deduplication keys and original decision. Concurrent callers
must either reference the committed original or receive an explicit conflict;
an application-level check-then-insert is insufficient. Failure rolls back the
entire new admission. Do not overwrite prior decisions with INSERT OR REPLACE.
Bound diagnostics and retained duplicate receipts in the implementation plan;
at capacity refuse new records explicitly rather than evict committed decision or
deduplication keys to make space. No pruning or retention-expiry implementation
is included. This slice does not establish an indefinitely available replay cache.

An old admitted preview is historical evidence, never a bearer capability. A
duplicate response labels it as the original decision; it cannot claim a fresh
permission check, produce another preview or start work. New requests use current
evidence. Revocation does not rewrite history, but prevents fresh admission and
must be rechecked before any future separately designed execution/publication.

Policy changes, profile activation or comment edits never resurrect a recorded
rejection. The maintainer posts a new command after resolving its blocker. An
operational transaction failure that recorded nothing is different: retrying the
same request may succeed after recovery under current valid policy.

There is no dispatcher or outbox in this slice because previews cause no external
work. Before adding agent dispatch later, separately design transactional intent,
post-commit recovery and reauthorisation; do not add an agent call to the webhook
callback and call it durable admission.

## SQLite Lifetime And Evidence Limits

Use a scoped `bun:sqlite` adapter in the private probe with an explicit local file,
constraints and transactions. Keep the file outside source fixtures in a test-owned
temporary directory. Close handles on success, interruption and failed
initialisation; preserve the primary error and surface cleanup failure. Do not
create a database, runtime or connection for every helper call.

Require deterministic rollback/fault tests, concurrent-connection deduplication,
and a child-process restart test reading the same file after the original writer
exits. A committed decision must survive restart and suppress re-admission after
a simulated lost response. Pre-commit failure must not leave a receipt or decision
that falsely blocks a safe retry. Crash timing evidence must distinguish committed,
rolled-back and genuinely unknown outcomes rather than infer success from a
process exit or printed message.

These qualify the tested local adapter and process-restart behavior only. They
do not prove filesystem power-loss guarantees, host-loss recovery, distributed
workers, multi-host storage, production retention or exactly-once execution.

## Acceptance Evidence

Use Effect's built-in Arbitrary support for pure generated laws and Bun tests for
deterministic protocol, race and process boundaries. Include constructive accepted
cases so a reject-everything implementation cannot satisfy the safety laws.

| Area          | Required evidence                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path    | Real channel handler verifies the signed fixture; one authorised exact issue command yields one stored preview with the correct identity and revisions.                                                   |
| Protocol      | Invalid/missing signatures, byte tampering, non-JSON, malformed fields, unsafe IDs, missing metadata and body/field limits cannot admit or partially persist.                                             |
| Scope         | Non-command text, arguments/quotes, edits, deletes, PR comments, other event kinds and bots cannot admit.                                                                                                 |
| Authority     | Unknown/disabled profile, wrong operator/installation/owner/repository, author/sender mismatch, unavailable/expired/future evidence and revoked access block fresh admission.                             |
| Revision race | Changed fixture authority revision or expiry before commit cannot store a newly admitted preview under stale evidence.                                                                                    |
| Replay        | Same delivery, changed delivery IDs and concurrent connections create at most one admission; content/identity/header conflicts preserve original records.                                                 |
| Identity      | Repository rename preserves command identity; transfer or installation change cannot inherit old authority. A new installation does not itself authorise work.                                            |
| Retry         | A recorded rejection stays rejected after policy changes or edits; a new comment can be evaluated afresh. A rolled-back operational failure can retry safely.                                             |
| Persistence   | Restart and simulated lost response retain the original decision; injected failures leave no partial keys, previews or leaked resources.                                                                  |
| Laws          | Generated delivery order, duplicates, renames, evidence changes and retries preserve identity, refusal and at-most-one-admission invariants, including successful cases and behavioral negative controls. |
| No execution  | Imports/composition and tests establish no agent dispatch, model/provider call, run/qualification invocation, worker allocation, listener or outbound GitHub request.                                     |

The later implementation plan must choose explicit property seeds/run counts,
timeouts and bounded fault schedules before execution, retain counterexamples and
report actual results. No root unfiltered Bun test traversal, cached evidence,
implicit environment loading or silent lowering of the universal checks.

## Verification And Stop Conditions

The implementation plan must list exact uncached Moon typecheck/test targets for
domain, engine, the existing probe and new probe, root `bun run check`, frozen
lockfile installation and whitespace checks. Report the exact tested source and
dependency identities. Preserve existing qualification and worker-lifecycle laws.

Stop for review if the real channel cannot meet raw-byte/bounded-request needs,
strict declarations or pinned Bun/Flue compatibility; if satisfying the design
needs lint exceptions, a cohort upgrade or vendor patch; or if local transactions
cannot meet the stated atomic deduplication/revision barriers. Do not silently
weaken the evidence claim or substitute a fake handler for the real SDK path.

Successful delivery means an offline, repeatable admission evidence report, not a
live App installation or a running upgrade service. Hosting, live permission
retrieval/freshness, ingress abuse limits, retention, GitHub redelivery operations,
models, worker isolation, publication and org discovery remain separately gated.

## Sources And Review Handoff

- [Flue GitHub channel documentation source](https://github.com/withastro/flue/blob/deee93b40d275ecc9a50c50af2158f20089d54bc/apps/docs/src/content/docs/ecosystem/channels/github.md)
- [Flue channel API and native payload boundary](https://github.com/withastro/flue/blob/deee93b40d275ecc9a50c50af2158f20089d54bc/packages/github/src/index.ts)
- [Flue exact-body verification implementation](https://github.com/withastro/flue/blob/deee93b40d275ecc9a50c50af2158f20089d54bc/packages/github/src/webhook.ts)
- [Assessed source package manifest](https://github.com/withastro/flue/blob/deee93b40d275ecc9a50c50af2158f20089d54bc/packages/github/package.json)
- [GitHub failed-delivery handling](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)

The owner subsequently approved the linked plan and selected subagent-driven
execution. The original published-artifact gate failed; only the explicitly
repaired local cohort is admitted. Pure Task 2 work is complete and reviewed;
Task 3's inferred service/memory contract and Task 4's local native transaction
adapter are complete and reviewed. Verified ingress, process-kill qualification,
live use and execution boundaries remain unimplemented.
