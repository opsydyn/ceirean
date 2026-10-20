# Local GitHub Ingress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify a local, single-repository GitHub admission listener with fresh access checks, immutable evidence and restart-safe replay protection, without enabling execution or publication.

**Architecture:** Extract the existing verified protocol into a private infrastructure workspace, retaining the old probe's semantics. Add a separate live-admission domain/service and schema-versioned SQLite adapter so per-request GitHub evidence cannot become shared fixture authority. One local CLI composition root owns one ManagedRuntime, the scoped adapters and the bounded loopback listener.

**Tech Stack:** Bun 1.4.2, Effect 4.0.5, Flue runtime/GitHub 2.3.0, TypeScript 7.0.2, Moon 2.5.4, bun:sqlite, Effect Arbitrary, Bun tests, oxlint 1.88.0, oxfmt 0.73.0, Effect lint 2.0.1. Candidate direct dependencies: jose 6.2.12 and @effect/platform-bun 4.0.5, subject to Task 1.

**Spec:** [Approved local GitHub ingress design](../specs/2026-10-20-local-github-ingress-design.md).

Status: the owner approved the written spec and selected subagent-driven plan
execution on 2026-10-20. Tasks 1-3 are committed and independently reviewed;
Task 3's blocking findings were fixed and cleared on 2026-10-21 at `f707065`.
That source passes 699 tests, five typechecks, all available gates and 24000 new
primary law cases per full execution. Tasks 4-7 remain pending. Two Task 3 Minor
findings remain for final triage; installer traffic was not independently traced.
Live credentials, public tunnel, App modification, live GitHub access, merge and
push remain separately gated. Original design baseline was main `6bc1567`;
implementation began from the approved planning commit `4fdf876` in isolation.

## Global Constraints

- Exactly `/leviathan assess`, new ordinary-issue comments, human sender/author equality, one GitHub.com App/installation/owner/repository, explicit immutable-ID operator allowlist and fresh write-or-higher permission per new admission.
- No models, agents, workers, coordinator calls, repository execution, assessment output, GitHub comments/PRs, publication, discovery, cloud resources or automated redelivery. Synthetic loopback tests are allowed only after plan execution approval; live rehearsal remains a separate gate.
- Preserve Bun 1.4.2, Effect 4.0.5, Flue 2.3.0, TypeScript 7.0.2, Moon 2.5.4, bun-types 1.4.2, oxlint 1.88.0, oxfmt 0.73.0, Effect lint 2.0.1 and existing XState pins. Node 24.15.0 is tooling only, not a controller fallback.
- All 141 Effect rules remain errors universally. No lint-config changes, disables, ignored new paths, manual Effect/Layer channels, fake inference factories, helper provisioning, new vendor patches or per-request runtimes. Preserve the two approved declaration patches and existing optional MCP peer only. New workspaces use `skipLibCheck: false`.
- One root Bun lockfile and one physical Effect. Task 1 alone admits exact new dependencies. No direct Hono/Octokit import, database wrapper, alternate test runner or cryptographic implementation.
- One exported application boundary owns one ManagedRuntime. Services acquire dependencies once. Native imports stay in infrastructure; domain stays pure and engine has no HTTP/filesystem/Flue imports. App uses Effect FileSystem/Path/Stdio with Bun platform implementations, not Node imports or environment-read loopholes.
- Loopback `127.0.0.1:8787`; four concurrent requests, no unbounded queue; 60 starts per rolling minute; eight-second request budget; six-second GitHub-check budget; two seconds maximum per HTTP attempt; ten-second graceful shutdown. Tests may explicitly use ephemeral ports and test-owned temporary files, never ambient real credentials.
- Request body 65536 bytes, GitHub response 1 MiB, existing identifier/comment/operator bounds unchanged. Capacity 256 decisions, 1024 receipts, 256 local authority revisions. Evidence expires no later than six seconds after the first live observation and within the request budget.
- No positive permission cache, HTTP retries, redirect following, automatic schema migration, key pruning, reset command or silent database creation on start. No asynchronous work inside SQLite transactions.
- Default database `~/Library/Application Support/Leviathan/github-admission.sqlite`, explicit `--database` override, directory 0700/database 0600 with protected sidecars. Production paths exclude repositories, temporary/synced directories and unsafe symlinks. Test-only paths do not weaken operator validation.
- Each task requires RED/GREEN, full available gates, a verified commit and the selected review gate before dependent work. Never lower existing law counts/budgets, retry failing suites into green, or treat old reports as evidence for changed source. No merge or push without separate approval.

## Review Focus

1. The same delivery ID with a changed digest, or the same comment with a changed actor/issue, must conflict even when GitHub is unavailable: Tasks 2, 3 and 5.
2. Cancellation after authentication but during response-body reading must release the reader and never allow a late commit: Tasks 4 and 6.
3. A renamed user/repository or reassigned login must preserve immutable identity without trusting webhook URLs or redirect targets: Task 4.
4. An empty existing database, symlinked parent, stale listener ownership or older backup must not silently become a new trusted ledger: Tasks 5 and 7.
5. A shutdown deadline cannot truthfully claim finalizers completed; a stuck cancellation must yield a bounded failed process exit, with restart recovery tested separately: Tasks 6 and 7.

## File And Dependency Map

All workspaces are private. Subsequent `src/` and `tests/` entries in each row are
relative to that workspace. Keep the legacy SQLite probe in place; extraction
shares protocol, not an unreviewed conversion of its historical authority model.

| Workspace                                                                      | Files and ownership                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/github-adapter` (`@leviathan/github-adapter`, Moon `github-adapter`) | New manifest, strict tsconfig and Moon tasks; `src/request-body.ts`, `github-payload.ts`, `verified-ingress.ts` (extracted protocol); `github-auth.ts`, `github-http.ts`, `github-authority.ts` (native cancellable API adapter); `local-state.ts`, `live-sqlite-storage.ts`, `live-sqlite-inbox.ts` (filesystem and new inbox); explicit subpath exports. Tests: `compatibility.test.ts`, `protocol.test.ts`, `github-authority.test.ts`, `local-state.test.ts`, `live-sqlite-inbox.test.ts`. |
| `packages/domain`                                                              | Create `src/live-admission.ts`, `src/live-admission-policy.ts`, `tests/live-admission.test.ts`, `tests/live-admission-properties.test.ts`; export from existing `src/index.ts`. Reuse existing command/ID/profile schemas without changing legacy record shapes.                                                                                                                                                                                                                               |
| `packages/engine`                                                              | Create `src/live-admission-errors.ts`, `live-admission-factories.ts`, `live-admission-ports.ts`, `live-admission-service.ts`; `tests/live-admission.test.ts`, `live-admission-properties.test.ts`, `memory-live-inbox.ts`; update barrel only.                                                                                                                                                                                                                                                 |
| `apps/github-ingress` (`@leviathan/github-ingress`, Moon `github-ingress`)     | New manifest, strict tsconfig and Moon tasks; `src/config.ts`, `cli.ts`, `composition.ts`, `listener.ts`, `responses.ts`, `main.ts`; tests `config.test.ts`, `listener.test.ts`, `cli.test.ts`, `restart.test.ts`, `restart-child.ts`. Child launched only by tests.                                                                                                                                                                                                                           |
| Existing probe                                                                 | Retain old file paths as small static forwarding/legacy-response modules in `src/request-body.ts`, `github-payload.ts`, `github-ingress.ts`; use the adapter's protocol export. Its composition, fixture authority, SQLite semantics and old test contracts remain independent.                                                                                                                                                                                                                |
| Root/docs                                                                      | Modify `.moon/workspace.yml`, relevant manifests and `bun.lock` only as needed for workspace links/Task 1; root override for platform-node-shared described below. Update README/roadmap; create `docs/runbooks/local-github-ingress.md`, `docs/assessments/local-github-ingress.md`, `docs/evidence/local-github-ingress.json`.                                                                                                                                                               |

New Moon tasks copy the existing explicit uncached configuration: `typecheck`
runs `bun --bun --no-env-file --no-install run typecheck`; `test` runs
`bun --no-env-file --no-install test --timeout 30000`; cache false, retryCount 0,
envFile false. Do not use root unfiltered Bun tests or include vendored trees.

### Shared Interfaces

Define data with Effect Schema and derive readonly types; signatures below are
data/native contracts, never instructions to hand-annotate Effect channels.

- `LocalIngressPolicy`: `{ revision, ingressScopeId, appId, installationId, ownerId, repositoryId, profile, policyRevision, allowedOperatorIds }`, reusing existing validated IDs/revisions/profile and the unique 100-operator bound. No live observation timestamps in shared policy.
- `ClockReading`: `{ wallMs, monotonicMs }`, safe nonnegative millisecond integers. The live adapter samples from an explicit clock; domain decisions receive readings rather than reading time.
- `AuthorityQuery`: `{ verified: VerifiedCommand, policy: LocalIngressPolicy }`, with detached construction snapshots.
- `LivePermissionEvidence`: `{ evidenceId, commandKey, appId, installationId, ownerId, repositoryId, operatorId, localPolicyRevision, policyRevision, profileId, profileRevision, basePermission, observedAtMs, checkedAtMs, validUntilMs }`; permission is `write | admin | read | none`, interval starts at the first live check, and exact expiry is excluded. `evidenceId` uses the existing bounded AuthorityRevision schema and an application-generated unique identity. `LiveEvidenceLease` adds request-local `startedMonotonicMs`; never persist or reuse an absolute monotonic tick after restart.
- `DecisionProvenance`: `LocalPolicy { revision }` or `LiveChecked { evidence }`. A local refusal never fabricates GitHub evidence. An admitted preview requires `LiveChecked` with matching IDs/key/revisions and acceptable permission/time.
- `LiveAdmissionRecord`: `{ decisionId, commandKey, candidate, decision, localPolicyRevision, provenance, evaluatedAtMs, committedAtMs }`; `LiveAdmissionReply` is `Recorded { record } | Duplicate { record } | Unrecorded { decision }`. Reuse existing AdmittedPreview/rejection facts; an admitted decision carries the business policy/profile revisions and uses `evidenceRevision = provenance.evidence.evidenceId`. Local rejections need no invented enabled-profile fields. Add a separate live record/envelope rather than widening legacy fixture records to optional evidence.
- `ReplayResolution`: `Absent | Duplicate { record } | Conflict { reason } | CapacityExceeded`; lookup can atomically add a bounded receipt referencing a matching existing command, never create a new decision. The final fresh commit always rechecks replay. Known receipts stay readable at capacity.
- `LiveAdmissionDraft`: `{ verified, expectedLocalRevision, decision, provenance, evaluatedAtMs, evaluatedMonotonicMs }`, with both evaluation readings taken from the actual evaluation clock and request-local `evaluatedMonotonicMs` common to LocalPolicy and LiveChecked. Final commit must reject wall or monotonic readings earlier than evaluation. The schema-derived union additionally requires request-local `startedMonotonicMs` for LiveChecked and omits it for LocalPolicy; live evaluation must be at or after that start and strictly within the evidence lifetime. Never persist absolute monotonic ticks in LiveAdmissionRecord or replay state across restart. Do not duplicate an independently mutable evidence object in a second lease field. Invalid provenance/decision combinations must not be representable as a validated draft.
- `LocalPolicyObservation`: `{ policy: LocalIngressPolicy, at: ClockReading }`. `LiveInboxDriver`: synchronous `loadPolicy(scopeId): Result<LocalPolicyObservation, LiveInboxError>`, `resolveReplay(verified): Result<ReplayResolution, LiveInboxError>`, `commit(draft): Result<LiveAdmissionReply, LiveInboxError>`; factory `makeLiveInbox(driver)` wraps actual driver operations into inferred Effects, decodes inputs/outputs and exposes matching service methods with spans. Derive `LiveInbox` from its real factory return. Reload after live checks to obtain current evaluation time; commit remains the final revision/time authority.
- `LiveAuthorityDriver`: `(query: AuthorityQuery, signal: AbortSignal) => Promise<Result<LiveEvidenceLease, LiveAuthorityError>>`. `makeLiveAuthority(driver)` uses the established engine native-driver pattern, propagates cancellation and schema-decodes results; derive `LiveAuthority` from that actual factory. Expected insufficient permission returns valid evidence, while unavailable/ambiguous checks fail with typed finite operational errors.
- `makeLiveAdmission()` acquires `LiveInbox` and `LiveAuthority` once; returned `admit(input: unknown)` performs replay-first/local-policy/live-check/atomic-commit flow. Service shape is inferred. Acquire clocks at service/adapter boundaries, not hidden in pure helpers.
- `decideLiveAdmission({ verified, policy, evidence, now })` is pure: evidence is Option<LiveEvidenceLease>, now is ClockReading, and the result is the existing AdmissionDecision union. The policy rejects locally before evidence is requested; an otherwise eligible request without complete evidence cannot be admitted. Derive finite error classes with Schema/Data: LiveAuthorityError has phase `installation | token | repository | user | permission | body | signing` and code `Unavailable | Denied | RateLimited | Timeout | Aborted | InvalidResponse | TooLarge | IdentityMismatch | InvalidKey`; LiveInboxError has operation `open | load | replay | commit | configure | close` and the existing inbox error codes plus `IncompatibleSchema | OwnershipBusy | UnsafePath`. No arbitrary native error text is public.
- `makeVerifiedGitHubIngress({ secret, ingressScopeId, capture, onVerified })` returns `{ fetch(request): Promise<Response> }`; `onVerified(VerifiedCommand)` runs only after real Flue verification/normalisation. The exported application bridge supplies it; no agent, inbox fixture, Layer or runtime is created by this callback.
- `makeGitHubAuthorityDriver({ appId, privateKey, fetch, clock }): Promise<Result<LiveAuthorityDriver, LiveAuthorityError>>` asynchronously imports the signing key once. Compose that acquisition once, not inside request callbacks. `clock(): ClockReading` and `fetch` are explicit native adapter dependencies, with AbortSignal on every fetch, not ambient test escapes. Use jose's published signing/key-import functions, never custom JWT crypto.
- `LiveInboxConfig`: `{ file, ingressScopeId, initialPolicy?, limits, clock }` with the existing 256/1024/256 ceilings, injected ClockReading callback and explicit test-only fault hooks. `initializeLiveInbox(config)` is a scoped Effect that exclusively creates schema version 1, its policy and ownership sidecar; `openLiveInbox(config)` returns `{ driver, updatePolicy(input) }` through scoped acquisition, with create disabled and no schema DDL. `updatePolicy({ expectedRevision, next })` is trusted stopped-ingress CLI administration only, with revision uniqueness and capacity. It is never exposed to webhook code.
- `openLocalGitHubApp(config)` owns the one ManagedRuntime, exposes `fetch(Request)` through its bridge plus idempotent `dispose()`, and acquires the database/credentials/services before listening. `runCli(argv)` supports `init`, `start`, `status`, `configure`; `configure` requires no listener owner and an expected policy revision. `main.ts` delegates once, sets the exit result and owns signal/forced-exit handling; never add another Effect runner alongside the ManagedRuntime.

The CLI config is explicit JSON `{ policy, stateRoot, webhookSecretFile,
privateKeyFile }`, schema-decoded with unknown keys rejected. `--config` is an
absolute file path; `--database` is an optional absolute path within stateRoot,
which defaults to the stated Application Support directory. init/status/configure
decode secret references but never read secret files. Explicitly reject known
synced roots and symlink components; document that arbitrary third-party sync
software cannot be inferred from a path alone and requires operator declaration.
CLI forms are `init --config PATH [--database PATH]`, `start --config PATH
[--database PATH]`, `status --config PATH [--database PATH]`, and `configure
--config PATH --expected-revision REV [--database PATH]`. Reject other flags and
positional inputs. Add a workspace `cli` script running
`bun --no-env-file --no-install src/main.ts`; no command auto-starts a tunnel.
Non-start commands use only the state/config layers in their single invocation
runtime, never acquire the start application and then create a second runtime.

## Task 1: Qualify Exact Authentication And Bun Platform Dependencies

**Files:** new adapter/app manifests, strict tsconfigs and Moon tasks;
`packages/github-adapter/tests/compatibility.test.ts`; root manifest/Moon/lock;
initial compatibility section in `docs/assessments/local-github-ingress.md`.

**Consumes:** pinned existing cohort and approved spec. **Produces:** accepted
direct `jose: "6.2.12"` and `@effect/platform-bun: "4.0.5"` imports, or a precise
blocked report. No real GitHub request or production app scaffold beyond the
compatibility deliverable. App's initial workspace may be added in Task 6 instead.

- [x] **1. Baseline.** Resolve the actual Leviathan checkout/worktree and clean status, inspect existing attachments and reuse a suitable isolated checkout via using-git-worktrees. Do not implement on main or attach a FoldKit worktree. Run the full existing gate block; capture source/lock identities before edits.
- [x] **2. RED.** Add compatibility tests importing candidate packages directly. Test synthetic PKCS8 RS256 JWT roundtrip, malformed key failure, real Bun-backed FileSystem exclusive creation/chmod and scope cleanup in a test-owned directory. A missing export/package is a compatibility RED, not a behavioural RED. No credential discovery or API calls.
- [x] **3. Verify/install exact artifacts.** Verify npm metadata/tarball SHA512 and declared exports/peers before one script-free install. Add jose to adapter dependencies; platform-bun to adapter devDependencies and, later, app dependencies. Pin root `overrides["@effect/platform-node-shared"] = "4.0.5"` because platform-bun declares `^4.0.5`; do not let that transitive range upgrade the Effect platform independently. Inspect ws/@types/ws transitive additions and prohibit unrelated lock changes. Current metadata is a candidate, not installed qualification.
- [x] **4. GREEN gate.** Run strict new-workspace typecheck, real synthetic signing/filesystem tests and the full gates. Confirm one physical Effect, unchanged existing pins/patch hashes and all 141 rules. Bun platform's internal node-shared dependency is not a Node controller fallback, but it must actually pass under Bun. Do not weaken lint or declaration checks if its API fails.
- [x] **5. Commit/review.** On success commit `test: qualify local ingress authentication cohort`; record exact installed artifacts, commands and limits. On failure stop dependent tasks, preserve diagnostics, restore only this task's unqualified dependency/setup edits without overwriting concurrent user changes, rerun baseline and commit a documentation-only blocked report. Do not leave a broken workspace committed.

## Task 2: Extract The Verified Protocol Without Changing Legacy Outcomes

**Files:** adapter `src/request-body.ts`, `github-payload.ts`,
`verified-ingress.ts`, `tests/protocol.test.ts`; old probe's three forwarding/
response modules and manifest; adapter explicit `./protocol` export.

**Consumes:** existing qualified body capture, native payload normalisation and
Flue 2.3.0. **Produces:** `makeVerifiedGitHubIngress` and exported capture/normalise
functions, with the legacy `makeGitHubIngress` retaining old AdmissionReply/status
semantics. Neither module imports fixtures or owns an application runtime.

- [x] **1. RED.** Add `verified callback sees exact normalised command once`, `invalid signature never reaches callback`, and `conflicting digest is not rewritten by transport` tests using synthetic signatures. Assert `expect(calls).toHaveLength(1)` for valid input and `expect(calls).toHaveLength(0)` for invalid/tampered/missing signatures. Keep existing probe tests untouched initially and observe new missing-export failures.
- [x] **2. Extract.** Move only shared protocol into the private package, with static old-path forwarding where appropriate. The legacy wrapper retains legacy reply decoding and status mapping; the live app will supply its own response projection. Preserve request-owned Flue channels and exact-byte verification. No dynamic imports or direct Hono dependency.
- [x] **3. Pin cleanup/security.** Cover aborted/slow/overflowing body reads, rejecting or pending cancellation, unsupported media/event/action, malformed IDs and ping. Assert zero onVerified callbacks for ignored/invalid input, exact original digest and no leaked reader lock. Preserve pending-cancellation ownership rather than forcing a false disposal success.
- [x] **4. Verify/commit.** Run focused protocol tests, old probe suites and full gates; commit `refactor: share verified GitHub protocol boundary`. Independent review must confirm old behaviour rather than accepting updated tests as parity proof.

## Task 3: Model Request-Bound Evidence And Replay-First Admission

**Files:** domain and engine files/tests listed in the map, including the real
inferred service factories/ports and test-only `memory-live-inbox.ts`.

**Consumes:** existing schemas/keys and shared interfaces above. **Produces:**
schema-derived live records/provenance, pure `decideLiveAdmission(input)`, real
`makeLiveInbox`, `makeLiveAuthority`, and `makeLiveAdmission` service factories.
Native implementation comes later; memory storage is tests only.

- [x] **1. RED domain cases.** Use trusted fixture wall time 1000, first observation 900, expiry 6900 and monotonic start 100. Test coherent write/admin acceptance, read/none refusal, absent/wrong-key/wrong-operator evidence, invalid IDs, custom role names, future/rollback times and expiry equality. Assert `expect(decision._tag).toBe('AdmittedPreview')` for the coherent control and `expect(decideAt(6900)._tag).toBe('Rejected')` at exclusive expiry; define these named fixture functions in this task's test file.
- [x] **2. Implement pure schemas/policy.** Add LocalPolicy/LiveChecked discriminated provenance and the live draft union; derive types rather than casts/booleans. Reuse existing pure policy where its semantics match, but never give live evidence the legacy shared snapshot lifecycle. No changes to old AdmissionRecord/AuthorityState or old evidence artifacts.
- [x] **3. RED service cases.** Define the test memory driver implementing the exact synchronous Result contracts. Add `known replay performs zero authority calls`, `unknown eligible comment performs a fresh call`, `unknown denied operator performs zero calls`, `two operators cannot share evidence`, `operational failure stores no decision`, `competing policy revision refuses commit`, and `same delivery changed digest conflicts before network`. Count actual calls and records; a different delivery of a recorded command may add only a receipt.
- [x] **4. Implement inferred services.** Follow existing service-factories.ts: deferred native calls, structured input/output decoding, tagged sanitised failures, cancellation-aware tryPromise at the authority boundary and named spans. Replay resolution precedes live checks, while final commit rechecks uniqueness and policy/time. No promise-returning Effect service method or fake type-inference factory.
- [x] **5. Add eight laws.** Four domain laws: coherent binding plus single-ID mutations; rename invariance; exclusive expiry/invalid-clock refusal; provenance/permission integrity. Four engine sequence laws: delivery permutation deduplication; command/receipt conflict history; operator/policy isolation; failed/interrupted checks cannot admit. Use Effect Arbitrary/checkLaw conventions, 1000 primary runs at seeds 0, 1, 163, size 50, maxShrinks 1000, maxDiscards 10000, sequences at most 25. Exactly 24000 new primary cases per full execution; exclude shrinks/control runs from this count and retain old law budgets.
- [x] **6. Verify/commit.** Run focused domain/engine tests with constructive accepted controls, full gates and chosen independent review; commit `feat: model fresh GitHub admission evidence`. Generated inputs must preserve enough coherence to exercise success, not only schema rejection.

## Task 4: Implement Bounded GitHub Authentication And Access Reads

**Files:** adapter `src/github-auth.ts`, `github-http.ts`,
`github-authority.ts`, `tests/github-authority.test.ts`; explicit `./authority`
export. No engine imports of jose or HTTP clients.

**Consumes:** Task 1 signing and Task 3 AuthorityQuery/LiveAuthorityDriver contracts.
**Produces:** `makeGitHubAuthorityDriver` returning valid request-bound evidence
or finite LiveAuthorityError values; interruption reaches every HTTP/body read.

- [ ] **1. RED protocol fixture.** Inject a recording Fetch implementation and synthetic key/clock. Assert the exact sequence: GET `/app/installations/{id}` with App JWT; POST `/app/installations/{id}/access_tokens` with `repository_ids: [configuredId]` and only necessary read grants; GET `/repositories/{id}`; GET `/user/{operatorId}`; GET `/repos/{canonicalOwner}/{canonicalRepo}/collaborators/{canonicalUser}/permission`. Send `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2026-03-10`; host is fixed `https://api.github.com`. No live network is used.
- [ ] **2. Implement auth/HTTP.** Use jose importPKCS8/SignJWT RS256, issuer bound to configured App ID, bounded clock-based JWT lifetime within GitHub's documented limit. Import key once at service acquisition; no token/permission reuse between new commands. Keep fetch redirect mode `manual`, no retry, explicit AbortSignal, two-second attempt/six-second total budgets, maximum 1 MiB streamed response and schema decode. Cancel/release response readers on every exit. Use structured errors without request headers, URLs with secrets, raw bodies or native cause text.
- [ ] **3. Implement evidence checks.** Validate installation App/account/id/suspended state, restricted token scope/expiry, repository/owner IDs and archived/disabled state, canonical user ID/type, and permission response user ID. Accept only base write/admin, not role_name. Sample first observation before the initial lookup, not after the final permission call; retain request-local monotonic start for commit validation.
- [ ] **4. Pin failures.** Test all permission values and missing fields; false-positive custom roles; user rename/reassigned login; repository rename/transfer; changed installation; 401/403/404/429/5xx; malformed JSON/UTF8/oversized/chunked responses; redirect attempts; expired token; each timeout/abort phase, including a pending response body. Assert zero follow-up requests after failure and no raw secrets in serialised errors.
- [ ] **5. Verify/commit.** Full gates and focused adapter tests, then `feat: verify live GitHub admission authority`. Report endpoint/token/grant behaviour as synthetic compatibility only; actual App permissions remain unproven until the separately approved rehearsal.

## Task 5: Persist Immutable Evidence In A Strictly Opened Local Inbox

**Files:** adapter `src/local-state.ts`, `live-sqlite-storage.ts`,
`live-sqlite-inbox.ts`, corresponding tests; explicit `./storage` export.

**Consumes:** Task 3 live driver/draft contracts, Effect FileSystem/Path from the
application layer and bun:sqlite. **Produces:** initializeLiveInbox/openLiveInbox,
read-only status and exclusive listener ownership, preserving legacy probe files.

- [ ] **1. RED storage cases.** Test absent file/start, existing zero-byte file, legacy probe schema, wrong scope/version, corrupt rows, missing policy, stale revision and inaccessible state. Assert start never creates a file/table or changes bytes on those failures. `init` exclusively creates version 1 and refuses an existing path. Test permission bits and symlinked final/parent paths with real native files on supported platforms.
- [ ] **2. Implement schema and local state.** Separate explicit creation DDL from create-disabled validation. Use WAL/FULL/FK/zero busy timeout, unique command/transport keys, immutable provenance/evidence in each decision, local policy revision history and a persisted wall-clock floor. Evidence rows/JSON belong to their decision transaction; do not store a shared live permission snapshot. Bound all persisted metadata through schemas.
- [ ] **3. Implement replay/commit/update.** Atomically resolve receipt conflicts and duplicate commands before any new decision; commit re-resolves after live checks, compares current local revision, validates evidence IDs/key/permission/wall and monotonic expiry, and inserts decision/evidence/receipt together. Trusted updatePolicy refuses revision reuse, changed expectedRevision or revision capacity; no request endpoint can call it. Known receipt replay reads succeed at capacity; a new receipt may refuse.
- [ ] **4. Prove races and rollback.** Two native connections race for one command, different operators and policy update; inject failures after decision/evidence/receipt and before/after commit. Verify no partial keys/evidence, no caller mutation, explicit Busy, capacity at 256/1024/256, exact expiry, wall rollback and per-request monotonic lease isolation. Test no fresh permission reuse after reopen and no downgrade to legacy schema.
- [ ] **5. Prove filesystem/ownership.** Resolve absolute external paths through FileSystem/Path, create only under owner-only verified parents, and protect database/WAL/SHM from first creation. Explicit init also creates `<database>.owner.sqlite` (0600), bound to the same canonical database identity. Hold `BEGIN EXCLUSIVE` on a separate bun:sqlite connection to that rollback-journal ownership database for the listener/configure lifetime; never hold a transaction open on the admission ledger across network work. Another owner gets Busy; process death releases the kernel-held SQLite lock without a stale PID/lockfile deletion algorithm. Start refuses absent/mismatched ownership state. Test concurrent owners with different ports and real child death. Read-only status does not acquire listener ownership or require credentials. Partial initialization refuses startup and requires operator recovery; never silently repair it. If native ownership cannot satisfy these cases, stop for review, not a new dependency/waiver. Reject unsafe/synced paths according to a documented explicit-root policy rather than guessing a cloud provider from a filename.
- [ ] **6. Verify/commit.** Full gates and real adapter tests; commit `feat: persist immutable live admission evidence`. Preserve original probe tests and historical evidence, which do not qualify the new schema.

## Task 6: Add The Bounded Local CLI And Listener

**Files:** app files/tests and explicit Moon project from the map; app dependencies
on adapter/engine/domain/effect and Task 1 platform-bun, exact pins only.

**Consumes:** Tasks 2-5 protocol, services and storage. **Produces:** init/start/
status/configure commands, one ManagedRuntime application boundary, bounded
loopback listener and minimal public responses. No public tunnel starts in tests.

- [ ] **1. RED config/CLI.** Schema-decode explicit config and argv; test default path, --database, unknown/duplicate flags, zero/unsafe IDs, empty/duplicate allowlist, incompatible file, missing secret references and invalid permissions. init/status/configure do not load real credentials; start requires explicit owner-only key/secret references. Do not auto-read .env or hidden profile defaults. Test configure requires stopped ingress plus expectedRevision and never touches replay keys.
- [ ] **2. Implement composition/entrypoint.** Supply BunFileSystem/BunPath/Stdio implementations at one boundary, not a broad child-process layer. Snapshot config/secret material, acquire key/storage/services, then listen on 127.0.0.1:8787. Keep Layer assembly out of request handlers; use the one ManagedRuntime bridge. main.ts owns argv/signals/exit only, with no Node imports or direct process.env reads. Public source exports must not execute a server on import.
- [ ] **3. RED listener limits.** Test ephemeral-port listener with fake API and synthetic credentials: fifth concurrent request is 429, 61st start within rolling 60000ms is 429, exactly expired rate-window entries no longer count, slow body/permission request hits the eight-second budget, and GitHub sub-budget is six seconds/two seconds per attempt. Use controlled clock/deferred work for limit assertions, plus bounded actual HTTP tests; no arbitrary sleeps or extended test timeouts.
- [ ] **4. Implement listener/response projection.** Serve only POST /webhook; no public status/admin route. Rate/concurrency checks precede expensive work; release slots on completion/abort. On fresh or historical success expose only minimal disposition plus opaque bounded correlation ID, not full record, policy or evidence. Preserve typed malformed/signature/media/conflict/operational statuses; saturation is 429. Recognise verified ping/ignored events without authority calls. Never ACK an uncommitted preview.
- [ ] **5. Pin cancellation/shutdown.** Abort in body/API/evidence/commit-boundary phases; assert no detached late commit. On signal stop accepts, drain, interrupt owned reads and await real disposal. At 10000ms a stuck finalizer causes bounded nonzero process exit with sanitised failed-shutdown status, never a fake clean close; main owns forced termination, not an inner service. Verify in a child process and separately inspect ledger recovery. Do not add BunRuntime.runMain or another Effect runner beside ManagedRuntime to obtain signal handling.
- [ ] **6. Verify/commit.** Full gates, actual loopback tests, strict source/import check and independent review; commit `feat: add bounded local GitHub admission CLI`. No live start command, App credentials or tunnel during implementation qualification.

## Task 7: Qualify Recovery And Publish A Local-Only Runbook

**Files:** app `tests/restart.test.ts`, `tests/restart-child.ts`, pure
`src/qualification-report.ts` and `tests/qualification-report.test.ts`; adapter
regression tests if findings require; README, roadmap, runbook, assessment and
evidence paths from the map. Do not overwrite old offline evidence files.

**Consumes:** complete local app and ledger. **Produces:** source-bound measured
local qualification report plus a usable, explicitly gated rehearsal runbook.
`validateLocalQualification(input: unknown)` schema-decodes measured source/lock,
gate exits/log hashes, restored controls and actual totals, returning a Result
with finite validation reasons. It cannot set live/deployed qualification flags.

- [ ] **1. RED restart/ambiguity cases.** Use phase sentinels and parent-owned watchdogs for real SIGKILL before transaction, after decision/evidence write, after commit/before response and while API work is pending. Reopen with synthetic credentials and confirm zero or one complete record, matching immutable evidence, no seeded history, released ownership and replay without fresh API checks where applicable. Restore of an older snapshot must be labelled replay-history loss, not automatically reconciled into completeness.
- [ ] **2. Behavioural controls.** Temporarily break each of evidence binding, policy revision barrier, replay uniqueness, transaction rollback and abort ownership separately. Each focused case must fail twice for the intended reason, then exact source restoration and GREEN. Save control logs and restoration hashes; never commit a control mutation or count controls as property cases.
- [ ] **3. Run full gates.** Sequential frozen install, root check, every workspace's uncached typecheck/test, whitespace and dependency/policy identity checks. Record exit codes, exact suite/assertion totals, 24000 new primary law cases separately from legacy law counts/shrinks, log hashes and source tree identity. Test report schema rejects missing/nonzero gates, unknown source identities and absent controls. Do not infer a passing result from a planned command list.
- [ ] **4. Write runbook/report.** Document proposed CLI syntax, owner-only config/secret files, explicit init/start/status/configure, tunnel setup done by operator, exact permission checks, redelivery, full-capacity stop, failed shutdown, backup/reset caveats and secret-safe evidence. Default live checklist remains unchecked: real IDs, App grant inspection, tunnel provider/URL, external database path, finite duration, operator command/revocation/redelivery and restoration actions all need separate approval. Record live unavailable, no production durability/availability or exactly-once execution claim.
- [ ] **5. Commit/review.** Commit `test: qualify local GitHub ingress recovery`; obtain a fresh whole-branch review and fix findings with verified commits. Link tested source separately from later docs-only evidence commits. Ask the owner how to integrate only after clean review/gates; do not merge/push or start the rehearsal implicitly.

## Full Gate Block

Run sequentially from the actual implementation checkout with minimal explicit
environment (`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"`), no credentials.
During baseline omit only workspaces not yet created; after their task adds them,
all apply. A failure stops dependent work; no cache/affected-only substitution.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
moon run domain:typecheck --force --no-actions
moon run engine:typecheck --force --no-actions
moon run probe:typecheck --force --no-actions
moon run github-admission:typecheck --force --no-actions
moon run github-adapter:typecheck --force --no-actions
moon run github-ingress:typecheck --force --no-actions
moon run domain:test --force --no-actions
moon run engine:test --force --no-actions
moon run probe:test --force --no-actions
moon run github-admission:test --force --no-actions
moon run github-adapter:test --force --no-actions
moon run github-ingress:test --force --no-actions
git diff --check
```

Inspect the final lock delta, root override, physical Effect resolution and all
141 rule severities. Existing two patch SHA256 values remain:
Flue `07d115c8c98bea3c28011afe76e838a89a5126b2f401bad1091af678c008931a`;
Gaxios `7ea7b1f29d158ab1595b71f798b71c9c44249ae29567b12dcf6d5d7e35239e3e`.
Record new lock SHA256; baseline is
`a03b2f20874301814ba165f945b3fa55df5f20023f29ba5b873f3d16537cadc3`.

## Planning Evidence And Stop Conditions

Read-only planning confirmed npm manifests exist for
[@effect/platform-bun 4.0.5](https://registry.npmjs.org/@effect%2Fplatform-bun/4.0.5)
and [platform-node-shared 4.0.5](https://registry.npmjs.org/@effect%2Fplatform-node-shared/4.0.5).
The former declares the latter as `^4.0.5`, hence the exact override. jose 6.2.12
is already transitively locked; its [upstream manifest](https://github.com/panva/jose/blob/v6.2.12/package.json)
declares Web API/Bun support. This is metadata/source evidence, not artifact
integrity, installed strict types, SQLite ownership-lock or runtime qualification.

The implementation must stop for review rather than add a waiver when the
candidate cohort, SQLite ownership guard, response cancellation or bounded
shutdown cannot satisfy this plan. Do not add a lock dependency, platform escape,
queue, permission cache, Node fallback or broader GitHub grant automatically.

## Execution Handoff

The owner selected subagent-driven execution. Continue remaining tasks with
independent task review before dependent code adopts their contracts, then a fresh
whole-branch review. The execution choice does not authorise a live rehearsal,
merge or push. Checkboxes above identify accepted tasks, not live readiness.
