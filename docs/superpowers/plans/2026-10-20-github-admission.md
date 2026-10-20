# Offline GitHub Command Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify the real Flue GitHub channel and prove offline, authorised, deduplicated issue-command admission without starting any upgrade work.

**Architecture:** Flue verifies signed ingress; application schemas normalise the one permitted command. Pure domain policy and an Effect admission service produce historical previews through an atomic application-owned inbox. A private probe supplies SQLite, trusted synthetic authority and an in-process Fetch harness, separate from conversation and run storage.

**Tech Stack:** Bun 1.4.2, Effect 4.0.5, @flue/runtime 2.3.0, candidate @flue/github 2.3.0, TypeScript 7.0.2, Moon 2.5.4, bun:sqlite, Effect Arbitrary, Bun tests, oxlint/oxfmt.

**Spec:** [Approved offline GitHub admission design](../specs/2026-10-20-github-admission-design.md).

Status: the owner approved the written spec and this plan on 2026-10-20 and
selected subagent-driven execution, with independent review owned by the
controller. The original Task 1 attempt failed and was restored; its
[blocked assessment](../../assessments/github-admission.md) remains historical
evidence, not an accepted unmodified artifact.

The owner subsequently approved the bounded
[compatibility repair](../../assessments/github-admission-repair.md), committed
at `629ada7`. The patched local cohort passes strict new-probe types, all existing
checks and 466 tests / 1924 assertions, including eight real-handler tests.
The owner then approved **Task 2 only**, now in progress. Tasks 3-6 remain pending
separate approval. No live GitHub access, merge or push is authorised.

**Approved compatibility amendment:** retain the two version-scoped declaration
patches and explicit Google optional MCP peer already committed at `629ada7`.
This narrowly supersedes the no-patch/no-extra-SDK clauses of the original
Task 1 instructions below; it does not allow further waivers, dependencies,
cohort changes or relaxed checks. Original failure/restoration instructions are
preserved to explain the historical gate.

## Global Constraints

- Accept exactly `/leviathan assess` in `issue_comment.created` on ordinary issues. No trimming, arguments, natural-language interpretation, edits, PR comments or bots.
- No models, agent dispatch, coordinator invocation, worker allocation, listening server, outbound GitHub request, live credentials, publisher, discovery or execution. Local test subprocesses are permitted only for persistence evidence.
- Keep Bun `1.4.2`, Effect `4.0.5`, Flue runtime `2.3.0`, TypeScript `7.0.2`, Moon `2.5.4`, bun-types `1.4.2`, oxlint `1.88.0`, oxfmt `0.73.0`, Effect lint `2.0.1`, existing XState pins and one physical Effect instance unchanged. Node `24.15.0` remains tooling only.
- All 141 Effect rules remain errors universally. No configuration changes, disables, new ignored paths, manual Effect/Layer channels, fake inference factories, inline helper provisioning, vendor patches or per-request runtimes. New workspace uses `skipLibCheck: false`.
- Add only exact `@flue/github: "2.3.0"` in the new private probe, alongside exact already-approved runtime/Effect and workspace dependencies. No direct Hono/Octokit client, new database wrapper, test runner or lockfile. No implicit transitive imports.
- Compose once at an exported application boundary. Keep native platform imports in adapters; filesystem/process setup stays in existing permitted `*.test.ts` boundaries. Preserve existing source, tests, law budgets and lint policy.
- Model command identity as `(installationId, repositoryId, commentId)`; transport identity as `(configured ingressScopeId, deliveryId)`. IDs and names cannot grant permissions. Old previews are historical, never reusable execution capabilities.
- Atomic SQLite uniqueness, revision/time checks and recording precede success. No overwrite, eviction of committed keys, automatic retry, inbox pruning, dispatch/outbox or asynchronous work inside a transaction.
- Each task ends with focused RED/GREEN, full available gates and a verified commit. Subagent-driven execution adds clean independent review before dependent work; native execution uses per-task self-review and a fresh independent whole-branch review at the end. No merge or push without separate approval.

## Review Focus

1. Exact expiry equality, clock rollback and invalid time must not refresh authority: Tasks 2-4 test `1999`, `2000`, `2001`, rollback and unsafe values.
2. Caller mutation or conflicting reuse of a comment/delivery key must not rewrite history: Tasks 2-4 test detached snapshots, tuple keys and changed actor/issue/header/digest.
3. Interrupted body reads and interrupted responses must not cause partial or duplicate admission: Tasks 5-6 test stream failure/abort and post-commit lost response separately.
4. A locked/corrupt database, full inbox or failed finalizer must not ACK success or discard the primary error: Tasks 3-4 test failure values, rollback, capacity and combined failures.
5. Reordered stale authority updates, repository transfer or reinstall must not inherit trust from a rename: Tasks 2-4 and 6 test current revision barriers and new immutable identities.

## File And Dependency Map

| Owner          | Create                                                                                                                                                                                                                                                                                                                                       | Modify                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Domain         | `packages/domain/src/command-admission.ts`, `packages/domain/src/command-admission-policy.ts`; `tests/command-fixtures.ts`, `tests/command-admission.test.ts`, `tests/command-properties.test.ts`                                                                                                                                            | `packages/domain/src/index.ts`                          |
| Engine         | `packages/engine/src/command-inbox-contracts.ts`, `src/command-inbox-errors.ts`, `src/command-inbox-factory.ts`, `src/command-inbox-port.ts`, `src/command-admission.ts`; `tests/command-fixtures.ts`, `tests/memory-command-inbox.ts`, `tests/command-inbox.test.ts`, `tests/command-admission.test.ts`, `tests/command-properties.test.ts` | `packages/engine/src/index.ts`                          |
| Probe setup    | `probes/github-admission/package.json`, `tsconfig.json`, `moon.yml`, `src/fixture.ts`, `tests/channel-compatibility.test.ts`                                                                                                                                                                                                                 | `.moon/workspace.yml`, `bun.lock`                       |
| Probe adapters | Under `probes/github-admission/src/`: `sqlite-inbox.ts`, `request-body.ts`, `github-payload.ts`, `github-ingress.ts`, `composition.ts`, `restart-child.ts`, `report.ts`                                                                                                                                                                      | Probe fixture/Moon targets as each task requires        |
| Probe evidence | Under `probes/github-admission/tests/`: `sqlite-inbox.test.ts`, `request-body.test.ts`, `github-payload.test.ts`, `github-ingress.test.ts`, `restart.test.ts`, `report.test.ts`                                                                                                                                                              | README, roadmap, `docs/assessments/github-admission.md` |

Paths in domain/engine rows use that package root for subsequent `src/` and
`tests/` entries. No `src` module imports tests. Refer to existing engine
`service-factories.ts`/`ports.ts` for real inferred services, domain
`tests/properties.ts` for validated property results, and the existing probe's
ledger/restart tests for lifetime and process evidence, not its vendor exception.

### Shared Interface Decisions

Define all public data below with Effect Schema and derive readonly TypeScript
types. Do not handwrite Effect success/error/environment annotations.

- `GitHubId`: positive safe integer; reject zero, fractions, infinity and values above `Number.MAX_SAFE_INTEGER` before key construction. SQL binds validated IDs without coercion. `IngressScopeId`/revision/profile IDs are nonblank bounded strings.
- `CommandCandidate`: `{ ingressScopeId, installationId, repositoryId, ownerId, issueId, issueNumber, commentId, operatorId, command: 'Assess', ownerLogin, repositoryName }`. The normaliser requires human sender/author identity equality before constructing it. Display names do not participate in identity.
- `CommandKey`: canonical JSON encoding of the validated three-number tuple `(installationId, repositoryId, commentId)`. `TransportKey`: canonical JSON encoding of `(ingressScopeId, deliveryId)`. Do not concatenate arbitrary strings with a delimiter.
- `AuthorityState`: `Unavailable { revision }` or `Available { revision, ingressScopeId, installationId, repositoryId, ownerId, access: 'Granted' | 'Revoked', profile, allowedOperatorIds, policyRevision, observedAtMs, validUntilMs }`. `profile` is `Enabled { profileId, profileRevision }`, `Disabled` or `Unknown`; operator IDs are unique. Revisions are opaque values compared for equality, not lexically ordered timestamps.
- `AdmissionDecision`: `AdmittedPreview { commandKey, policyRevision, profileId, profileRevision, evidenceRevision }`, `Rejected { reason }` or `Ignored { reason }`. Export the `Rejected | Ignored` schema as `NonAdmittedDecision`. Finite reason literals are `AuthorityUnavailable`, `InvalidAuthority`, `AuthorityExpired`, `AccessRevoked`, `IdentityMismatch`, `OperatorDenied`, `ProfileUnavailable`, `MalformedInput`, `FieldTooLarge`, `DeliveryConflict`, `CommandConflict`, `AuthorityChanged`, `CapacityExceeded`, `InvalidClock`, `UnsupportedEvent`, `UnsupportedAction`, `PullRequestComment`, `BotActor`, `NotCommand`. Never persist arbitrary exception text.
- `VerifiedCommand`: `{ receipt: { ingressScopeId, deliveryId, eventName: 'issue_comment', rawBodyDigest }, candidate }`. Validation includes matching scope fields. A type name is not a signature capability: only the verified ingress callback may call the engine in the composed application.
- `AdmissionRecord`: `{ decisionId, commandKey, candidate, decision, evaluatedAtMs, committedAtMs, authorityRevision }`. Recorded decisions are admitted previews or rejected exact commands, never ordinary conversation. SQLite assigns a stable validated decimal decision ID in the recording transaction.
- `AdmissionReply`: `Recorded { record }`, `Duplicate { record }` or `Unrecorded { decision }`; the latter contains only `Rejected`/`Ignored`. These envelopes describe recording disposition, not another business decision. A duplicate always labels the original decision/revisions and time.
- `AuthorityObservation`: `{ state: AuthorityState, atMs }`. `AdmissionDraft`: `{ verified: VerifiedCommand, expectedAuthorityRevision, evaluatedAtMs, decision }`, with decision limited to admitted/rejected exact commands. `CommitReply`: the `AdmissionReply` union.
- `CommandInboxDriver`: synchronous `loadAuthority(scopeId): Result<AuthorityObservation, CommandInboxError>` and `commit(draft): Result<CommitReply, CommandInboxError>`. `makeCommandInbox(driver)` wraps real calls into inferred Effects; `CommandInbox` derives from that actual factory. `makeCommandAdmission()` acquires the inbox once and returns inferred `admit(input: unknown)`; `CommandAdmission` derives from its actual acquisition success using installed Effect utilities.
- `makeSqliteInbox({ file, create, initialAuthority?, limits, nowMs, fault? })` is a scoped acquisition Effect returning `{ driver, installAuthority(input: unknown) }`. The latter is trusted harness administration, never reachable from request/agent APIs. `nowMs: () => number` is injected trusted fixture time read inside each native transaction; there is no wall-clock default. `initialAuthority` may seed only a new database, never overwrite existing state on reopen. `create: false` refuses a missing file. Fault phases are injected only at adapter construction in tests, never through ingress.
- `ProbeConfig` is trusted boundary configuration `{ file, create, initialAuthority?, ingressScopeId, secret, limits, nowMs, fault? }`, using the same native fields as `makeSqliteInbox`. It is not an ingress payload. `makeAdmissionProbeLayer(config)` composes inbox/admission Layers without running them. Exported `openAdmissionProbe(config)` owns one ManagedRuntime and returns `{ fetch(request: Request): Promise<Response>, dispose(): Promise<void> }`. Its bridge runs capture/admission on that one runtime; no internal helper provides dependencies or allocates another runtime. Do not add direct `Effect.run*` calls or change lint boundaries.

### Fixed Synthetic Limits And Protocol Decisions

- Body `65536` bytes; comment body `4096` UTF-8 bytes; delivery/scope/revision/profile IDs `128` bytes; display names `255` bytes; operator allowlist `100` entries; sanitised reason code `128` bytes. Reject control characters in persisted metadata. Limits apply before storing or echoing fields.
- Capacity `256` decisions, `1024` transport receipts and `256` authority revisions per fixture database; never evict committed keys. An already-recorded identical delivery can return its original at capacity; a new receipt/decision that needs space is refused atomically.
- Fixture time `1000ms`, authority observed at `900ms`, exclusive expiry `2000ms`. Valid time is finite, safe, nonnegative; `observedAtMs <= nowMs < validUntilMs`. A per-scope persisted clock floor cannot decrease on committed admission; backward time cannot enable a new preview.
- SQLite `journal_mode=WAL`, `synchronous=FULL`, foreign keys enabled, `busy_timeout=0`, explicit write transaction. Busy/locked/corrupt/I/O/close failures are tagged operational errors, not permission refusals or automatic retries.
- HTTP statuses in the in-process harness: fresh recorded preview `200`, recorded/duplicate business rejection `200` with explicit disposition (transport ACK only), ignored event `200`, malformed payload/metadata `400`, invalid signature `401`, conflicting identity/revision/capacity `409`, oversized body/field `413`, unsupported media type `415`, storage/unexpected operational failure `503`. A duplicate of an admitted preview is `200` and explicitly historical, not a new admission.
- Child watchdog `5000ms`; new-probe Bun test timeout `30000ms`. Retain existing probe `15000ms` and domain/engine `30000ms`. No arbitrary sleeps or extended budgets to hide a failure.
- New laws: six pure domain laws and four engine sequence laws, each `1000` runs at seeds `0`, `1`, `163`, size `50`, maxShrinks `1000`, maxDiscards `10000`, sequences at most `25` actions. Expected primary cases `30000`, separately counted from shrinks/assertions. No generated SQLite subprocess per case.

## Task 1: Strict Published-Channel Compatibility Gate

**Files:** probe setup/fixture/compatibility test, root lock/Moon project and
`docs/assessments/github-admission.md`. No domain or engine source changes.

**Interfaces:** `signedFixture({ bodyBytes?, eventName?, deliveryId?, signature?: 'valid' | 'invalid' | 'missing' }): Promise<Request>` uses only the synthetic secret and WebCrypto HMAC signing. Default request URL is `http://leviathan.invalid/webhook`, invoked through `channel.route().fetch(request)`, never global network fetch. This fixture is reused by Task 5.

- [ ] **1. Establish baseline.** Read spec/plan, verify main/worktree identity and clean state, run the existing full gate block below before edits. Reuse the isolated design worktree or obtain an approved isolated worktree; do not edit main. Record source and lock hashes.
- [ ] **2. Add the minimal gate and observe RED.** Create private `@leviathan/github-admission-probe`, strict tsconfig, Moon project ID `github-admission`, and tests importing `createGitHubChannel` from the exact package. Declare only `@flue/github: "2.3.0"`, `@flue/runtime: "2.3.0"`, `effect: "4.0.5"`, and existing domain/engine workspace dependencies. Run strict typecheck before installation; capture unresolved-package failure rather than claiming a behavioral RED.
- [ ] **3. Verify/install the exact artifact.** After plan-execution approval only, verify registry manifest/tarball integrity below and perform one script-free `bun install --ignore-scripts`. Inspect the lock delta and actual physical resolutions. Stop on unrelated pin changes, extra Effect instances, unexpected transitive changes or missing export/peer compatibility; do not compensate with Hono imports or vendor patches.
- [ ] **4. Exercise the real handler.** `signed valid request reaches callback once` asserts status `200`, native event/IDs and callback count `1`; `invalid and missing signatures never reach callback` asserts `401` and count `0`; `byte tampering fails verification` asserts `401`; `ping is handled internally` asserts `200` and count `0`. No agent runtime is started. Prove callback errors do not masquerade as an accepted application result.
- [ ] **5. Run strict gates and stop/go review.** Run `moon run github-admission:typecheck --force --no-actions`, `moon run github-admission:test --force --no-actions`, root check and all existing gates. Known earlier Flue vendor diagnostics include TS2846, TS2307 and TS2416: if reproduced, preserve exact diagnostics and stop without `skipLibCheck`, ambient shims, newly installed missing SDKs or cohort changes. No later task starts without clean compatibility evidence.
- [ ] **6. Commit verified gate/evidence.** Record admitted artifact or precise blocking condition, checks actually run and absence of live access. On success commit `test: qualify GitHub channel on pinned Bun cohort` and review under the selected execution method. On failure, preserve diagnostics and restore only this task's unqualified setup/manifest/lock edits to the recorded baseline, preserving concurrent user changes. Rerun baseline gates and commit only a clearly labelled documentation-only blocked assessment; do not commit a broken workspace or claim an accepted dependency gate.

Representative assertions in `signed valid request reaches callback once` (the
test constructs the real channel with its callback pushing into `calls`):

```typescript
const response = await channel.route().fetch(await signedFixture({}));
expect(response.status).toBe(200);
expect(calls).toHaveLength(1);
```

Planning-time public registry read on 2026-10-20 found version `2.3.0`, runtime
peer `^2.3.0`, exports `dist/index.mjs`/`dist/index.d.mts`, dependencies
`@octokit/webhooks-types: 7.6.1` and `hono: ^4.12.32`, and integrity
`sha512-YMhbDT8P3xt3ilO3OI9xOebiitTqy1z5kdLEL+1MB6mdGeYiGO1aEkjQPK1pmSK1hN6HAQNNpcOGZWJ/hhXpDg==`.
The published declaration was read without installation and exposes
`createGitHubChannel(options).route()`. This is not a clean typecheck/runtime gate.
See [exact registry metadata](https://registry.npmjs.org/@flue%2Fgithub/2.3.0).

## Task 2: Pure Command, Identity And Authority Policy

**Files:** domain files/tests and domain index from the map.

**Interfaces:** produce the shared schemas and `parseAssessCommand(body: string)`
returning `Assess | NotCommand`; `commandKey(candidate): CommandKey`;
`transportKey(scopeId, deliveryId): TransportKey`;
`decideAssessment({ candidate, authority: AuthorityState, nowMs }): AdmissionDecision`.
Return types are schema-derived data, not Effects. They consume no GitHub SDK.
`commandFixture()` in the domain test fixture returns coherent candidate/authority
with IDs installation `11`, repository `22`, owner `33`, issue `44`, comment `55`,
operator `66`, issue number `1`, scope `fixture-app`, profile `foldkit`, and
revisions `authority-1`, `policy-1`, `profile-1`. All other fixture packages reuse
these literal values without production source importing test modules.

- [ ] **1. Write focused failing literals.** `exact command only` asserts the exact literal parses and whitespace/newline/quotes/arguments/case variants do not. `coherent available authority admits preview` asserts all profile/evidence bindings. `one changed authority fact refuses` covers every identity, access, operator and profile dimension; unavailable evidence is explicit. Run `bun --no-env-file --no-install test tests/command-admission.test.ts --timeout 30000` from domain and observe the missing implementation failure.
- [ ] **2. Implement schema/decision files.** Derive immutable records and reason unions, validate finite safe IDs/times and unique bounded operators, and compare complete immutable bindings. Make validity end exclusive. No external calls, timestamps inferred from comments, repository instructions or default current time.
- [ ] **3. Pin boundary cases.** `expiry is exclusive` asserts admit at `1999`, refuse at `2000`/`2001`; `invalid/future observation fails` covers NaN/infinity/fraction/overflow/negative time; `rename is metadata, transfer is authority` tests name-only changes versus owner/install changes. `tuple keys do not alias` asserts distinct validated tuples cannot collide and display changes leave keys stable.
- [ ] **4. Add six nonvacuous laws.** At the fixed budget test coherent admission, single authority-binding mutation refuses, invalid interval/time refuses, rename invariance, key injectivity, and exact-command rejection under generated extra text. Use existing `checkLaw`; each law has a constructive admitted/control case, not filtered-away inputs. Retain failure seed and replay diagnostic.
- [ ] **5. Verify/commit/review.** Run focused RED/GREEN, all available full gates and new law count validation. Commit `feat: define pure assessment admission policy`; review under the selected execution method before Task 3.

Literal assertions in `expiry is exclusive`:

```typescript
const fixture = commandFixture();
expect(decideAssessment({ ...fixture, nowMs: 1999 })._tag).toBe('AdmittedPreview');
expect(decideAssessment({ ...fixture, nowMs: 2000 })).toEqual({
  _tag: 'Rejected',
  reason: 'AuthorityExpired',
});
```

## Task 3: Inferred Inbox Service And Admission Use Case

**Files:** engine source/tests and index from the map. Memory inbox is test-only.

**Interfaces:** produce shared driver/draft/record/reply contracts and
`CommandInboxError { operation: 'load' | 'commit' | 'open' | 'close', code }` with
finite sanitised codes. Produce `makeCommandInbox(driver)`, `CommandInbox`,
`makeCommandAdmission()` and `CommandAdmission`; use `Context.Service` derived
from the real factories. `admit(input: unknown)` returns an inferred Effect with
`AdmissionReply`, tagged operational failure and no retained inbox dependency
after its owning service acquisition. It decodes/detaches input before use.

- [ ] **1. Write/observe failing use-case tests.** `one exact candidate records one preview`, `operational failure is not a decision`, and `service retains declared dependencies` pin successful records, separate failure channels and consumer-only strict compilation. Add test driver load/commit call counts and mutation barriers; run the engine's named test files and capture RED.
- [ ] **2. Implement service/use case.** Load trusted authority observation, evaluate with pure policy, submit a detached draft and return the atomic driver's recording disposition. No check-then-insert policy in the service, implicit retry, new decision on duplicate, helper provisioning or Effect runners. Validate driver replies at the boundary; malformed/mismatched records become tagged failures rather than trusted success.
- [ ] **3. Implement the memory contract fixture.** Atomically enforce transport/command identity, authority revision, current time/clock floor, uniqueness and capacity. Clone both stored records and returned data. It is a synthetic contract implementation, not durable evidence or a second run ledger.
- [ ] **4. Exercise literal failures/races.** Assert same key/different digest, header event binding, actor or issue conflict preserve the first record; rename/different delivery ID references the original; rejected commands remain rejected after profile changes; new comments may succeed. Pausing between authority load and commit, then replacing/revoking authority, must produce an unrecorded rejection/conflict, never a stale preview. Caller mutation before/after completion cannot rewrite the draft/history. Store throw/invalid reply returns an observed operational error.
- [ ] **5. Add four engine sequence laws.** Generated delivery/replay ordering preserves at most one admission per command key; original decisions are immutable; authority changes cannot activate an old rejection or admit through a stale draft; a constructive valid new-comment sequence can admit after its blocker is resolved. Use `Arbitrary.checkEffect` and existing `validateCheckResult`, fixed budgets, fresh scoped state and sequences no longer than 25. Do not introduce a parallel admission-policy oracle.
- [ ] **6. Verify/commit/review.** Run the literal suites, exact property counts and full gates. Commit `feat: add transactional command admission boundary`; review under the selected execution method before SQLite/composition consumes the contracts.

The engine fixture exports `verifiedCommandFixture()` using the shared literal
candidate and a schema-valid synthetic digest. In `same command is not admitted
twice`, drive its identical input twice through the composed service and assert:

```typescript
expect(first).toMatchObject({
  _tag: 'Recorded',
  record: {
    decision: { _tag: 'AdmittedPreview' },
  },
});
expect(second).toMatchObject({
  _tag: 'Duplicate',
  record: {
    decision: { _tag: 'AdmittedPreview' },
  },
});
expect(storedDecisionCount).toBe(1);
```

## Task 4: Scoped SQLite Inbox And Authority Revision Barrier

**Files:** probe `src/sqlite-inbox.ts`, `src/fixture.ts`, `tests/sqlite-inbox.test.ts`.

**Interfaces:** implement `makeSqliteInbox` from the shared decisions using
`bun:sqlite` and inferred scoped acquisition. Its driver implements Task 3 exactly.
`installAuthority({ expectedRevision, nextState })` replaces the local snapshot
using an expected current revision. Persist used revisions so stale expected
revisions and reuse of an older revision cannot restore old authority; identical
current-revision/state installation is idempotent. It is not a GitHub API.
SQLite fault points are `BeforeRecord`, `AfterDecision`, `BeforeCommit`,
`AfterCommit`, `Close`; test construction owns them, requests cannot select them.

- [ ] **1. Write/observe failing adapter contract tests.** The real file-backed adapter must satisfy `record once`, `duplicate original`, `conflicting delivery cannot overwrite`, `stale authority cannot commit`, `rollback after decision insert has no partial rows`, and `fresh read returns detached schema-valid record`. Run `tests/sqlite-inbox.test.ts` in the new probe and capture RED before adapter code.
- [ ] **2. Implement native schema/lifetime.** Use authority rows keyed by ingress scope with revision/snapshot and clock floor plus unique used-revision history; decisions unique by command key; receipts unique by transport key and referring to decisions. Enforce SQL constraints/foreign keys and validate JSON on read. A new database without an explicit initial fixture has unavailable authority, not an enabled default; reopen never reseeds it. Acquire/init/close with Effect resource ownership; failed initialization closes the handle. Never store full comment/raw body, secret, signature or exception text; only normalised fields/digests/evidence. No run/conversation database is created.
- [ ] **3. Implement one synchronous write transaction.** Resolve identical receipts/commands first as explicitly historical results. For new work compare expected authority revision inside the transaction, read injected current time, enforce floor/freshness for new previews and recheck the pure policy against the current authority. Insert receipt/request/decision and update floor atomically. Capacity or mismatch rolls everything back; assign decision ID once. Do not await inside the transaction or call runtime helpers to obtain time.
- [ ] **4. Prove transaction and resource edges.** Two separately opened connections race the same fixture command: one original only, others duplicate or explicit retryable busy/conflict; sequential deliberate retry converges to that original. Inject each pre-commit fault and inspect fresh connection counts. Post-commit response loss must retain the original. At capacities 256/1024, known duplicates still work but new rows refuse without eviction. Busy lock, corrupt file, invalid stored schema, caller mutation, clock rollback, expiry equality and init-plus-close failure remain visible without leaking handles or swallowing the primary error.
- [ ] **5. Verify/commit/review.** Run focused suites and full gates. Record local transactional evidence separately from memory laws. Commit `feat: persist offline command admissions in SQLite`; review under the selected execution method before ingress integration.

In `rollback after decision insert has no partial rows`, inject `AfterDecision`
failure and count rows using a fresh native connection, not the adapter cache:

```typescript
expect(commitExit._tag).toBe('Failure');
expect(rowsAfterFailure).toEqual({ decisions: 0, receipts: 0 });
expect(originalAuthorityRevision).toBe('authority-1');
```

## Task 5: Bounded Verified Ingress And One Application Bridge

**Files:** probe `src/request-body.ts`, `src/github-payload.ts`,
`src/github-ingress.ts`, `src/composition.ts` and their named test files.

**Interfaces:** `captureRequestBody(request, limit, signal?)` returns an inferred
Effect containing `{ bytes: Uint8Array, digest: Digest }`; derive `CapturedBody`
from that actual Effect's success type, not manual Effect channels. It consumes
and cancels its reader under owned lifetime. Define sanitised `RequestBodyError`
codes `TooLarge`, `ReadFailed`, `Aborted`, `DigestFailed` in the same adapter file.
`normaliseGitHubDelivery({ eventName, payload: unknown,
receipt }): Result.Result<VerifiedCommand, NonAdmittedDecision>` performs runtime
decoding, returning a failure value containing the rejected/ignored decision when
not a command; this is a pure Result, not an operational Effect failure. `makeGitHubIngress({
secret, ingressScopeId, capture, admit })` returns `{ fetch(request): Promise<Response> }`,
with `capture: (request: Request) => Promise<CapturedBody>` and
`admit: (command: VerifiedCommand) => Promise<AdmissionReply>` injected only by
the exported composition boundary, running their Effects on its single runtime.
`openAdmissionProbe`/Layer follow the shared
signatures. Keep SDK calls in ingress, not domain/engine.

- [ ] **1. Write/observe failing end-to-end tests.** `signed authorised command persists one preview`, `tampered bytes never call admission`, `renamed replay is historical`, and `revoked new comment cannot admit` exercise the actual channel plus real SQLite through `openAdmissionProbe`. Assert response schema, transaction rows and bridge acquisition/disposal counts. Capture RED against missing integration before implementing it.
- [ ] **2. Implement bounded capture/normalisation.** Read once to the exact limit, hash original bytes, and construct a new local Request with unchanged bytes/headers for the SDK; do not reserialise or clone an unbounded stream. Pass digest/context through request-local closure/state, never a mutable global latest-delivery variable. Runtime-decode native fields and scope equality; only ordinary new issue comments with matching human author/sender and exact command proceed. Streaming read rejection or abort cancels/releases the reader and never calls admission.
- [ ] **3. Implement channel and application composition.** Create the real channel, route locally at `/webhook`, and await the injected admission callback before returning an explicit mapped response. Compose one scoped SQLite/inbox/admission Layer and one exported ManagedRuntime bridge, alive until `dispose`. No listener or per-request runtime; dispose is idempotent and late calls fail explicitly. Propagate cancellation before admission; interruption after synchronous commit must not undo it or claim the request never happened.
- [ ] **4. Exercise protocol/error table.** Assert every fixed HTTP status and finite outcome: bad/missing/tampered signature; invalid UTF-8/JSON/metadata/IDs; media/body/field limits including streamed overflow; unsupported events/actions/PR/bot; exact-command variants; authority denial/expiry/change; transport conflict/capacity; SQLite error and thrown callback. Avoid SDK default-empty-200 behavior on errors. Interleave two requests with different bytes/digests using barriers to prove request-local capture cannot cross-contaminate receipts.
- [ ] **5. Verify no-work boundaries and sanitisation.** Fail-closed outbound-fetch/listener spies in tests must remain at zero; restore them in cleanup. Inspect source import/call graph and unchanged qualification/worker source hashes: no agent/model API, run coordinator call, worker constructor or GitHub client. Query persisted rows/responses/logs for fixture secrets, signatures, raw non-command bodies and injected exception text; all absent. These are bounded proof claims, not universal network-containment guarantees.
- [ ] **6. Verify/commit/review.** Run focused RED/GREEN and full gates without modifying lint configuration. Commit `feat: bridge verified GitHub fixtures to admission previews`; review under the selected execution method before final persistence qualification.

In `tampered bytes never call admission`, sign first and change a body byte
without resigning. Through the composed application's `fetch`, assert:

```typescript
expect(response.status).toBe(401);
expect(admissionCallCount).toBe(0);
expect(storedDecisionCount).toBe(0);
expect(outboundFetchCallCount).toBe(0);
```

## Task 6: Restart, Fault Controls And Measured Qualification

**Files:** probe `src/restart-child.ts`, `src/report.ts`, `tests/restart.test.ts`,
`tests/report.test.ts`; evidence, README, roadmap and only implemented spec status.

**Interfaces:** child executable takes trusted `mode` and test-owned database path
as explicit CLI arguments; it imports source fixture/composition only, no Node
imports or tests. Modes `committed`, `uncommitted`, `read` communicate schema-valid
bounded JSON/sentinels; parent tests own subprocesses and watchdogs. Define
`RestartResult` in `report.ts` as `{ disposition: 'Recorded' | 'Duplicate',
decisionId }` and runtime-decode child JSON before using it. Parent tests query
actual decision/receipt counts from a fresh native connection. Report schema
binds tested source/lock/artifact identities, exact gate exits, actual test/law
counts and explicit offline exclusions. It must refuse missing/failed gates.

- [ ] **1. Write/observe failing recovery tests.** `committed lost response survives process kill` starts writer, waits for a sentinel emitted only after native commit, SIGKILLs it, and reads/replays from a fresh process. `uncommitted kill leaves no partial admission` pauses after insert but before transaction commit, kills, and asserts a fresh connection sees no partial keys/decision and current-authority retry records once. Parent always joins/kills surviving children and removes only its owned temporary directory; all waits use the 5000ms watchdog.
- [ ] **2. Implement child/recovery protocol.** Use the exported application boundary and real database, not seeded JSON as recovery proof. The trusted synchronous fault hook writes a bounded phase sentinel, then blocks on a child-local `Atomics.wait` barrier with a 5000ms fail-closed timeout; it never awaits inside the native transaction. The parent kills only after reading that phase, not after a guessed sleep. No timers keep the child alive. SIGKILL provides no close guarantee; clean close/interruption is covered separately. Reader mode uses `create: false` and no initial authority: missing/corrupt file cannot silently become a recovered success or reset revoked access. A post-commit repeated delivery under a new ID remains a duplicate after restart.
- [ ] **3. Run behavioral negative controls.** Temporarily break command-key deduplication, the authority-revision barrier and transaction rollback, one at a time. The corresponding replay law, literal revision race and SQLite fault/recovery test must fail reproducibly. Include a reject-everything control caught by a constructive admitted case. Restore correct source before verification; record RED/GREEN/control identities without committing broken code.
- [ ] **4. Build the measured report.** `report refuses any missing or nonzero gate` and `report separates local persistence from production durability` must fail before report implementation. Record exact fresh head/tree/lock and artifact integrity, physical Effect/cohort audit, all command exit codes, law seeds/budgets/actual runs, controls and unqualified live/durable/host-loss capabilities. Expected 30000 new cases is a requirement to verify, not a copied measured total.
- [ ] **5. Run final gates and update docs.** Execute the complete sequential block below in a minimal environment, with no cached/affected-only evidence or automatic retries. Mark roadmap items only where actual tests qualify them. Retain live permission, model/worker/publishing/hosting exclusions and any compatibility failure. Self-review spec-to-test coverage and no-work composition boundaries.
- [ ] **6. Commit and obtain final independent review.** Commit `test: qualify offline GitHub admission recovery`. A fresh reviewer checks the whole branch and reruns gates; fix/review findings before claiming completion. Recommend the next separately approved work, but do not merge, push, install credentials, expose an endpoint or start execution.

In `committed lost response survives process kill`, decode the fresh reader's
result and compare against the writer's committed decision identity:

```typescript
expect(writer.signalCode).toBe('SIGKILL');
expect(recovered.disposition).toBe('Duplicate');
expect(recovered.decisionId).toBe(committedDecisionId);
expect(storedDecisionCount).toBe(1);
```

## Verification Commands And Installation Audit

Run each command separately from the isolated worktree root, prefixing each with
`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"`. Initial baseline runs the
existing targets only and does not install anything. After approved Task 1
installation, every task's final gate includes all current targets:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
moon run domain:typecheck --force --no-actions
moon run engine:typecheck --force --no-actions
moon run probe:typecheck --force --no-actions
moon run github-admission:typecheck --force --no-actions
moon run domain:test --force --no-actions
moon run engine:test --force --no-actions
moon run probe:test --force --no-actions
moon run github-admission:test --force --no-actions
git diff --check
```

The new Moon test task is `bun --no-env-file --no-install test --timeout 30000`;
typecheck is `bun --bun --no-env-file --no-install run typecheck`. Both use
`cache: false`, `retryCount: 0`, `envFile: false`; the package script is
`tsc --noEmit`. Focused RED/GREEN runs the named test file from its workspace with
the same environment and timeout. A compiler/import RED is distinct from a
behavioral regression RED; capture both where appropriate.

Audit exact installed manifests/realpaths, `bun pm ls --all` and manifest/lock
diffs against baseline. One physical Effect `4.0.5`, unchanged existing direct
pins, unchanged root lint/format/toolchain policy and explained new transitive
entries are mandatory. Task 1 may update the root lock for the approved new
package, never to cure unrelated declaration errors. Validate the fetched tarball
against registry integrity and actual exports rather than trusting a source tree.

## Planning Self-Review And Handoff

Coverage: compatibility (Task 1); pure command/authority/identity (Task 2);
inferred services and replay semantics (Task 3); local atomic revision, capacity,
time and persistence boundaries (Task 4); real verified ingress, sanitisation and
no execution (Task 5); process recovery, controls and measured evidence (Task 6).
All five Review Focus cases have owning literal tests. Interface names and
schema-derived data are shared above; no unimplemented task consumes a differently
named service or grants wider authority.

The known vendor-declaration risk makes the first gate meaningful and potentially
blocking. Passing package metadata reads is not passing that gate. Do not start
the remaining tasks just because their plans are written.

The owner approved the plan and selected subagent-driven execution. The original
strict failure and its later explicitly approved, independently reviewed repair
are linked above. Task 2 is the next bounded approved slice; that approval does
not automatically start Tasks 3-6. Live GitHub use remains unauthorised.
