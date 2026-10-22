# FoldKit Replay Profile Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a read-only CLI that inspects the reviewed FoldKit replay profile,
validates its identity/request contract and explains why native execution remains blocked.

**Architecture:** Keep profile schemas and inspection decisions pure in domain.
Store the reviewed case as central JSON data. A small Bun application reads only
that profile with bounded I/O and emits a validated report; it owns no worker,
Docker, ledger, model or GitHub capability.

**Tech Stack:** Existing Bun 1.4.2, Effect 4.0.5, Effect Schema/Result/Arbitrary,
TypeScript 7.0.2, Moon, Oxlint and Oxfmt. No new third-party dependency versions.

**Spec:** [Approved replay/profile/worker design](../specs/2026-10-21-foldkit-replay-profile-design.md),
approved by the owner on 2026-10-21. This is Plan A, not the complete native-worker implementation.

## Global Constraints

- Design base: Ceirean `eeabe7f`; this plan is documentation until owner review and execution-method selection.
- Replay repository `opsydyn/fold-kit-experiments`; base `b7484cb46e66b162c8afddcfba235c9507b4f0ab`.
- FoldKit `0.165.0` to exact `0.166.0`; Vite plugin exact `0.26.1`; Effect remains `4.0.0` in the consumer.
- Historical reference `248636efea03a2048432260da6261bb657a282dc` is evaluator-only; do not put it in model-visible profile/report inputs.
- The first profile is Draft and publication Disabled. This plan cannot emit Ready/Qualified or authorize a run.
- Colima profile `ceirean` is a declared target, not an observed or approved running daemon.
- Proposed per-run caps: 2700000 ms, two repairs, one active run; per-worker 2 CPUs, 8 GiB RAM, 256 PIDs and 20 GiB writable storage.
- Proposed output caps: 10485760 bytes per command and 536870912 bytes total retained artifacts. These remain unapproved/unmeasured execution settings.
- No installs, builds or tests of consumer code; no Colima/Docker commands, host inspection, network, model calls, SQLite initialization or publication through the inspector.
- No API keys, cloud credentials, repository secrets or live-admission state are loaded.
- Universal Effect lint rules and existing declaration policies stay unchanged. No helper-local provisioning or manual Effect/Layer channels.
- Prefer Effect-native properties using the existing `checkLaw` helper: seeds 0/1/163, 1000 runs, existing shrink/discard budgets.
- Run check, all-workspace types and tests before each task commit; commit only verified task changes. Do not push without authorization.

## Scope And Follow-On Plans

The approved spec spans independently reviewable subsystems. Implement only the
profile-inspection subsystem here. Do not create placeholder native adapters or
claim that a parsed profile is an executable plan.

| Plan                  | Outcome                                                                        | Boundary                                                 |
| --------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| A: this plan          | Working offline profile inspector with explicit blockers                       | No execution capability                                  |
| B: later written plan | Native run/worker journal, ownership and recovery                              | Existing actor authority preserved; no migration implied |
| C: later written plan | Colima/Docker mechanism and measured isolation/readiness                       | Separate host/setup approval before any daemon operation |
| D: later written plan | Prepared artifacts, immutable acceptance harness, Flue tools and manual replay | Exact identities, model/data/spend/window approval first |

Plans B-D require their own detailed review. Plan A implements the spec's draft
profile/data boundary only; native readiness, egress, quotas, cleanup, browser
proof, paid reasoning and accepted migration remain explicitly unimplemented.

**Proposed implementation appetite:** one engineering day for these three tasks,
including qualification/review. This is an allowance proposal for plan approval,
not a completion estimate or authorization for native/cloud/model costs. Stop
and report if the inspector needs broader capabilities to be useful.

## File Structure

| File                                                                 | Responsibility                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `profiles/foldkit-0166-replay.json`                                  | Central Draft case, exact identities, proposed policy and unresolved qualification fields |
| `packages/domain/src/replay-profile.ts`                              | Strict data schemas, bounded fields, request/profile decoding and sanitized problems      |
| `packages/domain/src/replay-inspection.ts`                           | Pure request comparison and always-blocked Draft report construction                      |
| `packages/domain/tests/replay-fixtures.ts`                           | Independent synthetic valid draft/request fixtures, not runtime source                    |
| `packages/domain/tests/replay-profile.test.ts`                       | Decoder and canonical-profile tests                                                       |
| `packages/domain/tests/replay-inspection.test.ts`                    | Deterministic policy/report tests                                                         |
| `packages/domain/tests/replay-properties.test.ts`                    | Generated scope/identity/immutability laws                                                |
| `apps/replay/src/reader.ts`                                          | Bounded regular-file profile read and SHA-256 of original bytes                           |
| `apps/replay/src/cli.ts`                                             | `inspect` only; one exported Effect composition boundary                                  |
| `apps/replay/src/main.ts`                                            | Guarded Bun entrypoint and exit code, no import-time execution                            |
| `apps/replay/tests/reader.test.ts`, `cli.test.ts`, `process.test.ts` | Synthetic filesystem/CLI proof and forbidden-mode controls                                |
| `apps/replay/package.json`, `tsconfig.json`, `moon.yml`              | Working private app, strict types and workspace gates                                     |
| `apps/replay/README.md`                                              | Exact invocation, exit meanings, capabilities absent and qualification limits             |

Modify domain `src/index.ts` for actual exports, `.moon/workspace.yml` for the
working app and `.fallowrc.json` for its executable entrypoint. Root workspace
globs already cover `apps/*`. Register only workspace dependencies in `bun.lock`;
no package upgrades or unrelated lock churn. Update roadmap and add measured
`docs/assessments/foldkit-replay-profile.md` with actual results, not planned counts.

## Review Focus

1. Structurally valid but different repository/base/targets must not be described as the approved replay: Task 2 identity tests/properties.
2. Unknown fields, permissive executable scope or fabricated qualification flags must not become authority: Tasks 1-2 rejection tests and always-blocked law.
3. Read limits must hold if a file grows after metadata inspection; raw credentials/errors must not reach output: Task 3 bounded-read and redaction tests.
4. Importing the entrypoint or asking for `run` must not initialize workers, databases or models: Task 3 process/import negative controls.
5. The report must distinguish declared settings from measured facts and keep source input immutable: Task 2 evidence/immutability laws and Task 3 source digest tests.

## Task 1: Strict Draft Profile And Central Case

**Files:** Create central JSON, `replay-profile.ts`, `replay-fixtures.ts` and
`replay-profile.test.ts`; modify domain `src/index.ts`.

**Interfaces:**

- Produces schema/value/type `DraftReplayProfile`, `ReplayRequest` and `ProfileProblem`.
- Produces `decodeDraftProfile(input: unknown): Result.Result<DraftReplayProfile, ProfileProblem>`.
- Produces `decodeReplayRequest(input: unknown): Result.Result<ReplayRequest, ProfileProblem>`.
- Test fixtures export `validDraft()` and `validRequest()` returning independent JSON-shaped records; tests may load the canonical JSON with `Bun.file`, but domain source performs no I/O.
- `ProfileProblem` is sanitized tagged data: `InvalidProfile`, `InvalidRequest`, `RepositoryMismatch`, `BaseMismatch` or `TargetsMismatch`; never include raw input or library exception text.

- [x] **Step 1: Write failing decoder tests.** Test `accepts the reviewed draft`, `canonical JSON matches approved case`, `rejects unknown keys at every object level`, `rejects Qualified and enabled publication`, `rejects invalid paths and command descriptors`, `rejects invalid limits`, and `rejects credentials/executable extension fields`.
      Assert each invalid decode is Failure with the exact problem tag; error JSON contains no sentinel inserted in an unknown `apiKey`/`env` field. No constructor can turn untrusted input into a qualified profile.
- [x] **Step 2: Run red.** `cd packages/domain && bun --no-env-file --no-install test tests/replay-profile.test.ts`; expect missing new module/schema exports before implementation.
- [x] **Step 3: Implement data and decoders.** Use Effect Schema with strict excess-property rejection, finite safe integers, bounded strings/arrays and schema-derived types. Use existing `Digest` for digests; Git commit SHA is a separate 40-hex field, not a SHA-256 Digest.
      JSON fields are `schemaVersion: 1`, `profileId`, `status: 'Draft'`, `repository: { slug, baseSha }`, `targets: { fromFoldkit, foldkit, vitePlugin, effect }`, `host: { provider: 'ColimaDocker', profile: 'ceirean', qualification: 'Unqualified' }`, `publication: 'Disabled'`, `limits`, `scope`, `checks`, `journeys`, and `qualification`.
      Require qualification fields `image`, `toolchain`, `acceptance`, `execution` and `modelPolicy` all to be `Unqualified`; no secrets, shell hooks or open extension map. `ReplayRequest` contains mode `InspectOnly`, repository slug, base SHA and exact target map.
      All four target strings are exact stable `major.minor.patch` versions: reject ranges, dist-tags, URLs and prereleases in this first contract. Require lowercase 40-hex commit SHA and a bounded `owner/repository` slug with no URL scheme, extra segments or traversal. Request comparison is exact and conservative; inspection does not establish live repository ownership.
      `limits` uses exact keys `durationMs`, `maxRepairAttempts`, `maxActiveRuns`, `cpuCores`, `memoryBytes`, `pidLimit`, `writableBytes`, `commandOutputBytes` and `artifactBytes`; encode GiB as 1073741824 bytes. Reject zero/negative/nonfinite/unsafe integers, except `maxRepairAttempts` may be zero. String/array caps are profileId 64, slug 256, path 512, argv token 1024, 32 tokens per command, 64 checks, 128 scope paths and 16 journeys; these limits bound parsing/report construction, not native runtime enforcement.
      `scope` has `manifests` entries `{ path, allowedJsonPointers }`, `sourceRules` entries `{ path, rule: 'CarouselLiftAccessor' | 'PromoTemplatePins' }`, `generatedPaths`, `documentationPaths`, `forbiddenPaths` and `allowedFoldkitPeerRange`. JSON pointers name only existing dependency/peer fields; the peer range is exactly `>=0.165.0 <0.167.0`. These named source rules are descriptive identifiers from reviewed code, not executable hooks or proof that a patch has been inspected. `checks` entries have `{ id, cwd, argv }`; `journeys` entries have `{ id, path, interactions, viewports: [{ width, height }] }`. IDs are bounded identifiers, not expression/code hooks. Duplicate check/journey IDs, manifest paths, scope paths or JSON pointers are invalid.
      Paths are normalized repository-relative POSIX paths: reject absolute paths, backslashes, empty/dot/dot-dot segments, NUL/control characters and duplicate destinations. Permit `.` only as a command cwd. Command descriptors use fixed argv arrays, never shell strings; this task only parses them.
- [x] **Step 4: Populate the canonical draft.** Pin the identities/caps in Global Constraints. Manifest pointers: web `/dependencies/foldkit` and `/dependencies/@foldkit~1vite-plugin`; promo `/dependencies/foldkit`; Astro integration `/devDependencies/foldkit`, `/dependencies/@foldkit~1vite-plugin`, `/peerDependencies/foldkit`; Viz `/devDependencies/foldkit`, `/peerDependencies/foldkit`. Use their exact `package.json` paths from the spec. Source rules address only the carousel subscription and promo example-project paths; generatedPaths is only `bun.lock`. Documentation paths are the two package READMEs and `docs/migrations/foldkit-0.166.md`. Test/workflow/config/script edits remain forbidden and unlisted edits default-denied in the later native patch validator. Put only observed root install/check/type/test/build and web build-storybook argv/cwd descriptors in `checks`; do not invent commands for the not-yet-built consumer/browser harness.
      `journeys` records `/carousel` and `/examples/line`, their required interactions and viewports 1440x900/390x844. Leave `qualification.acceptance` as `Unqualified` for missing consumer/browser harnesses; never put fabricated argv there. No reference commit, historical answer, model key, image placeholder digest or fake qualification result appears in this JSON.
- [x] **Step 5: Run green and full gates.** Repeat the focused command, then root `bun --no-env-file run check`, `moon run :typecheck --force --no-actions`, `moon run :test --force --no-actions`. Expect all gates exit 0; record measured totals rather than retaining 962 as a required future count.
- [x] **Step 6: Review scope and commit.** Commit only this task as `feat(domain): define draft replay profile contract`.

## Task 2: Pure Inspection And Fail-Closed Properties

**Files:** Create `replay-inspection.ts`, `replay-inspection.test.ts` and
`replay-properties.test.ts`; extend fixtures/exports as needed without changing the canonical case.

**Interfaces:**

- Consumes Task 1 decoders, `DraftReplayProfile`, `ReplayRequest` and `ProfileProblem`.
- Produces schema/value/type `ReplayInspection` with `_tag: 'Blocked'`, `profileId`, declared `repository`, `targets`, `limits`, `checkIds`, `publication: 'Disabled'`, `canExecute: false`, and ordered `blockers`.
- Produces `inspectReplayRequest(profile: DraftReplayProfile, input: unknown): Result.Result<ReplayInspection, ProfileProblem>`.
- Blockers are exactly `ProfileRevisionUnverified`, `HostUnqualified`, `ImageUnqualified`, `ToolchainUnqualified`, `AcceptanceUnqualified`, `ExecutionUnapproved`, `ModelPolicyUnapproved` in that order. Parsing this file cannot remove them.
- No Effect runtime, journal, filesystem, process or actor service is introduced.

- [x] **Step 1: Write failing deterministic tests.** Matching request returns Blocked with all seven blockers and `canExecute: false`; wrong repository/base/any exact target returns its mismatch tag. Invalid input returns InvalidRequest. Declared check IDs are not check results; report has no `passed`, Ready/Qualified tag or qualification receipt. Mutating the returned report cannot change input profile/request objects.
      Example assertions using the Task 1 fixtures and Result match:
      `expect(report._tag).toBe('Blocked')`, `expect(report.canExecute).toBe(false)`,
      `expect(report.blockers).toEqual(theSevenOrderedBlockers)`.
- [x] **Step 2: Run red.** `cd packages/domain && bun --no-env-file --no-install test tests/replay-inspection.test.ts`; expect missing inspector export, then verify failures pin the intended behavior as implementation appears.
- [x] **Step 3: Implement pure inspection.** Decode the request, compare the approved profile's exact identities and construct fresh bounded report data. Do not accept requested image/model/host overrides or interpret repository instructions. Return schema-validated output, not a cast. No alias to mutable input arrays/objects may escape.
- [x] **Step 4: Add and run properties.** Use existing `checkLaw` with unchanged budgets. Laws: every accepted Draft request remains blocked; generated repository/base/target mismatches cannot pass; invalid/noncanonical paths cannot decode; unknown qualification/execution fields cannot authorize; inspection preserves deep input equality even after returned arrays are modified. Generate both valid and invalid cases constructively so rejection laws are non-vacuous.
      Run `cd packages/domain && bun --no-env-file --no-install test tests/replay-inspection.test.ts tests/replay-properties.test.ts --timeout 30000`; expect every seed and requested run count to complete, no skip/filter replacing a law.
- [x] **Step 5: Run full gates and commit.** Root check, all-workspace types and tests exit 0. Commit as `feat(domain): inspect replay requests without execution authority`.

## Task 3: Working Read-Only Inspector CLI And Evidence

**Files:** Create the `apps/replay` files in File Structure; modify Moon/Fallow
registration, root lockfile and roadmap; create the measured assessment.

**Interfaces:**

- Consumes Task 1 profile decoder, Task 2 inspector/report and existing Effect/Bun platform layers.
- Produces `readDraftProfile(path: string)` as an inferred Effect-returning function yielding `{ profile, sourceDigest }`; a bounded descriptor read, not arbitrary user-selected CLI access.
- Produces `runCli(argv: ReadonlyArray<string>)` as an inferred Effect-returning function yielding `{ exitCode, stdout, stderr }`. Provide the required platform layer once at this exported boundary, never in a local helper.
- Produces `main(argv: ReadonlyArray<string>)` at the guarded entrypoint. Importing the module does not invoke it.
- Exact command: `bun --no-env-file --no-install apps/replay/src/main.ts inspect`. No path, run, target, key, config or execution flags.
- The source path resolves only to central `profiles/foldkit-0166-replay.json` relative to the installed source module, never current cwd. Internal reader tests can supply temporary fixture paths; the public CLI cannot.
- Valid Draft inspection exits 2 with one JSON line containing `{ _tag: 'InspectionReport', report, sourceDigest, profileOrigin: 'UnverifiedWorkingTree' }`. Define and validate that envelope with an internal Effect Schema in `cli.ts`, using Task 2's `ReplayInspection` and existing `Digest`; `sourceDigest` hashes original bytes. Invalid/read failures exit 1 with a sanitized code; unsupported/missing args exit 64 before file I/O. No qualification or Git-revision attestation is made.

- [x] **Step 1: Write failing reader/CLI tests.** Valid canonical file reports the reviewed identity and all blockers; invalid JSON/UTF-8, unreadable/nonregular/symlink input, unknown keys and oversized file fail safely. Hard read maximum is 262145 bytes and maximum accepted profile is 262144 bytes; a growing file cannot bypass the bound through a prior stat. No partial JSON/report is emitted.
      Assert digest equals SHA-256 of original file bytes, not reserialized JSON. Working cwd cannot select another profile. Error output contains neither sentinel file contents, caller path nor native exception text. Bound machine output to 16384 bytes; oversized output is a sanitized failure, not silent truncation presented as complete JSON.
- [x] **Step 2: Run red.** Create only app test/package metadata needed for discovery and the three exact workspace dependencies named in Step 4; link them with a script-disabled root install in the isolated execution worktree, inspect the lock delta, then `cd apps/replay && bun --no-env-file --no-install test`. Expect missing reader/CLI behavior, not unrelated missing dependencies. No worker/module stub satisfies a test. Step 4 finishes registration after implementation; it does not introduce a second dependency install requirement.
- [x] **Step 3: Implement bounded reading and inspection.** Use scoped Effect FileSystem `open` with `noFollow: true`, descriptor `stat` and capped `readAlloc`; these APIs exist in the pinned Effect 4.0.5. Trust only the controller-owned parent directory, reject final-component symlinks/nonregular descriptors and never claim parent-directory traversal is prevented by `noFollow` alone. Read no more than the cap plus one byte and decode UTF-8 strictly. Map failures to internal finite reader codes `ReadFailed`, `NotRegular`, `ProfileTooLarge`, `InvalidEncoding` or `InvalidProfile`, without raw causes. Construct the matching InspectOnly request from the decoded canonical profile and call Task 2, without importing engine/runtime/model/infra modules. Keep stdout/stderr as returned data until the entrypoint emits it. No implicit config discovery, directory creation or writes.
- [x] **Step 4: Finish workspace metadata.** Private `@ceirean/replay`, ESM, scripts `typecheck: tsc --noEmit` and CLI with `bun --no-env-file --no-install src/main.ts`; dependencies only `@ceirean/domain: workspace:*`, `effect: 4.0.5`, `@effect/platform-bun: 4.0.5`. Follow existing app Moon tasks with `envFile: false`, no retries/cache; `skipLibCheck: false`. Add Moon project `replay: apps/replay` and Fallow executable root; no new lint exceptions or source ignores. Regenerate the workspace lock with scripts disabled and inspect the delta.
- [x] **Step 5: Add process-level negative controls.** Spawn the actual CLI with an allowlisted environment and `--no-env-file --no-install` in a synthetic cwd containing a sentinel `.env`; assert expected exit 2 and no sentinel in output. Import main and assert no stdout/side effects. `run`, arbitrary `--profile`, `--api-key` and extra args exit 64 before reader invocation. Temp working directories remain unchanged. This app has no persistence, subprocess-execution tool, network or lifecycle imports; inspect its static import graph in review. Tests only spawn the known inspector executable, never Docker/Colima or consumer code.
- [x] **Step 6: Run focused and full gates.** `moon run replay:test replay:typecheck --force --no-actions`, root check and all-workspace types/tests must exit 0. Direct inspector invocation must exit 2, with parseable schema-valid JSON and all blockers; an exit 0 would be a defect. No API key or local operational configuration is required.
- [x] **Step 7: Write measured docs and commit.** README explains command/exit codes, seven explicit blockers, non-authoritative working-tree origin, source digest and capabilities absent. Assessment records actual commands/counts, raw-output digest, one restored negative control (temporarily emit canExecute true; test must fail; restore and rerun) and clear absence of native execution/isolation proof. Update roadmap for completed offline inspection only. Commit as `feat(replay): add bounded offline profile inspector`.

## Self-Review And Handoff

- [x] Plan self-review: every named schema/function/file has an owning task and consistent signatures at consumption sites.
- [x] Plan self-review: no fabricated digests/toolchain patches, historical answer or future runnable harness commands are proposed.
- [x] Plan self-review: all five Review Focus risks map to tests in their owning tasks.
- [x] Confirm all new exports have real consumers; no optional future native APIs are scaffolded.
- [x] Independently review the complete implementation diff and run fresh final root check/types/tests. Stop on material findings; document review and measured fixes.
- [x] Hand off the working inspector and remaining B-D gates. Native worker execution still needs separately approved implementation plans, exact identities and finite host/model execution approval.

Plan self-review is against the approved spec, not an authorization to implement
Plans B-D. At execution, inspect existing managed worktrees and reuse a suitable
one or create isolation through the worktree workflow. Preserve all current
operator credentials/state and unrelated branches. Recommend inline execution
for this three-task pure-data/CLI slice with one final independent review;
subagent-driven execution remains available if the owner prefers per-task review.
